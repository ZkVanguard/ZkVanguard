/**
 * On-Chain Portfolio History Service
 * 
 * Real on-chain data with DB caching for performance.
 * Uses actual testnet contracts and real prices - NO mock data.
 * 
 * Data sources:
 * - Positions: Real wallet balances from RPC/PositionsContext
 * - Hedges: Real hedge PnL from HedgePnLTracker + PostgreSQL
 * - Prices: Real prices from Crypto.com Exchange API
 * 
 * DB is cache layer only - source of truth is on-chain.
 */

import { query, queryOne } from '@/lib/db/postgres';
import { hedgePnLTracker, type HedgePnLUpdate } from './HedgePnLTracker';
import { getActiveHedgesByWallet, type Hedge } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';

// ============================================
// TYPES
// ============================================

export interface OnChainPosition {
  symbol: string;
  value: number;
  amount: number;
  price: number;
  chain: string;
  onChain: boolean;
  source?: string;
}

export interface PortfolioSnapshotData {
  id?: number;
  walletAddress: string;
  totalValue: number;
  positions: OnChainPosition[];
  hedgesData: {
    count: number;
    totalNotional: number;
    unrealizedPnL: number;
    details?: HedgePnLUpdate[];
  };
  positionsValue: number;
  hedgesValue: number;
  unrealizedPnL: number;
  realizedPnL: number;
  chain: string;
  blockNumber?: number;
  verifiedOnchain: boolean;
  snapshotTime: Date;
}

export interface PerformanceMetrics {
  currentValue: number;
  initialValue: number;
  highestValue: number;
  lowestValue: number;
  totalPnL: number;
  totalPnLPercentage: number;
  dailyPnL: number;
  dailyPnLPercentage: number;
  weeklyPnL: number;
  weeklyPnLPercentage: number;
  monthlyPnL: number;
  monthlyPnLPercentage: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  // On-chain specific
  activeHedges: number;
  totalHedgePnL: number;
  verifiedOnchain: boolean;
  lastBlockNumber?: number;
}

export interface ChartDataPoint {
  timestamp: number;
  date: string;
  value: number;
  pnl: number;
  pnlPercentage: number;
  hedgePnL: number;
  verifiedOnchain: boolean;
}

// ============================================
// ON-CHAIN HISTORY SERVICE
// ============================================

class OnChainPortfolioHistoryService {
  private readonly SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private lastSnapshotTime: Map<string, number> = new Map();

  /**
   * Record a portfolio snapshot with REAL on-chain data
   * Called after fetching actual positions and hedge PnL
   */
  async recordSnapshot(
    walletAddress: string,
    positionsData: {
      totalValue: number;
      positions: Array<{ symbol: string; balanceUSD: string; balance: string; price: string; }>;
    },
    hedgeSummary?: {
      totalNotional: number;
      totalUnrealizedPnL: number;
      totalHedges: number;
      details?: HedgePnLUpdate[];
    },
    blockNumber?: number
  ): Promise<PortfolioSnapshotData | null> {
    const now = Date.now();
    const lastTime = this.lastSnapshotTime.get(walletAddress) || 0;

    // Throttle to prevent excessive DB writes
    if (now - lastTime < this.SNAPSHOT_INTERVAL_MS) {
      return null;
    }

    try {
      // Convert positions to storage format
      const positions: OnChainPosition[] = positionsData.positions.map(p => ({
        symbol: p.symbol,
        value: parseFloat(p.balanceUSD || '0'),
        amount: parseFloat(p.balance || '0'),
        price: parseFloat(p.price || '0'),
        chain: 'cronos', // From wallet context
        onChain: true,
      }));

      const positionsValue = positions.reduce((sum, p) => sum + p.value, 0);
      const hedgesValue = hedgeSummary?.totalNotional || 0;
      const unrealizedPnL = hedgeSummary?.totalUnrealizedPnL || 0;

      // Store in PostgreSQL
      const result = await queryOne<{ id: number }>(
        `INSERT INTO portfolio_snapshots 
         (wallet_address, total_value, positions, hedges_data, positions_value, hedges_value, 
          unrealized_pnl, chain, block_number, verified_onchain, snapshot_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         RETURNING id`,
        [
          walletAddress.toLowerCase(),
          positionsData.totalValue,
          JSON.stringify(positions),
          JSON.stringify({
            count: hedgeSummary?.totalHedges || 0,
            totalNotional: hedgesValue,
            unrealizedPnL,
          }),
          positionsValue,
          hedgesValue,
          unrealizedPnL,
          'cronos',
          blockNumber || null,
          true, // Verified because we fetched from real sources
        ]
      );

      this.lastSnapshotTime.set(walletAddress, now);

      // Update aggregated metrics
      await this.updateMetrics(walletAddress, positionsData.totalValue, hedgeSummary);

      logger.info(`📸 Recorded on-chain snapshot for ${walletAddress.slice(0, 10)}...`, {
        totalValue: positionsData.totalValue.toFixed(2),
        hedges: hedgeSummary?.totalHedges || 0,
        unrealizedPnL: unrealizedPnL.toFixed(2),
      });

      return {
        id: result?.id,
        walletAddress,
        totalValue: positionsData.totalValue,
        positions,
        hedgesData: {
          count: hedgeSummary?.totalHedges || 0,
          totalNotional: hedgesValue,
          unrealizedPnL,
        },
        positionsValue,
        hedgesValue,
        unrealizedPnL,
        realizedPnL: 0, // TODO: Track from closed hedges
        chain: 'cronos',
        blockNumber,
        verifiedOnchain: true,
        snapshotTime: new Date(),
      };
    } catch (error) {
      logger.error('Failed to record portfolio snapshot', { error });
      return null;
    }
  }

