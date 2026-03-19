/**
 * Tether WDK (Wallet Development Kit) Configuration
 * 
 * This module configures the Tether WDK for USDT integration across
 * supported EVM chains: Cronos and Arbitrum.
 * 
 * @see https://docs.wdk.tether.io/
 */

// ============================================
// USDT Contract Addresses (Official Tether)
// ============================================

/**
 * Official USDT contract addresses per chain.
 * 
 * Source: https://tether.to/en/transparency/#usdt
 * 
 * IMPORTANT: For Tether WDK Hackathon, use Sepolia which has OFFICIAL WDK USDT.
 * Cronos testnet only has MockUSDC (not official WDK).
 * 
 * For x402 payments: Use USD₮0 on Plasma/Stable chains
 */
export const USDT_ADDRESSES = {
  // Sepolia Testnet - OFFICIAL WDK USDT (use this for hackathon!)
  sepolia: {
    mainnet: null, // Sepolia is testnet only
    testnet: '0xd077a400968890eacc75cdc901f0356c943e4fdb', // OFFICIAL Tether WDK USDT
  },
  // Cronos Mainnet - Official USDT
  cronos: {
    mainnet: '0x66e428c3f67a68878562e79A0234c1F83c208770',
    testnet: null, // Cronos testnet has MockUSDC, NOT official WDK USDT
  },
  // Arbitrum - Official USDT  
  arbitrum: {
    mainnet: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    testnet: '0xA50E3d2C2110EBd08567A322e6e7B0Ca25341bF1', // MockUSDT on Arbitrum Sepolia
  },
  // Ethereum Mainnet (for reference)
  ethereum: {
    mainnet: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    testnet: null,
  },
  // x402 Recommended Chains - USD₮0 (bridge token)
  plasma: {
    mainnet: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USD₮0 on Plasma
    testnet: null,
  },
  stable: {
    mainnet: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', // USD₮0 on Stable
    testnet: null,
  },
} as const;

// ============================================
// USDT Token Metadata
// ============================================

export const USDT_METADATA = {
  name: 'Tether USD',
  symbol: 'USDT',
  decimals: 6,
  logo: 'https://cryptologos.cc/logos/tether-usdt-logo.svg',
} as const;

// ============================================
// WDK Chain Configuration
// ============================================

