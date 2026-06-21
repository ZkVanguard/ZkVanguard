/**
 * Polymarket Momentum + Relevance + Theme Service
 *
 * Three layers of "smart" discovery beyond static volume sorting:
 *
 *   1. **Momentum** — per-market history snapshots (in cron_state)
 *      compute probability velocity, volume velocity, liquidity growth
 *      between ticks. A market jumping from 35% → 55% probability with
 *      3× volume in 30 minutes is a much stronger AI signal than a
 *      static high-volume market that hasn't moved in days.
 *
 *   2. **Relevance** — score every market against the SUI pool's
 *      tracked assets + current allocation + horizon match. A BTC
 *      market at 24h horizon scores higher for a pool that's 25% BTC
 *      with a 30-min rebalance cadence than a SOL market at 30-day
 *      horizon for the same pool.
 *
 *   3. **Themes** — extract keywords (ETF, fed, halving, airdrop,
 *      hack, regulation, launch) and cluster markets by detected
 *      theme. Lets the AI see "12 markets clustering around Fed
 *      decision" as one signal instead of 12 independent observations,
 *      and surfaces emerging narratives.
 *
 * State stored under `cron_state`:
 *   poly-momentum:history:<slug>   ring buffer of up to 16 snapshots
 *   poly-momentum:themes:state     last-known theme counts (for delta alerting)
 *
 * No I/O for momentum/relevance/themes — all pure functions of inputs.
 * Cron-side reads/writes history.
 */

import type { BroadMarket } from './PolymarketBroadMarketsService';

// ── Momentum ──────────────────────────────────────────────────────────

export interface MarketSnapshot {
  ts: number;
  probability: number;
  volume24hr: number;
  liquidity: number;
}

export interface MarketMomentum {
  slug: string;
  question: string;
  currentProbability: number;
  currentVolume24hr: number;
  currentLiquidity: number;
  /** Probability change in % points across the history window. */
  probabilityDelta: number;
  /** Volume change ratio (1.0 = no change, 2.0 = doubled). */
  volumeRatio: number;
  /** Liquidity change ratio. */
  liquidityRatio: number;
  /** Time spanned by the history sample in minutes. */
  windowMinutes: number;
  /** Composite 0-100 hotness score — see scoreMomentum() for weights. */
  hotness: number;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  assets: string[];
}

const MAX_HISTORY_SAMPLES = 16;
const MIN_HISTORY_MINUTES = 15;       // need at least 15 min of data before scoring
const PROB_SWING_FOR_FULL_SCORE = 25; // 25 percentage-point swing → full prob component
const VOL_RATIO_FOR_FULL_SCORE = 4;   // 4× volume → full volume component

/**
 * Append a snapshot to the per-market history ring buffer.
 * Pure function — caller is responsible for persistence.
 */
export function appendSnapshot(history: MarketSnapshot[], snap: MarketSnapshot): MarketSnapshot[] {
  const next = [...history, snap];
  if (next.length > MAX_HISTORY_SAMPLES) next.splice(0, next.length - MAX_HISTORY_SAMPLES);
  return next;
}

/**
 * Compute composite hotness 0-100 from probability swing + volume + liquidity
 * deltas. Higher = market is moving faster relative to its baseline.
 */
function scoreMomentum(args: {
  probabilityDelta: number;     // absolute % points
  volumeRatio: number;
  liquidityRatio: number;
  windowMinutes: number;
}): number {
  const probScore = Math.min(45, (Math.abs(args.probabilityDelta) / PROB_SWING_FOR_FULL_SCORE) * 45);
  const volScore = Math.min(35, (Math.max(args.volumeRatio - 1, 0) / (VOL_RATIO_FOR_FULL_SCORE - 1)) * 35);
  const liqScore = Math.min(20, (Math.max(args.liquidityRatio - 1, 0) / 2) * 20);
  return Math.round(probScore + volScore + liqScore);
}

/**
 * Compute momentum for one market given its history + current snapshot.
 * Returns null when history is too short to be meaningful.
 */