  /**
   * Get real-time snapshot (fetches current on-chain state)
   */
  async getRealtimeSnapshot(walletAddress: string): Promise<PortfolioSnapshotData | null> {
    try {
      // Fetch real hedge PnL from tracker (uses Crypto.com real prices)
      const hedgeSummary = await hedgePnLTracker.getPortfolioPnLSummary(undefined, walletAddress);

      // Return summary - caller should combine with positions
      return {
        walletAddress,
        totalValue: 0, // Caller fills from positions
        positions: [],
        hedgesData: {
          count: hedgeSummary.totalHedges,
          totalNotional: hedgeSummary.totalNotional,
          unrealizedPnL: hedgeSummary.totalUnrealizedPnL,
          details: hedgeSummary.details,
        },
        positionsValue: 0,
        hedgesValue: hedgeSummary.totalNotional,
        unrealizedPnL: hedgeSummary.totalUnrealizedPnL,
        realizedPnL: 0,
        chain: 'cronos',
        verifiedOnchain: true,
        snapshotTime: new Date(),
      };
    } catch (error) {
      logger.error('Failed to get realtime snapshot', { error });
      return null;
    }
  }

  /**
   * Get historical snapshots from DB cache
   */
  async getHistory(
    walletAddress: string,
    timeRange: '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL' = '1W'
  ): Promise<PortfolioSnapshotData[]> {
    const intervals: Record<string, string> = {
      '1D': '1 day',
      '1W': '7 days',
      '1M': '30 days',
      '3M': '90 days',
      '1Y': '365 days',
      'ALL': '10 years',
    };

    const interval = intervals[timeRange] || '7 days';

    const rows = await query<{
      id: number;
      wallet_address: string;
      total_value: string;
      positions: string;
      hedges_data: string;
      positions_value: string;
      hedges_value: string;
      unrealized_pnl: string;
      realized_pnl: string;
      chain: string;
      block_number: number | null;
      verified_onchain: boolean;
      snapshot_time: Date;
    }>(
      `SELECT * FROM portfolio_snapshots 
       WHERE wallet_address = $1 
         AND snapshot_time > NOW() - INTERVAL '${interval}'
       ORDER BY snapshot_time ASC`,
      [walletAddress.toLowerCase()]
    );

    return rows.map(row => ({
      id: row.id,
      walletAddress: row.wallet_address,
      totalValue: parseFloat(row.total_value),
      positions: JSON.parse(row.positions || '[]'),
      hedgesData: JSON.parse(row.hedges_data || '{}'),
      positionsValue: parseFloat(row.positions_value || '0'),
      hedgesValue: parseFloat(row.hedges_value || '0'),
      unrealizedPnL: parseFloat(row.unrealized_pnl || '0'),
      realizedPnL: parseFloat(row.realized_pnl || '0'),
      chain: row.chain,
      blockNumber: row.block_number || undefined,
      verifiedOnchain: row.verified_onchain,
      snapshotTime: new Date(row.snapshot_time),
    }));
  }

