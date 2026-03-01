/**
 * SUI Auto-Hedging Adapter
 * 
 * Extends the AutoHedging system to route SUI-based portfolio hedges
 * via BlueFin instead of Moonlander (Cronos). This adapter:
 * 
 * 1. Monitors SUI portfolio positions (via RWA Manager Move contract)
 * 2. Fetches live SUI token prices for PnL
 * 3. Routes hedge execution to BlueFin DEX for SUI perpetuals
 * 4. Supports SUI-native assets: SUI, DEEP, NAVX, CETUS, etc.
 * 
 * Works alongside the existing AutoHedgingService — the orchestrator
 * detects the chain context and delegates to this adapter for SUI hedges.
 * 
 * @see lib/services/AutoHedgingService.ts  (Cronos equivalent)
 * @see lib/services/BluefinService.ts       (SUI perps execution)
 */

import { logger } from '@/lib/utils/logger';
import { BluefinService, BluefinHedgeResult, BLUEFIN_PAIRS } from './BluefinService';

// ============================================
// CONFIGURATION
// ============================================

const SUI_HEDGE_CONFIG = {
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

// SUI deployed contract addresses
const SUI_CONTRACTS = {
  packageId: '0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a',
  rwaManagerState: '0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97',
  hedgeExecutorState: '0xb6432f1ecc1f55a1f3f3c8c09d110c4bda9ed6536bd9ea4c9cb5e739c41cb41e',
  rpcUrl: 'https://fullnode.testnet.sui.io:443',
};

// ============================================
// TYPES
// ============================================

export interface SuiHedgePosition {
  hedgeId: string;
  asset: string;
  pair: string;         // BlueFin pair symbol (e.g. SUI-PERP)
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
}

export interface SuiPortfolioRisk {
  totalValueUsd: number;
  drawdownPercent: number;
  volatility: number;
  concentrationRisk: number;
  riskScore: number;    // 1-10
  topAsset: string;
  topAssetPercent: number;
  recommendations: SuiHedgeRecommendation[];
}

export interface SuiHedgeRecommendation {
  asset: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  suggestedSize: number;
  leverage: number;
  confidence: number;   // 0-1
  reason: string;
}

export interface SuiAutoHedgeConfig {
  ownerAddress: string;
  enabled: boolean;
  riskThreshold: number;     // 1-10 scale
  maxLeverage: number;
  allowedPairs: string[];    // e.g. ['SUI-PERP', 'BTC-PERP']
}

// ============================================
// SUI AUTO-HEDGING ADAPTER
// ============================================

export class SuiAutoHedgingAdapter {
  private isRunning = false;
  private pnlInterval: NodeJS.Timeout | null = null;
  private riskInterval: NodeJS.Timeout | null = null;
  private configs: Map<string, SuiAutoHedgeConfig> = new Map(); // key: ownerAddress
  private activeHedges: Map<string, SuiHedgePosition> = new Map(); // key: hedgeId
  private lastRisk: Map<string, SuiPortfolioRisk> = new Map();
  private bluefin: BluefinService;

  constructor() {
    this.bluefin = BluefinService.getInstance();
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('[SuiAutoHedge] Starting adapter');

    // Initial PnL sync
    await this.updateAllPnL();

    this.pnlInterval = setInterval(async () => {
      try { await this.updateAllPnL(); }
      catch (e) { logger.error('[SuiAutoHedge] PnL error', { error: e }); }
    }, SUI_HEDGE_CONFIG.PNL_UPDATE_INTERVAL_MS);

    this.riskInterval = setInterval(async () => {
      try { await this.checkAllRisks(); }
      catch (e) { logger.error('[SuiAutoHedge] Risk error', { error: e }); }
    }, SUI_HEDGE_CONFIG.RISK_CHECK_INTERVAL_MS);

    logger.info('[SuiAutoHedge] Adapter started', {
      pnlMs: SUI_HEDGE_CONFIG.PNL_UPDATE_INTERVAL_MS,
      riskMs: SUI_HEDGE_CONFIG.RISK_CHECK_INTERVAL_MS,
    });
  }

  stop(): void {
    if (!this.isRunning) return;
    if (this.pnlInterval) clearInterval(this.pnlInterval);
    if (this.riskInterval) clearInterval(this.riskInterval);
    this.pnlInterval = null;
    this.riskInterval = null;
    this.isRunning = false;
    logger.info('[SuiAutoHedge] Adapter stopped');
  }

  // ============================================
  // CONFIGURATION
  // ============================================

  enableForAddress(config: SuiAutoHedgeConfig): void {
    this.configs.set(config.ownerAddress, config);
    logger.info('[SuiAutoHedge] Enabled', {
      owner: config.ownerAddress.slice(0, 10),
      threshold: config.riskThreshold,
      pairs: config.allowedPairs,
    });
  }

  disableForAddress(ownerAddress: string): void {
    this.configs.delete(ownerAddress);
    logger.info('[SuiAutoHedge] Disabled', { owner: ownerAddress.slice(0, 10) });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      enabledAddresses: Array.from(this.configs.keys()),
      activeHedges: this.activeHedges.size,
      config: SUI_HEDGE_CONFIG,
    };
  }

  // ============================================
  // PNL UPDATES
  // ============================================

  /**
   * Update PnL for all active SUI hedges using BlueFin market data
   */
  private async updateAllPnL(): Promise<void> {
    if (this.activeHedges.size === 0) return;

    const uniquePairs = [...new Set(
      Array.from(this.activeHedges.values()).map(h => h.pair)
    )];

    // Fetch current prices from BlueFin
    const prices: Record<string, number> = {};
    for (const pair of uniquePairs) {
      try {
        const marketData = await this.bluefin.getMarketData(pair);
        if (marketData) prices[pair] = marketData.price;
      } catch {
        logger.warn(`[SuiAutoHedge] Price fetch failed: ${pair}`);
      }
    }

    // Update each hedge
    for (const [id, hedge] of this.activeHedges) {
      const price = prices[hedge.pair];
      if (!price) continue;

      const pnlMultiplier = hedge.side === 'SHORT'
        ? (hedge.entryPrice - price) / hedge.entryPrice
        : (price - hedge.entryPrice) / hedge.entryPrice;

      hedge.currentPrice = price;
      hedge.unrealizedPnl = hedge.notionalValue * pnlMultiplier * hedge.leverage;

      // Check auto-close conditions
      const pnlPercent = pnlMultiplier * 100 * hedge.leverage;
      if (pnlPercent <= -SUI_HEDGE_CONFIG.DEFAULT_STOP_LOSS_PERCENT) {
        logger.warn('[SuiAutoHedge] Stop-loss hit', { hedgeId: id, pnlPercent });
        await this.closeHedge(id);
      } else if (pnlPercent >= SUI_HEDGE_CONFIG.DEFAULT_TAKE_PROFIT_PERCENT) {
        logger.info('[SuiAutoHedge] Take-profit hit', { hedgeId: id, pnlPercent });
        await this.closeHedge(id);
      }
    }
  }

  // ============================================
  // RISK ASSESSMENT
  // ============================================

  /**
   * Check risks for all enabled SUI addresses
   */
  private async checkAllRisks(): Promise<void> {
    for (const [address, config] of this.configs) {
      if (!config.enabled) continue;

      try {
        const risk = await this.assessRisk(address);
        this.lastRisk.set(address, risk);

        if (risk.riskScore >= config.riskThreshold) {
          logger.info('[SuiAutoHedge] Risk threshold exceeded', {
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
        logger.error('[SuiAutoHedge] Risk check failed', { address: address.slice(0, 10), error: e });
      }
    }
  }

  /**
   * Assess portfolio risk for a SUI address by reading on-chain state
   */
  async assessRisk(ownerAddress: string): Promise<SuiPortfolioRisk> {
    try {
      // Fetch owned portfolio objects from SUI RPC
      const portfolios = await this.fetchSuiPortfolios(ownerAddress);

      let totalValue = 0;
      const assetValues: Record<string, number> = {};

      for (const p of portfolios) {
        totalValue += p.totalValue;
        for (const [asset, value] of Object.entries(p.assetValues)) {
          assetValues[asset] = (assetValues[asset] || 0) + value;
        }
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

      // Calculate risk score (1-10)
      let riskScore = 1;
      if (topAssetPercent > 40) riskScore += 2;
      if (topAssetPercent > 60) riskScore += 1;
      // Drawdown would require historical price comparison; approximate
      const drawdown = 0; // Placeholder
      if (drawdown > 3) riskScore += 2;
      if (drawdown > 7) riskScore += 2;
      riskScore = Math.min(riskScore, 10);

      // Generate recommendations
      const recommendations: SuiHedgeRecommendation[] = [];
      const hedgedAssets = new Set(
        Array.from(this.activeHedges.values()).map(h => h.asset)
      );

      for (const [asset, value] of Object.entries(assetValues)) {
        if (hedgedAssets.has(asset)) continue;
        if (value < SUI_HEDGE_CONFIG.MIN_HEDGE_SIZE_USD) continue;

        const pct = (value / totalValue) * 100;
        const pair = BluefinService.assetToPair(asset);
        if (!pair) continue;

        if (pct > SUI_HEDGE_CONFIG.MAX_CONCENTRATION_PERCENT) {
          recommendations.push({
            asset,
            pair,
            side: 'SHORT',
            suggestedSize: value * ((pct - 30) / 100),
            leverage: SUI_HEDGE_CONFIG.DEFAULT_LEVERAGE,
            confidence: 0.8,
            reason: `${asset} concentration at ${pct.toFixed(1)}% — reduce exposure`,
          });
        }
      }

      return {
        totalValueUsd: totalValue,
        drawdownPercent: drawdown,
        volatility: 0,
        concentrationRisk: topAssetPercent,
        riskScore,
        topAsset,
        topAssetPercent,
        recommendations,
      };
    } catch (e) {
      logger.error('[SuiAutoHedge] Risk assessment error', { error: e });
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
  // HEDGE EXECUTION (via BlueFin)
  // ============================================

  /**
   * Execute an auto-hedge recommendation on BlueFin
   */
  async executeHedge(
    ownerAddress: string,
    config: SuiAutoHedgeConfig,
    rec: SuiHedgeRecommendation,
  ): Promise<BluefinHedgeResult | null> {
    // Validate pair is allowed
    if (config.allowedPairs.length > 0 && !config.allowedPairs.includes(rec.pair)) {
      logger.info('[SuiAutoHedge] Pair not in allowed list', { pair: rec.pair });
      return null;
    }

    const leverage = Math.min(rec.leverage, config.maxLeverage);

    // Validate pair exists on BlueFin
    const pairConfig = Object.values(BLUEFIN_PAIRS).find(p => p.symbol === rec.pair);
    if (!pairConfig) {
      logger.warn('[SuiAutoHedge] Pair not available on BlueFin', { pair: rec.pair });
      return null;
    }

    const effectiveLeverage = Math.min(leverage, pairConfig.maxLeverage);

    try {
      // Get current market price for entry
      const marketData = await this.bluefin.getMarketData(rec.pair);
      const entryPrice = marketData?.price || 0;

      if (entryPrice <= 0) {
        logger.warn('[SuiAutoHedge] Invalid entry price', { pair: rec.pair });
        return null;
      }

      // Calculate size in base units
      const sizeInBase = rec.suggestedSize / entryPrice;

      // Execute via BlueFin
      const result = await this.bluefin.openHedge({
        symbol: rec.pair,
        side: rec.side,
        size: sizeInBase,
        leverage: effectiveLeverage,
        reason: `[SUI-AUTO] ${rec.reason}`,
      });

      if (result.success) {
        // Track in local state
        const hedge: SuiHedgePosition = {
          hedgeId: result.hedgeId,
          asset: rec.asset,
          pair: rec.pair,
          side: rec.side,
          size: sizeInBase,
          leverage: effectiveLeverage,
          entryPrice: result.executionPrice || entryPrice,
          currentPrice: result.executionPrice || entryPrice,
          unrealizedPnl: 0,
          notionalValue: rec.suggestedSize,
          status: 'active',
          createdAt: Date.now(),
          reason: rec.reason,
        };

        this.activeHedges.set(result.hedgeId, hedge);

        logger.info('[SuiAutoHedge] Hedge executed', {
          hedgeId: result.hedgeId,
          pair: rec.pair,
          side: rec.side,
          size: sizeInBase.toFixed(6),
          leverage: effectiveLeverage,
          entryPrice: result.executionPrice,
        });
      }

      return result;
    } catch (e) {
      logger.error('[SuiAutoHedge] Hedge execution error', { pair: rec.pair, error: e });
      return null;
    }
  }

  /**
   * Close an active SUI hedge
   */
  async closeHedge(hedgeId: string): Promise<BluefinHedgeResult | null> {
    const hedge = this.activeHedges.get(hedgeId);
    if (!hedge) {
      logger.warn('[SuiAutoHedge] Hedge not found', { hedgeId });
      return null;
    }

    try {
      const result = await this.bluefin.closeHedge({ symbol: hedge.pair, size: hedge.size });

      if (result.success) {
        hedge.status = 'closed';
        this.activeHedges.delete(hedgeId);
        logger.info('[SuiAutoHedge] Hedge closed', {
          hedgeId,
          pair: hedge.pair,
          pnl: hedge.unrealizedPnl.toFixed(2),
        });
      }

      return result;
    } catch (e) {
      logger.error('[SuiAutoHedge] Close error', { hedgeId, error: e });
      return null;
    }
  }

  // ============================================
  // SUI RPC HELPERS
  // ============================================

  /**
   * Fetch portfolio objects owned by an address from SUI RPC
   */
  private async fetchSuiPortfolios(ownerAddress: string): Promise<Array<{
    objectId: string;
    totalValue: number;
    assetValues: Record<string, number>;
  }>> {
    try {
      const response = await fetch(SUI_CONTRACTS.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getOwnedObjects',
          params: [
            ownerAddress,
            {
              filter: {
                StructType: `${SUI_CONTRACTS.packageId}::rwa_manager::Portfolio`,
              },
              options: { showContent: true },
            },
          ],
        }),
      });

      const data = await response.json();
      const objects = data.result?.data || [];

      return objects.map((obj: Record<string, unknown>) => {
        const objData = obj as { data?: { objectId?: string; content?: { fields?: Record<string, unknown> } } };
        const fields = objData.data?.content?.fields || {};
        const totalValue = Number(fields.total_value || '0') / 1e9 * 2.5; // MIST → USD approx

        // Parse asset allocations if available
        const assetValues: Record<string, number> = {};
        const allocations = fields.allocations;
        if (Array.isArray(allocations)) {
          for (const alloc of allocations) {
            const a = alloc as Record<string, unknown>;
            const assetType = String(a.asset_type || 'SUI');
            const amount = Number(a.amount || '0') / 1e9 * 2.5;
            assetValues[assetType] = amount;
          }
        } else {
          assetValues['SUI'] = totalValue;
        }

        return {
          objectId: objData.data?.objectId || '',
          totalValue,
          assetValues,
        };
      });
    } catch (e) {
      logger.error('[SuiAutoHedge] Failed to fetch portfolios', { error: e });
      return [];
    }
  }

  /**
   * Get active hedges
   */
  getActiveHedges(): SuiHedgePosition[] {
    return Array.from(this.activeHedges.values()).filter(h => h.status === 'active');
  }

  /**
   * Get last risk assessment for an address
   */
  getLastRisk(ownerAddress: string): SuiPortfolioRisk | null {
    return this.lastRisk.get(ownerAddress) || null;
  }
}

// ============================================
// SINGLETON
// ============================================

let suiAutoHedgingInstance: SuiAutoHedgingAdapter | null = null;

export function getSuiAutoHedgingAdapter(): SuiAutoHedgingAdapter {
  if (!suiAutoHedgingInstance) {
    suiAutoHedgingInstance = new SuiAutoHedgingAdapter();
  }
  return suiAutoHedgingInstance;
}

export { SUI_HEDGE_CONFIG };
