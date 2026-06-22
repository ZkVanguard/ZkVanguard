/**
 * Polymarket Broad-Markets Service
 *
 * Captures crypto-relevant Polymarket markets BEYOND the 5-min binaries
 * (which already have dedicated coverage via Polymarket5MinService and
 * MultiAssetSignalService). Targets:
 *
 *   * Hourly binaries — `*-updown-1h-{epoch}` (where they exist)
 *   * Daily binaries — `*-daily-{date}` / `*-eod-{date}`
 *   * Weekly/monthly close — `will-{asset}-be-above-{price}-by-{date}`
 *   * Price-target markets — "Will BTC reach $X by Y?"
 *   * Range markets — "Will BTC trade between $X-$Y?"
 *   * Event markets — Fed decisions, ETF approvals, exchange events,
 *     airdrop windows, halvings
 *
 * Why this matters: the SUI cron's enhanced-allocation pipeline weights
 * prediction signals by conviction (see SuiPoolAgent step 3). A 5-min
 * binary tells you what traders think about the next 300 seconds; a
 * daily or weekly market tells you what they think about a horizon that
 * matters for the cron's 30-min rebalance cadence and the daily-cap
 * reset. Different horizons frame different bets, and adding them
 * substantially widens the AI's evidence base.
 *
 * Coverage strategy:
 *   1. Single broad gamma query (`limit=500&order=volume24hr`) — same
 *      cost as discovery, no per-asset fan-out.
 *   2. Slug-pattern + question-text classification — categorize into
 *      one of: `5min` | `hourly` | `daily` | `weekly` | `priceTarget` |
 *      `range` | `event` | `other`.
 *   3. Extract structured fields: targetPrice, targetDate, horizonHours,
 *      assets[] — so downstream agents can filter by what they care
 *      about (e.g. SUI cron only wants ≤ 7-day horizons).
 *   4. Per-call cache (60 s) — Polymarket markets don't change faster
 *      than that and the cron only runs every 30 min anyway.
 */

import { logger } from '@/lib/utils/logger';

export type BroadHorizon =
  | '5min'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'longer'
  | 'unknown';

export type BroadMarketType =
  | 'binary-direction'
  | 'price-target'
  | 'price-range'
  | 'event'
  | 'other';

export interface BroadMarket {
  id: string;
  slug: string;
  question: string;
  horizon: BroadHorizon;
  horizonHours: number | null;
  marketType: BroadMarketType;
  upProbability: number;
  downProbability: number;
  probability: number;            // probability of the winning side
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  volume24hr: number;
  liquidity: number;
  assets: string[];               // detected asset symbols ('BTC', 'ETH', …)
  targetPrice: number | null;
  targetDate: string | null;
  endDate: string | null;
  sourceUrl: string;
}

const POLYMARKET_API = 'https://gamma-api.polymarket.com';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

// Slug patterns ordered most-specific first so a 5-min binary doesn't get
// mis-classified as "hourly" because both contain "h".
const HOURLY_SLUG_RE = /-updown-1h-(\d{10})$/i;
const DAILY_SLUG_RE = /-(daily|eod|24h)-/i;
const WEEKLY_SLUG_RE = /-(weekly|wk|7d)-/i;
const FIVE_MIN_SLUG_RE = /-updown-5m-(\d{10})$/i;

// Question-text heuristics
const ASSET_PATTERNS: Array<{ asset: string; re: RegExp }> = [
  { asset: 'BTC', re: /\b(bitcoin|btc)\b/i },
  { asset: 'ETH', re: /\b(ethereum|ether|eth)\b/i },
  { asset: 'SOL', re: /\b(solana|sol)\b/i },
  { asset: 'XRP', re: /\b(xrp|ripple)\b/i },
  { asset: 'DOGE', re: /\b(dogecoin|doge)\b/i },
  { asset: 'SUI', re: /\b(sui)\b/i },
  { asset: 'AVAX', re: /\b(avalanche|avax)\b/i },
  { asset: 'LINK', re: /\b(chainlink|link)\b/i },
  { asset: 'MATIC', re: /\b(polygon|matic)\b/i },
];

const PRICE_TARGET_RE = /\b(?:reach|hit|above|cross|surpass|exceed|break)\s*\$?([\d,]+(?:\.\d+)?)\s*[kKmM]?/i;
const RANGE_RE = /\bbetween\s*\$?([\d,]+(?:\.\d+)?)\s*(?:and|to|[-–])\s*\$?([\d,]+(?:\.\d+)?)/i;
const EVENT_KEYWORDS = [
  'sec', 'etf', 'approve', 'approval', 'rate cut', 'fomc',
  'fed', 'cpi', 'jobs report', 'airdrop', 'halving', 'launch',
  'listing', 'mainnet', 'fork', 'upgrade', 'hack', 'exploit',
];

let cache: { ts: number; markets: BroadMarket[] } | null = null;

