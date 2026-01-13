import { defineChain } from 'viem';

// ============================================
// CRONOS CHAINS (EVM-Compatible)
// ============================================

// Cronos EVM Mainnet (Required for Cronos x402 Paytech Hackathon)
export const CronosMainnet = defineChain({
  id: 25,
  name: 'Cronos',
  nativeCurrency: {
    decimals: 18,
    name: 'Cronos',
    symbol: 'CRO',
  },
  rpcUrls: {
    default: {
      http: ['https://evm.cronos.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Cronoscan',
      url: 'https://explorer.cronos.org',
    },
  },
  testnet: false,
});

// Cronos EVM Testnet (For Development & Testing)
export const CronosTestnet = defineChain({
  id: 338,
  name: 'Cronos Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Test Cronos',
    symbol: 'tCRO',
  },
  rpcUrls: {
    default: {
      http: ['https://evm-t3.cronos.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Cronos Testnet Explorer',
      url: 'https://explorer.cronos.org/testnet',
    },
  },
  testnet: true,
});

// ============================================
// SUI CHAINS (Move-based, Non-EVM)
// ============================================

// SUI Mainnet Configuration (for wallet display & reference)
export const SuiMainnet = {
  id: 'sui:mainnet',
  name: 'SUI',
  nativeCurrency: {
    decimals: 9,
    name: 'SUI',
    symbol: 'SUI',
  },
  rpcUrls: {
    default: {
      http: ['https://fullnode.mainnet.sui.io:443'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Sui Explorer',
      url: 'https://suiexplorer.com',
    },
  },
  testnet: false,
};

// SUI Testnet Configuration (For Development & Testing)
export const SuiTestnet = {
  id: 'sui:testnet',
  name: 'SUI Testnet',
  nativeCurrency: {
    decimals: 9,
    name: 'SUI',
    symbol: 'SUI',
  },
  rpcUrls: {
    default: {
      http: ['https://fullnode.testnet.sui.io:443'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Sui Testnet Explorer',
      url: 'https://suiexplorer.com/?network=testnet',
    },
  },
  testnet: true,
};

// SUI Devnet Configuration (For early development)
export const SuiDevnet = {
  id: 'sui:devnet',
  name: 'SUI Devnet',
  nativeCurrency: {
    decimals: 9,
    name: 'SUI',
    symbol: 'SUI',
  },
  rpcUrls: {
    default: {
      http: ['https://fullnode.devnet.sui.io:443'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Sui Devnet Explorer',
      url: 'https://suiexplorer.com/?network=devnet',
    },
  },
  testnet: true,
};

// ============================================
// MULTI-CHAIN UTILITIES
// ============================================

export type ChainType = 'evm' | 'sui';

export interface MultiChainConfig {
  type: ChainType;
  name: string;
  logo: string;
  chains: {
    mainnet: typeof CronosMainnet | typeof SuiMainnet;
    testnet: typeof CronosTestnet | typeof SuiTestnet;
  };
}

// Supported chains for the platform
export const SUPPORTED_CHAINS: MultiChainConfig[] = [
  {
    type: 'evm',
    name: 'Cronos',
    logo: '/chains/cronos.svg',
    chains: {
      mainnet: CronosMainnet,
      testnet: CronosTestnet,
    },
  },
  {
    type: 'sui',
    name: 'SUI',
    logo: '/chains/sui.svg',
    chains: {
      mainnet: SuiMainnet,
      testnet: SuiTestnet,
    },
  },
];

// Helper to check if a chain is EVM-compatible
export function isEVMChain(chainId: number | string): boolean {
  if (typeof chainId === 'number') {
    return chainId === 25 || chainId === 338;
  }
  return !chainId.startsWith('sui:');
}

// Helper to check if a chain is SUI
export function isSUIChain(chainId: number | string): boolean {
  if (typeof chainId === 'string') {
    return chainId.startsWith('sui:');
  }
  return false;
}

// Get chain type from ID
export function getChainType(chainId: number | string): ChainType {
  return isSUIChain(chainId) ? 'sui' : 'evm';
}
