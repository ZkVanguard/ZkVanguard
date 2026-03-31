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

import { getRpcUrl } from '../rpc-urls';

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
  provider: getRpcUrl('sepolia'),
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
  provider: getRpcUrl('sepolia'),
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
// SAFE CONSTANTS (v1.3.0)
// These are official Safe protocol contract addresses, NOT mock values.
// See: https://github.com/safe-global/safe-deployments
// ============================================================================
export const SAFE_CONFIG = {
  // Sepolia testnet Safe v1.3.0 deployments
  11155111: {
    safeProxyFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',  // Official Safe proxy factory
    safeSingleton: '0x3E5c63644E683549055b9Be8653de26E0B4CD36E',     // Official Safe singleton (L2)
    fallbackHandler: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4',   // Official CompatibilityFallbackHandler
  }
} as const;

// ============================================================================
// MAINNET CONFIGURATIONS
// ============================================================================

/**
 * Candide - Plasma Mainnet
 * Official WDK verified network for USD₮
 * Docs: https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-erc-4337/configuration#plasma
 */
export const CANDIDE_PLASMA: AAPaymasterConfig = {
  chainId: 9745,
  chainName: 'Plasma',
  provider: getRpcUrl('plasma'),
  bundlerUrl: 'https://api.candide.dev/public/v3/9745',
  paymasterUrl: 'https://api.candide.dev/public/v3/9745',
  paymasterAddress: '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USDT on Plasma
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000, // 0.1 USDT
  isTestnet: false,
};

/**
 * Candide - Polygon Mainnet
 * Official WDK verified network
 * Docs: https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-erc-4337/configuration#polygon-mainnet
 */
export const CANDIDE_POLYGON: AAPaymasterConfig = {
  chainId: 137,
  chainName: 'Polygon',
  provider: 'https://polygon-bor-rpc.publicnode.com',
  bundlerUrl: 'https://api.candide.dev/public/v3/polygon',
  paymasterUrl: 'https://api.candide.dev/public/v3/polygon',
  paymasterAddress: '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT on Polygon
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000, // 0.1 USDT
  isTestnet: false,
};

/**
 * Pimlico - Ethereum Mainnet
 */
