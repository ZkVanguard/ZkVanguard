/**
 * Chain parameters for wallet_switchEthereumChain / wallet_addEthereumChain
 * Shared by handleDeposit and handleWithdraw in useCommunityPool
 */

export interface ChainParam {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  blockExplorerUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export const EVM_CHAIN_PARAMS: Record<number, ChainParam> = {
  11155111: { // Sepolia
    chainId: '0xaa36a7',
    chainName: 'Sepolia',
    rpcUrls: ['https://sepolia.drpc.org', 'https://rpc.sepolia.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  },
  25: { // Cronos Mainnet
    chainId: '0x19',
    chainName: 'Cronos',
    rpcUrls: ['https://evm.cronos.org', 'https://cronos-evm-rpc.publicnode.com'],
    blockExplorerUrls: ['https://explorer.cronos.org'],
    nativeCurrency: { name: 'Cronos', symbol: 'CRO', decimals: 18 },
  },
  338: { // Cronos Testnet
    chainId: '0x152',
    chainName: 'Cronos Testnet',
    rpcUrls: ['https://evm-t3.cronos.org'],
    blockExplorerUrls: ['https://explorer.cronos.org/testnet'],
    nativeCurrency: { name: 'Test Cronos', symbol: 'tCRO', decimals: 18 },
  },
  296: { // Hedera Testnet
    chainId: '0x128',
    chainName: 'Hedera Testnet',
    rpcUrls: ['https://testnet.hashio.io/api'],
    blockExplorerUrls: ['https://hashscan.io/testnet'],
    nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  },
};

/**
 * Switch wallet to target chain using native wallet API.
 * Tries wallet_switchEthereumChain first, falls back to wallet_addEthereumChain.
 */
export async function switchChainNative(targetChainId: number): Promise<void> {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error('No wallet detected');

  const params = EVM_CHAIN_PARAMS[targetChainId];
  if (!params) throw new Error(`Chain ${targetChainId} not configured`);

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: params.chainId }],
    });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [params],
      });
    } else {
      throw switchError;
    }
  }
}
