/**
 * Account Abstraction (AA) Paymaster Configuration
 * 
 * Supports ERC-4337 gasless USDT deposits via:
 * - Pimlico public bundler/paymaster
 * - Candide public bundler/paymaster
 * 
 * Users pay gas fees in USDT instead of native tokens.
 * Paymasters sponsor the actual gas, taking USDT as payment.
 */

export interface AAPaymasterConfig {
  chainId: number;
  chainName: string;
  provider: string;
  bundlerUrl: string;
  paymasterUrl: string;
  paymasterAddress: string;
  entryPointAddress: string;
  safeModulesVersion: string;
  paymasterToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  transferMaxFee: number; // In token decimals (e.g., 100000 = 0.1 USDT)
  isTestnet: boolean;
}

export type PaymasterProvider = 'pimlico' | 'candide';

// ============================================================================
// SEPOLIA TESTNET CONFIGURATIONS
// ============================================================================

/**
 * Pimlico - Sepolia Testnet
 * Public bundler and paymaster for ERC-4337
 * Docs: https://docs.pimlico.io
 */
export const PIMLICO_SEPOLIA: AAPaymasterConfig = {
  chainId: 11155111,
  chainName: 'Sepolia',
  provider: 'https://sepolia.drpc.org',
  bundlerUrl: 'https://public.pimlico.io/v2/11155111/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/11155111/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xd077a400968890eacc75cdc901f0356c943e4fdb', // USDT Sepolia
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000, // 0.1 USDT (6 decimals)
  isTestnet: true,
};

/**
 * Candide - Sepolia Testnet
 * Public bundler and paymaster for ERC-4337
 * Docs: https://docs.candide.dev
 */
export const CANDIDE_SEPOLIA: AAPaymasterConfig = {
  chainId: 11155111,
  chainName: 'Sepolia',
  provider: 'https://sepolia.drpc.org',
  bundlerUrl: 'https://api.candide.dev/public/v3/11155111',
  paymasterUrl: 'https://api.candide.dev/public/v3/11155111',
  paymasterAddress: '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xd077a400968890eacc75cdc901f0356c943e4fdb', // USDT Sepolia
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000, // 0.1 USDT (6 decimals)
  isTestnet: true,
};

// ============================================================================
// MAINNET CONFIGURATIONS
// ============================================================================

/**
 * Pimlico - Ethereum Mainnet
 */
export const PIMLICO_MAINNET: AAPaymasterConfig = {
  chainId: 1,
  chainName: 'Ethereum',
  provider: 'https://eth.drpc.org',
  bundlerUrl: 'https://public.pimlico.io/v2/1/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/1/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT Mainnet
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 500000, // 0.5 USDT max fee for mainnet
  isTestnet: false,
};

/**
 * Pimlico - Arbitrum
 */
export const PIMLICO_ARBITRUM: AAPaymasterConfig = {
  chainId: 42161,
  chainName: 'Arbitrum',
  provider: 'https://arbitrum.drpc.org',
  bundlerUrl: 'https://public.pimlico.io/v2/42161/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/42161/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT Arbitrum
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000, // 0.1 USDT
  isTestnet: false,
};

/**
 * Pimlico - Arbitrum Sepolia
 */
export const PIMLICO_ARBITRUM_SEPOLIA: AAPaymasterConfig = {
  chainId: 421614,
  chainName: 'Arbitrum Sepolia',
  provider: 'https://sepolia-rollup.arbitrum.io/rpc',
  bundlerUrl: 'https://public.pimlico.io/v2/421614/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/421614/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // USDC Arb Sepolia (use as USDT proxy)
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000,
  isTestnet: true,
};

/**
 * Pimlico - Cronos (if supported)
 */
export const PIMLICO_CRONOS: AAPaymasterConfig = {
  chainId: 25,
  chainName: 'Cronos',
  provider: 'https://evm.cronos.org',
  bundlerUrl: 'https://public.pimlico.io/v2/25/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/25/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0x66e428c3f67a68878562e79A0234c1F83c208770', // USDT Cronos
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000,
  isTestnet: false,
};

// ============================================================================
// CONFIGURATION LOOKUP
// ============================================================================

/**
 * All supported AA configurations indexed by chain ID
 */
