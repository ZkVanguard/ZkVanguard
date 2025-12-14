/**
 * @fileoverview x402 Facilitator API client for gasless EIP-3009 transfers
 * @module integrations/x402/X402Client
 */

import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';
import { logger } from '@shared/utils/logger';
import config from '@shared/utils/config';

export interface X402TransferRequest {
  token: string;
  from: string;
  to: string;
  amount: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
}

export interface X402BatchRequest {
  token: string;
  from: string;
  recipients: string[];
  amounts: string[];
  validAfter: number;
  validBefore: number;
  nonce: string;
}

export interface X402TransferResponse {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  gasUsed?: string;
  timestamp: number;
}

/**
 * x402 Facilitator client for gasless payments
 */
export class X402Client {
  private httpClient: AxiosInstance;
  private provider: ethers.Provider;
  private signer: ethers.Signer | null = null;

  constructor(provider?: ethers.Provider) {
    this.httpClient = axios.create({
      baseURL: config.x402FacilitatorUrl,
      headers: {
        'Authorization': `Bearer ${config.x402ApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.provider = provider || new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org');
  }

  /**
   * Set signer for authorization signatures
   */
  setSigner(signer: ethers.Signer): void {
    this.signer = signer;
  }

  /**
   * Execute gasless transfer via x402
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

      // Generate EIP-3009 authorization signature
      const signature = await this.signTransferAuthorization(request);

      // Submit to x402 Facilitator
      const response = await this.httpClient.post('/api/v1/transfer', {
        ...request,
        signature,
      });

      logger.info('Gasless transfer submitted', {
        txHash: response.data.txHash,
        status: response.data.status,
      });

      return response.data;
    } catch (error) {
      logger.error('Gasless transfer failed', { error, request });
      throw error;
    }
  }

  /**
   * Execute batch gasless transfers
   */
  async executeBatchTransfer(request: X402BatchRequest): Promise<X402TransferResponse> {
    if (!this.signer) {
      throw new Error('Signer not set. Call setSigner() first.');
    }

    try {
      logger.info('Executing batch gasless transfer via x402', {
        from: request.from,
        recipientCount: request.recipients.length,
        totalAmount: request.amounts.reduce((sum, amt) => sum + BigInt(amt), BigInt(0)).toString(),
      });

      // Generate signatures for each transfer
      const signatures = await this.signBatchAuthorization(request);

      // Submit to x402 Facilitator
      const response = await this.httpClient.post('/api/v1/batch-transfer', {
        ...request,
        signatures,
      });

      logger.info('Batch gasless transfer submitted', {
        txHash: response.data.txHash,
        status: response.data.status,
      });

      return response.data;
    } catch (error) {
      logger.error('Batch gasless transfer failed', { error, request });
      throw error;
    }
  }

  /**
   * Sign EIP-3009 transfer authorization
   */
  private async signTransferAuthorization(
    request: X402TransferRequest
  ): Promise<{ v: number; r: string; s: string }> {
    if (!this.signer) {
      throw new Error('Signer not set');
    }

    // EIP-712 domain separator
    const domain = {
      name: 'ChronosVanguardPaymentRouter',
      version: '1',
      chainId: (await this.provider.getNetwork()).chainId,
      verifyingContract: request.token, // Token contract address
    };

    // EIP-712 types
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

    // Message
    const message = {
      from: request.from,
      to: request.to,
      value: request.amount,
      validAfter: request.validAfter,
      validBefore: request.validBefore,
      nonce: request.nonce,
    };

    // Sign typed data
    const signature = await this.signer.signTypedData(domain, types, message);
    
    // Split signature
    const sig = ethers.Signature.from(signature);
    
    return {
      v: sig.v,
      r: sig.r,
      s: sig.s,
    };
  }

  /**
   * Sign batch authorization
   */
  private async signBatchAuthorization(
    request: X402BatchRequest
  ): Promise<Array<{ v: number; r: string; s: string }>> {
    const signatures = [];

    for (let i = 0; i < request.recipients.length; i++) {
      const transferRequest: X402TransferRequest = {
        token: request.token,
        from: request.from,
        to: request.recipients[i],
        amount: request.amounts[i],
        validAfter: request.validAfter,
        validBefore: request.validBefore,
        nonce: ethers.keccak256(ethers.toUtf8Bytes(`${request.nonce}-${i}`)),
      };

      const signature = await this.signTransferAuthorization(transferRequest);
      signatures.push(signature);
    }

    return signatures;
  }

  /**
   * Check transfer status
   */
  async getTransferStatus(txHash: string): Promise<X402TransferResponse> {
    try {
      const response = await this.httpClient.get(`/api/v1/transfer/${txHash}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch transfer status', { txHash, error });
      throw error;
    }
  }

  /**
   * Estimate gas savings
   */
  async estimateGasSavings(
    transferCount: number
  ): Promise<{ normalGas: string; x402Gas: string; savings: string; savingsPercent: number }> {
    try {
      const response = await this.httpClient.post('/api/v1/estimate-savings', {
        transferCount,
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to estimate gas savings', { error });
      throw error;
    }
  }

  /**
   * Get facilitator fee information
   */
  async getFeeInfo(): Promise<{ feePercent: number; minFee: string; maxFee: string }> {
    try {
      const response = await this.httpClient.get('/api/v1/fee-info');
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch fee info', { error });
      throw error;
    }
  }

  /**
   * Check if nonce has been used
   */
  async isNonceUsed(address: string, nonce: string): Promise<boolean> {
    try {
      const response = await this.httpClient.get(`/api/v1/nonce/${address}/${nonce}`);
      return response.data.used;
    } catch (error) {
      logger.error('Failed to check nonce', { address, nonce, error });
      throw error;
    }
  }

  /**
   * Generate unique nonce
   */
  generateNonce(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  /**
   * Calculate validity window (current time + buffer)
   */
  getValidityWindow(bufferSeconds: number = 300): { validAfter: number; validBefore: number } {
    const now = Math.floor(Date.now() / 1000);
    return {
      validAfter: now - 60, // 1 minute ago (to account for clock skew)
      validBefore: now + bufferSeconds, // 5 minutes from now (default)
    };
  }
}

// Singleton instance
export const x402Client = new X402Client();
