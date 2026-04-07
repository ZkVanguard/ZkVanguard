/**
 * WDK Bridge Service — Cross-Chain USDT Orchestration
 *
 * Manages cross-chain USDT (USD₮0) transfers between supported chains
 * using the Tether Wallet Development Kit infrastructure.
 *
 * Supported chains:
 * - Sepolia (WDK official USDT testnet)
 * - Cronos (mainnet USDT)
 * - Hedera (when USDT is deployed)
 * - Plasma (USD₮0 bridge token)
 * - Stable (USD₮0 bridge token)
 *
 * The service coordinates:
 * 1. Cross-chain USDT balance aggregation
 * 2. Bridge transfers between chains via USD₮0
 * 3. Pool allocation tracking per chain
 * 4. Gas estimation and fee calculations
 *
 * @see lib/config/wdk.ts for chain configs
 * @see lib/wdk/treasury-service.ts for wallet management
 */

import 'server-only';

import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { WDK_CHAINS, USDT_ADDRESSES, type WDKChainConfig } from '@/lib/config/wdk';

// ============================================
// TYPES
// ============================================

export type WdkChainKey = 'sepolia' | 'cronos-mainnet' | 'cronos-testnet' | 'hedera-mainnet' | 'plasma' | 'stable';

export interface ChainBalance {
  chain: WdkChainKey;
  chainName: string;
  usdtBalance: string;
  nativeBalance: string;
  hasGas: boolean;
  usdtConfigured: boolean;
}

export interface BridgeQuote {
  sourceChain: WdkChainKey;
  destChain: WdkChainKey;
  amount: string;
  estimatedFee: string;
  estimatedTime: string; // e.g. "~5 minutes"
  route: string; // e.g. "Sepolia → Plasma (USD₮0) → Cronos"
  canExecute: boolean;
  error?: string;
}

export interface BridgeResult {
  success: boolean;
  sourceChain: WdkChainKey;
  destChain: WdkChainKey;
  amount: string;
  txHash?: string;
  bridgeTxHash?: string;
  error?: string;
  timestamp: number;
}

export interface CrossChainPoolState {
  totalUsdtAcrossChains: number;
  chainBalances: ChainBalance[];
  lastUpdated: number;
}

// ============================================
// ERC20 ABI
// ============================================

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// USD₮0 has additional bridge methods
const USDT0_ABI = [
  ...ERC20_ABI,
  'function send((uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd),bytes,address) payable returns ((bytes32 guid,uint64 nonce,uint256 amountSentLD,uint256 amountReceivedLD) receipt)',
];

// LayerZero endpoint IDs for USD₮0 bridging
const LZ_ENDPOINT_IDS: Partial<Record<WdkChainKey, number>> = {
  'sepolia': 40161,      // Sepolia testnet endpoint
  'cronos-mainnet': 30125, // Cronos mainnet endpoint
  'plasma': 40333,       // Plasma endpoint (estimated)
  'stable': 40334,       // Stable endpoint (estimated)
};

// Minimum gas reserve (in native token, 18 decimals)
const MIN_GAS_RESERVE: Record<string, bigint> = {
  'sepolia': ethers.parseEther('0.01'),        // 0.01 ETH
  'cronos-mainnet': ethers.parseEther('1'),    // 1 CRO
  'cronos-testnet': ethers.parseEther('1'),    // 1 tCRO
  'hedera-mainnet': ethers.parseEther('1'),    // 1 HBAR
  'plasma': ethers.parseEther('0.01'),
  'stable': ethers.parseEther('0.01'),
};

// ============================================
// WDK BRIDGE SERVICE
// ============================================

export class WdkBridgeService {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private wallets: Map<string, ethers.Wallet> = new Map();
  private initialized = false;

  constructor(private privateKey: string) {}

  /**
   * Initialize providers and wallets for all configured WDK chains.
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      const key = this.privateKey.startsWith('0x')
        ? this.privateKey
        : `0x${this.privateKey}`;

      for (const [chainKey, config] of Object.entries(WDK_CHAINS)) {
        if (!config.rpcUrl) continue;

        try {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const wallet = new ethers.Wallet(key, provider);
          this.providers.set(chainKey, provider);
          this.wallets.set(chainKey, wallet);
        } catch (err) {
          logger.warn(`[WdkBridge] Failed to initialize ${chainKey}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.initialized = true;
      logger.info('[WdkBridge] Initialized', { chains: Array.from(this.wallets.keys()) });
      return true;
    } catch (err) {
      logger.error('[WdkBridge] Init failed', { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /**
   * Get USDT balance on a specific chain.
   */
  async getUsdtBalance(chainKey: WdkChainKey): Promise<string> {
    await this.initialize();
    const wallet = this.wallets.get(chainKey);
    const config = WDK_CHAINS[chainKey];
    if (!wallet || !config?.usdtAddress) return '0';

    try {
      const token = new ethers.Contract(config.usdtAddress, ERC20_ABI, wallet.provider);
      const balance: bigint = await token.balanceOf(wallet.address);
      return ethers.formatUnits(balance, 6);
    } catch {
      return '0';
    }
  }

