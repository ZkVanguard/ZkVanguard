/**
 * Crypto.com Developer Platform Service
 * On-chain data access for Cronos EVM and zkEVM
 */

import {
  Client,
  Block,
  Transaction,
  Wallet,
  Token,
  CronosEvm,
  CronosZkEvm,
} from '@crypto.com/developer-platform-client';

export interface OnChainBalance {
  address: string;
  balance: string; // in wei
  balanceFormatted: string; // in ETH/CRO
  symbol: string;
  decimals: number;
}

export interface TokenBalance {
  tokenAddress: string;
  balance: string;
  balanceFormatted: string;
  symbol: string;
  decimals: number;
  name: string;
}

export interface TransactionData {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  blockNumber: number;
  timestamp: number;
  status: 'success' | 'failed' | 'pending';
}

export interface BlockData {
  number: number;
  hash: string;
  timestamp: number;
  transactions: string[];
  gasUsed: string;
  gasLimit: string;
}

class CryptocomDeveloperPlatformService {
  private isInitialized: boolean = false;
  private network: typeof CronosEvm.Mainnet | typeof CronosEvm.Testnet | typeof CronosZkEvm.Mainnet | typeof CronosZkEvm.Testnet;

  constructor() {
    this.network = CronosEvm.Testnet; // Default to Cronos EVM Testnet
  }

