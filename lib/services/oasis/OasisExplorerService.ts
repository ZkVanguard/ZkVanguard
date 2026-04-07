/**
 * Oasis Explorer Service
 * 
 * On-chain data querying for Oasis Sapphire and Emerald ParaTimes.
 * Uses the Oasis Nexus API and direct EVM RPC calls for:
 * - Transaction history & block data
 * - Contract state reads
 * - Balance lookups  
 * - Token metadata
 * 
 * Mirrors the Cronos Explorer proxy and SuiExplorerService pattern.
 * 
 * @see lib/services/SuiExplorerService.ts  (SUI equivalent)
 * @see app/api/cronos-explorer/route.ts    (Cronos equivalent)
 */

import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getOasisSapphireProvider, getOasisEmeraldProvider } from '@/lib/throttled-provider';

// ============================================
// CONFIGURATION
// ============================================

const OASIS_EXPLORER_CONFIG = {
  'sapphire-testnet': {
    rpcUrl: process.env.OASIS_SAPPHIRE_TESTNET_RPC || 'https://testnet.sapphire.oasis.io',
    explorerUrl: 'https://explorer.oasis.io/testnet/sapphire',
    nexusApiUrl: 'https://nexus.oasis.io/v1',
    chainId: 23295,
    faucetUrl: 'https://faucet.testnet.oasis.io/',
    paratime: 'sapphire',
  },
  'sapphire-mainnet': {
    rpcUrl: process.env.OASIS_SAPPHIRE_MAINNET_RPC || 'https://sapphire.oasis.io',
    explorerUrl: 'https://explorer.oasis.io/mainnet/sapphire',
    nexusApiUrl: 'https://nexus.oasis.io/v1',
    chainId: 23294,
    faucetUrl: '',
    paratime: 'sapphire',
  },
  'emerald-testnet': {
    rpcUrl: process.env.OASIS_EMERALD_TESTNET_RPC || 'https://testnet.emerald.oasis.io',
    explorerUrl: 'https://explorer.oasis.io/testnet/emerald',
    nexusApiUrl: 'https://nexus.oasis.io/v1',
    chainId: 42261,
    faucetUrl: 'https://faucet.testnet.oasis.io/',
    paratime: 'emerald',
  },
  'emerald-mainnet': {
    rpcUrl: process.env.OASIS_EMERALD_MAINNET_RPC || 'https://emerald.oasis.io',
    explorerUrl: 'https://explorer.oasis.io/mainnet/emerald',
    nexusApiUrl: 'https://nexus.oasis.io/v1',
    chainId: 42262,
    faucetUrl: '',
    paratime: 'emerald',
  },
} as const;

type OasisNetwork = keyof typeof OASIS_EXPLORER_CONFIG;

// ============================================
// TYPES
// ============================================

export interface OasisBalance {
  address: string;
  balanceWei: bigint;
  balanceFormatted: number;
  symbol: string;
}

export interface OasisTransaction {
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string | null;
  value: string;
  gasUsed: string;
  status: 'success' | 'failure';
  explorerUrl: string;
}

export interface OasisBlock {
  number: number;
  hash: string;
  timestamp: number;
  transactionCount: number;
  gasUsed: string;
  gasLimit: string;
}

export interface OasisContractInfo {
  address: string;
  bytecodeSize: number;
  isContract: boolean;
  explorerUrl: string;
}

export interface OasisTokenBalance {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceFormatted: number;
}

// ERC20 minimal ABI for token queries
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
];

// ============================================
// SERVICE
// ============================================

export class OasisExplorerService {
  private network: OasisNetwork;
  private config: typeof OASIS_EXPLORER_CONFIG[OasisNetwork];
  private provider: ethers.JsonRpcProvider;

  constructor(network: OasisNetwork = 'sapphire-testnet') {
    this.network = network;
    this.config = OASIS_EXPLORER_CONFIG[network];
    
    // Use throttled provider for rate limiting
    const isSapphire = network.startsWith('sapphire');
    const throttled = isSapphire 
      ? getOasisSapphireProvider(this.config.rpcUrl)
      : getOasisEmeraldProvider(this.config.rpcUrl);
    this.provider = throttled.provider;

    logger.info('🔍 [OasisExplorer] Initialized', { network, rpcUrl: this.config.rpcUrl });
  }

  // ─── Balance Queries ────────────────────────────────────────

  /**
   * Get native ROSE balance for an address
   */
  async getBalance(address: string): Promise<OasisBalance> {
    const balance = await this.provider.getBalance(address);
    return {
      address,
      balanceWei: balance,
      balanceFormatted: parseFloat(ethers.formatEther(balance)),
      symbol: 'ROSE',
    };
  }

  /**
   * Get ERC20 token balance
   */
  async getTokenBalance(address: string, tokenAddress: string): Promise<OasisTokenBalance> {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const [balance, symbol, name, decimals] = await Promise.all([
      contract.balanceOf(address),
      contract.symbol().catch(() => 'UNKNOWN'),
      contract.name().catch(() => 'Unknown Token'),
      contract.decimals().catch(() => 18),
    ]);

    return {
      tokenAddress,
      symbol,
      name,
      decimals: Number(decimals),
      balance: balance.toString(),
      balanceFormatted: parseFloat(ethers.formatUnits(balance, decimals)),
    };
  }

