/**
 * x402 Protocol Configuration for WDK Integration
 * 
 * Based on official Tether WDK x402 documentation:
 * @see https://docs.wdk.tether.io/
 * 
 * x402 is an open payment protocol that enables HTTP 402 Payment Required
 * flows using blockchain-native payments. No accounts, API keys, or checkout flows.
 * 
 * Recommended Chains for x402:
 * - Plasma (eip155:9745) - Purpose-built for USD₮ transfers
 * - Stable (eip155:988) - Near-instant finality and near-zero fees
 * 
 * Note: We also support Cronos and Hedera for broader compatibility.
 */

// ============================================
// x402 NETWORK CONFIGURATION
// ============================================

/**
 * x402 recommended networks with USD₮0 (USDT0) token
 * These chains are purpose-built for USD₮ transfers
 */
export const X402_NETWORKS = {
  // Plasma - Primary recommended chain for x402
  plasma: {
    name: 'Plasma',
    caip2: 'eip155:9745',
    chainId: 9745,
    rpcUrl: 'https://rpc.plasma.to',
    explorerUrl: 'https://plasmascan.to',
    usdt0Address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  },
  // Stable - Secondary recommended chain
  stable: {
    name: 'Stable',
    caip2: 'eip155:988',
    chainId: 988,
    rpcUrl: 'https://rpc.stable.xyz',
    explorerUrl: 'https://stablescan.xyz',
    usdt0Address: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  },
  // Cronos - For hackathon compatibility
  cronos: {
    name: 'Cronos',
    caip2: 'eip155:25',
    chainId: 25,
    rpcUrl: 'https://evm.cronos.org',
    explorerUrl: 'https://cronoscan.com',
    usdt0Address: '0x66e428c3f67a68878562e79A0234c1F83c208770', // Official USDT on Cronos
    nativeCurrency: { name: 'CRO', symbol: 'CRO', decimals: 18 },
  },
  'cronos-testnet': {
    name: 'Cronos Testnet',
    caip2: 'eip155:338',
    chainId: 338,
    rpcUrl: 'https://evm-t3.cronos.org',
    explorerUrl: 'https://explorer.cronos.org/testnet',
    usdt0Address: '0x28217DAddC55e3C4831b4A48A00Ce04880786967', // MockUSDT
    nativeCurrency: { name: 'tCRO', symbol: 'tCRO', decimals: 18 },
  },
  // Hedera - For multi-chain support
  hedera: {
    name: 'Hedera',
    caip2: 'eip155:295',
    chainId: 295,
    rpcUrl: 'https://mainnet.hashio.io/api',
    explorerUrl: 'https://hashscan.io/mainnet',
    usdt0Address: '0x0000000000000000000000000000000000000000', // USDT on Hedera - TODO
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  },
  'hedera-testnet': {
    name: 'Hedera Testnet',
    caip2: 'eip155:296',
    chainId: 296,
    rpcUrl: 'https://testnet.hashio.io/api',
    explorerUrl: 'https://hashscan.io/testnet',
    usdt0Address: '0x0000000000000000000000000000000000000000', // USDT on Hedera testnet - TODO
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  },
} as const;

export type X402NetworkKey = keyof typeof X402_NETWORKS;

// ============================================
// USD₮0 TOKEN METADATA
// ============================================

/**
 * USD₮0 (USDT0) - Bridge token for x402 payments
 * Used in EIP-712 signatures for payment authorization
 */
export const USDT0_METADATA = {
  name: 'USDT0',   // Required for EIP-712 signature
  symbol: 'USDT0',
  version: '1',    // Required for EIP-712 signature
  decimals: 6,
} as const;

// ============================================
// x402 FACILITATOR CONFIGURATION
// ============================================

/**
 * Hosted facilitator services
 * 
 * Semantic Pay operates a public USD₮-enabled x402 facilitator.
 * Note: This is a third-party service not operated by Tether.
 */
export const X402_FACILITATORS = {
  // Semantic Pay - Public hosted facilitator (Plasma + Stable)
  semantic: {
    url: 'https://x402.semanticpay.io/',
    supportedNetworks: ['plasma', 'stable'] as X402NetworkKey[],
    description: 'Semantic Pay public facilitator',
  },
  // Self-hosted facilitator (local development)
  local: {
    url: process.env.X402_FACILITATOR_URL || 'http://localhost:4022',
    supportedNetworks: ['cronos-testnet', 'hedera-testnet', 'plasma', 'stable'] as X402NetworkKey[],
    description: 'Self-hosted in-process facilitator',
  },
} as const;

// Default facilitator based on environment
export const DEFAULT_FACILITATOR = process.env.NODE_ENV === 'production' 
  ? X402_FACILITATORS.semantic 
  : X402_FACILITATORS.local;

// ============================================
// x402 PAYMENT CHALLENGE TYPES
// ============================================

/**
 * x402 Payment Challenge (HTTP 402 Response)
 * 
 * When a server returns 402 Payment Required, this structure
 * describes what payment is needed.
 */
export interface X402PaymentChallenge {
  x402Version: 1;
  error?: string;
  accepts: X402PaymentOption[];
}