  /**
   * Initialize the Developer Platform Client
   */
  async initialize(apiKey?: string, network?: 'mainnet' | 'testnet' | 'zkevm-mainnet' | 'zkevm-testnet'): Promise<void> {
    try {
      const key = apiKey || process.env.DASHBOARD_API_KEY || process.env.CRYPTOCOM_DEVELOPER_API_KEY;
      
      if (!key) {
        console.warn('[DeveloperPlatform] No API key provided, some features may be limited');
      }

      // Set network
      switch (network) {
        case 'mainnet':
          this.network = CronosEvm.Mainnet;
          break;
        case 'testnet':
          this.network = CronosEvm.Testnet;
          break;
        case 'zkevm-mainnet':
          this.network = CronosZkEvm.Mainnet;
          break;
        case 'zkevm-testnet':
          this.network = CronosZkEvm.Testnet;
          break;
        default:
          this.network = CronosEvm.Testnet;
      }

      // Initialize client
      if (!key) {
        throw new Error('API key is required for Crypto.com Developer Platform');
      }
      
      Client.init({
        apiKey: key,
      });

      this.isInitialized = true;
      console.log('[DeveloperPlatform] Initialized successfully on', this.network);
    } catch (error: any) {
      console.error('[DeveloperPlatform] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Get native balance (CRO) for an address
   */
  async getNativeBalance(address: string): Promise<OnChainBalance> {
    this.ensureInitialized();

    try {
      // TODO: SDK method signatures need verification
      // const balance = await Wallet.getBalance({
      //   address,
      //   network: this.network,
      // });

      return {
        address,
        balance: '0',
        balanceFormatted: '0',
        symbol: 'CRO',
        decimals: 18,
      };
    } catch (error: any) {
      console.error(`[DeveloperPlatform] Failed to get balance for ${address}:`, error.message);
      throw error;
    }
  }

  /**
   * Get ERC-20 token balance
   */
  async getTokenBalance(address: string, tokenAddress: string): Promise<TokenBalance> {
    this.ensureInitialized();

    try {
      // TODO: SDK method signatures need verification
      // const balance = await Token.getBalance({
      //   address,
      //   contractAddress: tokenAddress,
      //   network: this.network,
      // });

      return {
        tokenAddress,
        balance: '0',
        balanceFormatted: '0',
        symbol: 'TOKEN',
        decimals: 18,
        name: 'Unknown Token',
      };
    } catch (error: any) {
      console.error(`[DeveloperPlatform] Failed to get token balance:`, error.message);
      throw error;
    }
  }

  /**
   * Get transaction details
   */
  async getTransaction(txHash: string): Promise<TransactionData> {
    this.ensureInitialized();

    try {
      // TODO: SDK method signatures need verification
      // const tx = await Transaction.getByHash({
      //   hash: txHash,
      //   network: this.network,
      // });

      const txData = {} as any;

      return {
        hash: txData.hash,
        from: txData.from,
        to: txData.to || '',
        value: txData.value,
        gasUsed: txData.gasUsed || '0',
        gasPrice: txData.gasPrice || '0',
        blockNumber: parseInt(txData.blockNumber),
        timestamp: txData.timestamp ? parseInt(txData.timestamp) : Date.now() / 1000,
        status: txData.status === '1' ? 'success' : txData.status === '0' ? 'failed' : 'pending',
      };
    } catch (error: any) {
      console.error(`[DeveloperPlatform] Failed to get transaction ${txHash}:`, error.message);
      throw error;
    }
  }

  /**
   * Get transactions for an address
   */
  async getAddressTransactions(address: string, limit: number = 10): Promise<TransactionData[]> {
    this.ensureInitialized();

    try {
      // TODO: SDK method signatures need verification
      // const txs = await Transaction.getByAddress({
      //   address,
      //   network: this.network,
      //   limit,
      // });
      const txs = { data: { items: [] } } as any;

      return txs.data.transactions.map((tx: any) => ({
        hash: tx.hash,
        from: tx.from,
        to: tx.to || '',
        value: tx.value,
        gasUsed: tx.gasUsed || '0',
        gasPrice: tx.gasPrice || '0',
        blockNumber: parseInt(tx.blockNumber),
        timestamp: tx.timestamp ? parseInt(tx.timestamp) : Date.now() / 1000,
        status: tx.status === '1' ? 'success' : tx.status === '0' ? 'failed' : 'pending',
      }));
    } catch (error: any) {
      console.error(`[DeveloperPlatform] Failed to get transactions for ${address}:`, error.message);
      return [];
    }
  }

  /**
   * Get latest block
   */
  async getLatestBlock(): Promise<BlockData> {
    this.ensureInitialized();

    try {
      // TODO: SDK method signatures need verification
      // const block = await Block.get({
      //   tag: 'latest',
      //   network: this.network,
      // });
      const block = { data: { number: '0', timestamp: '0', transactions: [] } } as any;

      const blockData = block.data.block;

      return {
        number: parseInt(blockData.number),
        hash: blockData.hash,
        timestamp: parseInt(blockData.timestamp),
        transactions: blockData.transactions || [],
        gasUsed: blockData.gasUsed,
        gasLimit: blockData.gasLimit,
      };
    } catch (error: any) {
      console.error('[DeveloperPlatform] Failed to get latest block:', error.message);
      throw error;
    }
  }

  /**
   * Get block by number
   */
  async getBlock(blockNumber: number): Promise<BlockData> {
    this.ensureInitialized();

    try {
      // TODO: SDK method signatures need verification
      // const block = await Block.getBlockByNumber({
      //   blockNumber: blockNumber.toString(),
      //   network: this.network,
      // });

      const blockData = {} as any;

      return {
        number: parseInt(blockData.number),
        hash: blockData.hash,
        timestamp: parseInt(blockData.timestamp),
        transactions: blockData.transactions || [],
        gasUsed: blockData.gasUsed,
        gasLimit: blockData.gasLimit,
      };
    } catch (error: any) {
      console.error(`[DeveloperPlatform] Failed to get block ${blockNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all token balances for an address
   */
  async getAllTokenBalances(address: string): Promise<TokenBalance[]> {
    this.ensureInitialized();

    try {
      // Note: This would require iterating through known token contracts
      // For now, return empty array - implement token discovery logic as needed
      console.warn('[DeveloperPlatform] getAllTokenBalances not fully implemented');
      return [];
    } catch (error: any) {
      console.error(`[DeveloperPlatform] Failed to get all token balances:`, error.message);
      return [];
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      const block = await this.getLatestBlock();
      return block.number > 0;
    } catch (error) {
      console.error('[DeveloperPlatform] Health check failed:', error);
      return false;
    }
  }

  /**
   * Ensure service is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Developer Platform service not initialized. Call initialize() first.');
    }
  }

  /**
   * Get current network
   */
  getCurrentNetwork(): string {
    return this.network.toString();
  }

  /**
   * Switch network
   */
  async switchNetwork(network: 'mainnet' | 'testnet' | 'zkevm-mainnet' | 'zkevm-testnet'): Promise<void> {
    const apiKey = process.env.DASHBOARD_API_KEY || process.env.CRYPTOCOM_DEVELOPER_API_KEY;
    this.isInitialized = false;
    await this.initialize(apiKey, network);
  }
}

// Export singleton instance
export const cryptocomDeveloperPlatform = new CryptocomDeveloperPlatformService();
export default CryptocomDeveloperPlatformService;
