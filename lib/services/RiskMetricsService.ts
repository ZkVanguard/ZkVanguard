/**
 * Risk Metrics Service
 * 
 * Professional hedge fund-style risk analytics for CommunityPool
 * 
 * Metrics Implemented:
 * - Sharpe Ratio: Risk-adjusted returns (excess return / volatility)
 * - Sortino Ratio: Downside risk-adjusted returns
 * - Maximum Drawdown (MDD): Largest peak-to-trough decline
 * - Value at Risk (VaR): Maximum expected loss at confidence level
 * - Volatility: Standard deviation of returns
 * - Beta: Correlation with benchmark (BTC as proxy)
 * - Alpha: Excess return over benchmark
 * - Calmar Ratio: Annual return / Max drawdown
 * - Win Rate: Percentage of profitable periods
 * - Information Ratio: Excess return per unit tracking error
 */

import { logger } from '../utils/logger';
import { getPoolHistory } from '../storage/community-pool-storage';

// Risk-free rate (annualized) - using 5% for T-Bill proxy
const RISK_FREE_RATE = 0.05;

// Trading days per year for crypto (24/7 = 365)
const TRADING_DAYS_PER_YEAR = 365;

// Confidence level for VaR
const VAR_CONFIDENCE = 0.95;

export interface RiskMetrics {
  // Core Metrics
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownDate: string | null;
  currentDrawdown: number;
  
  // Volatility Metrics
  volatilityDaily: number;
  volatilityAnnualized: number;
  downsideVolatility: number;
  
  // Value at Risk
  var95Daily: number;      // 95% confidence, 1-day
  var95Weekly: number;     // 95% confidence, 7-day
  cvar95: number;          // Conditional VaR (Expected Shortfall)
  
  // Performance Attribution
  beta: number;            // vs BTC benchmark
  alpha: number;           // Jensen's Alpha
  treynorRatio: number;
  informationRatio: number;
  
  // Return Metrics
  calmarRatio: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  
  // Time Series
  returns7d: number;
  returns30d: number;
  returns90d: number;
  returnsYTD: number;
  returnsSinceInception: number;
  
  // Meta
  dataPoints: number;
  lastCalculated: string;
  periodStart: string | null;
  periodEnd: string | null;
  
  // Data availability
  insufficientData: boolean;
  insufficientDataReason?: string;
}

export interface NAVSnapshot {
  timestamp: number;
  nav: number;
  sharePrice: number;
}

/**
 * Calculate daily returns from NAV series
 */
function calculateReturns(navSeries: NAVSnapshot[]): number[] {
  if (navSeries.length < 2) return [];
  
  const returns: number[] = [];
  for (let i = 1; i < navSeries.length; i++) {
    const prevNav = navSeries[i - 1].nav;
    const currNav = navSeries[i].nav;
    if (prevNav > 0) {
      returns.push((currNav - prevNav) / prevNav);
    }
  }
  return returns;
}

/**
 * Calculate mean of array
 */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Clamp value to range
 */
function clamp(value: number, min: number, max: number): number {
  if (!isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate standard deviation
 */
function stdDev(arr: number[], avg?: number): number {
  if (arr.length < 2) return 0;
  const m = avg !== undefined ? avg : mean(arr);
  const squaredDiffs = arr.map(val => Math.pow(val - m, 2));
  return Math.sqrt(mean(squaredDiffs));
}

/**
 * Calculate downside deviation (only negative returns)
 */
function downsideDeviation(returns: number[], targetReturn: number = 0): number {
  const negativeReturns = returns.filter(r => r < targetReturn);
  if (negativeReturns.length < 2) return 0;
  const squaredDownside = negativeReturns.map(r => Math.pow(r - targetReturn, 2));
  return Math.sqrt(mean(squaredDownside));
}

/**
 * Calculate maximum drawdown
 */
function calculateMaxDrawdown(navSeries: NAVSnapshot[]): { maxDD: number; maxDDDate: string | null } {
  if (navSeries.length < 2) return { maxDD: 0, maxDDDate: null };
  
  let peak = navSeries[0].nav;
  let maxDD = 0;
  let maxDDDate: string | null = null;
  
  for (const point of navSeries) {
    if (point.nav > peak) {
      peak = point.nav;
    }
    const drawdown = (peak - point.nav) / peak;
    if (drawdown > maxDD) {
      maxDD = drawdown;
      maxDDDate = new Date(point.timestamp).toISOString();
    }
  }
  
  return { maxDD, maxDDDate };
}

/**
 * Calculate current drawdown from peak
 */
function calculateCurrentDrawdown(navSeries: NAVSnapshot[]): number {
  if (navSeries.length < 1) return 0;
  
  const peak = Math.max(...navSeries.map(s => s.nav));
  const current = navSeries[navSeries.length - 1].nav;
  
  return peak > 0 ? (peak - current) / peak : 0;
}

/**
 * Calculate Value at Risk using historical simulation
 */
function calculateVaR(returns: number[], confidence: number = 0.95): number {
  if (returns.length < 10) return 0;
  
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidence) * sorted.length);
  return Math.abs(sorted[index] || 0);
}