export const PIMLICO_MAINNET: AAPaymasterConfig = {
  chainId: 1,
  chainName: 'Ethereum',
  provider: getRpcUrl('ethereum'),
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
 * Pimlico - Hedera Mainnet
 */
export const PIMLICO_HEDERA: AAPaymasterConfig = {
  chainId: 295,
  chainName: 'Hedera',
  provider: getRpcUrl('hedera'),
  bundlerUrl: 'https://public.pimlico.io/v2/295/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/295/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0x0000000000000000000000000000000000000000', // USDT Hedera (TBD)
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000, // 0.1 USDT
  isTestnet: false,
};

/**
 * Pimlico - Hedera Testnet
 */
export const PIMLICO_HEDERA_TESTNET: AAPaymasterConfig = {
  chainId: 296,
  chainName: 'Hedera Testnet',
  provider: 'https://testnet.hashio.io/api',
  bundlerUrl: 'https://public.pimlico.io/v2/296/rpc',
  paymasterUrl: 'https://public.pimlico.io/v2/296/rpc',
  paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0x0000000000000000000000000000000000000000', // USDT Hedera Testnet (TBD)
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000,
  isTestnet: true,
};

/**
 * Cronos zkEVM Mainnet
 * Uses Gelato as bundler (Pimlico doesn't support Cronos)
 * Docs: https://docs.cronos.org/cronos-zkevm
 */
export const CRONOS_ZKEVM_MAINNET: AAPaymasterConfig = {
  chainId: 388,
  chainName: 'Cronos zkEVM',
  provider: 'https://mainnet.zkevm.cronos.org',
  bundlerUrl: 'https://api.gelato.digital/bundler/388',
  paymasterUrl: 'https://api.gelato.digital/paymaster/388',
  paymasterAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD', // Gelato paymaster
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0x7a6B3C88A2F34C0D2345A8D1E8F2E9B3C4D5E6F7', // zkUSDT on Cronos zkEVM (placeholder)
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000,
  isTestnet: false,
};

/**
 * Cronos zkEVM Testnet
 */
export const CRONOS_ZKEVM_TESTNET: AAPaymasterConfig = {
  chainId: 282,
  chainName: 'Cronos zkEVM Testnet',
  provider: 'https://testnet.zkevm.cronos.org',
  bundlerUrl: 'https://api.gelato.digital/bundler/282',
  paymasterUrl: 'https://api.gelato.digital/paymaster/282',
  paymasterAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0x1234567890123456789012345678901234567890', // Test USDT (placeholder)
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000,
  isTestnet: true,
};

/**
 * Cronos EVM Mainnet - NOTE: Use x402 instead of AA
 * Pimlico/Candide don't support Cronos EVM chain.
 * For gasless USDT on Cronos EVM, use x402 protocol instead.
 */
export const CRONOS_EVM_FALLBACK: AAPaymasterConfig = {
  chainId: 25,
  chainName: 'Cronos EVM (use x402)',
  provider: 'https://evm.cronos.org',
  bundlerUrl: '', // Not supported - use x402
  paymasterUrl: '', // Not supported - use x402
  paymasterAddress: '0x0000000000000000000000000000000000000000',
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

/**
 * Cronos EVM Testnet - NOTE: Use x402 instead of AA
 */
export const CRONOS_EVM_TESTNET_FALLBACK: AAPaymasterConfig = {
  chainId: 338,
  chainName: 'Cronos Testnet (use x402)',
  provider: 'https://evm-t3.cronos.org',
  bundlerUrl: '', // Not supported - use x402
  paymasterUrl: '', // Not supported - use x402
  paymasterAddress: '0x0000000000000000000000000000000000000000',
  entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  safeModulesVersion: '0.3.0',
  paymasterToken: {
    address: '0xc01efAAF7C5c61BEBFAEB358E1161b537b8bC0E0', // DevUSDC as USDT proxy
    symbol: 'USDT',
    decimals: 6,
  },
  transferMaxFee: 100000,
  isTestnet: true,
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
  // Plasma - Official WDK recommended chain
  9745: {
    pimlico: CANDIDE_PLASMA, // Only Candide supports Plasma
    candide: CANDIDE_PLASMA,
  },
  // Polygon
  137: {
    pimlico: CANDIDE_POLYGON, // Candide recommended for Polygon
    candide: CANDIDE_POLYGON,
  },
  // Hedera Mainnet
  295: {
    pimlico: PIMLICO_HEDERA,
    candide: PIMLICO_HEDERA,
  },
  // Hedera Testnet
  296: {
    pimlico: PIMLICO_HEDERA_TESTNET,
    candide: PIMLICO_HEDERA_TESTNET,
  },
  // Cronos zkEVM Mainnet (full AA support)
  388: {
    pimlico: CRONOS_ZKEVM_MAINNET,
    candide: CRONOS_ZKEVM_MAINNET,
  },
  // Cronos zkEVM Testnet (full AA support)
  282: {
    pimlico: CRONOS_ZKEVM_TESTNET,
    candide: CRONOS_ZKEVM_TESTNET,
  },
  // Cronos EVM - fallback (use x402 instead)
  25: {
    pimlico: CRONOS_EVM_FALLBACK,
    candide: CRONOS_EVM_FALLBACK,
  },
  // Cronos Testnet - fallback (use x402 instead)
  338: {
    pimlico: CRONOS_EVM_TESTNET_FALLBACK,
    candide: CRONOS_EVM_TESTNET_FALLBACK,
  },
};

/**
 * Chains that should use x402 instead of ERC-4337 AA
 * These chains don't have bundler/paymaster support
 */
export const X402_PREFERRED_CHAINS = [25, 338] as const;

/**
 * Check if a chain should use x402 instead of AA
 */
export function shouldUseX402(chainId: number): boolean {
  return (X402_PREFERRED_CHAINS as readonly number[]).includes(chainId);
}

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