function parsePriceWithSuffix(raw: string): number {
  const cleaned = raw.replace(/,/g, '');
  const lower = raw.toLowerCase();
  const base = parseFloat(cleaned);
  if (!Number.isFinite(base)) return 0;
  if (lower.endsWith('k')) return base * 1_000;
  if (lower.endsWith('m')) return base * 1_000_000;
  return base;
}

function classifyHorizon(slug: string, endMs: number | null): { horizon: BroadHorizon; horizonHours: number | null } {
  if (FIVE_MIN_SLUG_RE.test(slug)) return { horizon: '5min', horizonHours: 1 / 12 };
  if (HOURLY_SLUG_RE.test(slug)) return { horizon: 'hourly', horizonHours: 1 };
  if (DAILY_SLUG_RE.test(slug)) return { horizon: 'daily', horizonHours: 24 };
  if (WEEKLY_SLUG_RE.test(slug)) return { horizon: 'weekly', horizonHours: 24 * 7 };

  if (endMs) {
    const hoursOut = (endMs - Date.now()) / 3_600_000;
    if (hoursOut < 0.5) return { horizon: 'hourly', horizonHours: hoursOut };
    if (hoursOut < 36) return { horizon: 'daily', horizonHours: hoursOut };
    if (hoursOut < 24 * 10) return { horizon: 'weekly', horizonHours: hoursOut };
    if (hoursOut < 24 * 45) return { horizon: 'monthly', horizonHours: hoursOut };
    return { horizon: 'longer', horizonHours: hoursOut };
  }
  return { horizon: 'unknown', horizonHours: null };
}

function classifyMarketType(question: string, slug: string): BroadMarketType {
  const q = question.toLowerCase();
  if (RANGE_RE.test(q)) return 'price-range';
  if (PRICE_TARGET_RE.test(q)) return 'price-target';
  if (/(up or down|will\s+\w+\s+(go up|go down|rise|fall))/i.test(q)) return 'binary-direction';
  if (FIVE_MIN_SLUG_RE.test(slug) || HOURLY_SLUG_RE.test(slug)) return 'binary-direction';
  for (const kw of EVENT_KEYWORDS) {
    if (q.includes(kw)) return 'event';
  }
  return 'other';
}

function detectAssets(question: string, slug: string): string[] {
  const text = `${question} ${slug}`;
  const found = new Set<string>();
  for (const { asset, re } of ASSET_PATTERNS) {
    if (re.test(text)) found.add(asset);
  }
  return Array.from(found);
}

function extractTargetPrice(question: string): number | null {
  const m = PRICE_TARGET_RE.exec(question);
  if (!m) return null;
  const raw = m[0].match(/\$?([\d,]+(?:\.\d+)?)\s*[kKmM]?/);
  return raw ? parsePriceWithSuffix(raw[0].replace('$', '')) : null;
}

