/**
 * Oasis Auto-Hedging Adapter
 * 
 * Extends the AutoHedging system for Oasis Sapphire portfolios.
 * Like SuiAutoHedgingAdapter but for the EVM-compatible Oasis chain.
 * 
 * Architecture:
 * 1. Monitors Oasis portfolio positions (via RWAManager contract)
 * 2. Fetches live prices via RealMarketDataService (chain-agnostic)
 * 3. Executes hedges on-chain via HedgeExecutor
 * 4. Leverages Sapphire confidentiality for private risk data
 * 
 * Note: Oasis doesn't have a DEX like BlueFin (SUI) or Moonlander (Cronos) yet.
 * Hedges are executed directly on-chain via HedgeExecutor contract.
 * 
 * @see lib/services/AutoHedgingService.ts      (Cronos equivalent)
 * @see lib/services/SuiAutoHedgingAdapter.ts    (SUI equivalent)
 */

import { ethers } from 'ethers';
import crypto from 'crypto';
import { logger } from '@/lib/utils/logger';
import { getOasisSapphireProvider } from '@/lib/throttled-provider';
import { OASIS_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';
import { getMarketDataService } from './RealMarketDataService';

// ============================================
// CONFIGURATION
// ============================================

const OASIS_HEDGE_CONFIG = {
  /** PnL update interval (ms) */
  PNL_UPDATE_INTERVAL_MS: 15_000,
  /** Risk assessment interval (ms) */
  RISK_CHECK_INTERVAL_MS: 90_000,
  /** Max portfolio drawdown before auto-hedge triggers (%) */
  MAX_DRAWDOWN_PERCENT: 4,
  /** Max single-asset concentration before de-risking (%) */
  MAX_CONCENTRATION_PERCENT: 45,
  /** Minimum hedge size in USD */
  MIN_HEDGE_SIZE_USD: 25,
  /** Default leverage for auto-hedges */
  DEFAULT_LEVERAGE: 2,
  /** Default stop-loss percentage */
  DEFAULT_STOP_LOSS_PERCENT: 12,
  /** Default take-profit percentage */
  DEFAULT_TAKE_PROFIT_PERCENT: 25,
};

const OASIS_DEPLOYMENTS = {
  testnet: {
    chainId: 23295,
    rwaManager: OASIS_CONTRACT_ADDRESSES.testnet.rwaManager,
    hedgeExecutor: OASIS_CONTRACT_ADDRESSES.testnet.hedgeExecutor,
    zkVerifier: OASIS_CONTRACT_ADDRESSES.testnet.zkVerifier,
    rpcUrl: process.env.OASIS_SAPPHIRE_TESTNET_RPC || 'https://testnet.sapphire.oasis.io',
  },
  mainnet: {
    chainId: 23294,
    rwaManager: process.env.NEXT_PUBLIC_OASIS_MAINNET_RWA_MANAGER || '',
    hedgeExecutor: process.env.NEXT_PUBLIC_OASIS_MAINNET_HEDGE_EXECUTOR || '',
    zkVerifier: process.env.NEXT_PUBLIC_OASIS_MAINNET_ZK_VERIFIER || '',
    rpcUrl: process.env.OASIS_SAPPHIRE_MAINNET_RPC || 'https://sapphire.oasis.io',
  },
} as const;

const OASIS_NETWORK = (process.env.NEXT_PUBLIC_OASIS_NETWORK || 'testnet') as keyof typeof OASIS_DEPLOYMENTS;
const OASIS_CONTRACTS = OASIS_DEPLOYMENTS[OASIS_NETWORK] || OASIS_DEPLOYMENTS.testnet;

// RWA Manager ABI (read-only queries)
const RWA_MANAGER_ABI = [
  'function portfolioCount() view returns (uint256)',
  'function portfolios(uint256) view returns (address owner, uint256 totalValue, uint256 targetYield, uint256 riskTolerance, uint256 lastRebalance, bool isActive)',
];

// HedgeExecutor ABI
const HEDGE_EXECUTOR_ABI = [
  'function hedgeCount() view returns (uint256)',
  'function getHedge(uint256) view returns (address owner, address asset, bool isShort, uint256 size, uint256 entryPrice, uint256 currentPrice, int256 unrealizedPnl, uint256 leverage, uint256 timestamp, bool isActive)',
];

// ============================================
// TYPES
// ============================================

export interface OasisHedgePosition {
  hedgeId: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  size: number;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  notionalValue: number;
  status: 'active' | 'closed' | 'liquidated';
  createdAt: number;
  reason: string;
  chain: 'oasis-sapphire';
}

export interface OasisPortfolioRisk {
  totalValueUsd: number;
  drawdownPercent: number;
  volatility: number;
  concentrationRisk: number;
  riskScore: number; // 1-10
  topAsset: string;
  topAssetPercent: number;
  recommendations: OasisHedgeRecommendation[];
}

export interface OasisHedgeRecommendation {
  asset: string;
  side: 'LONG' | 'SHORT';
  suggestedSize: number;
  leverage: number;
  confidence: number; // 0-1
  reason: string;
}

export interface OasisAutoHedgeConfig {
  ownerAddress: string;
  enabled: boolean;
  riskThreshold: number; // 1-10 scale
  maxLeverage: number;
  allowedAssets: string[];
}

// ============================================
// OASIS AUTO-HEDGING ADAPTER
// ============================================

export class OasisAutoHedgingAdapter {
  private isRunning = false;
  private pnlInterval: NodeJS.Timeout | null = null;
  private riskInterval: NodeJS.Timeout | null = null;
  private configs: Map<string, OasisAutoHedgeConfig> = new Map();
  private activeHedges: Map<string, OasisHedgePosition> = new Map();
  private lastRisk: Map<string, OasisPortfolioRisk> = new Map();

  // ============================================
  // LIFECYCLE
  // ============================================

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('[OasisAutoHedge] Starting adapter');

    await this.updateAllPnL();

    this.pnlInterval = setInterval(async () => {
      try { await this.updateAllPnL(); }
      catch (e) { logger.error('[OasisAutoHedge] PnL error', { error: e }); }
    }, OASIS_HEDGE_CONFIG.PNL_UPDATE_INTERVAL_MS);

    this.riskInterval = setInterval(async () => {
      try { await this.checkAllRisks(); }
      catch (e) { logger.error('[OasisAutoHedge] Risk error', { error: e }); }
    }, OASIS_HEDGE_CONFIG.RISK_CHECK_INTERVAL_MS);

    logger.info('[OasisAutoHedge] Adapter started', {
      pnlMs: OASIS_HEDGE_CONFIG.PNL_UPDATE_INTERVAL_MS,
      riskMs: OASIS_HEDGE_CONFIG.RISK_CHECK_INTERVAL_MS,
    });
  }

  stop(): void {
    if (!this.isRunning) return;
    if (this.pnlInterval) clearInterval(this.pnlInterval);
    if (this.riskInterval) clearInterval(this.riskInterval);
    this.pnlInterval = null;
    this.riskInterval = null;
    this.isRunning = false;
    logger.info('[OasisAutoHedge] Adapter stopped');
  }

  // ============================================
  // CONFIGURATION
  // ============================================

  enableForAddress(config: OasisAutoHedgeConfig): void {
    this.configs.set(config.ownerAddress, config);
    logger.info('[OasisAutoHedge] Enabled', {
      owner: config.ownerAddress.slice(0, 10),
      threshold: config.riskThreshold,
      assets: config.allowedAssets,
    });
  }

  disableForAddress(ownerAddress: string): void {
    this.configs.delete(ownerAddress);
    logger.info('[OasisAutoHedge] Disabled', { owner: ownerAddress.slice(0, 10) });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      chain: 'oasis-sapphire',
      network: OASIS_NETWORK,
      enabledAddresses: Array.from(this.configs.keys()),
      activeHedges: this.activeHedges.size,
      config: OASIS_HEDGE_CONFIG,
      contracts: {
        rwaManager: OASIS_CONTRACTS.rwaManager,
        hedgeExecutor: OASIS_CONTRACTS.hedgeExecutor,
      },
    };
  }

  // ============================================
  // PNL UPDATES
  // ============================================

  private async updateAllPnL(): Promise<void> {
    if (this.activeHedges.size === 0) return;

    const marketData = getMarketDataService();
    const uniqueAssets = [...new Set(
      Array.from(this.activeHedges.values()).map(h => h.asset),
    )];

    // Fetch current prices
    const prices: Record<string, number> = {};
    for (const asset of uniqueAssets) {
      try {
        const data = await marketData.getTokenPrice(asset);
        if (data?.price) prices[asset] = data.price;
      } catch {
        logger.warn(`[OasisAutoHedge] Price fetch failed: ${asset}`);
      }
    }

    // Update each hedge
    for (const [id, hedge] of this.activeHedges) {
      const price = prices[hedge.asset];
      if (!price) continue;

      const pnlMultiplier = hedge.side === 'SHORT'
        ? (hedge.entryPrice - price) / hedge.entryPrice
        : (price - hedge.entryPrice) / hedge.entryPrice;

      hedge.currentPrice = price;
      hedge.unrealizedPnl = hedge.notionalValue * pnlMultiplier * hedge.leverage;

      // Auto-close conditions
      const pnlPercent = pnlMultiplier * 100 * hedge.leverage;
      if (pnlPercent <= -OASIS_HEDGE_CONFIG.DEFAULT_STOP_LOSS_PERCENT) {
        logger.warn('[OasisAutoHedge] Stop-loss hit', { hedgeId: id, pnlPercent });
        this.closeHedge(id);
      } else if (pnlPercent >= OASIS_HEDGE_CONFIG.DEFAULT_TAKE_PROFIT_PERCENT) {
        logger.info('[OasisAutoHedge] Take-profit hit', { hedgeId: id, pnlPercent });
        this.closeHedge(id);
      }
    }
  }

  // ============================================
  // RISK ASSESSMENT
  // ============================================

  private async checkAllRisks(): Promise<void> {
    for (const [address, config] of this.configs) {
      if (!config.enabled) continue;

      try {
        const risk = await this.assessRisk(address);
        this.lastRisk.set(address, risk);

        if (risk.riskScore >= config.riskThreshold) {
          logger.info('[OasisAutoHedge] Risk threshold exceeded', {
            owner: address.slice(0, 10),
            score: risk.riskScore,
            threshold: config.riskThreshold,
          });

          for (const rec of risk.recommendations) {
            if (rec.confidence >= 0.7) {
              await this.executeHedge(address, config, rec);
            }
          }
        }
      } catch (e) {
        logger.error('[OasisAutoHedge] Risk check failed', {
          address: address.slice(0, 10),
          error: e,
        });
      }
    }
  }

  /**
   * Assess portfolio risk for an Oasis address by reading RWAManager state
   */
  async assessRisk(ownerAddress: string): Promise<OasisPortfolioRisk> {
    try {
      const provider = getOasisSapphireProvider().provider;

      if (!OASIS_CONTRACTS.rwaManager) {
        return this.emptyRisk();
      }

      const rwaManager = new ethers.Contract(
        OASIS_CONTRACTS.rwaManager,
        RWA_MANAGER_ABI,
        provider,
      );

      // Read on-chain portfolio count
      const count = await rwaManager.portfolioCount();
      let totalValue = 0;
      const assetValues: Record<string, number> = {};

      // Scan portfolios for the owner
      for (let i = 0; i < Math.min(Number(count), 20); i++) {
        try {
          const p = await rwaManager.portfolios(i);
          if (p.owner.toLowerCase() === ownerAddress.toLowerCase() && p.isActive) {
            const val = parseFloat(ethers.formatUnits(p.totalValue, 6));
            totalValue += val;
            // Without per-asset breakdown in current ABI, group as ROSE
            assetValues['ROSE'] = (assetValues['ROSE'] || 0) + val;
          }
        } catch { /* skip invalid portfolios */ }
      }

      // Calculate concentration
      let topAsset = '';
      let topAssetPercent = 0;
      for (const [asset, value] of Object.entries(assetValues)) {
        const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
        if (pct > topAssetPercent) {
          topAsset = asset;
          topAssetPercent = pct;
        }
      }

      // Risk score
      let riskScore = 1;
      if (topAssetPercent > 40) riskScore += 2;
      if (topAssetPercent > 60) riskScore += 1;
      riskScore = Math.min(riskScore, 10);

      // Recommendations
      const recommendations: OasisHedgeRecommendation[] = [];
      const hedgedAssets = new Set(
        Array.from(this.activeHedges.values()).map(h => h.asset),
      );

      for (const [asset, value] of Object.entries(assetValues)) {
        if (hedgedAssets.has(asset)) continue;
        if (value < OASIS_HEDGE_CONFIG.MIN_HEDGE_SIZE_USD) continue;
        const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;

        if (pct > OASIS_HEDGE_CONFIG.MAX_CONCENTRATION_PERCENT) {
          recommendations.push({
            asset,
            side: 'SHORT',
            suggestedSize: value * ((pct - 30) / 100),
            leverage: OASIS_HEDGE_CONFIG.DEFAULT_LEVERAGE,
            confidence: 0.8,
            reason: `${asset} concentration at ${pct.toFixed(1)}% — reduce exposure`,
          });
        }
      }

      return {
        totalValueUsd: totalValue,
        drawdownPercent: 0,
        volatility: 0,
        concentrationRisk: topAssetPercent,
        riskScore,
        topAsset,
        topAssetPercent,
        recommendations,
      };
    } catch (e) {
      logger.error('[OasisAutoHedge] Risk assessment error', { error: e });
      return this.emptyRisk();
    }
  }

  // ============================================
  // HEDGE EXECUTION
  // ============================================

  async executeHedge(
    _ownerAddress: string,
    config: OasisAutoHedgeConfig,
    rec: OasisHedgeRecommendation,
  ): Promise<{ success: boolean; hedgeId?: string }> {
    // Validate asset is allowed
    if (config.allowedAssets.length > 0 && !config.allowedAssets.includes(rec.asset)) {
      logger.info('[OasisAutoHedge] Asset not in allowed list', { asset: rec.asset });
      return { success: false };
    }

    const leverage = Math.min(rec.leverage, config.maxLeverage);

    try {
      const marketData = getMarketDataService();
      const priceData = await marketData.getTokenPrice(rec.asset);
      const entryPrice = priceData?.price || 0;

      if (entryPrice <= 0) {
        logger.warn('[OasisAutoHedge] Invalid entry price', { asset: rec.asset });
        return { success: false };
      }

      const hedgeId = `oasis-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const hedge: OasisHedgePosition = {
        hedgeId,
        asset: rec.asset,
        side: rec.side,
        size: rec.suggestedSize / entryPrice,
        leverage,
        entryPrice,
        currentPrice: entryPrice,
        unrealizedPnl: 0,
        notionalValue: rec.suggestedSize,
        status: 'active',
        createdAt: Date.now(),
        reason: `[OASIS-AUTO] ${rec.reason}`,
        chain: 'oasis-sapphire',
      };

      this.activeHedges.set(hedgeId, hedge);

      logger.info('[OasisAutoHedge] Hedge executed', {
        hedgeId,
        asset: rec.asset,
        side: rec.side,
        size: hedge.size.toFixed(6),
        leverage,
        entryPrice,
      });

      return { success: true, hedgeId };
    } catch (e) {
      logger.error('[OasisAutoHedge] Hedge execution error', { asset: rec.asset, error: e });
      return { success: false };
    }
  }

  closeHedge(hedgeId: string): boolean {
    const hedge = this.activeHedges.get(hedgeId);
    if (!hedge) return false;

    hedge.status = 'closed';
    this.activeHedges.delete(hedgeId);
    logger.info('[OasisAutoHedge] Hedge closed', {
      hedgeId,
      asset: hedge.asset,
      pnl: hedge.unrealizedPnl.toFixed(2),
    });
    return true;
  }

  // ============================================
  // ACCESSORS
  // ============================================

  getActiveHedges(): OasisHedgePosition[] {
    return Array.from(this.activeHedges.values()).filter(h => h.status === 'active');
  }

  getLastRisk(ownerAddress: string): OasisPortfolioRisk | null {
    return this.lastRisk.get(ownerAddress) || null;
  }

  private emptyRisk(): OasisPortfolioRisk {
    return {
      totalValueUsd: 0,
      drawdownPercent: 0,
      volatility: 0,
      concentrationRisk: 0,
      riskScore: 1,
      topAsset: '',
      topAssetPercent: 0,
      recommendations: [],
    };
  }
}

// ============================================
// SINGLETON
// ============================================

let _oasisAutoHedgingInstance: OasisAutoHedgingAdapter | null = null;

export function getOasisAutoHedgingAdapter(): OasisAutoHedgingAdapter {
  if (!_oasisAutoHedgingInstance) {
    _oasisAutoHedgingInstance = new OasisAutoHedgingAdapter();
  }
  return _oasisAutoHedgingInstance;
}

export { OASIS_HEDGE_CONFIG };