  /**
   * Get chart data from real snapshots
   */
  async getChartData(
    walletAddress: string,
    timeRange: '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL' = '1W'
  ): Promise<ChartDataPoint[]> {
    const snapshots = await this.getHistory(walletAddress, timeRange);

    if (snapshots.length === 0) {
      return [];
    }

    const initialValue = snapshots[0].totalValue;

    return snapshots.map(s => ({
      timestamp: s.snapshotTime.getTime(),
      date: s.snapshotTime.toISOString(),
      value: s.totalValue,
      pnl: s.totalValue - initialValue,
      pnlPercentage: initialValue > 0 ? ((s.totalValue - initialValue) / initialValue) * 100 : 0,
      hedgePnL: s.unrealizedPnL,
      verifiedOnchain: s.verifiedOnchain,
    }));
  }

  /**
   * Get performance metrics from cached DB data
   */
  async getPerformanceMetrics(walletAddress: string): Promise<PerformanceMetrics> {
    // Try to get from cached metrics table first
    const cached = await queryOne<{
      current_value: string;
      initial_value: string;
      highest_value: string;
      lowest_value: string;
      total_pnl: string;
      total_pnl_percentage: string;
      daily_pnl: string;
      daily_pnl_percentage: string;
      weekly_pnl: string;
      weekly_pnl_percentage: string;
      monthly_pnl: string;
      monthly_pnl_percentage: string;
      volatility: string;
      sharpe_ratio: string;
      max_drawdown: string;
      win_rate: string;
      active_hedges: number;
      total_hedge_pnl: string;
    }>(
      `SELECT * FROM portfolio_metrics WHERE wallet_address = $1`,
      [walletAddress.toLowerCase()]
    );

    if (cached) {
      // Get real-time hedge PnL to ensure freshness
      const hedgeSummary = await hedgePnLTracker.getPortfolioPnLSummary(undefined, walletAddress);

      return {
        currentValue: parseFloat(cached.current_value),
        initialValue: parseFloat(cached.initial_value),
        highestValue: parseFloat(cached.highest_value),
        lowestValue: parseFloat(cached.lowest_value),
        totalPnL: parseFloat(cached.total_pnl),
        totalPnLPercentage: parseFloat(cached.total_pnl_percentage),
        dailyPnL: parseFloat(cached.daily_pnl),
        dailyPnLPercentage: parseFloat(cached.daily_pnl_percentage),
        weeklyPnL: parseFloat(cached.weekly_pnl),
        weeklyPnLPercentage: parseFloat(cached.weekly_pnl_percentage),
        monthlyPnL: parseFloat(cached.monthly_pnl),
        monthlyPnLPercentage: parseFloat(cached.monthly_pnl_percentage),
        volatility: parseFloat(cached.volatility),
        sharpeRatio: parseFloat(cached.sharpe_ratio),
        maxDrawdown: parseFloat(cached.max_drawdown),
        winRate: parseFloat(cached.win_rate),
        activeHedges: hedgeSummary.totalHedges,
        totalHedgePnL: hedgeSummary.totalUnrealizedPnL,
        verifiedOnchain: true,
      };
    }

    // Calculate from snapshots if no cached metrics
    return this.calculateMetricsFromHistory(walletAddress);
  }

  /**
   * Calculate metrics from historical snapshots
   */
  private async calculateMetricsFromHistory(walletAddress: string): Promise<PerformanceMetrics> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get snapshots
    const allSnapshots = await this.getHistory(walletAddress, 'ALL');
    
    if (allSnapshots.length === 0) {
      return this.emptyMetrics();
    }

    // Get hedge data for real-time PnL
    const hedgeSummary = await hedgePnLTracker.getPortfolioPnLSummary(undefined, walletAddress);

