/**
 * Network Utilities
 * Helper functions for mainnet/testnet detection and explorer URLs
 */

// ============================================
// CHAIN CONSTANTS
// ============================================

export const CHAIN_IDS = {
  CRONOS_MAINNET: 25,
  CRONOS_TESTNET: 338,
  CRONOS_ZKEVM: 388,
  HARDHAT: 31337,
} as const;

export const EXPLORER_URLS = {
  [CHAIN_IDS.CRONOS_MAINNET]: 'https://explorer.cronos.org',
  [CHAIN_IDS.CRONOS_TESTNET]: 'https://explorer.cronos.org/testnet',
  [CHAIN_IDS.CRONOS_ZKEVM]: 'https://explorer.zkevm.cronos.org',
  [CHAIN_IDS.HARDHAT]: '',
} as const;

export const SUI_EXPLORER_URLS = {
  mainnet: 'https://suiexplorer.com',
  testnet: 'https://suiexplorer.com/?network=testnet',
  devnet: 'https://suiexplorer.com/?network=devnet',
} as const;

// ============================================
// NETWORK DETECTION
// ============================================

/**
 * Get the current chain ID from environment
 */
export function getCurrentChainId(): number {
  const envChainId = process.env.NEXT_PUBLIC_CHAIN_ID;
  if (envChainId) {
    const parsed = parseInt(envChainId, 10);
    if (!isNaN(parsed)) return parsed;
  }
  // Default to testnet
  return CHAIN_IDS.CRONOS_TESTNET;
}

/**
 * Check if we're on mainnet
 */
export function isMainnet(): boolean {
  return getCurrentChainId() === CHAIN_IDS.CRONOS_MAINNET;
}

/**
 * Check if we're on testnet
 */
export function isTestnet(): boolean {
  return getCurrentChainId() === CHAIN_IDS.CRONOS_TESTNET;
}

/**
 * Get network name from chain ID
 */
export function getNetworkName(chainId?: number): string {
  const id = chainId ?? getCurrentChainId();
  switch (id) {
    case CHAIN_IDS.CRONOS_MAINNET:
      return 'cronos-mainnet';
    case CHAIN_IDS.CRONOS_TESTNET:
      return 'cronos-testnet';
    case CHAIN_IDS.CRONOS_ZKEVM:
      return 'cronos-zkevm';
    case CHAIN_IDS.HARDHAT:
      return 'hardhat';
    default:
      return 'unknown';
  }
}

// ============================================
// EXPLORER URL HELPERS
// ============================================

/**
 * Get explorer base URL for a chain ID
 */
export function getExplorerUrl(chainId?: number): string {
  const id = chainId ?? getCurrentChainId();
  return EXPLORER_URLS[id as keyof typeof EXPLORER_URLS] || EXPLORER_URLS[CHAIN_IDS.CRONOS_TESTNET];
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerTxUrl(txHash: string, chainId?: number): string {
  const baseUrl = getExplorerUrl(chainId);
  if (!baseUrl) return '';
  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Get explorer URL for an address
 */
export function getExplorerAddressUrl(address: string, chainId?: number): string {
  const baseUrl = getExplorerUrl(chainId);
  if (!baseUrl) return '';
  return `${baseUrl}/address/${address}`;
}

/**
 * Get SUI explorer URL for a transaction
 */
export function getSuiExplorerTxUrl(txDigest: string, network: 'mainnet' | 'testnet' | 'devnet' = 'testnet'): string {
  const baseUrl = SUI_EXPLORER_URLS[network];
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl.split('?')[0]}/txblock/${txDigest}${network !== 'mainnet' ? `?network=${network}` : ''}`;
}

/**
 * Get SUI network from environment
 */
export function getSuiNetwork(): 'mainnet' | 'testnet' | 'devnet' {
  const network = process.env.BLUEFIN_NETWORK || process.env.SUI_NETWORK || 'testnet';
  if (network === 'mainnet' || network === 'testnet' || network === 'devnet') {
    return network;
  }
  return 'testnet';
}

// ============================================
// TOKEN ADDRESSES
// ============================================

/**
 * Get USDT address for current network (via Tether WDK)
 */
export function getUsdtAddress(chainId?: number): `0x${string}` {
  const id = chainId ?? getCurrentChainId();
  switch (id) {
    case CHAIN_IDS.CRONOS_MAINNET:
      // Official Tether USDT on Cronos Mainnet
      return '0x66e428c3f67a68878562e79A0234c1F83c208770';
    case CHAIN_IDS.CRONOS_TESTNET:
      // USDT Mock on Cronos Testnet (via WDK)
      return '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
    case CHAIN_IDS.CRONOS_ZKEVM:
      // USDT on Cronos zkEVM
      return '0x0000000000000000000000000000000000000000'; // Not deployed yet
    default:
      return '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
  }
}

// Legacy alias for backward compatibility
export const getUsdcAddress = getUsdtAddress;

/**
 * Get Moonlander contract address for current network
 */
export function getMoonlanderAddress(chainId?: number): `0x${string}` {
  const id = chainId ?? getCurrentChainId();
  switch (id) {
    case CHAIN_IDS.CRONOS_MAINNET:
      // Real Moonlander Diamond on mainnet
      return '0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9';
    case CHAIN_IDS.CRONOS_TESTNET:
      // Also use mainnet Moonlander (it works cross-network)
      return '0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9';
    case CHAIN_IDS.CRONOS_ZKEVM:
      return '0x02ae2e56bfDF1ee4667405eE7e959CD3fE717A05';
    default:
      return '0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9';
  }
}

// ============================================
// RPC URLS
// ============================================

/**
 * Get RPC URL for a chain
 */
export function getRpcUrl(chainId?: number): string {
  const id = chainId ?? getCurrentChainId();
  switch (id) {
    case CHAIN_IDS.CRONOS_MAINNET:
      return process.env.CRONOS_MAINNET_RPC || 'https://evm.cronos.org/';
    case CHAIN_IDS.CRONOS_TESTNET:
      return process.env.CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org/';
    case CHAIN_IDS.CRONOS_ZKEVM:
      return process.env.CRONOS_ZKEVM_RPC || 'https://mainnet.zkevm.cronos.org/';
    case CHAIN_IDS.HARDHAT:
      return 'http://127.0.0.1:8545';
    default:
      return 'https://evm-t3.cronos.org/';
  }
}
