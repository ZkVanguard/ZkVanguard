/**
 * Multi-Chain Community Pool Configuration
 * 
 * Manages CommunityPool contract addresses and configurations across:
 * - Cronos (EVM) - Live on testnet
 * - Arbitrum - Live on Sepolia testnet
 * - SUI - Planned
 */

import { ChainType, NetworkType } from './addresses';

// ============================================
// TYPES
// ============================================

export interface PoolChainConfig {
  chainId: number | string;
  chainType: ChainType;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: {
    testnet: string;
    mainnet: string;
  };
  blockExplorer: {
    testnet: string;
    mainnet: string;
  };
  contracts: {
    testnet: {
      communityPool: `0x${string}`;
      usdc: `0x${string}`;
      pythOracle?: `0x${string}`;
    };
    mainnet: {
      communityPool: `0x${string}`;
      usdc: `0x${string}`;
      pythOracle?: `0x${string}`;
    };
  };
  assets: string[]; // Asset names tracked in this pool (e.g., ['BTC', 'ETH', 'SUI', 'CRO'])
  status: 'live' | 'testing' | 'planned' | 'deprecated';
}

export interface MultiChainPoolConfig {
  chains: Record<string, PoolChainConfig>;
  defaultChain: string;
  defaultNetwork: NetworkType;
}

// ============================================
// CHAIN CONFIGURATIONS
// ============================================

export const POOL_CHAIN_CONFIGS: Record<string, PoolChainConfig> = {
  cronos: {
    chainId: 338,
    chainType: 'evm',
    name: 'Cronos',
    shortName: 'CRO',
    icon: '🔷',
    color: 'bg-blue-600',
    nativeCurrency: {
      name: 'Cronos',
      symbol: 'CRO',
      decimals: 18,
    },
    rpcUrls: {
      testnet: 'https://evm-t3.cronos.org/',
      mainnet: 'https://evm.cronos.org/',
    },
    blockExplorer: {
      testnet: 'https://explorer.cronos.org/testnet',
      mainnet: 'https://explorer.cronos.org',
    },
    contracts: {
      testnet: {
        // CommunityPool V3 Proxy (upgraded 2026-03-12)
        communityPool: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30',
        usdc: '0x28217DAddC55e3C4831b4A48A00Ce04880786967', // MockUSDC on testnet (6 decimals)
        pythOracle: '0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320',
      },
      mainnet: {
        communityPool: '0x0000000000000000000000000000000000000000', // Not deployed yet
        usdc: '0x66e428c3f67a68878562e79A0234c1F83c208770', // Official Tether USDT on Cronos
        pythOracle: '0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B',
      },
    },
    // Pool tracks BTC, ETH, SUI, CRO allocations for cross-chain strategy
    assets: ['BTC', 'ETH', 'SUI', 'CRO'],
    status: 'live',
  },
  
  arbitrum: {
    chainId: 421614,
    chainType: 'arbitrum',
    name: 'Arbitrum',
    shortName: 'ARB',
    icon: '🔵',
    color: 'bg-cyan-500',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      testnet: 'https://sepolia-rollup.arbitrum.io/rpc',
      mainnet: 'https://arb1.arbitrum.io/rpc',
    },
    blockExplorer: {
      testnet: 'https://sepolia.arbiscan.io',
      mainnet: 'https://arbiscan.io',
    },
    contracts: {
      testnet: {
        communityPool: '0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B',
        usdc: '0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1', // MockUSDC on Arbitrum Sepolia (6 decimals)
        pythOracle: '0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF',
      },
      mainnet: {
        communityPool: '0x0000000000000000000000000000000000000000', // Not deployed yet
        usdc: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Official Tether USDT on Arbitrum
        pythOracle: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
      },
    },
    // Pool tracks BTC, ETH, SUI, ARB allocations for cross-chain strategy
    assets: ['BTC', 'ETH', 'SUI', 'ARB'],
    status: 'testing',
  },
  
  sui: {
    chainId: 'sui:testnet',
    chainType: 'sui',
    name: 'SUI',
    shortName: 'SUI',
    icon: '💧',
    color: 'bg-blue-400',
    nativeCurrency: {
      name: 'SUI',
      symbol: 'SUI',
      decimals: 9,
    },
    rpcUrls: {
      testnet: 'https://fullnode.testnet.sui.io:443',
      mainnet: 'https://fullnode.mainnet.sui.io:443',
    },
    blockExplorer: {
      testnet: 'https://suiscan.xyz/testnet',
      mainnet: 'https://suiscan.xyz/mainnet',
    },
    contracts: {
      testnet: {
        // Package ID - use create_pool to create CommunityPoolState shared object
        communityPool: '0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c',
        usdc: '0x0000000000000000000000000000000000000000', // Native SUI used
      },
      mainnet: {
        communityPool: '0x0000000000000000000000000000000000000000',
        usdc: '0x0000000000000000000000000000000000000000',
      },
    },
    // SUI Move chain - native SUI pool with BTC/ETH tracking
    assets: ['BTC', 'ETH', 'SUI'],
    status: 'testing',
  },
};

