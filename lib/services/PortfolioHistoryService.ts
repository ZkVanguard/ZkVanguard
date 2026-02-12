/**
 * Portfolio History Service
 * 
 * Tracks portfolio value snapshots over time for:
 * - Performance charts
 * - PnL calculations
 * - Historical analysis
 * 
 * Uses in-memory storage with periodic persistence to localStorage (client)
 * or file system (server). Designed to work in both environments.
 */

import { logger } from '@/lib/utils/logger';

export interface PortfolioSnapshot {
  timestamp: number;
  totalValue: number;
  positions: Array<{
    symbol: string;
    value: number;
    amount: number;
    price: number;
  }>;
  pnl?: {
    absolute: number;      // Total PnL since inception
    percentage: number;    // Total PnL %
    daily: number;         // 24h PnL
    dailyPercentage: number;
    weekly: number;        // 7d PnL
    weeklyPercentage: number;
  };
  metadata?: {
    hedgesActive: number;
    rebalancesCount: number;
    avgYield: number;
  };
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
  volatility: number;      // Standard deviation of daily returns
  sharpeRatio: number;     // Risk-adjusted return metric
  maxDrawdown: number;     // Maximum peak-to-trough decline
  winRate: number;         // % of days with positive returns
}

export interface ChartDataPoint {
  timestamp: number;
  date: string;
  value: number;
  pnl: number;
  pnlPercentage: number;
}

// Time intervals in milliseconds
const INTERVALS = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
};

class PortfolioHistoryService {
  private snapshots: Map<string, PortfolioSnapshot[]> = new Map();
  private initialValues: Map<string, number> = new Map();
  private readonly MAX_SNAPSHOTS = 1000; // Keep last 1000 snapshots per wallet
  private readonly SNAPSHOT_INTERVAL = 5 * INTERVALS.MINUTE; // 5 minute intervals
  private lastSnapshotTime: Map<string, number> = new Map();

  constructor() {
    // Initialize from localStorage if in browser
    if (typeof window !== 'undefined') {
      this.loadFromStorage();
    }
    logger.info('[PortfolioHistoryService] Initialized');
  }

  /**
   * Record a new portfolio snapshot
   */
  recordSnapshot(
    walletAddress: string,
    totalValue: number,
    positions: Array<{ symbol: string; value: number; amount: number; price: number }>,
    metadata?: { hedgesActive: number; rebalancesCount: number; avgYield: number }
  ): PortfolioSnapshot | null {
    const now = Date.now();
    const lastTime = this.lastSnapshotTime.get(walletAddress) || 0;

    // Throttle snapshots to prevent excessive storage
    if (now - lastTime < this.SNAPSHOT_INTERVAL) {
      return null; // Too soon, skip
    }

    const history = this.getHistory(walletAddress);
    const initialValue = this.getInitialValue(walletAddress) || totalValue;
    
    // Calculate PnL metrics
    const pnl = this.calculatePnL(walletAddress, totalValue);

    const snapshot: PortfolioSnapshot = {
      timestamp: now,
      totalValue,
      positions,
      pnl,
      metadata,
    };

    history.push(snapshot);

    // Trim old snapshots if needed
    if (history.length > this.MAX_SNAPSHOTS) {
      history.splice(0, history.length - this.MAX_SNAPSHOTS);
    }

    this.snapshots.set(walletAddress, history);
    this.lastSnapshotTime.set(walletAddress, now);

    // Set initial value if first snapshot
    if (!this.initialValues.has(walletAddress)) {
      this.initialValues.set(walletAddress, totalValue);
    }

    // Persist to storage
    this.saveToStorage();

    logger.debug('[PortfolioHistoryService] Snapshot recorded', {
      wallet: walletAddress.slice(0, 10),
      value: totalValue,
      snapshotCount: history.length,
    });

    return snapshot;
  }

  /**
   * Force record a snapshot (bypass throttling)
   */
  forceRecordSnapshot(
    walletAddress: string,
    totalValue: number,
    positions: Array<{ symbol: string; value: number; amount: number; price: number }>,
    metadata?: { hedgesActive: number; rebalancesCount: number; avgYield: number }
  ): PortfolioSnapshot {
    this.lastSnapshotTime.delete(walletAddress);
    return this.recordSnapshot(walletAddress, totalValue, positions, metadata)!;
  }