/**
 * Calculate Conditional VaR (Expected Shortfall)
 * Average of returns below VaR threshold
 */
function calculateCVaR(returns: number[], confidence: number = 0.95): number {
  if (returns.length < 10) return 0;
  
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - confidence) * sorted.length);
  const tailReturns = sorted.slice(0, cutoff);
  
  return tailReturns.length > 0 ? Math.abs(mean(tailReturns)) : 0;
}

/**
 * Calculate Beta against benchmark (BTC)
 */
function calculateBeta(portfolioReturns: number[], benchmarkReturns: number[]): number {
  if (portfolioReturns.length < 3 || benchmarkReturns.length !== portfolioReturns.length) {
    return 1; // Default to market beta
  }
  
  const portfolioMean = mean(portfolioReturns);
  const benchmarkMean = mean(benchmarkReturns);
  
  let covariance = 0;
  let benchmarkVariance = 0;
  
  for (let i = 0; i < portfolioReturns.length; i++) {
    const portfolioDiff = portfolioReturns[i] - portfolioMean;
    const benchmarkDiff = benchmarkReturns[i] - benchmarkMean;
    covariance += portfolioDiff * benchmarkDiff;
    benchmarkVariance += benchmarkDiff * benchmarkDiff;
  }
  
  return benchmarkVariance > 0 ? covariance / benchmarkVariance : 1;
}

/**
 * Calculate period return
 */
function calculatePeriodReturn(navSeries: NAVSnapshot[], daysBack: number): number {
  if (navSeries.length < 2) return 0;
  
  const now = Date.now();
  const cutoff = now - (daysBack * 24 * 60 * 60 * 1000);
  
  const recentSeries = navSeries.filter(s => s.timestamp >= cutoff);
  if (recentSeries.length < 2) return 0;
  
  const startNav = recentSeries[0].nav;
  const endNav = recentSeries[recentSeries.length - 1].nav;
  
  return startNav > 0 ? (endNav - startNav) / startNav : 0;
}

/**
 * Calculate YTD return
 */
function calculateYTDReturn(navSeries: NAVSnapshot[]): number {
  if (navSeries.length < 2) return 0;
  
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  
  const ytdSeries = navSeries.filter(s => s.timestamp >= yearStart);
  if (ytdSeries.length < 2) return 0;
  
  const startNav = ytdSeries[0].nav;
  const endNav = ytdSeries[ytdSeries.length - 1].nav;
  
  return startNav > 0 ? (endNav - startNav) / startNav : 0;
}

/**
 * Calculate win rate and profit factor
 */
function calculateTradingMetrics(returns: number[]): { winRate: number; profitFactor: number; avgWin: number; avgLoss: number } {
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  
  const totalWins = wins.reduce((sum, r) => sum + r, 0);
  const totalLosses = Math.abs(losses.reduce((sum, r) => sum + r, 0));
  
  return {
    winRate: returns.length > 0 ? (wins.length / returns.length) * 100 : 0,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
    avgWin: wins.length > 0 ? mean(wins) * 100 : 0,
    avgLoss: losses.length > 0 ? Math.abs(mean(losses)) * 100 : 0,
  };
}

/**
 * Generate NAV history from share price data
 * 
 * IMPORTANT: Risk metrics should be based on SHARE PRICE changes, not NAV.
 * NAV changes when users deposit/withdraw - that's not investment performance.
 * Share price changes reflect actual portfolio performance.
 * 
 * Returns empty array if no real performance data is available.
 */
