/**
 * Real-time Hedge PnL Tracker
 * Uses Crypto.com market data to calculate actual profit/loss on hedge positions
 */

import { getActiveHedges, updateHedgePnL, type Hedge } from '@/lib/db/hedges';
import { cryptocomExchangeService } from './CryptocomExchangeService';
import { logger } from '@/lib/utils/logger';

export interface HedgePnLUpdate {
  orderId: string;
  asset: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  unrealizedPnL: number;
  pnlPercentage: number;
  liquidationPrice: number | null;
  isNearLiquidation: boolean;
}

export class HedgePnLTracker {
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly UPDATE_FREQUENCY_MS = 10000; // Update every 10 seconds

  /**
   * Calculate unrealized PnL for a hedge position
   */
  calculatePnL(hedge: Hedge, currentPrice: number): HedgePnLUpdate {
    const entryPrice = Number(hedge.entry_price) || 0;
    const size = Number(hedge.size);
    const leverage = Number(hedge.leverage);
    const notionalValue = Number(hedge.notional_value);

    // Calculate PnL based on position side
    let pnlMultiplier: number;
    if (hedge.side === 'SHORT') {
      // SHORT: Profit when price goes down
      pnlMultiplier = (entryPrice - currentPrice) / entryPrice;
    } else {
      // LONG: Profit when price goes up
      pnlMultiplier = (currentPrice - entryPrice) / entryPrice;
    }

    // Apply leverage to PnL
    const unrealizedPnL = notionalValue * pnlMultiplier * leverage;
    const pnlPercentage = pnlMultiplier * leverage * 100;

    // Check if near liquidation (within 10% of liquidation price)
    const isNearLiquidation = hedge.liquidation_price 
      ? Math.abs(currentPrice - Number(hedge.liquidation_price)) / Number(hedge.liquidation_price) < 0.1
      : false;

    return {
      orderId: hedge.order_id,
      asset: hedge.asset,
      side: hedge.side,
      entryPrice,
      currentPrice,
      size,
      leverage,
      unrealizedPnL,
      pnlPercentage,
      liquidationPrice: hedge.liquidation_price ? Number(hedge.liquidation_price) : null,
      isNearLiquidation,
    };
  }

  /**
   * Update PnL for all active hedges
   */
  async updateAllHedges(): Promise<HedgePnLUpdate[]> {
    try {
      // Get all active hedges
      const activeHedges = await getActiveHedges();
      
      if (activeHedges.length === 0) {
        return [];
      }

      logger.info(`📊 Updating PnL for ${activeHedges.length} active hedges`);

      // Get unique assets to minimize API calls
      const uniqueAssets = [...new Set(activeHedges.map(h => h.asset))];
      
      // Batch fetch all prices
      const pricePromises = uniqueAssets.map(async asset => {
        try {
          // Strip -PERP suffix for Crypto.com API
          const baseAsset = asset.replace('-PERP', '').replace('-USD-PERP', '');
          const price = await cryptocomExchangeService.getPrice(baseAsset);
          return { asset, price };
        } catch (err) {
          logger.error(`Failed to get price for ${asset}`, { error: err });
          return { asset, price: null };
        }
      });

      const priceResults = await Promise.all(pricePromises);
      const priceMap = new Map(
        priceResults
          .filter(r => r.price !== null)
          .map(r => [r.asset, r.price as number])
      );

      // Calculate PnL for each hedge
      const updates: HedgePnLUpdate[] = [];

      for (const hedge of activeHedges) {
        const currentPrice = priceMap.get(hedge.asset);
        
        if (!currentPrice) {
          logger.warn(`No price available for ${hedge.asset}, skipping PnL update`);
          continue;
        }

        const pnlUpdate = this.calculatePnL(hedge, currentPrice);
        updates.push(pnlUpdate);

        // Update in database
        try {
          await updateHedgePnL(hedge.order_id, pnlUpdate.unrealizedPnL);
          
          // Log significant PnL changes
          if (Math.abs(pnlUpdate.pnlPercentage) > 10) {
            logger.info(`💰 Significant PnL on ${hedge.order_id}`, {
              asset: hedge.asset,
              pnl: pnlUpdate.unrealizedPnL.toFixed(2),
              percentage: pnlUpdate.pnlPercentage.toFixed(2) + '%',
            });
          }

          // Alert if near liquidation
          if (pnlUpdate.isNearLiquidation) {
            logger.warn(`⚠️ Hedge near liquidation: ${hedge.order_id}`, {
              asset: hedge.asset,
              currentPrice,
              liquidationPrice: hedge.liquidation_price,
            });
          }
        } catch (dbErr) {
          logger.error(`Failed to update PnL in database for ${hedge.order_id}`, { error: dbErr });
        }
      }

      return updates;

    } catch (error) {
      logger.error('Failed to update hedge PnL', { error });
      return [];
    }
  }

