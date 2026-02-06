/**
 * X402 Facilitator Service - Official SDK Integration
 * 
 * Uses @crypto.com/facilitator-client for proper x402 payment flows.
 * This is the CORE x402 integration for the hackathon.
 */

import { logger } from '../utils/logger';
import { 
  Facilitator, 
  CronosNetwork, 
  Contract,
  type PaymentRequirements,
  type VerifyRequest,
  type X402VerifyResponse,
  type X402SettleResponse,
} from '@crypto.com/facilitator-client';
import { ethers } from 'ethers';

// Network configuration - use proper CronosNetwork enum
const IS_TESTNET = process.env.NETWORK !== 'cronos-mainnet';
const NETWORK = IS_TESTNET ? CronosNetwork.CronosTestnet : CronosNetwork.CronosMainnet;

// Contract addresses from SDK
const USDC_CONTRACT = IS_TESTNET ? Contract.DevUSDCe : Contract.USDCe;

// Platform merchant address (receives x402 fees)
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS || process.env.NEXT_PUBLIC_PLATFORM_ADDRESS || '';

/**
 * Payment settlement result
 */
export type PayResult =
  | { ok: true; txHash?: string; paymentId: string }
  | { ok: false; error: 'verify_failed' | 'settle_failed' | 'invalid_request'; details?: unknown };

/**
 * X402 payment challenge response (402 Payment Required)
 */
export interface X402Challenge {
  x402Version: number;
  error?: string;
  accepts: Array<{
    scheme: 'exact';
    network: CronosNetwork;
    payTo: string;
    asset: string;
    maxAmountRequired: string;
    maxTimeoutSeconds: number;
    description?: string;
    resource?: string;
    mimeType?: string;
    extra?: {
      paymentId: string;
    };
  }>;
}

/**
 * Payment challenge for API responses (alias)
 */
export type PaymentChallenge = X402Challenge;

/**
 * Payment result for settlements
 */
export interface PaymentResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * X402 Facilitator Service
 * 
 * Provides x402 payment capabilities using the official Cronos SDK.
 */
export class X402FacilitatorService {
  private facilitator: Facilitator;
  private entitlements = new Map<string, { txHash?: string; settledAt: number }>();
  private network: CronosNetwork;

  constructor(network: CronosNetwork = NETWORK) {
    this.network = network;
    this.facilitator = new Facilitator({ network: this.network });
  }