export function computeMomentum(
  market: BroadMarket,
  history: MarketSnapshot[],
): MarketMomentum | null {
  if (history.length < 2) return null;
  const oldest = history[0];
  const newest = history[history.length - 1];
  const windowMinutes = (newest.ts - oldest.ts) / 60_000;
  if (windowMinutes < MIN_HISTORY_MINUTES) return null;

  const probabilityDelta = newest.probability - oldest.probability;
  const volumeRatio = oldest.volume24hr > 0 ? newest.volume24hr / oldest.volume24hr : 1;
  const liquidityRatio = oldest.liquidity > 0 ? newest.liquidity / oldest.liquidity : 1;
  const hotness = scoreMomentum({ probabilityDelta, volumeRatio, liquidityRatio, windowMinutes });

  return {
    slug: market.slug,
    question: market.question,
    currentProbability: market.probability,
    currentVolume24hr: market.volume24hr,
    currentLiquidity: market.liquidity,
    probabilityDelta,
    volumeRatio,
    liquidityRatio,
    windowMinutes,
    hotness,
    direction: market.direction,
    assets: market.assets,
  };
}

// ── Relevance ─────────────────────────────────────────────────────────

export interface RelevanceContext {
  /** Pool's tracked asset universe, e.g. ['BTC','ETH','SUI']. */
  poolAssets: string[];
  /** Current pool allocation % per asset (sums to ~100). */
  allocation?: Record<string, number>;
  /** Pool's rebalance cadence in minutes — markets at compatible
   *  horizons score higher than year-out markets. */
  rebalanceMinutes?: number;
}

export interface MarketRelevance {
  slug: string;
  /** 0-100 — higher = more relevant to the pool's decisions. */
  score: number;
  reasons: string[];
}

/**
 * Composite relevance:
 *   * Asset overlap with pool assets, weighted by current allocation.
 *   * Horizon match: markets within 10× the rebalance cadence are
 *     more useful than longer-dated.
 *   * Direction conviction: strong skew (probability ≠ 50) = more
 *     useful signal.
 *   * Volume / liquidity floor: tiny markets are noise.
 */
export function scoreRelevance(market: BroadMarket, ctx: RelevanceContext): MarketRelevance {
  const reasons: string[] = [];
  let score = 0;

  // Asset overlap (0-45 pts)
  const poolSet = new Set(ctx.poolAssets.map(a => a.toUpperCase()));
  const matchedAssets = market.assets.filter(a => poolSet.has(a));
  if (matchedAssets.length > 0) {
    let allocWeight = 0;
    for (const a of matchedAssets) {
      const allocPct = ctx.allocation?.[a] ?? (100 / Math.max(1, ctx.poolAssets.length));
      allocWeight += allocPct;
    }
    const assetScore = Math.min(45, allocWeight * 0.45);
    score += assetScore;
    reasons.push(`asset-match: ${matchedAssets.join('/')} (+${assetScore.toFixed(1)})`);
  } else {
    // Non-pool-asset market — still useful if it's a macro/event market
    // that affects all crypto (Fed, SEC, regulation). Give it a small
    // base score and let theme detection lift it later.
    score += 5;
    reasons.push('non-pool-asset macro context (+5)');
  }

  // Horizon match (0-25 pts) — peak score when horizon ≈ rebalance cadence
  const rebalMin = ctx.rebalanceMinutes ?? 30;
  if (market.horizonHours !== null) {
    const horizonMin = market.horizonHours * 60;
    const ratio = horizonMin / rebalMin;
    // Sweet spot: 1× → 60× rebalance cadence (30min → 30hr). Score falls
    // off outside that range.
    let horizonScore = 0;
    if (ratio < 0.5) horizonScore = 10;          // too short to act on
    else if (ratio < 60) horizonScore = 25 - Math.abs(Math.log2(ratio / 5)) * 4;
    else if (ratio < 720) horizonScore = 10;      // 1-30 day
    else horizonScore = 5;
    horizonScore = Math.max(0, Math.min(25, horizonScore));
    score += horizonScore;
    reasons.push(`horizon: ${market.horizon} (+${horizonScore.toFixed(1)})`);
  }

  // Conviction (0-15 pts)
  const skew = Math.abs(market.probability - 50);
  const convictionScore = Math.min(15, skew * 0.3);
  score += convictionScore;
  reasons.push(`conviction: ${skew.toFixed(0)}% skew (+${convictionScore.toFixed(1)})`);

  // Liquidity floor (0-15 pts) — log scale so $10k and $100k both score
  const liqScore = Math.min(15, Math.log10(Math.max(market.liquidity, 100)) * 3.5);
  score += liqScore;
  reasons.push(`liq: $${market.liquidity.toFixed(0)} (+${liqScore.toFixed(1)})`);

  return {
    slug: market.slug,
    score: Math.round(Math.max(0, Math.min(100, score))),
    reasons,
  };
}

