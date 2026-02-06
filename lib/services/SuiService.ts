/**
 * SUI Blockchain Service
 * 
 * Provides integration with the SUI blockchain for:
 * - Wallet connections (@mysten/dapp-kit)
 * - Transaction execution
 * - Sponsored transactions (gasless)
 * - Balance fetching
 */

import { logger } from '@/lib/utils/logger';

// SUI Network Configuration
export const SUI_NETWORKS = {
  mainnet: {
    name: 'SUI Mainnet',
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    explorerUrl: 'https://suiexplorer.com',
    faucetUrl: null,
  },
  testnet: {
    name: 'SUI Testnet', 
    rpcUrl: 'https://fullnode.testnet.sui.io:443',
    explorerUrl: 'https://suiexplorer.com/?network=testnet',
    faucetUrl: 'https://faucet.testnet.sui.io',
  },
  devnet: {
    name: 'SUI Devnet',
    rpcUrl: 'https://fullnode.devnet.sui.io:443',
    explorerUrl: 'https://suiexplorer.com/?network=devnet',
    faucetUrl: 'https://faucet.devnet.sui.io',
  },
} as const;

export type SuiNetworkType = keyof typeof SUI_NETWORKS;

// Default network for development
const DEFAULT_NETWORK: SuiNetworkType = 'testnet';

/**
 * SUI Token addresses (Object IDs for common tokens)
 * Note: SUI uses object IDs instead of contract addresses
 */
export const SUI_TOKENS = {
  SUI: '0x2::sui::SUI', // Native SUI token
  // Add wrapped tokens as they become available
} as const;

/**
 * SUI Service Class
 * 
 * Wraps @mysten/sui SDK functionality for ZkVanguard
 */
export class SuiService {
  private network: SuiNetworkType;
  private rpcUrl: string;

  constructor(network: SuiNetworkType = DEFAULT_NETWORK) {
    this.network = network;
    this.rpcUrl = SUI_NETWORKS[network].rpcUrl;
  }

  /**
   * Get current network configuration
   */
  getNetworkConfig() {
    return SUI_NETWORKS[this.network];
  }

  /**
   * Switch network
   */
  switchNetwork(network: SuiNetworkType) {
    this.network = network;
    this.rpcUrl = SUI_NETWORKS[network].rpcUrl;
  }

  /**
   * Get SUI balance for an address
   * 
   * @param address - SUI address (0x...)
   * @returns Balance in SUI
   */
  async getBalance(address: string): Promise<{ balance: string; balanceRaw: string }> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getBalance',
          params: [address, '0x2::sui::SUI'],
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      const totalBalance = data.result?.totalBalance || '0';
      // SUI has 9 decimals
      const balanceInSui = (BigInt(totalBalance) / BigInt(10 ** 9)).toString();
      
      return {
        balance: balanceInSui,
        balanceRaw: totalBalance,
      };
    } catch (error) {
      logger.error('[SuiService] Failed to get balance', error, { component: 'SuiService' });
      return { balance: '0', balanceRaw: '0' };
    }
  }

  /**
   * Get all coin balances for an address
   */
  async getAllBalances(address: string): Promise<Array<{ coinType: string; balance: string }>> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getAllBalances',
          params: [address],
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      return data.result || [];
    } catch (error) {
      logger.error('[SuiService] Failed to get all balances', error, { component: 'SuiService' });
      return [];
    }
  }

  /**
   * Get transaction details
   */
  async getTransaction(digest: string): Promise<unknown> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sui_getTransactionBlock',
          params: [digest, { showEffects: true, showInput: true }],
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      return data.result;
    } catch (error) {
      logger.error('[SuiService] Failed to get transaction', error, { component: 'SuiService' });
      return null;
    }
  }

  /**
   * Get explorer URL for a transaction
   */
  getExplorerUrl(digest: string): string {
    const baseUrl = SUI_NETWORKS[this.network].explorerUrl;
    return `${baseUrl}/txblock/${digest}`;
  }

  /**
   * Get explorer URL for an address
   */
  getAddressExplorerUrl(address: string): string {
    const baseUrl = SUI_NETWORKS[this.network].explorerUrl;
    return `${baseUrl}/address/${address}`;
  }

  /**
   * Get faucet URL for testnet/devnet
   */
  getFaucetUrl(): string | null {
    return SUI_NETWORKS[this.network].faucetUrl;
  }

  /**
   * Request tokens from faucet (testnet/devnet only)
   */
  async requestFaucetTokens(address: string): Promise<{ success: boolean; message: string }> {
    const faucetUrl = this.getFaucetUrl();
    
    if (!faucetUrl) {
      return { success: false, message: 'Faucet not available on mainnet' };
    }

    try {
      const response = await fetch(`${faucetUrl}/gas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FixedAmountRequest: { recipient: address },
        }),
      });

      if (!response.ok) {
        throw new Error(`Faucet request failed: ${response.statusText}`);
      }

      return { success: true, message: 'Tokens requested successfully' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}

// Singleton instance
let suiServiceInstance: SuiService | null = null;

export function getSuiService(network?: SuiNetworkType): SuiService {
  if (!suiServiceInstance) {
    suiServiceInstance = new SuiService(network);
  } else if (network && network !== suiServiceInstance['network']) {
    suiServiceInstance.switchNetwork(network);
  }
  return suiServiceInstance;
}

export default SuiService;