  // ─── Transaction Queries ────────────────────────────────────

  /**
   * Get transaction by hash
   */
  async getTransaction(txHash: string): Promise<OasisTransaction | null> {
    const [tx, receipt] = await Promise.all([
      this.provider.getTransaction(txHash),
      this.provider.getTransactionReceipt(txHash),
    ]);

    if (!tx) return null;

    const block = tx.blockNumber ? await this.provider.getBlock(tx.blockNumber) : null;

    return {
      hash: tx.hash,
      blockNumber: tx.blockNumber || 0,
      timestamp: block?.timestamp || 0,
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value),
      gasUsed: receipt ? receipt.gasUsed.toString() : '0',
      status: receipt?.status === 1 ? 'success' : 'failure',
      explorerUrl: this.getTransactionUrl(tx.hash),
    };
  }

  /**
   * Get transaction count (nonce) for an address
   */
  async getTransactionCount(address: string): Promise<number> {
    return this.provider.getTransactionCount(address);
  }

  // ─── Block Queries ──────────────────────────────────────────

  /**
   * Get latest block number
   */
  async getLatestBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /**
   * Get block by number
   */
  async getBlock(blockNumber: number): Promise<OasisBlock | null> {
    const block = await this.provider.getBlock(blockNumber);
    if (!block) return null;

    return {
      number: block.number,
      hash: block.hash || '',
      timestamp: block.timestamp,
      transactionCount: block.transactions?.length || 0,
      gasUsed: block.gasUsed.toString(),
      gasLimit: block.gasLimit.toString(),
    };
  }

  /**
   * Get latest block
   */
  async getLatestBlock(): Promise<OasisBlock | null> {
    const blockNumber = await this.getLatestBlockNumber();
    return this.getBlock(blockNumber);
  }

  // ─── Contract Queries ───────────────────────────────────────

  /**
   * Check if an address is a contract
   */
  async getContractInfo(address: string): Promise<OasisContractInfo> {
    const code = await this.provider.getCode(address);
    const isContract = code !== '0x' && code.length > 2;

    return {
      address,
      bytecodeSize: isContract ? code.length : 0,
      isContract,
      explorerUrl: this.getAddressUrl(address),
    };
  }

  /**
   * Read contract state (generic call)
   */
  async readContract(
    contractAddress: string,
    abi: string[],
    functionName: string,
    args: unknown[] = []
  ): Promise<unknown> {
    const contract = new ethers.Contract(contractAddress, abi, this.provider);
    return contract[functionName](...args);
  }

  // ─── Chain Info ─────────────────────────────────────────────

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<{ wei: bigint; gwei: string }> {
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(0);
    return {
      wei: gasPrice,
      gwei: ethers.formatUnits(gasPrice, 'gwei'),
    };
  }

  /**
   * Get chain ID
   */
  async getChainId(): Promise<number> {
    const network = await this.provider.getNetwork();
    return Number(network.chainId);
  }

  // ─── URL Generators ─────────────────────────────────────────

  getTransactionUrl(txHash: string): string {
    return `${this.config.explorerUrl}/tx/${txHash}`;
  }

  getAddressUrl(address: string): string {
    return `${this.config.explorerUrl}/address/${address}`;
  }

  getBlockUrl(blockNumber: number): string {
    return `${this.config.explorerUrl}/block/${blockNumber}`;
  }

  getTokenUrl(tokenAddress: string): string {
    return `${this.config.explorerUrl}/token/${tokenAddress}`;
  }

  // ─── Service Info ───────────────────────────────────────────

  getConfig() {
    return {
      network: this.network,
      chainId: this.config.chainId,
      rpcUrl: this.config.rpcUrl,
      explorerUrl: this.config.explorerUrl,
      paratime: this.config.paratime,
    };
  }
}

// ─── Singleton Factories ──────────────────────────────────────

let _sapphireExplorer: OasisExplorerService | null = null;
let _emeraldExplorer: OasisExplorerService | null = null;

export function getOasisSapphireExplorer(): OasisExplorerService {
  if (!_sapphireExplorer) {
    const network = (process.env.NEXT_PUBLIC_OASIS_NETWORK === 'mainnet' 
      ? 'sapphire-mainnet' 
      : 'sapphire-testnet') as OasisNetwork;
    _sapphireExplorer = new OasisExplorerService(network);
  }
  return _sapphireExplorer;
}

export function getOasisEmeraldExplorer(): OasisExplorerService {
  if (!_emeraldExplorer) {
    const network = (process.env.NEXT_PUBLIC_OASIS_NETWORK === 'mainnet'
      ? 'emerald-mainnet'
      : 'emerald-testnet') as OasisNetwork;
    _emeraldExplorer = new OasisExplorerService(network);
  }
  return _emeraldExplorer;
}