// ── Themes ────────────────────────────────────────────────────────────

/**
 * Theme detection via keyword cluster — explicit, auditable, no LLM
 * required. Each market can match multiple themes. Add new themes by
 * extending THEME_PATTERNS; the cron picks them up automatically.
 */
export const THEME_PATTERNS: Array<{ theme: string; re: RegExp; affects: string[] }> = [
  { theme: 'etf-approval', re: /\b(etf|spot etf|approval|approve)\b/i, affects: ['BTC', 'ETH'] },
  { theme: 'fed-rates', re: /\b(fed|fomc|federal reserve|rate cut|rate hike|interest rate)\b/i, affects: ['BTC', 'ETH', 'USDC'] },
  { theme: 'inflation', re: /\b(cpi|inflation|core pce|wholesale prices)\b/i, affects: ['BTC', 'ETH', 'USDC'] },
  { theme: 'regulation', re: /\b(sec|cftc|regulation|enforcement|lawsuit|investigation)\b/i, affects: ['BTC', 'ETH'] },
  { theme: 'airdrop', re: /\bairdrop|tge|token launch\b/i, affects: ['ETH', 'SUI', 'SOL'] },
  { theme: 'halving', re: /\bhalving|halv\b/i, affects: ['BTC'] },
  { theme: 'hack-exploit', re: /\b(hack|exploit|drain|stolen|rug)\b/i, affects: ['ETH', 'BTC', 'SOL'] },
  { theme: 'price-target', re: /\b(reach|hit|above|cross|break)\s*\$?\d/i, affects: ['BTC', 'ETH'] },
  { theme: 'macro-recession', re: /\brecession|stagflation|gdp|jobs report|unemployment\b/i, affects: ['BTC', 'ETH', 'USDC'] },
  { theme: 'mainnet-launch', re: /\b(mainnet|launch|upgrade|fork|migration)\b/i, affects: ['ETH', 'SUI', 'SOL'] },
];

export interface ThemeCluster {
  theme: string;
  marketCount: number;
  totalVolume24hr: number;
  weightedDirection: number;     // -1 to +1 (bearish ↔ bullish), weighted by volume
  affectsAssets: string[];
  markets: Array<{ slug: string; question: string; probability: number; direction: 'UP' | 'DOWN' | 'NEUTRAL'; volume24hr: number }>;
}

export function detectThemes(markets: BroadMarket[]): ThemeCluster[] {
  const clusters: Record<string, ThemeCluster> = {};
  for (const pattern of THEME_PATTERNS) {
    clusters[pattern.theme] = {
      theme: pattern.theme,
      marketCount: 0,
      totalVolume24hr: 0,
      weightedDirection: 0,
      affectsAssets: pattern.affects,
      markets: [],
    };
  }
  // Weighted direction accumulator: sum(volume × dirSign), then divide
  const dirWeightSums: Record<string, number> = {};
  for (const t of Object.keys(clusters)) dirWeightSums[t] = 0;

  for (const m of markets) {
    for (const pattern of THEME_PATTERNS) {
      if (pattern.re.test(m.question)) {
        const c = clusters[pattern.theme];
        c.marketCount += 1;
        c.totalVolume24hr += m.volume24hr;
        const dirSign = m.direction === 'UP' ? 1 : m.direction === 'DOWN' ? -1 : 0;
        dirWeightSums[pattern.theme] += dirSign * m.volume24hr;
        c.markets.push({
          slug: m.slug,
          question: m.question,
          probability: m.probability,
          direction: m.direction,
          volume24hr: m.volume24hr,
        });
      }
    }
  }
  for (const c of Object.values(clusters)) {
    c.weightedDirection = c.totalVolume24hr > 0
      ? dirWeightSums[c.theme] / c.totalVolume24hr
      : 0;
    // Keep only top 5 markets per cluster — full list lives elsewhere
    c.markets = c.markets.sort((a, b) => b.volume24hr - a.volume24hr).slice(0, 5);
  }
  return Object.values(clusters)
    .filter(c => c.marketCount > 0)
    .sort((a, b) => b.totalVolume24hr - a.totalVolume24hr);
}