export interface WDKChainConfig {
  chainId: number;
  name: string;
  network: 'mainnet' | 'testnet';
  rpcUrl: string;
  usdtAddress: string | null;
  explorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * WDK-compatible chain configurations.
 * 
 * PRIORITY: Sepolia has official WDK USDT - use for Tether Hackathon demo!
 */
export const WDK_CHAINS: Record<string, WDKChainConfig> = {
  // ============================================
  // SEPOLIA - PRIMARY CHAIN FOR TETHER WDK HACKATHON
  // Has OFFICIAL WDK USDT token
  // ============================================
  'sepolia': {
    chainId: 11155111,
    name: 'Sepolia',
    network: 'testnet',
    rpcUrl: 'https://sepolia.drpc.org',
    usdtAddress: '0xd077a400968890eacc75cdc901f0356c943e4fdb', // OFFICIAL WDK USDT
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeCurrency: {
      name: 'Sepolia ETH',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  // Cronos Mainnet
  'cronos-mainnet': {
    chainId: 25,
    name: 'Cronos',
    network: 'mainnet',
    rpcUrl: 'https://evm.cronos.org',
    usdtAddress: USDT_ADDRESSES.cronos.mainnet,
    explorerUrl: 'https://cronoscan.com',
    nativeCurrency: {
      name: 'Cronos',
      symbol: 'CRO',
      decimals: 18,
    },
  },
  // Cronos Testnet - NOTE: Does NOT have official WDK USDT
  'cronos-testnet': {
    chainId: 338,
    name: 'Cronos Testnet',
    network: 'testnet',
    rpcUrl: 'https://evm-t3.cronos.org',
    usdtAddress: null, // NO official WDK USDT - use Sepolia instead
    explorerUrl: 'https://explorer.cronos.org/testnet',
    nativeCurrency: {
      name: 'Test Cronos',
      symbol: 'tCRO',
      decimals: 18,
    },
  },
  // Arbitrum One (Mainnet)
  'arbitrum-mainnet': {
    chainId: 42161,
    name: 'Arbitrum One',
    network: 'mainnet',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    usdtAddress: USDT_ADDRESSES.arbitrum.mainnet,
    explorerUrl: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  // Arbitrum Sepolia (Testnet)
  'arbitrum-sepolia': {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    network: 'testnet',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    usdtAddress: USDT_ADDRESSES.arbitrum.testnet,
    explorerUrl: 'https://sepolia.arbiscan.io',
    nativeCurrency: {
      name: 'Sepolia ETH',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  // ============================================
  // x402 RECOMMENDED CHAINS (Plasma & Stable)
  // Purpose-built for USD₮ transfers with near-instant finality
  // ============================================
  // Plasma - Primary recommended chain for x402 payments
  'plasma': {
    chainId: 9745,
    name: 'Plasma',
    network: 'mainnet',
    rpcUrl: 'https://rpc.plasma.to',
    usdtAddress: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USD₮0 on Plasma
    explorerUrl: 'https://plasmascan.to',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
  },
  // Stable - Secondary recommended chain for x402 payments
  'stable': {
    chainId: 988,
    name: 'Stable',
    network: 'mainnet',
    rpcUrl: 'https://rpc.stable.xyz',
    usdtAddress: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', // USD₮0 on Stable
    explorerUrl: 'https://stablescan.xyz',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
  },
} as const;

// ============================================
// Helper Functions
// ============================================

/**
 * Get the USDT address for a specific chain.
 * Returns null if USDT is not available on that chain (use MockUSDT for testnet).
 */
export function getUSDTAddress(chainId: number): string | null {
  const chain = Object.values(WDK_CHAINS).find(c => c.chainId === chainId);
  return chain?.usdtAddress ?? null;
}

/**
 * Get chain configuration by chain ID.
 */
export function getChainConfig(chainId: number): WDKChainConfig | undefined {
  return Object.values(WDK_CHAINS).find(c => c.chainId === chainId);
}

/**
 * Check if a chain is a mainnet (production) chain.
 */
export function isMainnet(chainId: number): boolean {
  const chain = getChainConfig(chainId);
  return chain?.network === 'mainnet';
}

/**
 * Get the appropriate deposit token address for a chain.
 * On mainnet: returns official USDT address
 * On testnet: returns the MockUSDC address from deployment config
 */
export function getDepositTokenAddress(
  chainId: number,
  mockUsdcAddress?: string
): string {
  const usdtAddress = getUSDTAddress(chainId);
  if (usdtAddress) {
    return usdtAddress;
  }
  // Fallback to MockUSDC for testnets
  if (mockUsdcAddress) {
    return mockUsdcAddress;
  }
  throw new Error(`No deposit token configured for chain ${chainId}`);
}

// ============================================
// WDK Provider Configuration
// ============================================

/**
 * Get WDK EVM wallet configuration for a chain.
 */
export function getWDKEvmConfig(chainId: number) {
  const chain = getChainConfig(chainId);
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  
  return {
    provider: chain.rpcUrl,
    chainId: chain.chainId,
  };
}

/**
 * Default supported chain IDs for WDK integration.
 * Includes x402 recommended chains (Plasma, Stable)
 * 
 * PRIORITY: Sepolia (11155111) has official WDK USDT for hackathon!
 */
export const WDK_SUPPORTED_CHAINS = [
  11155111, // Sepolia - OFFICIAL WDK USDT (primary for hackathon)
  25,       // Cronos Mainnet
  42161,    // Arbitrum One
  421614,   // Arbitrum Sepolia
  9745,     // Plasma (x402 primary)
  988,      // Stable (x402 secondary)
] as const;

export type WDKSupportedChainId = typeof WDK_SUPPORTED_CHAINS[number];
