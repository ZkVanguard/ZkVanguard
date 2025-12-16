/**
 * Utility functions for contract interactions
 */

import { ethers, type Signer } from 'ethers';
import type { WalletClient } from 'viem';
import { type Account, type Chain, type Transport } from 'viem';

/**
 * Convert viem WalletClient to ethers Signer
 * Required for gasless transactions that use ethers.js
 */
export async function walletClientToSigner(walletClient: WalletClient<Transport, Chain, Account>): Promise<Signer> {
  const { account, chain, transport } = walletClient;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  
  const provider = new ethers.BrowserProvider(transport, network);
  const signer = await provider.getSigner(account.address);
  return signer;
}