function extractTargetDate(question: string, endDate: string | null): string | null {
  if (endDate) return endDate;
  const m = /\b(?:by|before)\s+([A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?|Q[1-4]\s*\d{4}|\d{4})\b/.exec(question);
  return m ? m[1] : null;
}

function parseMarket(m: Record<string, unknown>): BroadMarket | null {
  try {
    const question = String(m.question || '').trim();
    if (!question) return null;
    const slug = String(m.slug || '').toLowerCase();
    const id = String(m.id || m.conditionId || slug);
    if (m.closed || m.archived || m.resolved) return null;

    const endRaw = (m.endDate as string) || (m.endDateIso as string) || '';
    const endMs = endRaw ? new Date(endRaw).getTime() : null;
    if (endMs && endMs <= Date.now()) return null;

    let upProb = 50;
    let downProb = 50;
    try {
      const pricesStr = m.outcomePrices as string;
      if (pricesStr) {
        const prices = typeof pricesStr === 'string' ? JSON.parse(pricesStr) : pricesStr;
        if (Array.isArray(prices) && prices.length >= 2) {
          upProb = Math.round(parseFloat(prices[0]) * 10000) / 100;
          downProb = Math.round(parseFloat(prices[1]) * 10000) / 100;
        }
      }
    } catch { /* graceful */ }
    const probability = Math.max(upProb, downProb);
    const direction: 'UP' | 'DOWN' | 'NEUTRAL' =
      Math.abs(upProb - 50) < 3 ? 'NEUTRAL' : upProb > downProb ? 'UP' : 'DOWN';

    const assets = detectAssets(question, slug);
    if (assets.length === 0) return null;     // Skip non-crypto markets

    const { horizon, horizonHours } = classifyHorizon(slug, endMs);
    const marketType = classifyMarketType(question, slug);
    const volume24hr = Number(m.volume24hr ?? m.volumeNum ?? m.volume ?? 0) || 0;
    const liquidity = Number(m.liquidityNum ?? m.liquidity ?? 0) || 0;

    return {
      id,
      slug,
      question,
      horizon,
      horizonHours,
      marketType,
      upProbability: upProb,
      downProbability: downProb,
      probability,
      direction,
      volume24hr,
      liquidity,
      assets,
      targetPrice: extractTargetPrice(question),
      targetDate: extractTargetDate(question, endRaw || null),
      endDate: endRaw || null,
      sourceUrl: slug ? `https://polymarket.com/event/${slug}` : `https://polymarket.com/market/${id}`,
    };
  } catch (err) {
    logger.debug('[BroadMarkets] parseMarket failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Multi-query gamma fan-out + dedup. A single `?limit=500&order=volume24hr`
 * call gets dominated by politics/sports/entertainment markets and leaves
 * very few crypto markets after the filter — observed in production
 * (only 1 crypto market discovered from 500 returned). To get real
 * coverage, fan out across complementary sort orders + keyword searches,
 * dedup by id, then crypto-filter the union.
 *
 * Queries (all run in parallel via Promise.allSettled):
 *   1. Top 500 by 24h volume (catches popular)
 *   2. Top 500 by liquidity (catches well-funded crypto markets, often
 *      thin volume because long-dated)
 *   3. /markets?search=bitcoin     (direct crypto keyword targeting)
 *   4. /markets?search=ethereum
 *   5. /markets?search=crypto
 *
 * Any individual query failing degrades to "missing those results" — the
 * rest still return. Cached 60 s so SUI cron + UI share one fan-out.
 */
async function fetchOne(
  url: string,
  controller: AbortController,
): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const raw = await res.json();
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    const dataArr = (raw as { data?: unknown }).data;
    return Array.isArray(dataArr) ? (dataArr as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

export async function fetchBroadCryptoMarkets(opts: {
  limit?: number;
  bypassCache?: boolean;
} = {}): Promise<BroadMarket[]> {
  if (!opts.bypassCache && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.markets;
  }
  const limit = Math.max(50, Math.min(500, opts.limit ?? 500));
  const base = `${POLYMARKET_API}/markets?active=true&closed=false&limit=${limit}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const queries = [
    `${base}&order=volume24hr&ascending=false`,
    `${base}&order=liquidityNum&ascending=false`,
    `${base}&order=startDate&ascending=false`,
    // Keyword-targeted: gamma supports `search=` for substring slug/question
    // search. These three terms together cover the vast majority of crypto
    // market questions.
    `${base.replace(`&limit=${limit}`, '&limit=200')}&search=bitcoin`,
    `${base.replace(`&limit=${limit}`, '&limit=200')}&search=ethereum`,
    `${base.replace(`&limit=${limit}`, '&limit=200')}&search=crypto`,
  ];

  let all: Array<Record<string, unknown>> = [];
  try {
    const results = await Promise.allSettled(
      queries.map(u => fetchOne(u, controller)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') all = all.concat(r.value);
    }
  } finally {
    clearTimeout(timeout);
  }

  if (all.length === 0) {
    logger.warn('[BroadMarkets] all fan-out queries returned empty');
    return cache?.markets ?? [];
  }

  // De-dup by id BEFORE the expensive parse step — a market that appears
  // in 3 of the 6 queries shouldn't get parsed 3 times.
  const seenIds = new Set<string>();
  const uniqueRaw: Array<Record<string, unknown>> = [];
  for (const m of all) {
    const id = String(m.id || m.conditionId || m.slug || '');
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    uniqueRaw.push(m);
  }

  const parsed: BroadMarket[] = [];
  for (const m of uniqueRaw) {
    const bm = parseMarket(m);
    if (bm) parsed.push(bm);
  }

  const markets = parsed;
  cache = { ts: Date.now(), markets };
  logger.info('[BroadMarkets] fetched (multi-query)', {
    rawTotal: all.length,
    uniqueAfterDedup: uniqueRaw.length,
    cryptoRelevant: markets.length,
    byHorizon: countBy(markets, m => m.horizon),
    byType: countBy(markets, m => m.marketType),
  });
  return markets;
}

function countBy<T, K extends string>(items: T[], key: (t: T) => K): Record<K, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out as Record<K, number>;
}

/**
 * Filter helpers — most callers want only a subset of the broad universe.
 */
export function filterByHorizon(markets: BroadMarket[], horizons: BroadHorizon[]): BroadMarket[] {
  const set = new Set(horizons);
  return markets.filter(m => set.has(m.horizon));
}

export function filterByAsset(markets: BroadMarket[], assets: string[]): BroadMarket[] {
  const set = new Set(assets.map(a => a.toUpperCase()));
  return markets.filter(m => m.assets.some(a => set.has(a)));
}

export function summarize(markets: BroadMarket[]): {
  total: number;
  byHorizon: Record<BroadHorizon, number>;
  byType: Record<BroadMarketType, number>;
  byAsset: Record<string, number>;
} {
  const byHorizon = countBy(markets, m => m.horizon);
  const byType = countBy(markets, m => m.marketType);
  const byAsset: Record<string, number> = {};
  for (const m of markets) {
    for (const a of m.assets) byAsset[a] = (byAsset[a] || 0) + 1;
  }
  return { total: markets.length, byHorizon, byType, byAsset };
}