  /**
   * Start automatic PnL tracking (updates every 10 seconds)
   */
  startTracking(): void {
    if (this.isRunning) {
      logger.warn('PnL tracker already running');
      return;
    }

    this.isRunning = true;
    logger.info(`🔄 Starting hedge PnL tracker (updates every ${this.UPDATE_FREQUENCY_MS / 1000}s)`);

    // Initial update
    this.updateAllHedges().catch(err => 
      logger.error('Initial PnL update failed', { error: err })
    );

    // Schedule periodic updates
    this.updateInterval = setInterval(() => {
      this.updateAllHedges().catch(err =>
        logger.error('Scheduled PnL update failed', { error: err })
      );
    }, this.UPDATE_FREQUENCY_MS);
  }

  /**
   * Stop automatic PnL tracking
   */
  stopTracking(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      this.isRunning = false;
      logger.info('⏸️ Stopped hedge PnL tracker');
    }
  }

  /**
   * Check if tracker is running
   */
  isTrackingActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get real-time PnL for a specific hedge without updating database
   */
  async getHedgePnL(hedge: Hedge): Promise<HedgePnLUpdate> {
    // Strip -PERP suffix for Crypto.com API
    const baseAsset = hedge.asset.replace('-PERP', '').replace('-USD-PERP', '');
    const currentPrice = await cryptocomExchangeService.getPrice(baseAsset);
    return this.calculatePnL(hedge, currentPrice);
  }

  /**
   * Get portfolio-level PnL summary
   */
  async getPortfolioPnLSummary(portfolioId?: number) {
    const hedges = await getActiveHedges(portfolioId);
    
    if (hedges.length === 0) {
      return {
        totalHedges: 0,
        totalNotional: 0,
        totalUnrealizedPnL: 0,
        avgPnLPercentage: 0,
        profitable: 0,
        unprofitable: 0,
      };
    }

    const updates = await Promise.all(
      hedges.map(async hedge => {
        try {
          return await this.getHedgePnL(hedge);
        } catch (err) {
          logger.error(`Failed to get PnL for ${hedge.order_id}`, { error: err });
          return null;
        }
      })
    );

    const validUpdates = updates.filter((u): u is HedgePnLUpdate => u !== null);

    const totalUnrealizedPnL = validUpdates.reduce((sum, u) => sum + u.unrealizedPnL, 0);
    const totalNotional = hedges.reduce((sum, h) => sum + Number(h.notional_value), 0);
    const avgPnLPercentage = validUpdates.length > 0 
      ? validUpdates.reduce((sum, u) => sum + u.pnlPercentage, 0) / validUpdates.length 
      : 0;
    const profitable = validUpdates.filter(u => u.unrealizedPnL > 0).length;
    const unprofitable = validUpdates.filter(u => u.unrealizedPnL < 0).length;

    return {
      totalHedges: hedges.length,
      totalNotional,
      totalUnrealizedPnL,
      avgPnLPercentage,
      profitable,
      unprofitable,
      details: validUpdates,
    };
  }
}

// Singleton instance
export const hedgePnLTracker = new HedgePnLTracker();