async function getHistoricalNAV(): Promise<NAVSnapshot[]> {
  const history = await getPoolHistory(365);
  
  // Need at least 2 data points to calculate returns
  if (history.length < 2) {
    logger.info('[RiskMetrics] Insufficient transaction history', {
      transactions: history.length,
    });
    return [];
  }
  
  const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
  
  // Get unique share prices (if all are 1.0 or undefined, there's no real performance data)
  const uniquePrices = new Set(
    sortedHistory
      .map(tx => tx.sharePrice)
      .filter(p => p !== undefined && p !== null)
  );
  
  const hasRealPriceData = uniquePrices.size > 1 || 
    (uniquePrices.size === 1 && !uniquePrices.has(1));
  
  if (!hasRealPriceData) {
    logger.info('[RiskMetrics] No share price variation detected (all prices are 1.0)', {
      transactions: history.length,
      uniquePrices: uniquePrices.size,
    });
    return [];
  }
  
  // Use actual share price progression for risk metrics
  const navSeries: NAVSnapshot[] = [];
  const baseNAV = 10000; // Normalize to $10k base for consistent calculations
  
  for (const tx of sortedHistory) {
    const sharePrice = tx.sharePrice || 1;
    // Scale NAV proportionally to share price (normalized)
    const normalizedNAV = baseNAV * sharePrice;
    
    navSeries.push({
      timestamp: tx.timestamp,
      nav: normalizedNAV,
      sharePrice,
    });
  }
  
  return navSeries;
}

/**
 * Generate BTC benchmark returns for beta calculation
 * Uses actual BTC price data if available, otherwise returns empty
 */
function generateBenchmarkReturns(length: number): number[] {
  // TODO: In production, fetch actual BTC price history
  // For now, return zeros to indicate no benchmark comparison available
  return Array.from({ length }, () => 0);
}

/**
 * Calculate comprehensive risk metrics
 */