export interface X402PaymentOption {
  scheme: 'exact';
  network: string;  // CAIP-2 network identifier (e.g., "eip155:9745")
  maxAmountRequired: string;  // Amount in smallest unit (6 decimals for USDT)
  asset: string;    // Token contract address
  resource: string; // URL of the resource being paid for
  payTo: string;    // Recipient address
  description?: string;
  mimeType?: string;
  extra?: {
    name: string;     // Token name for EIP-712 ("USDT0")
    version: string;  // Token version for EIP-712 ("1")
    decimals: number; // Token decimals (6)
    paymentId?: string;
  };
}

/**
 * x402 Payment Header (EIP-3009 Authorization)
 * 
 * This is signed by the payer and sent in X-PAYMENT header
 */
export interface X402PaymentHeader {
  scheme: 'exact';
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: number;
      validBefore: number;
      nonce: string;
    };
  };
}

/**
 * x402 Settlement Result
 */
export interface X402SettlementResult {
  success: boolean;
  transactionHash?: string;
  network: string;
  settledAt: number;
  error?: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get x402 network configuration by network key or CAIP-2 identifier
 */
export function getX402Network(networkKeyOrCaip2: string): typeof X402_NETWORKS[X402NetworkKey] | null {
  // Try direct key lookup
  if (networkKeyOrCaip2 in X402_NETWORKS) {
    return X402_NETWORKS[networkKeyOrCaip2 as X402NetworkKey];
  }
  
  // Try CAIP-2 lookup
  const network = Object.values(X402_NETWORKS).find(n => n.caip2 === networkKeyOrCaip2);
  return network || null;
}

/**
 * Get x402 network by chain ID
 */
export function getX402NetworkByChainId(chainId: number): typeof X402_NETWORKS[X402NetworkKey] | null {
  const network = Object.values(X402_NETWORKS).find(n => n.chainId === chainId);
  return network || null;
}

/**
 * Get USD₮0 address for a network
 */
export function getUsdt0Address(networkKey: X402NetworkKey): string {
  return X402_NETWORKS[networkKey].usdt0Address;
}

/**
 * Convert amount to smallest unit (6 decimals)
 */
export function toUsdt0Amount(amount: number): string {
  return Math.floor(amount * 1_000_000).toString();
}

/**
 * Convert from smallest unit to human readable
 */
export function fromUsdt0Amount(amount: string | bigint): number {
  return Number(BigInt(amount)) / 1_000_000;
}

/**
 * Create a payment challenge for x402
 */
export function createX402Challenge(options: {
  network: X402NetworkKey;
  amount: number;          // Amount in USD (e.g., 0.001 for $0.001)
  payTo: string;           // Recipient address
  resource: string;        // Resource URL
  description?: string;
  paymentId?: string;
}): X402PaymentChallenge {
  const networkConfig = X402_NETWORKS[options.network];
  const paymentId = options.paymentId || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  
  return {
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network: networkConfig.caip2,
      maxAmountRequired: toUsdt0Amount(options.amount),
      asset: networkConfig.usdt0Address,
      resource: options.resource,
      payTo: options.payTo,
      description: options.description,
      mimeType: 'application/json',
      extra: {
        name: USDT0_METADATA.name,
        version: USDT0_METADATA.version,
        decimals: USDT0_METADATA.decimals,
        paymentId,
      },
    }],
  };
}

/**
 * Create multi-chain payment challenge (accepts payment on multiple networks)
 */
export function createMultiChainX402Challenge(options: {
  networks: X402NetworkKey[];
  amount: number;
  payTo: string;
  resource: string;
  description?: string;
}): X402PaymentChallenge {
  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  
  return {
    x402Version: 1,
    accepts: options.networks.map(network => {
      const networkConfig = X402_NETWORKS[network];
      return {
        scheme: 'exact' as const,
        network: networkConfig.caip2,
        maxAmountRequired: toUsdt0Amount(options.amount),
        asset: networkConfig.usdt0Address,
        resource: options.resource,
        payTo: options.payTo,
        description: options.description,
        mimeType: 'application/json',
        extra: {
          name: USDT0_METADATA.name,
          version: USDT0_METADATA.version,
          decimals: USDT0_METADATA.decimals,
          paymentId,
        },
      };
    }),
  };
}

/**
 * Generate EIP-3009 authorization nonce
 */
export function generateAuthorizationNonce(): string {
  const bytes = new Uint8Array(32);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calculate validity window for EIP-3009 authorization
 */
export function getAuthorizationWindow(maxTimeoutSeconds: number = 300): { validAfter: number; validBefore: number } {
  const now = Math.floor(Date.now() / 1000);
  return {
    validAfter: now - 60,  // Valid from 1 minute ago (clock skew tolerance)
    validBefore: now + maxTimeoutSeconds,
  };
}

// ============================================
// EXPORTS
// ============================================

export default {
  networks: X402_NETWORKS,
  facilitators: X402_FACILITATORS,
  defaultFacilitator: DEFAULT_FACILITATOR,
  usdt0: USDT0_METADATA,
  getNetwork: getX402Network,
  getNetworkByChainId: getX402NetworkByChainId,
  getUsdt0Address,
  toUsdt0Amount,
  fromUsdt0Amount,
  createChallenge: createX402Challenge,
  createMultiChainChallenge: createMultiChainX402Challenge,
  generateNonce: generateAuthorizationNonce,
  getAuthWindow: getAuthorizationWindow,
};