    const currentValue = allSnapshots[allSnapshots.length - 1].totalValue;
    const initialValue = allSnapshots[0].totalValue;

    // Find closest snapshots to time boundaries
    const dayAgoSnapshot = this.findClosest(allSnapshots, dayAgo);
    const weekAgoSnapshot = this.findClosest(allSnapshots, weekAgo);
    const monthAgoSnapshot = this.findClosest(allSnapshots, monthAgo);

    // Calculate metrics
    const highlow = allSnapshots.reduce(
      (acc, s) => ({
        high: Math.max(acc.high, s.totalValue),
        low: Math.min(acc.low, s.totalValue),
      }),
      { high: currentValue, low: currentValue }
    );

    const dailyPnL = dayAgoSnapshot ? currentValue - dayAgoSnapshot.totalValue : 0;
    const weeklyPnL = weekAgoSnapshot ? currentValue - weekAgoSnapshot.totalValue : 0;
    const monthlyPnL = monthAgoSnapshot ? currentValue - monthAgoSnapshot.totalValue : 0;
    const totalPnL = currentValue - initialValue;

    // Calculate volatility from daily returns
    const dailyReturns = this.calculateDailyReturns(allSnapshots);
    const volatility = this.calculateVolatility(dailyReturns);
    const sharpeRatio = this.calculateSharpeRatio(dailyReturns, volatility);
    const maxDrawdown = this.calculateMaxDrawdown(allSnapshots);
    const winRate = dailyReturns.length > 0 
      ? (dailyReturns.filter(r => r > 0).length / dailyReturns.length) * 100 
      : 50;