export async function calculateRiskMetrics(): Promise<RiskMetrics> {
  const emptyMetrics: RiskMetrics = {
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdown: 0,
    maxDrawdownDate: null,
    currentDrawdown: 0,
    volatilityDaily: 0,
    volatilityAnnualized: 0,
    downsideVolatility: 0,
    var95Daily: 0,
    var95Weekly: 0,
    cvar95: 0,
    beta: 0,
    alpha: 0,
    treynorRatio: 0,
    informationRatio: 0,
    calmarRatio: 0,
    winRate: 0,
    profitFactor: 0,
    avgWin: 0,
    avgLoss: 0,
    returns7d: 0,
    returns30d: 0,
    returns90d: 0,
    returnsYTD: 0,
    returnsSinceInception: 0,
    dataPoints: 0,
    lastCalculated: new Date().toISOString(),
    periodStart: null,
    periodEnd: null,
    insufficientData: true,
    insufficientDataReason: 'No share price history available',
  };

  try {
    const navSeries = await getHistoricalNAV();
    
    // Check for insufficient data
    if (navSeries.length < 2) {
      logger.info('[RiskMetrics] Insufficient data for risk calculation', {
        dataPoints: navSeries.length,
      });
      return {
        ...emptyMetrics,
        insufficientDataReason: navSeries.length === 0 
          ? 'No share price history available. Risk metrics require actual portfolio performance data.'
          : 'Only 1 data point available. Risk metrics require at least 2 data points.',
      };
    }
    
    const returns = calculateReturns(navSeries);
    
    // Need at least 1 return to calculate anything meaningful
    if (returns.length < 1) {
      return {
        ...emptyMetrics,
        dataPoints: navSeries.length,
        insufficientDataReason: 'Unable to calculate returns from available data.',
      };
    }
    
    // Daily stats
    const dailyMean = mean(returns);
    const dailyStdDev = stdDev(returns, dailyMean);
    const downsideVol = downsideDeviation(returns);
    
    // Annualized metrics
    const annualizedReturn = dailyMean * TRADING_DAYS_PER_YEAR;
    const annualizedVol = dailyStdDev * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const annualizedDownsideVol = downsideVol * Math.sqrt(TRADING_DAYS_PER_YEAR);
    
    // Daily risk-free rate
    const dailyRiskFree = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;
    
    // Sharpe Ratio (annualized)
    const excessReturn = annualizedReturn - RISK_FREE_RATE;
    const sharpeRatio = annualizedVol > 0 ? excessReturn / annualizedVol : 0;
    
    // Sortino Ratio (annualized)
    const sortinoRatio = annualizedDownsideVol > 0 ? excessReturn / annualizedDownsideVol : 0;
    
    // Maximum Drawdown
    const { maxDD, maxDDDate } = calculateMaxDrawdown(navSeries);
    const currentDD = calculateCurrentDrawdown(navSeries);
    
    // Calmar Ratio
    const calmarRatio = maxDD > 0 ? annualizedReturn / maxDD : 0;
    
    // Value at Risk
    const var95Daily = calculateVaR(returns, VAR_CONFIDENCE);
    const var95Weekly = var95Daily * Math.sqrt(7);
    const cvar95 = calculateCVaR(returns, VAR_CONFIDENCE);
    
    // Beta and Alpha (using mock BTC benchmark)
    const benchmarkReturns = generateBenchmarkReturns(returns.length);
    const beta = calculateBeta(returns, benchmarkReturns);
    const benchmarkAnnualizedReturn = mean(benchmarkReturns) * TRADING_DAYS_PER_YEAR;
    const alpha = annualizedReturn - (RISK_FREE_RATE + beta * (benchmarkAnnualizedReturn - RISK_FREE_RATE));
    
    // Treynor Ratio
    const treynorRatio = beta !== 0 ? excessReturn / beta : 0;
    
    // Information Ratio
    const trackingErrors = returns.map((r, i) => r - benchmarkReturns[i]);
    const trackingErrorStdDev = stdDev(trackingErrors) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const informationRatio = trackingErrorStdDev > 0 ? (annualizedReturn - benchmarkAnnualizedReturn) / trackingErrorStdDev : 0;
    
    // Trading metrics
    const tradingMetrics = calculateTradingMetrics(returns);
    
    // Period returns
    const returns7d = calculatePeriodReturn(navSeries, 7);
    const returns30d = calculatePeriodReturn(navSeries, 30);
    const returns90d = calculatePeriodReturn(navSeries, 90);
    const returnsYTD = calculateYTDReturn(navSeries);
    const returnsSinceInception = navSeries.length > 1 
      ? (navSeries[navSeries.length - 1].nav - navSeries[0].nav) / navSeries[0].nav 
      : 0;
    
    const metrics: RiskMetrics = {
      // Core - clamp to reasonable ranges
      sharpeRatio: parseFloat(clamp(sharpeRatio, -10, 10).toFixed(2)),
      sortinoRatio: parseFloat(clamp(sortinoRatio, -10, 10).toFixed(2)),
      maxDrawdown: parseFloat(clamp(maxDD * 100, 0, 99.9).toFixed(2)),
      maxDrawdownDate: maxDDDate,
      currentDrawdown: parseFloat(clamp(currentDD * 100, 0, 99.9).toFixed(2)),
      
      // Volatility - clamp to reasonable daily max
      volatilityDaily: parseFloat(clamp(dailyStdDev * 100, 0, 50).toFixed(2)),
      volatilityAnnualized: parseFloat(clamp(annualizedVol * 100, 0, 500).toFixed(2)),
      downsideVolatility: parseFloat(clamp(annualizedDownsideVol * 100, 0, 500).toFixed(2)),
      
      // VaR - clamp to reasonable loss limits
      var95Daily: parseFloat(clamp(var95Daily * 100, 0, 50).toFixed(2)),
      var95Weekly: parseFloat(clamp(var95Weekly * 100, 0, 75).toFixed(2)),
      cvar95: parseFloat(clamp(cvar95 * 100, 0, 75).toFixed(2)),
      
      // Attribution - clamp beta/alpha
      beta: parseFloat(clamp(beta, -5, 5).toFixed(2)),
      alpha: parseFloat(clamp(alpha * 100, -500, 500).toFixed(2)),
      treynorRatio: parseFloat(clamp(treynorRatio, -100, 100).toFixed(2)),
      informationRatio: parseFloat(clamp(informationRatio, -10, 10).toFixed(2)),
      
      // Returns - clamp to reasonable bounds
      calmarRatio: parseFloat(clamp(calmarRatio, -100, 100).toFixed(2)),
      winRate: parseFloat(clamp(tradingMetrics.winRate, 0, 100).toFixed(1)),
      profitFactor: parseFloat(clamp(tradingMetrics.profitFactor, 0, 99.99).toFixed(2)),
      avgWin: parseFloat(clamp(tradingMetrics.avgWin, 0, 100).toFixed(2)),
      avgLoss: parseFloat(clamp(tradingMetrics.avgLoss, 0, 100).toFixed(2)),
      
      // Time Series - clamp extreme returns
      returns7d: parseFloat(clamp(returns7d * 100, -99, 1000).toFixed(2)),
      returns30d: parseFloat(clamp(returns30d * 100, -99, 1000).toFixed(2)),
      returns90d: parseFloat(clamp(returns90d * 100, -99, 5000).toFixed(2)),
      returnsYTD: parseFloat(clamp(returnsYTD * 100, -99, 10000).toFixed(2)),
      returnsSinceInception: parseFloat(clamp(returnsSinceInception * 100, -99, 10000).toFixed(2)),
      
      // Meta
      dataPoints: returns.length,
      lastCalculated: new Date().toISOString(),
      periodStart: navSeries.length > 0 ? new Date(navSeries[0].timestamp).toISOString() : null,
      periodEnd: navSeries.length > 0 ? new Date(navSeries[navSeries.length - 1].timestamp).toISOString() : null,
      
      // Data is sufficient
      insufficientData: false,
    };
    
    logger.info('[RiskMetrics] Calculated risk metrics', { sharpeRatio, maxDrawdown: maxDD, beta });
    
    return metrics;
    
  } catch (error) {
    logger.error('[RiskMetrics] Failed to calculate metrics', error);
    
    // Return default metrics on error
    return {
      ...getDefaultMetrics(),
      insufficientData: true,
      insufficientDataReason: 'Error calculating metrics: ' + (error instanceof Error ? error.message : 'Unknown error'),
    };
  }
}

