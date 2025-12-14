/**
 * @fileoverview Shared type definitions for blockchain interactions
 * @module shared/types/blockchain
 */

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface ContractAddresses {
  rwaManager: string;
  paymentRouter: string;
  zkVerifier: string;
  proofRegistry: string;
  vvsRouter?: string;
  moonlanderAdapter?: string;
  delphiContract?: string;
}

export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  gasUsed: bigint;
  status: 'success' | 'failed';
  events?: any[];
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  estimatedCost: bigint;
  estimatedCostUSD?: number;
}
