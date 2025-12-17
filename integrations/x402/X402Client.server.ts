/**
 * @fileoverview x402 Facilitator API client for REAL gasless payments (Server-only)
 * Uses @crypto.com/facilitator-client SDK for true gasless transactions
 * @module integrations/x402/X402Client.server
 */

import { Facilitator, CronosNetwork } from '@crypto.com/facilitator-client';
import { ethers } from 'ethers';
import { logger } from '@shared/utils/logger';

export interface X402TransferRequest {
  token: string;
  from: string;
  to: string;
  amount: string;
  validAfter?: number;
  validBefore?: number;
  nonce?: string;
}

export interface X402BatchRequest {
  token: string;
  from: string;
  recipients: string[];
  amounts: string[];
  validAfter?: number;
  validBefore?: number;
  nonces?: string[];
}

export interface X402TransferResponse {
  success: boolean;
  txHash?: string;
  error?: string;
  jobId?: string;
}

/**
 * Real x402 Client using @crypto.com/facilitator-client SDK
 */
export class X402Client {
  private facilitator: Facilitator;
  private network: CronosNetwork;
  private signer: ethers.Signer | null = null;

  constructor(
    network: CronosNetwork = CronosNetwork.CronosTestnet,
    privateKey?: string
  ) {
    this.network = network;
    
    // Initialize signer if private key provided
    if (privateKey) {
      this.signer = new ethers.Wallet(privateKey);
    } else {
      const key = process.env.PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
      if (key) {
        this.signer = new ethers.Wallet(key);
      }
    }

    // Initialize Facilitator client (signer passed per-method, not in constructor)
    this.facilitator = new Facilitator({
      network: this.network,
    });

    logger.info('X402Client initialized', {
      network: this.network,
      hasSigner: !!this.signer,
      address: this.signer ? (this.signer as ethers.Wallet).address : undefined,
    });
  }

  /**
   * Set signer for authorization signatures
   */
  setSigner(signer: ethers.Signer): void {
    this.signer = signer;
  }

  /**
   * Execute gasless transfer via x402 Facilitator
   */
  async executeGaslessTransfer(request: X402TransferRequest): Promise<X402TransferResponse> {
    if (!this.signer) {
      throw new Error('Signer not set. Call setSigner() first.');
    }

    try {
      logger.info('Executing gasless transfer via x402', {
        from: request.from,
        to: request.to,
        amount: request.amount,
      });

      // Build payment requirements
      const paymentReq = await this.facilitator.generatePaymentRequirements({
        network: this.network,
        payTo: request.to,
        asset: request.token,
        description: 'Gasless payment via x402',
        maxAmountRequired: request.amount,
        maxTimeoutSeconds: 300,
      } as any);

      // Generate payment header (EIP-3009 signature)
      const paymentHeader = await this.facilitator.generatePaymentHeader({
        to: request.to,
        value: request.amount,
        asset: request.token as any,
        signer: this.signer,
        validAfter: request.validAfter,
        validBefore: request.validBefore,
      });

      // Settle payment via x402 - GASLESS!
      const settlement = await this.facilitator.settlePayment({
        x402Version: 1,
        paymentHeader,
        paymentRequirements: paymentReq,
      });

      logger.info('Gasless transfer settled via x402', {
        txHash: settlement.txHash,
        status: 'confirmed',
      });

      return {
        success: true,
        txHash: settlement.txHash,
      };
    } catch (error) {
      logger.error('x402 transfer failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Factory function to create X402Client instance
 */
export function createX402Client(
  network: CronosNetwork = CronosNetwork.CronosTestnet,
  privateKey?: string
): X402Client {
  return new X402Client(network, privateKey);
}

/**
 * Default client instance for Cronos Testnet
 */
let defaultClient: X402Client | null = null;

export function getX402Client(): X402Client {
  if (!defaultClient) {
    defaultClient = createX402Client();
  }
  return defaultClient;
}
