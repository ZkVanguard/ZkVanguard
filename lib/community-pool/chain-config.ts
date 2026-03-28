/**
 * Chain configuration for community pool multi-chain support
 */

import { POOL_CHAIN_CONFIGS, getCommunityPoolAddress } from '@/lib/contracts/community-pool-config';
import type { ChainConfig, ChainKey, NetworkType } from './types';

// Legacy constant for default chain (Cronos testnet)
export const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';

// Minimal ABI for reading pool stats
export const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function calculateTotalNAV() view returns (uint256)',
  'function totalShares() view returns (uint256)',
  'function getMemberCount() view returns (uint256)',
  'function memberList(uint256) view returns (address)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinTime)',
];

/**
 * Get RPC URL and pool address for a given chain/network
 * Falls back to Sepolia testnet (primary live chain) if invalid
 */
export function getChainConfig(chain?: string | null, network?: string | null): ChainConfig {
  const chainKey = (chain as ChainKey) || 'sepolia';
  const networkType: NetworkType = network === 'mainnet' ? 'mainnet' : 'testnet';
  
  const config = POOL_CHAIN_CONFIGS[chainKey];
  if (!config) {
    // Fallback to Sepolia testnet (primary live chain)
    const fallbackConfig = POOL_CHAIN_CONFIGS['sepolia'];
    return {
      rpcUrl: fallbackConfig?.rpcUrls?.testnet || 'https://sepolia.drpc.org',
      poolAddress: getCommunityPoolAddress('sepolia', 'testnet'),
      chainKey: 'sepolia',
      network: 'testnet',
      assets: fallbackConfig?.assets || ['BTC', 'ETH', 'SUI', 'CRO'],
    };
  }
  
  const rpcUrl = networkType === 'mainnet' ? config.rpcUrls.mainnet : config.rpcUrls.testnet;
  const poolAddress = networkType === 'mainnet' 
    ? config.contracts.mainnet.communityPool 
    : config.contracts.testnet.communityPool;
  
  return { rpcUrl, poolAddress, chainKey, network: networkType, assets: config.assets };
}