// ============================================
// MULTI-CHAIN POOL CONFIGURATION
// ============================================

export const MULTI_CHAIN_POOL_CONFIG: MultiChainPoolConfig = {
  chains: POOL_CHAIN_CONFIGS,
  defaultChain: 'cronos',
  defaultNetwork: 'testnet',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get pool configuration for a specific chain
 */
export function getPoolChainConfig(chainKey: string): PoolChainConfig | undefined {
  return POOL_CHAIN_CONFIGS[chainKey];
}

/**
 * Get community pool address for a specific chain and network
 */
export function getCommunityPoolAddress(
  chainKey: string,
  network: NetworkType = 'testnet'
): `0x${string}` {
  const config = POOL_CHAIN_CONFIGS[chainKey];
  if (!config) {
    return '0x0000000000000000000000000000000000000000';
  }
  return config.contracts[network === 'mainnet' ? 'mainnet' : 'testnet'].communityPool as `0x${string}`;
}

/**
 * Get USDC token address for a specific chain and network
 */
export function getUsdcAddress(
  chainKey: string,
  network: NetworkType = 'testnet'
): `0x${string}` {
  const config = POOL_CHAIN_CONFIGS[chainKey];
  if (!config) {
    return '0x0000000000000000000000000000000000000000';
  }
  return config.contracts[network === 'mainnet' ? 'mainnet' : 'testnet'].usdc as `0x${string}`;
}

/**
 * Get deposit token symbol based on chain and network
 * - Mainnet: USDT (Official Tether)
 * - Testnet: USDC (Mock stable for development)
 */
export function getDepositTokenSymbol(
  chainKey: string,
  network: NetworkType = 'testnet'
): string {
  // SUI uses USDC across all networks
  if (chainKey === 'sui') return 'USDC';
  // EVM chains: USDT on mainnet, USDC on testnet
  return network === 'mainnet' ? 'USDT' : 'USDC';
}

/**
 * Get full deposit token info
 */
export function getDepositTokenInfo(
  chainKey: string,
  network: NetworkType = 'testnet'
): { symbol: string; name: string; decimals: number; logo?: string } {
  const isMainnet = network === 'mainnet';
  const isSui = chainKey === 'sui';
  
  if (isSui || !isMainnet) {
    return {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logo: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg',
    };
  }
  
  // Mainnet EVM chains use official Tether USDT
  return {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logo: 'https://cryptologos.cc/logos/tether-usdt-logo.svg',
  };
}

/**
 * Get all active chains (live or testing)
 */
export function getActiveChains(): PoolChainConfig[] {
  return Object.values(POOL_CHAIN_CONFIGS).filter(
    c => c.status === 'live' || c.status === 'testing'
  );
}

/**
 * Get chain config by chainId (supports both number and string)
 */
export function getPoolChainByChainId(chainId: number | string): PoolChainConfig | undefined {
  return Object.values(POOL_CHAIN_CONFIGS).find(c => c.chainId === chainId);
}

/**
 * Get explorer URL for a transaction or address
 */
export function getPoolExplorerUrl(
  chainKey: string,
  type: 'tx' | 'address',
  value: string,
  network: NetworkType = 'testnet'
): string {
  const config = POOL_CHAIN_CONFIGS[chainKey];
  if (!config) return '';
  
  const baseUrl = config.blockExplorer[network === 'mainnet' ? 'mainnet' : 'testnet'];
  return `${baseUrl}/${type}/${value}`;
}

/**
 * Check if a chain's pool is deployed (address != zero)
 */
export function isPoolDeployed(
  chainKey: string,
  network: NetworkType = 'testnet'
): boolean {
  const address = getCommunityPoolAddress(chainKey, network);
  return address !== '0x0000000000000000000000000000000000000000';
}

/**
 * Get all deployed pools
 */
export function getDeployedPools(network: NetworkType = 'testnet'): string[] {
  return Object.keys(POOL_CHAIN_CONFIGS).filter(key => isPoolDeployed(key, network));
}

// ============================================
// COMMUNITY POOL ABI (shared across chains)
// ============================================

export const COMMUNITY_POOL_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'minAmountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
  {
    name: 'getPoolStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '_totalShares', type: 'uint256' },
      { name: '_totalNAV', type: 'uint256' },
      { name: '_memberCount', type: 'uint256' },
      { name: '_allocations', type: 'uint256[4]' },
    ],
  },
  {
    name: 'members',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'member', type: 'address' }],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'depositedUSD', type: 'uint256' },
      { name: 'withdrawnUSD', type: 'uint256' },
      { name: 'joinedAt', type: 'uint256' },
      { name: 'lastDepositAt', type: 'uint256' },
      { name: 'highWaterMark', type: 'uint256' },
    ],
  },
  {
    name: 'totalShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'calculateNAV',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ERC20 ABI subset for approvals
export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