/**
 * Get default/placeholder metrics
 */
function getDefaultMetrics(): RiskMetrics {
  return {
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdown: 0,
    maxDrawdownDate: null,
    currentDrawdown: 0,
    volatilityDaily: 0,
    volatilityAnnualized: 0,
    downsideVolatility: 0,
    var95Daily: 0,
    var95Weekly: 0,
    cvar95: 0,
    beta: 0,
    alpha: 0,
    treynorRatio: 0,
    informationRatio: 0,
    calmarRatio: 0,
    winRate: 0,
    profitFactor: 0,
    avgWin: 0,
    avgLoss: 0,
    returns7d: 0,
    returns30d: 0,
    returns90d: 0,
    returnsYTD: 0,
    returnsSinceInception: 0,
    dataPoints: 0,
    lastCalculated: new Date().toISOString(),
    periodStart: null,
    periodEnd: null,
    insufficientData: true,
    insufficientDataReason: 'No performance data available',
  };
}

/**
 * Get risk rating based on metrics
 */
export function getRiskRating(metrics: RiskMetrics): { rating: string; color: string; description: string } {
  const { sharpeRatio, maxDrawdown, volatilityAnnualized, var95Daily } = metrics;
  
  // Composite risk score
  let riskScore = 0;
  
  // Sharpe > 1.5 = low risk, < 0.5 = high risk
  if (sharpeRatio > 1.5) riskScore += 3;
  else if (sharpeRatio > 1.0) riskScore += 2;
  else if (sharpeRatio > 0.5) riskScore += 1;
  
  // Max DD < 10% = low risk, > 30% = high risk
  if (maxDrawdown < 10) riskScore += 3;
  else if (maxDrawdown < 20) riskScore += 2;
  else if (maxDrawdown < 30) riskScore += 1;
  
  // Volatility < 20% = low risk, > 50% = high risk
  if (volatilityAnnualized < 20) riskScore += 3;
  else if (volatilityAnnualized < 35) riskScore += 2;
  else if (volatilityAnnualized < 50) riskScore += 1;
  
  // VaR < 3% = low risk, > 7% = high risk
  if (var95Daily < 3) riskScore += 3;
  else if (var95Daily < 5) riskScore += 2;
  else if (var95Daily < 7) riskScore += 1;
  
  // Rating scale: 0-4 High, 5-8 Moderate, 9-12 Low
  if (riskScore >= 9) {
    return { rating: 'Low', color: 'text-green-500', description: 'Conservative risk profile with strong risk-adjusted returns' };
  } else if (riskScore >= 5) {
    return { rating: 'Moderate', color: 'text-yellow-500', description: 'Balanced risk-reward with typical crypto volatility' };
  } else {
    return { rating: 'High', color: 'text-red-500', description: 'Aggressive exposure with elevated volatility and drawdown risk' };
  }
}