export const AA_CONFIGS: Record<number, Record<PaymasterProvider, AAPaymasterConfig>> = {
  // Sepolia
  11155111: {
    pimlico: PIMLICO_SEPOLIA,
    candide: CANDIDE_SEPOLIA,
  },
  // Ethereum Mainnet
  1: {
    pimlico: PIMLICO_MAINNET,
    candide: PIMLICO_MAINNET, // Fallback to Pimlico
  },
  // Arbitrum
  42161: {
    pimlico: PIMLICO_ARBITRUM,
    candide: PIMLICO_ARBITRUM,
  },
  // Arbitrum Sepolia
  421614: {
    pimlico: PIMLICO_ARBITRUM_SEPOLIA,
    candide: PIMLICO_ARBITRUM_SEPOLIA,
  },
  // Cronos
  25: {
    pimlico: PIMLICO_CRONOS,
    candide: PIMLICO_CRONOS,
  },
};

/**
 * Get AA paymaster configuration for a chain
 */
export function getAAConfig(
  chainId: number,
  provider: PaymasterProvider = 'pimlico'
): AAPaymasterConfig | null {
  const chainConfigs = AA_CONFIGS[chainId];
  if (!chainConfigs) return null;
  return chainConfigs[provider] || null;
}

/**
 * Get default AA config (Sepolia + Pimlico)
 */
export function getDefaultAAConfig(): AAPaymasterConfig {
  return PIMLICO_SEPOLIA;
}

/**
 * Check if a chain supports AA paymasters
 */
export function isAASupported(chainId: number): boolean {
  return chainId in AA_CONFIGS;
}

/**
 * Get all supported AA chain IDs
 */
export function getSupportedAAChains(): number[] {
  return Object.keys(AA_CONFIGS).map(Number);
}

// ============================================================================
// ENTRY POINT & SAFE CONSTANTS
// ============================================================================

/**
 * ERC-4337 EntryPoint v0.7 address (same across all chains)
 */
export const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/**
 * Safe 4337 Module addresses
 */
export const SAFE_4337_MODULE = {
  // Safe modules v0.3.0
  safeProxyFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  safeSingleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  safeModule4337: '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226',
  multiSend: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526',
  multiSendCallOnly: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
};

// ============================================================================
// USER OPERATION TYPES
// ============================================================================

/**
 * ERC-4337 UserOperation structure (v0.7)
 */
export interface UserOperation {
  sender: string;
  nonce: bigint;
  factory?: string;
  factoryData?: string;
  callData: string;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster?: string;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterData?: string;
  signature: string;
}

/**
 * Packed UserOperation for v0.7
 */
export interface PackedUserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string; // packed: callGasLimit | verificationGasLimit
  preVerificationGas: bigint;
  gasFees: string; // packed: maxFeePerGas | maxPriorityFeePerGas
  paymasterAndData: string;
  signature: string;
}

/**
 * Gas estimation response from bundler
 */
export interface GasEstimation {
  preVerificationGas: bigint;
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
}

/**
 * Paymaster quote response
 */
export interface PaymasterQuote {
  paymaster: string;
  paymasterData: string;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  tokenCost: bigint; // USDT cost in base units
  tokenSymbol: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format USDT amount from base units (6 decimals)
 */
export function formatUSDT(amount: bigint | number): string {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount);
  const formatted = Number(value) / 1_000_000;
  return formatted.toFixed(6);
}

/**
 * Parse USDT amount to base units (6 decimals)
 */
export function parseUSDT(amount: number | string): bigint {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  return BigInt(Math.floor(value * 1_000_000));
}

/**
 * Get USDT token address for a chain
 */
export function getUSDTAddress(chainId: number, provider: PaymasterProvider = 'pimlico'): string | null {
  const config = getAAConfig(chainId, provider);
  return config?.paymasterToken.address || null;
}

/**
 * Calculate estimated USDT gas cost
 */
export function estimateUSDTGasCost(
  gasEstimate: GasEstimation,
  maxFeePerGas: bigint,
  usdtPriceUSD: number = 1.0 // USDT is pegged to USD
): bigint {
  const totalGas = gasEstimate.preVerificationGas + 
                   gasEstimate.verificationGasLimit + 
                   gasEstimate.callGasLimit +
                   (gasEstimate.paymasterVerificationGasLimit || 0n) +
                   (gasEstimate.paymasterPostOpGasLimit || 0n);
  
  // Gas cost in wei
  const gasCostWei = totalGas * maxFeePerGas;
  
  // Convert to USDT (assuming 18 decimals for native token, 6 for USDT)
  // This is a simplified calculation - actual conversion depends on ETH/USDT price
  // Paymaster will provide exact quote
  return gasCostWei / BigInt(1e12); // Rough conversion
}

export default {
  getAAConfig,
  getDefaultAAConfig,
  isAASupported,
  getSupportedAAChains,
  formatUSDT,
  parseUSDT,
  getUSDTAddress,
  ENTRY_POINT_V07,
  SAFE_4337_MODULE,
};