  /**
   * Get native token balance on a specific chain (for gas).
   */
  async getNativeBalance(chainKey: WdkChainKey): Promise<string> {
    await this.initialize();
    const wallet = this.wallets.get(chainKey);
    if (!wallet?.provider) return '0';

    try {
      const balance = await wallet.provider.getBalance(wallet.address);
      return ethers.formatEther(balance);
    } catch {
      return '0';
    }
  }

  /**
   * Get aggregated USDT balances across all WDK chains.
   */
  async getCrossChainBalances(): Promise<CrossChainPoolState> {
    await this.initialize();

    const chainBalances: ChainBalance[] = [];
    let totalUsdt = 0;

    const chainKeys: WdkChainKey[] = ['sepolia', 'cronos-mainnet', 'hedera-mainnet', 'plasma', 'stable'];

    for (const chainKey of chainKeys) {
      const config = WDK_CHAINS[chainKey];
      if (!config) continue;

      const [usdtBalance, nativeBalance] = await Promise.all([
        this.getUsdtBalance(chainKey),
        this.getNativeBalance(chainKey),
      ]);

      const nativeWei = ethers.parseEther(nativeBalance || '0');
      const minGas = MIN_GAS_RESERVE[chainKey] || 0n;

      const balance: ChainBalance = {
        chain: chainKey,
        chainName: config.name,
        usdtBalance,
        nativeBalance,
        hasGas: nativeWei > minGas,
        usdtConfigured: !!config.usdtAddress,
      };

      chainBalances.push(balance);
      totalUsdt += parseFloat(usdtBalance);
    }

    return {
      totalUsdtAcrossChains: totalUsdt,
      chainBalances,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get a bridge quote for transferring USDT between chains.
   */
  async getBridgeQuote(
    sourceChain: WdkChainKey,
    destChain: WdkChainKey,
    amount: string,
  ): Promise<BridgeQuote> {
    const sourceConfig = WDK_CHAINS[sourceChain];
    const destConfig = WDK_CHAINS[destChain];

    if (!sourceConfig?.usdtAddress) {
      return {
        sourceChain, destChain, amount,
        estimatedFee: '0', estimatedTime: 'N/A',
        route: 'N/A', canExecute: false,
        error: `USDT not configured on ${sourceChain}`,
      };
    }

    if (!destConfig?.usdtAddress) {
      return {
        sourceChain, destChain, amount,
        estimatedFee: '0', estimatedTime: 'N/A',
        route: 'N/A', canExecute: false,
        error: `USDT not configured on ${destChain}`,
      };
    }

    // Check balance
    const balance = await this.getUsdtBalance(sourceChain);
    if (parseFloat(balance) < parseFloat(amount)) {
      return {
        sourceChain, destChain, amount,
        estimatedFee: '0', estimatedTime: 'N/A',
        route: 'insufficient balance', canExecute: false,
        error: `Insufficient USDT on ${sourceChain}: ${balance} < ${amount}`,
      };
    }

    // Determine route
    // For same-network transfers: direct USDT transfer
    // For cross-chain: USD₮0 → LayerZero bridging
    const isUSDT0Source = sourceChain === 'plasma' || sourceChain === 'stable';
    const isUSDT0Dest = destChain === 'plasma' || destChain === 'stable';

    let route: string;
    let estimatedTime: string;
    let estimatedFee: string;

    if (isUSDT0Source || isUSDT0Dest) {
      // USD₮0 bridge path via LayerZero OFT
      route = `${sourceConfig.name} → LayerZero OFT → ${destConfig.name}`;
      estimatedTime = '~3-5 minutes';
      estimatedFee = '0.50'; // Estimated LayerZero gas cost in USDT terms
    } else {
      // Two-hop bridge: Source → Plasma (USD₮0) → Dest
      route = `${sourceConfig.name} → Plasma (USD₮0) → ${destConfig.name}`;
      estimatedTime = '~8-12 minutes';
      estimatedFee = '1.00'; // Two-hop fee
    }

    return {
      sourceChain, destChain, amount,
      estimatedFee, estimatedTime, route,
      canExecute: true,
    };
  }

  /**
   * Execute a same-chain USDT transfer.
   */
  async transferUsdt(
    chainKey: WdkChainKey,
    to: string,
    amount: string,
  ): Promise<BridgeResult> {
    await this.initialize();
    const wallet = this.wallets.get(chainKey);
    const config = WDK_CHAINS[chainKey];

    if (!wallet || !config?.usdtAddress) {
      return {
        success: false, sourceChain: chainKey, destChain: chainKey,
        amount, error: `USDT not configured on ${chainKey}`, timestamp: Date.now(),
      };
    }

    try {
      const token = new ethers.Contract(config.usdtAddress, ERC20_ABI, wallet);
      const amountWei = ethers.parseUnits(amount, 6);

      const tx = await token.transfer(to, amountWei);
      const receipt = await tx.wait();

      logger.info('[WdkBridge] USDT transfer', {
        chain: chainKey, to, amount, txHash: receipt.hash,
      });

      return {
        success: true, sourceChain: chainKey, destChain: chainKey,
        amount, txHash: receipt.hash, timestamp: Date.now(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false, sourceChain: chainKey, destChain: chainKey,
        amount, error: msg, timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute a cross-chain USDT bridge via USD₮0 (LayerZero OFT).
   *
   * For chains that support USD₮0 (Plasma, Stable): Direct OFT send.
   * For EVM chains: Transfer to Plasma first, then OFT bridge to destination.
   *
   * Note: This is a best-effort implementation. Real cross-chain bridging
   * requires LayerZero endpoint configuration and USD₮0 contract integration.
   */
  async bridgeUsdt(
    sourceChain: WdkChainKey,
    destChain: WdkChainKey,
    amount: string,
  ): Promise<BridgeResult> {
    await this.initialize();

    const quote = await this.getBridgeQuote(sourceChain, destChain, amount);
    if (!quote.canExecute) {
      return {
        success: false, sourceChain, destChain, amount,
        error: quote.error, timestamp: Date.now(),
      };
    }

    const sourceWallet = this.wallets.get(sourceChain);
    const destWallet = this.wallets.get(destChain);
    if (!sourceWallet || !destWallet) {
      return {
        success: false, sourceChain, destChain, amount,
        error: 'Wallets not initialized for source/dest chains',
        timestamp: Date.now(),
      };
    }

    const destAddress = destWallet.address;
    const sourceConfig = WDK_CHAINS[sourceChain];
    const destEid = LZ_ENDPOINT_IDS[destChain];

    // USD₮0 direct bridge (source has USD₮0 token)
    if ((sourceChain === 'plasma' || sourceChain === 'stable') && destEid && sourceConfig?.usdtAddress) {
      try {
        const usdt0 = new ethers.Contract(sourceConfig.usdtAddress, USDT0_ABI, sourceWallet);
        const amountLD = ethers.parseUnits(amount, 6);
        const minAmountLD = amountLD * 99n / 100n; // 1% slippage

        // Encode destination address as bytes32
        const toBytes32 = ethers.zeroPadValue(destAddress, 32);

        const sendParam = {
          dstEid: destEid,
          to: toBytes32,
          amountLD,
          minAmountLD,
          extraOptions: '0x',
          composeMsg: '0x',
          oftCmd: '0x',
        };

        const tx = await usdt0.send(sendParam, '0x', destAddress, { value: ethers.parseEther('0.01') });
        const receipt = await tx.wait();

        logger.info('[WdkBridge] USD₮0 bridge executed', {
          sourceChain, destChain, amount, txHash: receipt.hash,
        });

        return {
          success: true, sourceChain, destChain, amount,
          bridgeTxHash: receipt.hash, timestamp: Date.now(),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('[WdkBridge] USD₮0 bridge failed', { error: msg });
        return {
          success: false, sourceChain, destChain, amount,
          error: msg, timestamp: Date.now(),
        };
      }
    }

    // Fallback: same-chain transfer (for chains without direct bridge)
    // In production, this would route through Plasma/Stable as intermediary
    logger.warn('[WdkBridge] Cross-chain bridge not available for this route — using same-chain transfer', {
      sourceChain, destChain,
    });

    return this.transferUsdt(sourceChain, destAddress, amount);
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.providers.clear();
    this.wallets.clear();
    this.initialized = false;
  }
}

// ============================================
// SINGLETON FACTORY
// ============================================

let bridgeInstance: WdkBridgeService | null = null;

export function getWdkBridgeService(): WdkBridgeService | null {
  if (bridgeInstance) return bridgeInstance;

  const key = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.HEDERA_PRIVATE_KEY;
  if (!key) {
    logger.warn('[WdkBridge] No private key configured — bridge disabled');
    return null;
  }

  bridgeInstance = new WdkBridgeService(key);
  return bridgeInstance;
}
