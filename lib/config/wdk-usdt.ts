/**
 * Tether WDK USDT Token Configuration
 * 
 * Official Tether WDK USDT addresses for supported networks.
 * These are REAL Tether tokens - not mocks.
 * 
 * Faucets (Testnet):
 *   - Pimlico: https://dashboard.pimlico.io/test-erc20-faucet
 *   - Candide: https://dashboard.candide.dev/faucet
 * 
 * @see https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-erc-4337/configuration
 */

export interface WDKUSDTConfig {
  chainId: number;
  network: string;
  address: string;
  symbol: string;
  decimals: number;
  isTestnet: boolean;
  faucets?: string[];
  explorer: string;
}

/**
 * WDK USDT Configurations by Chain ID
 */
export const WDK_USDT_CONFIGS: Record<number, WDKUSDTConfig> = {
  // Ethereum Mainnet
  1: {
    chainId: 1,
    network: 'Ethereum Mainnet',
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USD₮',
    decimals: 6,
    isTestnet: false,
    explorer: 'https://etherscan.io/token/0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  
  // Cronos Mainnet (PRIMARY FOR PRODUCTION)
  25: {
    chainId: 25,
    network: 'Cronos Mainnet',
    address: '0x66e428c3f67a68878562e79A0234c1F83c208770',
    symbol: 'USDT',
    decimals: 6,
    isTestnet: false,
    explorer: 'https://explorer.cronos.org/token/0x66e428c3f67a68878562e79A0234c1F83c208770',
  },
  
  // Polygon Mainnet
  137: {
    chainId: 137,
    network: 'Polygon Mainnet',
    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    symbol: 'USD₮',
    decimals: 6,
    isTestnet: false,
    explorer: 'https://polygonscan.com/token/0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  
  // Arbitrum One
  42161: {
    chainId: 42161,
    network: 'Arbitrum One',
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    symbol: 'USD₮',
    decimals: 6,
    isTestnet: false,
    explorer: 'https://arbiscan.io/token/0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  
  // Plasma
  9745: {
    chainId: 9745,
    network: 'Plasma',
    address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    symbol: 'USD₮',
    decimals: 6,
    isTestnet: false,
    explorer: 'https://plasmascan.to',
  },
  
  // Sepolia Testnet (OFFICIAL WDK TEST TOKEN - FOR HACKATHON)
  11155111: {
    chainId: 11155111,
    network: 'Sepolia Testnet',
    address: '0xd077a400968890eacc75cdc901f0356c943e4fdb',
    symbol: 'USD₮',
    decimals: 6,
    isTestnet: true,
    faucets: [
      'https://dashboard.pimlico.io/test-erc20-faucet',
      'https://dashboard.candide.dev/faucet',
    ],
    explorer: 'https://sepolia.etherscan.io/token/0xd077a400968890eacc75cdc901f0356c943e4fdb',
  },
};

/**
 * Get WDK USDT config for a chain
 */
export function getWDKUSDTConfig(chainId: number): WDKUSDTConfig | null {
  return WDK_USDT_CONFIGS[chainId] ?? null;
}

/**
 * Get WDK USDT address for a chain
 */
export function getWDKUSDTAddress(chainId: number): string | null {
  return WDK_USDT_CONFIGS[chainId]?.address ?? null;
}

/**
 * Check if chain supports WDK USDT
 */
export function isWDKUSDTSupported(chainId: number): boolean {
  return chainId in WDK_USDT_CONFIGS;
}

/**
 * Get testnet config for hackathon demo
 */
export function getTestnetConfig(): WDKUSDTConfig {
  return WDK_USDT_CONFIGS[11155111]; // Sepolia
}

/**
 * Get production config (Cronos Mainnet)
 */
export function getProductionConfig(): WDKUSDTConfig {
  return WDK_USDT_CONFIGS[25]; // Cronos Mainnet
}

/**
 * All supported chain IDs
 */
export const WDK_SUPPORTED_CHAINS = Object.keys(WDK_USDT_CONFIGS).map(Number);

/**
 * Testnet chain IDs
 */
export const WDK_TESTNET_CHAINS = Object.values(WDK_USDT_CONFIGS)
  .filter(c => c.isTestnet)
  .map(c => c.chainId);

/**
 * Mainnet chain IDs
 */
export const WDK_MAINNET_CHAINS = Object.values(WDK_USDT_CONFIGS)
  .filter(c => !c.isTestnet)
  .map(c => c.chainId);

// Default export for convenience
export default WDK_USDT_CONFIGS;
