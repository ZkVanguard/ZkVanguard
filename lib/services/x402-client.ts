/**
 * x402 Client Service - WDK Implementation
 * 
 * Official WDK x402 integration for making paid HTTP requests.
 * Based on: https://docs.wdk.tether.io/
 * 
 * The x402 protocol enables HTTP payments using EIP-3009 transferWithAuthorization.
 * 
 * Flow:
 * 1. Client requests resource
 * 2. Server responds with 402 Payment Required + challenge
 * 3. Client signs EIP-3009 authorization
 * 4. Client retries with X-PAYMENT header
 * 5. Facilitator verifies and settles payment
 * 6. Server returns resource
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import {
  X402_NETWORKS,
  X402_FACILITATORS,
  DEFAULT_FACILITATOR,
  USDT0_METADATA,
  X402PaymentChallenge,
  X402PaymentOption,
  X402SettlementResult,
  getX402Network,
  getAuthorizationWindow,
  generateAuthorizationNonce,
  type X402NetworkKey,
} from '../config/x402-config';

// ============================================
// EIP-3009 TYPES
// ============================================

/**
 * EIP-3009 TransferWithAuthorization message structure
 */
export interface EIP3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
}

/**
 * Signed authorization payload
 */
export interface SignedAuthorization extends EIP3009Authorization {
  v: number;
  r: string;
  s: string;
}

// ============================================
// x402 CLIENT CONFIGURATION
// ============================================

export interface X402ClientConfig {
  /** Network to use for payments */
  network: X402NetworkKey;
  /** Private key or signer for authorization */
  signer: ethers.Signer | string;
  /** Custom facilitator URL (optional) */
  facilitatorUrl?: string;
  /** Timeout for payment operations in ms */
  timeout?: number;
}

// ============================================
// x402 CLIENT SERVICE
// ============================================

/**
 * x402 Payment Client
 * 
 * Handles the client-side of x402 payment protocol:
 * - Signing EIP-3009 authorizations
 * - Automatic 402 response handling
 * - Payment retry logic
 */
export class X402Client {
  private network: X402NetworkKey;
  private signer: ethers.Signer;
  private provider: ethers.JsonRpcProvider;
  private facilitatorUrl: string;
  private timeout: number;

  constructor(config: X402ClientConfig) {
    this.network = config.network;
    this.facilitatorUrl = config.facilitatorUrl || DEFAULT_FACILITATOR.url;
    this.timeout = config.timeout || 30000;

    // Initialize provider
    const networkConfig = X402_NETWORKS[config.network];
    this.provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

    // Initialize signer
    if (typeof config.signer === 'string') {
      this.signer = new ethers.Wallet(config.signer, this.provider);
    } else {
      this.signer = config.signer;
    }
  }

  /**
   * Get the signer's address
   */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  /**
   * Get USD₮0 balance for the signer
   */
  async getBalance(): Promise<bigint> {
    const networkConfig = X402_NETWORKS[this.network];
    const address = await this.getAddress();
    
    const erc20 = new ethers.Contract(
      networkConfig.usdt0Address,
      ['function balanceOf(address) view returns (uint256)'],
      this.provider
    );
    
    return erc20.balanceOf(address);
  }

  /**
   * Sign an EIP-3009 TransferWithAuthorization
   * 
   * @param to - Recipient address
   * @param value - Amount in smallest unit (6 decimals)
   * @param maxTimeoutSeconds - Validity window
   */
  async signAuthorization(
    to: string,
    value: string,
    maxTimeoutSeconds: number = 300
  ): Promise<SignedAuthorization> {
    const from = await this.getAddress();
    const { validAfter, validBefore } = getAuthorizationWindow(maxTimeoutSeconds);
    const nonce = generateAuthorizationNonce();

    const networkConfig = X402_NETWORKS[this.network];

    // EIP-712 domain for USD₮0
    const domain = {
      name: USDT0_METADATA.name,
      version: USDT0_METADATA.version,
      chainId: networkConfig.chainId,
      verifyingContract: networkConfig.usdt0Address,
    };

    // EIP-712 types for TransferWithAuthorization
    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    };

    // Message to sign
    const message = {
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
    };

