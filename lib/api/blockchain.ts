/**
 * Blockchain Integration
 * Real contract interactions on Cronos EVM testnet
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { CronosTestnet } from '../chains';

// Contract addresses (deployed on testnet)
export const CONTRACTS = {
  PAYMENT_ROUTER: '0x0000000000000000000000000000000000000000', // Replace with actual deployment
  RISK_ENGINE: '0x0000000000000000000000000000000000000000',
  ZK_VERIFIER: '0x0000000000000000000000000000000000000000',
  X402_BATCH_SENDER: '0x0000000000000000000000000000000000000000'
};

// Module-level singleton client (reused across all function calls)
let _publicClient: PublicClient | null = null;

/**
 * Create public client for reading blockchain data — cached singleton
 */
export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: CronosTestnet,
      transport: http()
    });
  }
  return _publicClient;
}

/**
 * Get real-time gas prices from Cronos EVM
 */
export async function getGasPrice() {
  const client = getPublicClient();
  try {
    const gasPrice = await client.getGasPrice();
    return {
      gasPrice: gasPrice.toString(),
      gasPriceGwei: Number(gasPrice) / 1e9,
      formattedPrice: `${(Number(gasPrice) / 1e9).toFixed(2)} Gwei`
    };
  } catch (error) {
    console.error('Failed to fetch gas price:', error);
    return {
      gasPrice: '0',
      gasPriceGwei: 0,
      formattedPrice: 'N/A'
    };
  }
}

/**
 * Get transaction count (nonce) for address
 */
export async function getTransactionCount(address: string) {
  const client = getPublicClient();
  try {
    const count = await client.getTransactionCount({ address: address as `0x${string}` });
    return count;
  } catch (error) {
    console.error('Failed to fetch transaction count:', error);
    return 0;
  }
}

/**
 * Get CRO balance for address
 */
export async function getBalance(address: string) {
  const client = getPublicClient();
  try {
    const balance = await client.getBalance({ address: address as `0x${string}` });
    return {
      balance: balance.toString(),
      balanceEther: Number(balance) / 1e18,
      formatted: `${(Number(balance) / 1e18).toFixed(4)} CRO`
    };
  } catch (error) {
    console.error('Failed to fetch balance:', error);
    return {
      balance: '0',
      balanceEther: 0,
      formatted: '0 CRO'
    };
  }
}

/**
 * Estimate gas for transaction batch
 */
export async function estimateBatchGas(transactions: unknown[]) {
  try {
    // Estimate gas for individual transactions
    const individualGas = transactions.length * 21000; // Base gas per transaction
    
    // Estimate gas for batched transaction (via x402)
    const batchedGas = 21000 + (transactions.length * 5000); // Much more efficient
    
    const gasSaved = individualGas - batchedGas;
    const gasSavingsPercent = (gasSaved / individualGas) * 100;
    
    return {
      individualGas,
      batchedGas,
      gasSaved,
      gasSavingsPercent: gasSavingsPercent.toFixed(2),
      estimatedCostCRO: (batchedGas * 0.00000001).toFixed(6) // Approximate
    };
  } catch (error) {
    console.error('Failed to estimate gas:', error);
    return {
      individualGas: 0,
      batchedGas: 0,
      gasSaved: 0,
      gasSavingsPercent: '0',
      estimatedCostCRO: '0'
    };
  }
}

/**
 * Get block number and timestamp
 */
export async function getLatestBlock() {
  const client = getPublicClient();
  try {
    const block = await client.getBlock();
    return {
      number: Number(block.number),
      timestamp: Number(block.timestamp),
      hash: block.hash,
      transactions: block.transactions.length
    };
  } catch (error) {
    console.error('Failed to fetch latest block:', error);
    return {
      number: 0,
      timestamp: 0,
      hash: '0x',
      transactions: 0
    };
  }
}

/**
 * Check if contract is deployed at address
 */
export async function isContractDeployed(address: string): Promise<boolean> {
  const client = getPublicClient();
  try {
    const code = await client.getBytecode({ address: address as `0x${string}` });
    return code !== undefined && code !== '0x';
  } catch (error) {
    return false;
  }
}

/**
 * Get network stats
 */
export async function getNetworkStats() {
  const client = getPublicClient();
  
  try {
    const [block, gasPrice] = await Promise.all([
      client.getBlock(),
      client.getGasPrice()
    ]);

    return {
      chainId: CronosTestnet.id,
      chainName: CronosTestnet.name,
      blockNumber: Number(block.number),
      blockTime: Number(block.timestamp),
      gasPrice: (Number(gasPrice) / 1e9).toFixed(2) + ' Gwei',
      isTestnet: true,
      explorer: CronosTestnet.blockExplorers?.default.url
    };
  } catch (error) {
    console.error('Failed to fetch network stats:', error);
    return {
      chainId: CronosTestnet.id,
      chainName: CronosTestnet.name,
      blockNumber: 0,
      blockTime: 0,
      gasPrice: 'N/A',
      isTestnet: true,
      explorer: CronosTestnet.blockExplorers?.default.url
    };
  }
}

/**
 * Simulate contract call to check if position would liquidate
 */
export async function checkLiquidationRisk(
  position: Record<string, unknown>
): Promise<{ atRisk: boolean; liquidationPrice: number; buffer: number }> {
  // In production, this calls the RiskEngine contract
  // For demo, we calculate locally
  const entryPrice = Number(position.entryPrice);
  const leverage = Number(position.leverage);
  const type = String(position.type);
  
  const liquidationBuffer = 0.10; // 10% buffer before liquidation
  
  let liquidationPrice: number;
  if (type === 'LONG') {
    liquidationPrice = entryPrice * (1 - liquidationBuffer / leverage);
  } else {
    liquidationPrice = entryPrice * (1 + liquidationBuffer / leverage);
  }
  
  const currentPrice = Number(position.currentPrice);
  const atRisk = type === 'LONG' 
    ? currentPrice < liquidationPrice * 1.2 
    : currentPrice > liquidationPrice * 0.8;
  
  const buffer = Math.abs((currentPrice - liquidationPrice) / currentPrice);
  
  return {
    atRisk,
    liquidationPrice,
    buffer: buffer * 100
  };
}
