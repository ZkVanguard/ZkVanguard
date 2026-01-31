/**
 * Smart Contract Addresses
 * Multi-chain deployment addresses for Cronos (EVM) and SUI (Move)
 */

// ============================================
// CRONOS (EVM) CONTRACT ADDRESSES
// ============================================

export const CRONOS_CONTRACT_ADDRESSES = {
  testnet: {
    zkVerifier: ((process.env.NEXT_PUBLIC_ZKVERIFIER_ADDRESS || '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8').trim()) as `0x${string}`,
    rwaManager: ((process.env.NEXT_PUBLIC_RWAMANAGER_ADDRESS || '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189').trim()) as `0x${string}`,
    paymentRouter: ((process.env.NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS || '0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b').trim()) as `0x${string}`,
    // Legacy gasless contracts (archived)
    universalRelayer: ((process.env.NEXT_PUBLIC_RELAYER_CONTRACT || '0x9E5512b683d92290ccD20F483D20699658bcb9f3').trim()) as `0x${string}`,
    gaslessZKVerifier: ((process.env.NEXT_PUBLIC_GASLESS_ZK_VERIFIER || '0x7747e2D3e8fc092A0bd0d6060Ec8d56294A5b73F').trim()) as `0x${string}`,
    // Production gasless contract (gas refund model)
    gaslessZKCommitmentVerifier: ((process.env.NEXT_PUBLIC_GASLESS_COMMITMENT_VERIFIER || '0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9').trim()) as `0x${string}`,
    // TRUE gasless contract (x402 + USDC)
    x402GaslessZKCommitmentVerifier: ((process.env.NEXT_PUBLIC_X402_GASLESS_VERIFIER || '0x44098d0dE36e157b4C1700B48d615285C76fdE47').trim()) as `0x${string}`,
    // DevUSDCe token on Cronos Testnet (for x402 payments)
    usdcToken: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0' as `0x${string}`,
  },
  mainnet: {
    zkVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    rwaManager: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    paymentRouter: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    universalRelayer: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    gaslessZKVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    gaslessZKCommitmentVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    x402GaslessZKCommitmentVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  },
} as const;

// ============================================
// SUI (MOVE) CONTRACT ADDRESSES
// ============================================

export const SUI_CONTRACT_ADDRESSES = {
  testnet: {
    // Package ID (deployed module)
    packageId: ((process.env.NEXT_PUBLIC_SUI_PACKAGE_ID || '0xd76a2da684743b47e64382b61004314bca46fb2dc94a286c4f1882caa0dfc1d9').trim()) as string,
    // Shared object IDs
    rwaManagerState: ((process.env.NEXT_PUBLIC_SUI_RWA_MANAGER_STATE || '0x84925d623a658bc40a5821ef74458e7f8e8f5a2971c58ec9df6fb59277a8951d').trim()) as string,
    zkVerifierState: ((process.env.NEXT_PUBLIC_SUI_ZK_VERIFIER_STATE || '0x19f9c7a1ca761442180928f0efe982d414fd324948a1a092a258e8116c56213e').trim()) as string,
    paymentRouterState: ((process.env.NEXT_PUBLIC_SUI_PAYMENT_ROUTER_STATE || '0x08c0f37564f618162edc982d714b79dd946fbf7d387731f6c5ca3946d6cbe507').trim()) as string,
    // Capability object IDs (owned by admin)
    adminCap: ((process.env.NEXT_PUBLIC_SUI_ADMIN_CAP || '0x5084205f4dedd52f9d7b6680f3ff27af1046f9e43a02b0de40b52815a91b3e37').trim()) as string,
  },
  mainnet: {
    packageId: '' as string,
    rwaManagerState: '' as string,
    zkVerifierState: '' as string,
    paymentRouterState: '' as string,
    adminCap: '' as string,
  },
  devnet: {
    packageId: '' as string,
    rwaManagerState: '' as string,
    zkVerifierState: '' as string,
    paymentRouterState: '' as string,
    adminCap: '' as string,
  },
} as const;

// ============================================
// LEGACY EXPORT (for backward compatibility)
// ============================================

export const CONTRACT_ADDRESSES = {
  cronos_testnet: CRONOS_CONTRACT_ADDRESSES.testnet,
  cronos_mainnet: CRONOS_CONTRACT_ADDRESSES.mainnet,
  sui_testnet: SUI_CONTRACT_ADDRESSES.testnet,
  sui_mainnet: SUI_CONTRACT_ADDRESSES.mainnet,
  sui_devnet: SUI_CONTRACT_ADDRESSES.devnet,
} as const;

// ============================================
// CHAIN TYPE DETECTION
// ============================================

export type ChainType = 'evm' | 'sui';
export type NetworkType = 'mainnet' | 'testnet' | 'devnet';

export interface ChainInfo {
  type: ChainType;
  network: NetworkType;
  chainId: number | string;
}

/**
 * Get chain info from chainId
 */
export function getChainInfo(chainId: number | string): ChainInfo {
  if (typeof chainId === 'string' && chainId.startsWith('sui:')) {
    const network = chainId.split(':')[1] as NetworkType;
    return { type: 'sui', network, chainId };
  }
  
  switch (chainId) {
    case 338:
      return { type: 'evm', network: 'testnet', chainId };
    case 25:
      return { type: 'evm', network: 'mainnet', chainId };
    default:
      return { type: 'evm', network: 'testnet', chainId };
  }
}

/**
 * Get EVM contract addresses for the current chain
 */
export function getContractAddresses(chainId: number) {
  switch (chainId) {
    case 338: // Cronos Testnet
      return CRONOS_CONTRACT_ADDRESSES.testnet;
    case 25: // Cronos Mainnet
      return CRONOS_CONTRACT_ADDRESSES.mainnet;
    default:
      return CRONOS_CONTRACT_ADDRESSES.testnet; // Default to testnet
  }
}

/**
 * Get SUI contract addresses for the current network
 */
export function getSuiContractAddresses(network: 'mainnet' | 'testnet' | 'devnet' = 'testnet') {
  return SUI_CONTRACT_ADDRESSES[network];
}

/**
 * Get contract addresses based on chain type and network
 */
export function getMultiChainAddresses(chainType: ChainType, network: NetworkType) {
  if (chainType === 'sui') {
    return SUI_CONTRACT_ADDRESSES[network === 'mainnet' ? 'mainnet' : network === 'devnet' ? 'devnet' : 'testnet'];
  }
  return CRONOS_CONTRACT_ADDRESSES[network === 'mainnet' ? 'mainnet' : 'testnet'];
}