    // Sign with EIP-712 (ethers v6 uses signTypedData)
    const signature = await (this.signer as ethers.Wallet).signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    return {
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
      v,
      r,
      s,
    };
  }

  /**
   * Create X-PAYMENT header from signed authorization
   */
  createPaymentHeader(authorization: SignedAuthorization): string {
    const networkConfig = X402_NETWORKS[this.network];
    
    const payload = {
      scheme: 'exact',
      network: networkConfig.caip2,
      payload: {
        signature: ethers.Signature.from({
          v: authorization.v,
          r: authorization.r,
          s: authorization.s,
        }).serialized,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          nonce: authorization.nonce,
        },
      },
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Handle 402 Payment Required response
   * 
   * Parses the challenge, signs authorization, and creates payment header
   */
  async handlePaymentRequired(challenge: X402PaymentChallenge): Promise<string> {
    // Find an accepted payment option for our network
    const networkConfig = X402_NETWORKS[this.network];
    const option = challenge.accepts.find(opt => opt.network === networkConfig.caip2);

    if (!option) {
      // Try to find any supported network
      const supportedOption = challenge.accepts.find(opt => {
        const network = getX402Network(opt.network);
        return network !== null;
      });

      if (!supportedOption) {
        throw new Error(`No supported payment network in challenge. Supported: ${networkConfig.caip2}`);
      }

      logger.warn('Using different network for payment', { 
        requested: networkConfig.caip2, 
        using: supportedOption.network 
      });
    }

    const paymentOption = option || challenge.accepts[0];

    // Check balance
    const balance = await this.getBalance();
    const requiredAmount = BigInt(paymentOption.maxAmountRequired);
    
    if (balance < requiredAmount) {
      throw new Error(`Insufficient USD₮0 balance. Required: ${requiredAmount}, Have: ${balance}`);
    }

    // Sign authorization
    const authorization = await this.signAuthorization(
      paymentOption.payTo,
      paymentOption.maxAmountRequired,
      300 // 5 minute validity
    );

    // Create payment header
    return this.createPaymentHeader(authorization);
  }

  /**
   * Make a paid HTTP request with automatic 402 handling
   * 
   * @param url - Resource URL
   * @param options - Fetch options
   */
  async fetchWithPayment(url: string, options: RequestInit = {}): Promise<Response> {
    // First request - may return 402
    const initialResponse = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(this.timeout),
    });

    // If not 402, return as-is
    if (initialResponse.status !== 402) {
      return initialResponse;
    }

    // Parse 402 challenge
    const challenge: X402PaymentChallenge = await initialResponse.json();

    if (challenge.x402Version !== 1) {
      throw new Error(`Unsupported x402 version: ${challenge.x402Version}`);
    }

    // Handle payment
    const paymentHeader = await this.handlePaymentRequired(challenge);

    // Retry with payment header
    const paidResponse = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'X-PAYMENT': paymentHeader,
      },
      signal: AbortSignal.timeout(this.timeout),
    });

    return paidResponse;
  }

  /**
   * Get network configuration
   */
  getNetworkConfig() {
    return X402_NETWORKS[this.network];
  }
}

// ============================================
// FACILITATOR CLIENT (HTTP Client for Hosted Facilitator)
// ============================================

/**
 * HTTP Facilitator Client
 * 
 * Communicates with a hosted facilitator (e.g., Semantic Pay)
 * for payment verification and settlement.
 */
export class X402FacilitatorClient {
  private facilitatorUrl: string;

  constructor(facilitatorUrl: string = DEFAULT_FACILITATOR.url) {
    this.facilitatorUrl = facilitatorUrl.replace(/\/$/, '');
  }

  /**
   * Verify a payment header
   */
  async verify(paymentHeader: string, paymentRequirements: X402PaymentOption): Promise<{
    isValid: boolean;
    payer?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.facilitatorUrl}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          x402Version: 1,
          paymentHeader,
          paymentRequirements,
        }),
      });

      return response.json();
    } catch (error) {
      logger.error('Facilitator verify error', error);
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Settle a payment on-chain
   */
  async settle(paymentHeader: string, paymentRequirements: X402PaymentOption): Promise<X402SettlementResult> {
    try {
      const response = await fetch(`${this.facilitatorUrl}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          x402Version: 1,
          paymentHeader,
          paymentRequirements,
        }),
      });

      const result = await response.json();
      
      return {
        success: result.success || result.event === 'payment.settled',
        transactionHash: result.transactionHash || result.txHash,
        network: paymentRequirements.network,
        settledAt: Date.now(),
        error: result.error,
      };
    } catch (error) {
      logger.error('Facilitator settle error', error);
      return {
        success: false,
        network: paymentRequirements.network,
        settledAt: Date.now(),
        error: error instanceof Error ? error.message : 'Settlement failed',
      };
    }
  }
}

// ============================================
// SINGLETON INSTANCES
// ============================================

let defaultClient: X402Client | null = null;

/**
 * Get or create default x402 client
 */
export function getX402Client(config?: X402ClientConfig): X402Client {
  if (config) {
    return new X402Client(config);
  }
  
  if (!defaultClient) {
    const privateKey = process.env.X402_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('X402_PRIVATE_KEY or PRIVATE_KEY environment variable required');
    }
    
    defaultClient = new X402Client({
      network: (process.env.X402_NETWORK as X402NetworkKey) || 'cronos-testnet',
      signer: privateKey,
    });
  }

  return defaultClient;
}

// ============================================
// EXPORTS
// ============================================

export default {
  X402Client,
  X402FacilitatorClient,
  getX402Client,
};
