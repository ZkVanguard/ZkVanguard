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
// OASIS NETWORK PARATIMES
// ============================================
// Oasis has 4 ParaTimes: Consensus (base layer), Emerald (public EVM),
// Sapphire (confidential EVM), and Cipher (confidential WASM)

// --- OASIS EMERALD (Public EVM ParaTime) ---

// Oasis Emerald Mainnet
export const OasisEmeraldMainnet = defineChain({
  id: 42262,
  name: 'Oasis Emerald',
  nativeCurrency: {
    decimals: 18,
    name: 'ROSE',
    symbol: 'ROSE',
  },
  rpcUrls: {
    default: {
      http: ['https://emerald.oasis.io'],
      webSocket: ['wss://emerald.oasis.io/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Explorer',
      url: 'https://explorer.oasis.io/mainnet/emerald',
    },
  },
  testnet: false,
});

// Oasis Emerald Testnet
export const OasisEmeraldTestnet = defineChain({
  id: 42261,
  name: 'Oasis Emerald Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Test ROSE',
    symbol: 'TEST',
  },
  rpcUrls: {
    default: {
      http: ['https://testnet.emerald.oasis.io'],
      webSocket: ['wss://testnet.emerald.oasis.io/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Testnet Explorer',
      url: 'https://explorer.oasis.io/testnet/emerald',
    },
  },
  testnet: true,
});

// --- OASIS SAPPHIRE (Confidential EVM ParaTime) ---

// Oasis Sapphire Mainnet (Confidential EVM ParaTime)
export const OasisSapphireMainnet = defineChain({
  id: 23294,
  name: 'Oasis Sapphire',
  nativeCurrency: {
    decimals: 18,
    name: 'ROSE',
    symbol: 'ROSE',
  },
  rpcUrls: {
    default: {
      http: ['https://sapphire.oasis.io'],
      webSocket: ['wss://sapphire.oasis.io/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Explorer',
      url: 'https://explorer.oasis.io/mainnet/sapphire',
    },
  },
  testnet: false,
});

// Oasis Sapphire Testnet (For Development & Testing)
export const OasisSapphireTestnet = defineChain({
  id: 23295,
  name: 'Oasis Sapphire Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Test ROSE',
    symbol: 'TEST',
  },
  rpcUrls: {
    default: {
      http: ['https://testnet.sapphire.oasis.io'],
      webSocket: ['wss://testnet.sapphire.oasis.io/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Testnet Explorer',
      url: 'https://explorer.oasis.io/testnet/sapphire',
    },
  },
  testnet: true,
});

// --- OASIS CONSENSUS (Base Layer) ---
// Not an EVM chain — used for staking, governance, and cross-ParaTime transfers

export const OasisConsensusMainnet = {
  id: 'oasis:consensus:mainnet',
  name: 'Oasis Consensus',
  nativeCurrency: {
    decimals: 9,
    name: 'ROSE',
    symbol: 'ROSE',
  },
  rpcUrls: {
    default: {
      http: ['https://grpc.oasis.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Explorer',
      url: 'https://explorer.oasis.io/mainnet/consensus',
    },
  },
  testnet: false,
};

export const OasisConsensusTestnet = {
  id: 'oasis:consensus:testnet',
  name: 'Oasis Consensus Testnet',
  nativeCurrency: {
    decimals: 9,
    name: 'Test ROSE',
    symbol: 'TEST',
  },
  rpcUrls: {
    default: {
      http: ['https://testnet.grpc.oasis.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Testnet Explorer',
      url: 'https://explorer.oasis.io/testnet/consensus',
    },
  },
  testnet: true,
};

// --- OASIS CIPHER (Confidential WASM ParaTime) ---
// Not EVM — uses Oasis SDK with WebAssembly smart contracts

export const OasisCipherMainnet = {
  id: 'oasis:cipher:mainnet',
  name: 'Oasis Cipher',
  nativeCurrency: {
    decimals: 9,
    name: 'ROSE',
    symbol: 'ROSE',
  },
  rpcUrls: {
    default: {
      http: ['https://cipher.oasis.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Explorer',
      url: 'https://explorer.oasis.io/mainnet/cipher',
    },
  },
  testnet: false,
};

export const OasisCipherTestnet = {
  id: 'oasis:cipher:testnet',
  name: 'Oasis Cipher Testnet',
  nativeCurrency: {
    decimals: 9,
    name: 'Test ROSE',
    symbol: 'TEST',
  },
  rpcUrls: {
    default: {
      http: ['https://testnet.cipher.oasis.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Oasis Testnet Explorer',
      url: 'https://explorer.oasis.io/testnet/cipher',
    },
  },
  testnet: true,
};

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

export type ChainType = 'evm' | 'sui' | 'oasis-emerald' | 'oasis-sapphire' | 'oasis-consensus' | 'oasis-cipher';

// Convenience type for any Oasis ParaTime
export type OasisParaTime = 'oasis-emerald' | 'oasis-sapphire' | 'oasis-consensus' | 'oasis-cipher';

export interface MultiChainConfig {
  type: ChainType;
  name: string;
  logo: string;
  chains: {
    mainnet: typeof CronosMainnet | typeof SuiMainnet | typeof OasisSapphireMainnet | typeof OasisEmeraldMainnet | typeof OasisConsensusMainnet | typeof OasisCipherMainnet;
    testnet: typeof CronosTestnet | typeof SuiTestnet | typeof OasisSapphireTestnet | typeof OasisEmeraldTestnet | typeof OasisConsensusTestnet | typeof OasisCipherTestnet;
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
  {
    type: 'oasis-consensus',
    name: 'Oasis Consensus',
    logo: '/chains/oasis-consensus.svg',
    chains: {
      mainnet: OasisConsensusMainnet,
      testnet: OasisConsensusTestnet,
    },
  },
  {
    type: 'oasis-emerald',
    name: 'Oasis Emerald',
    logo: '/chains/oasis-emerald.svg',
    chains: {
      mainnet: OasisEmeraldMainnet,
      testnet: OasisEmeraldTestnet,
    },
  },
  {
    type: 'oasis-sapphire',
    name: 'Oasis Sapphire',
    logo: '/chains/oasis-sapphire.svg',
    chains: {
      mainnet: OasisSapphireMainnet,
      testnet: OasisSapphireTestnet,
    },
  },
  {
    type: 'oasis-cipher',
    name: 'Oasis Cipher',
    logo: '/chains/oasis-cipher.svg',
    chains: {
      mainnet: OasisCipherMainnet,
      testnet: OasisCipherTestnet,
    },
  },
];

// Helper to check if a chain is any Oasis ParaTime
export function isOasisChain(chainId: number | string): boolean {
  if (typeof chainId === 'number') {
    return chainId === 23294 || chainId === 23295 || chainId === 42262 || chainId === 42261;
  }
  if (typeof chainId === 'string') {
    return chainId.startsWith('oasis:');
  }
  return false;
}

// Helper to check if a chain is EVM-compatible (includes Cronos, Emerald, Sapphire)
export function isEVMChain(chainId: number | string): boolean {
  if (typeof chainId === 'number') {
    return chainId === 25 || chainId === 338 || chainId === 23294 || chainId === 23295 || chainId === 42262 || chainId === 42261;
  }
  return !chainId.startsWith('sui:') && !chainId.startsWith('oasis:');
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
  if (isSUIChain(chainId)) return 'sui';
  if (typeof chainId === 'string') {
    if (chainId.startsWith('oasis:consensus')) return 'oasis-consensus';
    if (chainId.startsWith('oasis:cipher')) return 'oasis-cipher';
  }
  if (typeof chainId === 'number') {
    if (chainId === 42262 || chainId === 42261) return 'oasis-emerald';
    if (chainId === 23294 || chainId === 23295) return 'oasis-sapphire';
  }
  return 'evm';
}
