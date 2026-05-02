/**
 * SUI Community Pool — AI Allocation Engine
 *
 * Pure, side-effect-free allocation logic extracted from the cron route.
 * Same algorithm as the EVM pool, adapted for the SUI USDC 3-asset pool
 * (BTC, ETH, SUI). Kept intentionally simple: scoring → allocation %s →
 * confidence + reasoning. No on-chain or DB writes happen here.
 */

import { logger } from '@/lib/utils/logger';
import { getMarketDataService } from '@/lib/services/market-data/RealMarketDataService';

// 3 pool assets (SUI community pool — BTC, ETH, SUI only)
export const POOL_ASSETS = ['BTC', 'ETH', 'SUI'] as const;
export type PoolAsset = (typeof POOL_ASSETS)[number];

export interface AssetIndicator {
  asset: PoolAsset;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  volatility: 'low' | 'medium' | 'high';
  trend: 'bullish' | 'bearish' | 'neutral';
  score: number;
}

export async function fetchMarketIndicators(): Promise<AssetIndicator[]> {
  const mds = getMarketDataService();
  const indicators: AssetIndicator[] = [];

  for (const asset of POOL_ASSETS) {
    try {
      const data = await mds.getTokenPrice(asset);
      const price = data.price;
      const change24h = data.change24h ?? 0;
      const volume24h = data.volume24h ?? 0;
      // Estimate high/low from price and 24h change (MarketPrice doesn't have these)
      const high24h = price * (1 + Math.abs(change24h) / 100 * 0.6);
      const low24h = price * (1 - Math.abs(change24h) / 100 * 0.6);

      // Volatility from 24h range
      const rangePercent = price > 0 ? ((high24h - low24h) / price) * 100 : 0;
      const volatility: 'low' | 'medium' | 'high' =
        rangePercent < 3 ? 'low' : rangePercent < 7 ? 'medium' : 'high';

      // Trend from 24h change
      const trend: 'bullish' | 'bearish' | 'neutral' =
        change24h > 2 ? 'bullish' : change24h < -2 ? 'bearish' : 'neutral';

      // Score 0-100
      let score = 50 + change24h * 2;
      if (volatility === 'low') score += 10;
      else if (volatility === 'high') score -= 5;
      if (trend === 'bullish') score += 10;
      else if (trend === 'bearish') score -= 10;
      if (volume24h * price > 100_000_000) score += 5;
      score = Math.max(0, Math.min(100, score));

      indicators.push({ asset, price, change24h, volume24h, high24h, low24h, volatility, trend, score });
    } catch (err) {
      logger.warn(`[SUI Cron] Failed to fetch ${asset} price — skipping asset (no zero-data fallback)`, { error: err });
      // Do NOT push zero-data indicators — AI should not make decisions on missing data
    }
  }

  return indicators;
}

export function generateAllocation(
  indicators: AssetIndicator[],
  currentAllocations?: Record<PoolAsset, number>
): {
  allocations: Record<PoolAsset, number>;
  confidence: number;
  reasoning: string;
  shouldRebalance: boolean;
} {
  const totalScore = indicators.reduce((s, i) => s + i.score, 0) || 1;
  const sorted = [...indicators].sort((a, b) => b.score - a.score);

  const allocations: Record<string, number> = {};
  let remaining = 100;

  for (let i = 0; i < sorted.length; i++) {
    if (i === sorted.length - 1) {
      allocations[sorted[i].asset] = remaining;
    } else {
      let pct = Math.round((sorted[i].score / totalScore) * 100);
      pct = Math.max(10, Math.min(40, pct));
      allocations[sorted[i].asset] = pct;
      remaining -= pct;
    }
  }

  // Confidence
  const clearTrends = indicators.filter(i => i.trend !== 'neutral').length;
  const highVol = indicators.filter(i => i.volatility === 'high').length;
  const confidence = Math.max(50, Math.min(95, 60 + clearTrends * 8 - highVol * 5));

  // Reasoning
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const reasoning = `SUI USDC Pool AI (${new Date().toISOString().split('T')[0]}): ` +
    `Overweight ${top.asset} (${allocations[top.asset]}%) — ${top.trend}, score ${top.score.toFixed(0)}. ` +
    `Underweight ${bottom.asset} (${allocations[bottom.asset]}%) — ${bottom.trend}, score ${bottom.score.toFixed(0)}. ` +
    `Prices: ${indicators.map(i => `${i.asset}=$${i.price.toLocaleString()}`).join(', ')}.`;

  // Check drift to decide if rebalance needed
  let shouldRebalance = false;
  if (currentAllocations) {
    const maxDrift = Math.max(
      ...POOL_ASSETS.map(a => Math.abs((allocations[a] || 25) - (currentAllocations[a] || 25)))
    );
    shouldRebalance = maxDrift > 3;
  } else {
    shouldRebalance = confidence >= 65;
  }

  return {
    allocations: allocations as Record<PoolAsset, number>,
    confidence,
    reasoning,
    shouldRebalance,
  };
}
