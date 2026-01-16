/**
 * Smart Contract Addresses
 * Deployed on Cronos Testnet (Chain ID 338)
 */

export const CONTRACT_ADDRESSES = {
  cronos_testnet: {
    zkVerifier: (process.env.NEXT_PUBLIC_ZKVERIFIER_ADDRESS || '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8') as `0x${string}`,
    rwaManager: (process.env.NEXT_PUBLIC_RWAMANAGER_ADDRESS || '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189') as `0x${string}`, // Updated Jan 16, 2026 with Deposited/Withdrawn events
    paymentRouter: (process.env.NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS || '0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b') as `0x${string}`,
    // Legacy gasless contracts (archived)
    universalRelayer: (process.env.NEXT_PUBLIC_RELAYER_CONTRACT || '0x9E5512b683d92290ccD20F483D20699658bcb9f3') as `0x${string}`,
    gaslessZKVerifier: (process.env.NEXT_PUBLIC_GASLESS_ZK_VERIFIER || '0x7747e2D3e8fc092A0bd0d6060Ec8d56294A5b73F') as `0x${string}`,
    // Production gasless contract (gas refund model)
    gaslessZKCommitmentVerifier: (process.env.NEXT_PUBLIC_GASLESS_COMMITMENT_VERIFIER || '0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9') as `0x${string}`,
    // TRUE gasless contract (x402 + USDC) ⭐ DEPLOYED Dec 25, 2025
    x402GaslessZKCommitmentVerifier: (process.env.NEXT_PUBLIC_X402_GASLESS_VERIFIER || '0x44098d0dE36e157b4C1700B48d615285C76fdE47') as `0x${string}`,
    // DevUSDCe token on Cronos Testnet (for x402 payments)
    usdcToken: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0' as `0x${string}`,
  },
  cronos_mainnet: {
    zkVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    rwaManager: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    paymentRouter: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    universalRelayer: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    gaslessZKVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    gaslessZKCommitmentVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    x402GaslessZKCommitmentVerifier: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  },
} as const;

/**
 * Get contract addresses for the current chain
 */
export function getContractAddresses(chainId: number) {
  switch (chainId) {
    case 338: // Cronos Testnet
      return CONTRACT_ADDRESSES.cronos_testnet;
    case 25: // Cronos Mainnet
      return CONTRACT_ADDRESSES.cronos_mainnet;
    default:
      return CONTRACT_ADDRESSES.cronos_testnet; // Default to testnet
  }
}