  /**
   * Generate a unique payment ID
   */
  generatePaymentId(): string {
    return `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Create a 402 Payment Required challenge
   * 
   * @param options - Challenge options OR amount string
   * @param description - Human-readable description (if options is string)
   * @param resource - Resource being paid for (if options is string)
   */
  createPaymentChallenge(
    options: string | { amount: number; currency?: string; description: string; resource: string; expiry?: number },
    description?: string,
    resource?: string
  ): X402Challenge {
    const paymentId = this.generatePaymentId();
    
    // Handle both object and string signatures
    let amount: string;
    let desc: string;
    let res: string;
    let maxTimeout: number = 300;
    
    if (typeof options === 'object') {
      // Object signature: convert amount to string (USDC has 6 decimals)
      amount = (options.amount * 1_000_000).toString();
      desc = options.description;
      res = options.resource;
      maxTimeout = options.expiry || 300;
    } else {
      // String signature (legacy)
      amount = options;
      desc = description || '';
      res = resource || '';
    }
    
    return {
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: this.network,
        payTo: MERCHANT_ADDRESS,
        asset: USDC_CONTRACT,
        maxAmountRequired: amount,
        maxTimeoutSeconds: maxTimeout,
        description: desc,
        resource: res,
        mimeType: 'application/json',
        extra: {
          paymentId,
        },
      }],
    };
  }

  /**
   * Generate a payment header for client-side signing
   * 
   * @param to - Recipient address
   * @param value - Amount in base units
   * @param signer - Ethers signer
   * @param validBefore - Unix timestamp for validity window
   */
  async generatePaymentHeader(
    to: string,
    value: string,
    signer: ethers.Signer,
    validBefore?: number
  ): Promise<string> {
    const defaultValidBefore = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    
    return this.facilitator.generatePaymentHeader({
      to,
      value,
      signer,
      validBefore: validBefore || defaultValidBefore,
      validAfter: 0,
    });
  }

  /**
   * Verify and settle an x402 payment
   * 
   * This is the SERVER-SIDE settlement flow:
   * 1. Verify the payment header signature
   * 2. Execute the on-chain settlement
   * 3. Store entitlement for future access
   */
  async settlePayment(params: {
    paymentId: string;
    paymentHeader: string;
    paymentRequirements: PaymentRequirements;
  }): Promise<PayResult> {
    const { paymentId, paymentHeader, paymentRequirements } = params;

    if (!paymentId || !paymentHeader || !paymentRequirements) {
      return { ok: false, error: 'invalid_request', details: 'Missing required fields' };
    }

    const verifyRequest: VerifyRequest = {
      x402Version: 1,
      paymentHeader,
      paymentRequirements,
    };

    try {
      // Step 1: Verify the payment
      logger.info('X402 Verifying payment', { paymentId });
      const verifyResponse = await this.facilitator.verifyPayment(verifyRequest) as X402VerifyResponse;
      
      if (!verifyResponse.isValid) {
        logger.error('X402 Verification failed', undefined, { response: verifyResponse });
        return { 
          ok: false, 
          error: 'verify_failed', 
          details: verifyResponse,
        };
      }

      // Step 2: Settle the payment on-chain
      logger.info('X402 Settling payment', { paymentId });
      const settleResponse = await this.facilitator.settlePayment(verifyRequest) as X402SettleResponse;
      
      if (settleResponse.event !== 'payment.settled') {
        logger.error('X402 Settlement failed', undefined, { response: settleResponse });
        return { 
          ok: false, 
          error: 'settle_failed', 
          details: settleResponse,
        };
      }

      // Step 3: Store entitlement
      this.entitlements.set(paymentId, {
        txHash: settleResponse.txHash,
        settledAt: Date.now(),
      });

      logger.info('X402 Payment settled successfully', { txHash: settleResponse.txHash });
      return {
        ok: true,
        txHash: settleResponse.txHash,
        paymentId,
      };
    } catch (error) {
      logger.error('X402 Settlement error', error);
      return {
        ok: false,
        error: 'settle_failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if a payment ID has been settled (entitlement check)
   */
  isEntitled(paymentId: string): boolean {
    return this.entitlements.has(paymentId);
  }

  /**
   * Get entitlement details
   */
  getEntitlement(paymentId: string) {
    return this.entitlements.get(paymentId);
  }

  /**
   * Create payment requirements for a settlement action
   */
  createPaymentRequirements(
    amount: string,
    description: string = 'ZkVanguard Settlement'
  ): PaymentRequirements {
    return {
      scheme: 'exact',
      network: NETWORK as CronosNetwork,
      payTo: MERCHANT_ADDRESS,
      asset: USDC_CONTRACT,
      maxAmountRequired: amount,
      maxTimeoutSeconds: 300,
      description,
      mimeType: 'application/json',
    } as PaymentRequirements;
  }

  /**
   * Get the facilitator instance for advanced operations
   */
  getFacilitator(): Facilitator {
    return this.facilitator;
  }

  /**
   * Get network configuration
   */
  getNetworkConfig() {
    return {
      network: NETWORK,
      isTestnet: IS_TESTNET,
      usdcContract: USDC_CONTRACT,
      merchantAddress: MERCHANT_ADDRESS,
    };
  }
}

// Singleton instance
let facilitatorService: X402FacilitatorService | null = null;

export function getX402FacilitatorService(): X402FacilitatorService {
  if (!facilitatorService) {
    facilitatorService = new X402FacilitatorService();
  }
  return facilitatorService;
}

export default X402FacilitatorService;