  /**
   * Get portfolio history for a wallet
   */
  getHistory(walletAddress: string): PortfolioSnapshot[] {
    if (!this.snapshots.has(walletAddress)) {
      this.snapshots.set(walletAddress, []);
    }
    return this.snapshots.get(walletAddress)!;
  }

  /**
   * Get initial portfolio value
   */
  getInitialValue(walletAddress: string): number | null {
    return this.initialValues.get(walletAddress) ?? null;
  }

  /**
   * Set initial value (for existing portfolios)
   */
  setInitialValue(walletAddress: string, value: number): void {
    if (!this.initialValues.has(walletAddress)) {
      this.initialValues.set(walletAddress, value);
      this.saveToStorage();
    }
  }

  /**
   * Calculate PnL metrics based on history
   */
  calculatePnL(walletAddress: string, currentValue: number): PortfolioSnapshot['pnl'] {
    const history = this.getHistory(walletAddress);
    const initialValue = this.getInitialValue(walletAddress) || currentValue;
    const now = Date.now();

    // Total PnL since inception
    const absolute = currentValue - initialValue;
    const percentage = initialValue > 0 ? (absolute / initialValue) * 100 : 0;

    // Find snapshot from ~24h ago
    const dayAgo = now - INTERVALS.DAY;
    const dayAgoSnapshot = this.findClosestSnapshot(history, dayAgo);
    const daily = dayAgoSnapshot ? currentValue - dayAgoSnapshot.totalValue : 0;
    const dailyPercentage = dayAgoSnapshot && dayAgoSnapshot.totalValue > 0
      ? (daily / dayAgoSnapshot.totalValue) * 100
      : 0;

    // Find snapshot from ~7d ago
    const weekAgo = now - INTERVALS.WEEK;
    const weekAgoSnapshot = this.findClosestSnapshot(history, weekAgo);
    const weekly = weekAgoSnapshot ? currentValue - weekAgoSnapshot.totalValue : absolute;
    const weeklyPercentage = weekAgoSnapshot && weekAgoSnapshot.totalValue > 0
      ? (weekly / weekAgoSnapshot.totalValue) * 100
      : percentage;

    return {
      absolute,
      percentage,
      daily,
      dailyPercentage,
      weekly,
      weeklyPercentage,
    };
  }

  /**
   * Get performance metrics for a wallet
   */
  getPerformanceMetrics(walletAddress: string): PerformanceMetrics {
    const history = this.getHistory(walletAddress);
    const now = Date.now();
    
    if (history.length === 0) {
      return this.emptyMetrics();
    }

    const currentValue = history[history.length - 1].totalValue;
    const initialValue = this.getInitialValue(walletAddress) || history[0].totalValue;
    
    // Calculate high/low
    let highestValue = currentValue;
    let lowestValue = currentValue;
    
    for (const snapshot of history) {
      if (snapshot.totalValue > highestValue) highestValue = snapshot.totalValue;
      if (snapshot.totalValue < lowestValue) lowestValue = snapshot.totalValue;
    }

    // Total PnL
    const totalPnL = currentValue - initialValue;
    const totalPnLPercentage = initialValue > 0 ? (totalPnL / initialValue) * 100 : 0;

    // Daily PnL
    const dayAgoSnapshot = this.findClosestSnapshot(history, now - INTERVALS.DAY);
    const dailyPnL = dayAgoSnapshot ? currentValue - dayAgoSnapshot.totalValue : 0;
    const dailyPnLPercentage = dayAgoSnapshot?.totalValue 
      ? (dailyPnL / dayAgoSnapshot.totalValue) * 100 : 0;

    // Weekly PnL
    const weekAgoSnapshot = this.findClosestSnapshot(history, now - INTERVALS.WEEK);
    const weeklyPnL = weekAgoSnapshot ? currentValue - weekAgoSnapshot.totalValue : totalPnL;
    const weeklyPnLPercentage = weekAgoSnapshot?.totalValue 
      ? (weeklyPnL / weekAgoSnapshot.totalValue) * 100 : totalPnLPercentage;

    // Monthly PnL
    const monthAgoSnapshot = this.findClosestSnapshot(history, now - INTERVALS.MONTH);
    const monthlyPnL = monthAgoSnapshot ? currentValue - monthAgoSnapshot.totalValue : totalPnL;
    const monthlyPnLPercentage = monthAgoSnapshot?.totalValue 
      ? (monthlyPnL / monthAgoSnapshot.totalValue) * 100 : totalPnLPercentage;

    // Calculate daily returns for volatility
    const dailyReturns = this.calculateDailyReturns(history);
    const volatility = this.calculateVolatility(dailyReturns);
    const sharpeRatio = this.calculateSharpeRatio(dailyReturns, volatility);
    const maxDrawdown = this.calculateMaxDrawdown(history);
    const winRate = this.calculateWinRate(dailyReturns);

    return {
      currentValue,
      initialValue,
      highestValue,
      lowestValue,
      totalPnL,
      totalPnLPercentage,
      dailyPnL,
      dailyPnLPercentage,
      weeklyPnL,
      weeklyPnLPercentage,
      monthlyPnL,
      monthlyPnLPercentage,
      volatility,
      sharpeRatio,
      maxDrawdown,
      winRate,
    };
  }