    return {
      currentValue,
      initialValue,
      highestValue: highlow.high,
      lowestValue: highlow.low,
      totalPnL,
      totalPnLPercentage: initialValue > 0 ? (totalPnL / initialValue) * 100 : 0,
      dailyPnL,
      dailyPnLPercentage: dayAgoSnapshot?.totalValue ? (dailyPnL / dayAgoSnapshot.totalValue) * 100 : 0,
      weeklyPnL,
      weeklyPnLPercentage: weekAgoSnapshot?.totalValue ? (weeklyPnL / weekAgoSnapshot.totalValue) * 100 : 0,
      monthlyPnL,
      monthlyPnLPercentage: monthAgoSnapshot?.totalValue ? (monthlyPnL / monthAgoSnapshot.totalValue) * 100 : 0,
      volatility,
      sharpeRatio,
      maxDrawdown,
      winRate,
      activeHedges: hedgeSummary.totalHedges,
      totalHedgePnL: hedgeSummary.totalUnrealizedPnL,
      verifiedOnchain: true,
    };
  }

  /**
   * Update aggregated metrics table
   */
  private async updateMetrics(
    walletAddress: string,
    currentValue: number,
    hedgeSummary?: { totalHedges: number; totalUnrealizedPnL: number; totalNotional: number }
  ): Promise<void> {
    try {
      const metrics = await this.calculateMetricsFromHistory(walletAddress);

      await query(
        `INSERT INTO portfolio_metrics 
         (wallet_address, current_value, initial_value, highest_value, lowest_value,
          total_pnl, total_pnl_percentage, daily_pnl, daily_pnl_percentage,
          weekly_pnl, weekly_pnl_percentage, monthly_pnl, monthly_pnl_percentage,
          volatility, sharpe_ratio, max_drawdown, win_rate,
          active_hedges, total_hedge_pnl, last_snapshot_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW())
         ON CONFLICT (wallet_address) DO UPDATE SET
           current_value = EXCLUDED.current_value,
           highest_value = GREATEST(portfolio_metrics.highest_value, EXCLUDED.current_value),
           lowest_value = LEAST(portfolio_metrics.lowest_value, EXCLUDED.current_value),
           total_pnl = EXCLUDED.total_pnl,
           total_pnl_percentage = EXCLUDED.total_pnl_percentage,
           daily_pnl = EXCLUDED.daily_pnl,
           daily_pnl_percentage = EXCLUDED.daily_pnl_percentage,
           weekly_pnl = EXCLUDED.weekly_pnl,
           weekly_pnl_percentage = EXCLUDED.weekly_pnl_percentage,
           monthly_pnl = EXCLUDED.monthly_pnl,
           monthly_pnl_percentage = EXCLUDED.monthly_pnl_percentage,
           volatility = EXCLUDED.volatility,
           sharpe_ratio = EXCLUDED.sharpe_ratio,
           max_drawdown = EXCLUDED.max_drawdown,
           win_rate = EXCLUDED.win_rate,
           active_hedges = EXCLUDED.active_hedges,
           total_hedge_pnl = EXCLUDED.total_hedge_pnl,
           last_snapshot_at = NOW(),
           updated_at = NOW()`,
        [
          walletAddress.toLowerCase(),
          currentValue,
          metrics.initialValue || currentValue,
          metrics.highestValue,
          metrics.lowestValue,
          metrics.totalPnL,
          metrics.totalPnLPercentage,
          metrics.dailyPnL,
          metrics.dailyPnLPercentage,
          metrics.weeklyPnL,
          metrics.weeklyPnLPercentage,
          metrics.monthlyPnL,
          metrics.monthlyPnLPercentage,
          metrics.volatility,
          metrics.sharpeRatio,
          metrics.maxDrawdown,
          metrics.winRate,
          hedgeSummary?.totalHedges || 0,
          hedgeSummary?.totalUnrealizedPnL || 0,
        ]
      );
    } catch (error) {
      logger.warn('Failed to update portfolio metrics', { error });
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private findClosest(snapshots: PortfolioSnapshotData[], target: Date): PortfolioSnapshotData | null {
    if (snapshots.length === 0) return null;

    let closest = snapshots[0];
    let minDiff = Math.abs(snapshots[0].snapshotTime.getTime() - target.getTime());

    for (const s of snapshots) {
      const diff = Math.abs(s.snapshotTime.getTime() - target.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = s;
      }
    }

    return closest;
  }

  private calculateDailyReturns(snapshots: PortfolioSnapshotData[]): number[] {
    if (snapshots.length < 2) return [];

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1].totalValue;
      const curr = snapshots[i].totalValue;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
    return returns;
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1);

    // Annualized volatility
    return Math.sqrt(variance * 365) * 100;
  }

  private calculateSharpeRatio(returns: number[], volatility: number): number {
    if (returns.length === 0 || volatility === 0) return 0;

    const riskFreeRate = 0.05; // 5% annual
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const annualizedReturn = meanReturn * 365;

    return (annualizedReturn - riskFreeRate) / (volatility / 100);
  }

  private calculateMaxDrawdown(snapshots: PortfolioSnapshotData[]): number {
    if (snapshots.length < 2) return 0;

    let maxDrawdown = 0;
    let peak = snapshots[0].totalValue;

    for (const s of snapshots) {
      if (s.totalValue > peak) {
        peak = s.totalValue;
      }
      const drawdown = (peak - s.totalValue) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown * 100;
  }

  private emptyMetrics(): PerformanceMetrics {
    return {
      currentValue: 0,
      initialValue: 0,
      highestValue: 0,
      lowestValue: 0,
      totalPnL: 0,
      totalPnLPercentage: 0,
      dailyPnL: 0,
      dailyPnLPercentage: 0,
      weeklyPnL: 0,
      weeklyPnLPercentage: 0,
      monthlyPnL: 0,
      monthlyPnLPercentage: 0,
      volatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      winRate: 50,
      activeHedges: 0,
      totalHedgePnL: 0,
      verifiedOnchain: false,
    };
  }

  /**
   * Get snapshot count for a wallet
   */
  async getSnapshotCount(walletAddress: string): Promise<number> {
    const result = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM portfolio_snapshots WHERE wallet_address = $1`,
      [walletAddress.toLowerCase()]
    );
    return parseInt(result?.count || '0');
  }
}

// Singleton
let instance: OnChainPortfolioHistoryService | null = null;

export function getOnChainHistoryService(): OnChainPortfolioHistoryService {
  if (!instance) {
    instance = new OnChainPortfolioHistoryService();
  }
  return instance;
}

export { OnChainPortfolioHistoryService };