  /**
   * Get chart data for a specific time range
   */
  getChartData(
    walletAddress: string,
    timeRange: '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL' = '1W'
  ): ChartDataPoint[] {
    const history = this.getHistory(walletAddress);
    const now = Date.now();
    
    // Calculate time range
    let startTime: number;
    switch (timeRange) {
      case '1D':
        startTime = now - INTERVALS.DAY;
        break;
      case '1W':
        startTime = now - INTERVALS.WEEK;
        break;
      case '1M':
        startTime = now - INTERVALS.MONTH;
        break;
      case '3M':
        startTime = now - 3 * INTERVALS.MONTH;
        break;
      case '1Y':
        startTime = now - 365 * INTERVALS.DAY;
        break;
      case 'ALL':
      default:
        startTime = history[0]?.timestamp || now;
    }

    // Filter snapshots within range
    const filteredHistory = history.filter(s => s.timestamp >= startTime);
    
    if (filteredHistory.length === 0) {
      return [];
    }

    // Get initial value for PnL calculation
    const initialSnapshot = filteredHistory[0];
    const initialValue = initialSnapshot.totalValue;

    // Convert to chart data points
    return filteredHistory.map(snapshot => ({
      timestamp: snapshot.timestamp,
      date: new Date(snapshot.timestamp).toISOString(),
      value: snapshot.totalValue,
      pnl: snapshot.totalValue - initialValue,
      pnlPercentage: initialValue > 0 
        ? ((snapshot.totalValue - initialValue) / initialValue) * 100 
        : 0,
    }));
  }

  /**
   * Generate mock history for demo/new users
   */
  generateMockHistory(
    walletAddress: string,
    currentValue: number,
    days: number = 30
  ): void {
    if (this.getHistory(walletAddress).length > 0) {
      return; // Don't overwrite existing history
    }

    const now = Date.now();
    const intervalMs = INTERVALS.HOUR * 4; // 4-hour intervals
    const dataPoints = Math.floor((days * INTERVALS.DAY) / intervalMs);
    
    // Start from a value 80-120% of current (random variance)
    const startMultiplier = 0.85 + Math.random() * 0.2;
    let value = currentValue * startMultiplier;
    const history: PortfolioSnapshot[] = [];

    // Generate realistic price movement using random walk
    for (let i = 0; i < dataPoints; i++) {
      const timestamp = now - ((dataPoints - i) * intervalMs);
      
      // Random daily return between -2% and +2.5% (slight upward bias)
      const dailyReturn = (Math.random() * 0.045 - 0.02);
      const intervalReturn = dailyReturn / 6; // 6 intervals per day
      value = value * (1 + intervalReturn);
      
      // Add some noise
      value = value * (1 + (Math.random() - 0.5) * 0.005);

      history.push({
        timestamp,
        totalValue: value,
        positions: [], // Empty for mock data
      });
    }

    // Ensure final value matches current
    if (history.length > 0) {
      history[history.length - 1].totalValue = currentValue;
    }

    this.snapshots.set(walletAddress, history);
    this.initialValues.set(walletAddress, history[0]?.totalValue || currentValue);
    this.saveToStorage();

    logger.info('[PortfolioHistoryService] Mock history generated', {
      wallet: walletAddress.slice(0, 10),
      dataPoints: history.length,
    });
  }

  // Private helper methods

  private findClosestSnapshot(
    history: PortfolioSnapshot[],
    targetTime: number
  ): PortfolioSnapshot | null {
    if (history.length === 0) return null;

    // Binary search for efficiency
    let left = 0;
    let right = history.length - 1;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (history[mid].timestamp < targetTime) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // Return the closest snapshot
    if (left === 0) return history[0];
    
    const before = history[left - 1];
    const after = history[left];
    
    return Math.abs(before.timestamp - targetTime) < Math.abs(after.timestamp - targetTime)
      ? before
      : after;
  }

  private calculateDailyReturns(history: PortfolioSnapshot[]): number[] {
    const returns: number[] = [];
    const dailySnapshots = this.aggregateToDailySnapshots(history);
    
    for (let i = 1; i < dailySnapshots.length; i++) {
      const prevValue = dailySnapshots[i - 1].totalValue;
      const currValue = dailySnapshots[i].totalValue;
      if (prevValue > 0) {
        returns.push((currValue - prevValue) / prevValue);
      }
    }
    
    return returns;
  }

  private aggregateToDailySnapshots(history: PortfolioSnapshot[]): PortfolioSnapshot[] {
    const dailyMap = new Map<string, PortfolioSnapshot>();
    
    for (const snapshot of history) {
      const date = new Date(snapshot.timestamp).toISOString().split('T')[0];
      // Keep the last snapshot of each day
      dailyMap.set(date, snapshot);
    }
    
    return Array.from(dailyMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1);
    
    // Annualized volatility (assuming 365 trading days)
    return Math.sqrt(variance * 365) * 100;
  }

  private calculateSharpeRatio(returns: number[], volatility: number): number {
    if (returns.length === 0 || volatility === 0) return 0;
    
    // Assume risk-free rate of 5% annually
    const riskFreeRate = 0.05;
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const annualizedReturn = meanReturn * 365;
    
    return (annualizedReturn - riskFreeRate) / (volatility / 100);
  }

  private calculateMaxDrawdown(history: PortfolioSnapshot[]): number {
    if (history.length < 2) return 0;
    
    let maxDrawdown = 0;
    let peak = history[0].totalValue;
    
    for (const snapshot of history) {
      if (snapshot.totalValue > peak) {
        peak = snapshot.totalValue;
      }
      const drawdown = (peak - snapshot.totalValue) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown * 100;
  }

  private calculateWinRate(returns: number[]): number {
    if (returns.length === 0) return 50;
    
    const positiveReturns = returns.filter(r => r > 0).length;
    return (positiveReturns / returns.length) * 100;
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
    };
  }

  private loadFromStorage(): void {
    try {
      const saved = localStorage.getItem('portfolioHistory');
      if (saved) {
        const data = JSON.parse(saved);
        
        if (data.snapshots) {
          for (const [key, value] of Object.entries(data.snapshots)) {
            this.snapshots.set(key, value as PortfolioSnapshot[]);
          }
        }
        
        if (data.initialValues) {
          for (const [key, value] of Object.entries(data.initialValues)) {
            this.initialValues.set(key, value as number);
          }
        }
        
        logger.debug('[PortfolioHistoryService] Loaded from localStorage', {
          wallets: this.snapshots.size,
        });
      }
    } catch (error) {
      logger.warn('[PortfolioHistoryService] Failed to load from localStorage', error);
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') return;
    
    try {
      const data = {
        snapshots: Object.fromEntries(this.snapshots),
        initialValues: Object.fromEntries(this.initialValues),
        savedAt: Date.now(),
      };
      
      localStorage.setItem('portfolioHistory', JSON.stringify(data));
    } catch (error) {
      logger.warn('[PortfolioHistoryService] Failed to save to localStorage', error);
    }
  }

  /**
   * Clear history for a wallet (for testing)
   */
  clearHistory(walletAddress: string): void {
    this.snapshots.delete(walletAddress);
    this.initialValues.delete(walletAddress);
    this.lastSnapshotTime.delete(walletAddress);
    this.saveToStorage();
  }

  /**
   * Clear all history (for testing)
   */
  clearAllHistory(): void {
    this.snapshots.clear();
    this.initialValues.clear();
    this.lastSnapshotTime.clear();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('portfolioHistory');
    }
  }
}

// Singleton instance
let instance: PortfolioHistoryService | null = null;

export function getPortfolioHistoryService(): PortfolioHistoryService {
  if (!instance) {
    instance = new PortfolioHistoryService();
  }
  return instance;
}

export { PortfolioHistoryService };
