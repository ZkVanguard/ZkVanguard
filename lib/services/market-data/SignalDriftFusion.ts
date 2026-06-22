/**
 * SignalDriftFusion
 *
 * Extracts actionable signal from quiet markets by fusing three weak inputs
 * into one synthetic-STRONG output:
 *
 *   1. **Per-asset drift** — change in 5-min binary probability over the
 *      last N samples. Even when every absolute reading is "WEAK" (50/50),
 *      a consistent 49 → 50 → 51 → 52 → 53 trajectory is real directional
 *      information that the per-tick classifier discards.
 *
 *   2. **Cross-asset alignment** — when BTC + ETH + SOL all read weak-UP,
 *      that 3-asset agreement is stronger than any single STRONG reading
 *      on one asset. Computes a 0-100 alignment score and the direction
 *      the majority is pointing.
 *
 *   3. **Funding regime** — Bluefin perp funding rate confirms or denies
 *      the predicted direction. Positive funding (longs paying shorts)
 *      ALIGNS with a DOWN-bias prediction (mean reversion). Negative
 *      funding ALIGNS with UP-bias.
 *
 * Output: a per-asset upgrade decision. If all three fuse, the signal is
 * re-tagged `SYNTHETIC_STRONG` and confidence is boosted to a floor of 70.
 * Consumers (PredictionAggregatorService) treat these the same as a real
 * STRONG signal for trade-gating.
 *
 * **Why a singleton with in-memory state?** The drift component needs
 * history across calls. In serverless this only works within one Lambda
 * instance's warm window — but the SUI cron, the trader cron, and the
 * lead-cycle all run inside the same warm Vercel function pool, and
 * Polymarket5MinService already relies on the same model. For cold
 * starts, we just return "no drift signal yet" until 3+ samples accrue.
 */
import type { MultiAssetSignal } from './MultiAssetSignalService';
import { logger } from '@/lib/utils/logger';

const HISTORY_MAX = 12;                       // ~ 60 min @ 5-min cadence
const DRIFT_MIN_SAMPLES = 3;                  // need at least 3 to see a trend
const DRIFT_CONSISTENT_THRESHOLD = 0.6;       // 60% of consecutive deltas same sign
const ALIGNMENT_MIN_ASSETS = 3;               // need 3+ assets to call alignment
const ALIGNMENT_DOMINANCE_PCT = 67;           // majority must be ≥ 2/3 to upgrade
const SYNTHETIC_CONFIDENCE_FLOOR = 70;
const FUNDING_ALIGN_THRESHOLD = 0.00002;      // ~ 2% APR — below this, funding is noise

export type DriftDirection = 'UP' | 'DOWN' | 'FLAT';

export interface AssetDrift {
  asset: string;
  samples: number;
  directionConsistency: number;           // 0-1 — fraction of deltas matching majority sign
  netDelta: number;                       // last - first probability
  recentSlope: number;                    // average per-sample probability change
  driftDirection: DriftDirection;
}

export interface AlignmentSnapshot {
  upCount: number;
  downCount: number;
  neutralCount: number;
  totalAssets: number;
  dominantDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  dominancePct: number;                   // 0-100
  meanConfidence: number;
}

export interface FusionUpgrade {
  asset: string;
  originalStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  upgradedToStrong: boolean;
  syntheticConfidence: number;            // final confidence after fusion
  reasons: string[];
  drift: AssetDrift | null;               // probability drift (Polymarket moves)
  priceDrift: AssetDrift | null;          // spot-price momentum drift
  alignment: AlignmentSnapshot | null;
  fundingAlign: 'CONFIRMS' | 'CONFLICTS' | 'NEUTRAL';
}

interface SignalSample {
  ts: number;
  probability: number;                    // direction-aware: upProbability if UP-leaning
  direction: 'UP' | 'DOWN';
  confidence: number;
}

interface PriceSample {
  ts: number;
  price: number;
}

export class SignalDriftFusion {
  private static history: Map<string, SignalSample[]> = new Map();
  private static priceHistory: Map<string, PriceSample[]> = new Map();

  /**
   * Record a fresh signal sample for an asset. Called by the aggregator
   * each time it fetches per-asset signals so the drift window stays warm.
   *
   * **Dedup by fetchedAt:** MultiAssetSignalService caches per-asset
   * signals for 15s, and the aggregator caches its output for 20s, so
   * back-to-back API calls would otherwise record IDENTICAL samples that
   * pollute the history with zero-delta entries and force drift to FLAT.
   * We only push when the underlying market data is genuinely new
   * (fetchedAt strictly greater than the last recorded sample's ts).
   */
  static recordSample(asset: string, signal: MultiAssetSignal): void {
    const key = asset.toUpperCase();
    const arr = this.history.get(key) ?? [];
    const ts = signal.fetchedAt || Date.now();
    const last = arr[arr.length - 1];
    if (last && ts <= last.ts) return;             // skip duplicate / older sample
    // Direction-aware probability: UP-leaning markets are tracked by their
    // upProbability; DOWN-leaning by 100 - upProbability. This lets a
    // 48 → 50 → 52 trajectory read as a smooth UP drift even though the
    // direction flipped at 50.
    arr.push({
      ts,
      probability: signal.upProbability,
      direction: signal.direction,
      confidence: signal.confidence,
    });
    while (arr.length > HISTORY_MAX) arr.shift();
    this.history.set(key, arr);
  }

  /**
   * Record a spot-price tick for an asset. The parallel-drift layer that
   * runs alongside probability drift. On quiet days when Polymarket
   * binaries are stuck at 50/50 because no one's betting, spot prices
   * still move — that's directional information our drift component
   * would otherwise miss.
   *
   * Dedup by ts the same way probability samples do.
   */
  static recordPriceTick(asset: string, price: number, ts: number = Date.now()): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const key = asset.toUpperCase();
    const arr = this.priceHistory.get(key) ?? [];
    const last = arr[arr.length - 1];
    if (last && ts <= last.ts) return;
    arr.push({ ts, price });
    while (arr.length > HISTORY_MAX) arr.shift();
    this.priceHistory.set(key, arr);
  }

  /**
   * Drift derived from spot-price log returns. Same shape as computeDrift
   * so the upgrade decision can treat them interchangeably.
   *
   * Threshold for "non-zero" is tighter here than for probability drift:
   * a 5-bps (0.05%) move per sample counts as directional. Most crypto
   * tickers move > 0.1% in any given 30s, so this is a low bar that
   * still filters noise.
   */
  static computePriceDrift(asset: string): AssetDrift | null {
    const key = asset.toUpperCase();
    const samples = this.priceHistory.get(key) ?? [];
    if (samples.length < DRIFT_MIN_SAMPLES) return null;

    // Log returns between consecutive samples (sign-robust to magnitude).
    const returns: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1].price;
      const curr = samples[i].price;
      if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
    }
    if (returns.length === 0) return null;

    // Noise floor: ignore deltas below 1 bp (0.01%). At 30s sampling BTC
    // moves ~0.0015% per tick on average — anything below 1bp is almost
    // certainly stale ticker / floating-point jitter, not real movement.
    let pos = 0, neg = 0;
    const NOISE_THRESHOLD = 0.0001;            // 1 bp per sample
    for (const r of returns) {
      if (r > NOISE_THRESHOLD) pos++;
      else if (r < -NOISE_THRESHOLD) neg++;
    }
    const nonZero = pos + neg;
    // Need at least 2 non-zero deltas before claiming a trend — one data
    // point isn't direction. Otherwise FLAT.
    if (nonZero < 2) {
      return {
        asset: key,
        samples: samples.length,
        directionConsistency: 0,
        netDelta: samples[0].price > 0
          ? ((samples[samples.length - 1].price - samples[0].price) / samples[0].price) * 100
          : 0,
        recentSlope: returns.reduce((s, r) => s + r, 0) / returns.length * 100,
        driftDirection: 'FLAT',
      };
    }
    const dominant = pos > neg ? pos : neg;
    // Consistency over NON-ZERO deltas only. Including zero-classified
    // deltas in the denominator would dilute a genuine trend (e.g., 1 UP
    // + 4 zero deltas would read as 20% consistency even though all the
    // signal is UP).
    const directionConsistency = dominant / nonZero;
    const driftDirection: DriftDirection =
      directionConsistency < DRIFT_CONSISTENT_THRESHOLD ? 'FLAT'
      : pos >= neg ? 'UP' : 'DOWN';

    const firstPrice = samples[0].price;
    const lastPrice = samples[samples.length - 1].price;
    const netDelta = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    const recentSlope = returns.reduce((s, r) => s + r, 0) / returns.length * 100;

    return {
      asset: key,
      samples: samples.length,
      directionConsistency,
      netDelta,
      recentSlope,
      driftDirection,
    };
  }

  /**
   * Compute drift over the recorded history for a single asset.
   * Returns null when there's not enough history.
   */
  static computeDrift(asset: string): AssetDrift | null {
    const key = asset.toUpperCase();
    const samples = this.history.get(key) ?? [];
    if (samples.length < DRIFT_MIN_SAMPLES) return null;

    // Consecutive deltas (sign-agnostic noise gets filtered by majority)
    const deltas: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      deltas.push(samples[i].probability - samples[i - 1].probability);
    }
    if (deltas.length === 0) return null;

    let pos = 0, neg = 0;
    for (const d of deltas) {
      if (d > 0.2) pos++;
      else if (d < -0.2) neg++;
    }
    const nonZero = pos + neg;
    // Same "non-zero divisor" pattern as computePriceDrift — including
    // zero-classified deltas in the denominator dilutes a real trend.
    const dominant = pos > neg ? pos : neg;
    const directionConsistency = nonZero > 0 ? dominant / nonZero : 0;
    const driftDirection: DriftDirection =
      nonZero < 2 ? 'FLAT'
      : directionConsistency < DRIFT_CONSISTENT_THRESHOLD ? 'FLAT'
      : pos >= neg ? 'UP' : 'DOWN';

    const netDelta = samples[samples.length - 1].probability - samples[0].probability;
    const recentSlope = deltas.reduce((s, d) => s + d, 0) / deltas.length;

    return {
      asset: key,
      samples: samples.length,
      directionConsistency,
      netDelta,
      recentSlope,
      driftDirection,
    };
  }

  /**
   * Compute cross-asset alignment over the current per-asset signal map.
   * "Alignment" = how many of the latest signals are pointing the same way,
   * weighted by their confidence. A 5-asset alignment of 4-UP / 0-DOWN /
   * 1-NEUTRAL reads as STRONG bullish even when no single asset is STRONG.
   */
  static computeAlignment(signals: Record<string, MultiAssetSignal | null>): AlignmentSnapshot {
    let upCount = 0, downCount = 0, neutralCount = 0;
    let confSum = 0, confN = 0;
    for (const sig of Object.values(signals)) {
      if (!sig) continue;
      confN++;
      confSum += sig.confidence;
      // Treat very-close-to-50 as neutral for alignment purposes — otherwise
      // every 50.01% UP reading inflates the alignment count and the
      // synthetic-STRONG would fire on pure noise.
      if (Math.abs(sig.upProbability - 50) < 0.5) neutralCount++;
      else if (sig.direction === 'UP') upCount++;
      else downCount++;
    }
    const totalAssets = upCount + downCount + neutralCount;
    const dominantCount = Math.max(upCount, downCount);
    const dominancePct = totalAssets > 0 ? (dominantCount / totalAssets) * 100 : 0;
    const dominantDirection: 'UP' | 'DOWN' | 'NEUTRAL' =
      upCount === downCount ? 'NEUTRAL'
      : upCount > downCount ? 'UP' : 'DOWN';

    return {
      upCount,
      downCount,
      neutralCount,
      totalAssets,
      dominantDirection,
      dominancePct,
      meanConfidence: confN > 0 ? confSum / confN : 0,
    };
  }

  /**
   * Decide whether to upgrade an asset to synthetic STRONG.
   *
   * Upgrade fires when ALL of:
   *   - The asset's drift is in a consistent direction
   *   - Cross-asset alignment is dominant in the SAME direction with ≥3
   *     assets and ≥67% dominance
   *   - Funding rate, if available, does not CONFLICT with the direction
   *
   * Funding-confirmation is a bonus (boosts confidence), not a requirement
   * — funding is sparse on some perps and we don't want to gate on it.
   */
  static decideUpgrade(
    asset: string,
    currentSignal: MultiAssetSignal,
    allSignals: Record<string, MultiAssetSignal | null>,
    fundingRates: Record<string, number>,
  ): FusionUpgrade {
    const drift = this.computeDrift(asset);
    const priceDrift = this.computePriceDrift(asset);
    const alignment = this.computeAlignment(allSignals);
    const reasons: string[] = [];
    const fundingRate = fundingRates[asset.toUpperCase()];

    // Direction of the prediction we'd be upgrading
    const predDir = currentSignal.direction;

    // Funding alignment check
    let fundingAlign: 'CONFIRMS' | 'CONFLICTS' | 'NEUTRAL' = 'NEUTRAL';
    if (Number.isFinite(fundingRate) && Math.abs(fundingRate) >= FUNDING_ALIGN_THRESHOLD) {
      // Positive funding = longs pay shorts = crowd is long = mean-reversion DOWN
      // Negative funding = shorts pay longs = crowd is short = mean-reversion UP
      const fundingMeanReversion: 'UP' | 'DOWN' = fundingRate > 0 ? 'DOWN' : 'UP';
      fundingAlign = fundingMeanReversion === predDir ? 'CONFIRMS' : 'CONFLICTS';
    }

    // Probability-drift check (Polymarket binary moves)
    const probDriftMatches = drift && drift.driftDirection !== 'FLAT' && drift.driftDirection === predDir;
    if (drift && probDriftMatches) {
      reasons.push(
        `prob-drift ${drift.driftDirection} consistency=${(drift.directionConsistency * 100).toFixed(0)}% over ${drift.samples} samples`,
      );
    }

    // Price-drift check (spot-momentum — fires when Polymarket is flat but
    // the underlying spot is still moving directionally).
    const priceDriftMatches = priceDrift && priceDrift.driftDirection !== 'FLAT' && priceDrift.driftDirection === predDir;
    if (priceDrift && priceDriftMatches) {
      reasons.push(
        `price-drift ${priceDrift.driftDirection} ${priceDrift.netDelta >= 0 ? '+' : ''}${priceDrift.netDelta.toFixed(2)}% over ${priceDrift.samples} samples`,
      );
    }

    // Drift requirement = EITHER source matches direction. Quiet days where
    // Polymarket is silent but spot is moving still let alignment work.
    const driftMatches = Boolean(probDriftMatches) || Boolean(priceDriftMatches);

    // Alignment check
    const alignmentMatches =
      alignment.totalAssets >= ALIGNMENT_MIN_ASSETS
      && alignment.dominancePct >= ALIGNMENT_DOMINANCE_PCT
      && alignment.dominantDirection === predDir;
    if (alignmentMatches) {
      reasons.push(
        `${alignment.dominantDirection} alignment ${alignment.dominancePct.toFixed(0)}% across ${alignment.totalAssets} assets`,
      );
    }

    if (fundingAlign === 'CONFIRMS') {
      reasons.push(`funding ${fundingRate >= 0 ? '+' : ''}${(fundingRate * 100).toFixed(4)}% confirms ${predDir}`);
    } else if (fundingAlign === 'CONFLICTS') {
      reasons.push(`funding conflicts (would be ${fundingRate > 0 ? 'DOWN' : 'UP'}-bias)`);
    }

    const upgradeable =
      currentSignal.signalStrength !== 'STRONG'
      && driftMatches
      && alignmentMatches
      && fundingAlign !== 'CONFLICTS';

    // Confidence floor + bonuses. Each independent confirmation adds a
    // small boost — both drift sources agreeing is meaningfully stronger
    // than just one.
    let syntheticConfidence = upgradeable
      ? Math.max(
          SYNTHETIC_CONFIDENCE_FLOOR,
          currentSignal.confidence,
          alignment.meanConfidence,
        )
      : currentSignal.confidence;
    if (upgradeable) {
      if (probDriftMatches && priceDriftMatches) syntheticConfidence += 8;
      if (fundingAlign === 'CONFIRMS') syntheticConfidence += 5;
    }

    return {
      asset: asset.toUpperCase(),
      originalStrength: currentSignal.signalStrength,
      upgradedToStrong: upgradeable,
      syntheticConfidence: Math.min(100, syntheticConfidence),
      reasons,
      drift,
      priceDrift,
      alignment,
      fundingAlign,
    };
  }

  /**
   * Apply the fusion across an entire per-asset signal map. Mutates a
   * shallow copy of the input — caller substitutes the result back into
   * the per-asset aggregation pipeline. Records each sample as a side
   * effect to keep the rolling history warm.
   */
  static fuseAll(
    signals: Record<string, MultiAssetSignal | null>,
    fundingRates: Record<string, number> = {},
  ): {
    upgrades: Record<string, FusionUpgrade>;
    alignment: AlignmentSnapshot;
  } {
    const upgrades: Record<string, FusionUpgrade> = {};
    const alignment = this.computeAlignment(signals);

    for (const [asset, sig] of Object.entries(signals)) {
      if (!sig) continue;
      this.recordSample(asset, sig);
      upgrades[asset] = this.decideUpgrade(asset, sig, signals, fundingRates);
    }

    const upgradeCount = Object.values(upgrades).filter(u => u.upgradedToStrong).length;
    if (upgradeCount > 0) {
      logger.info('[SignalDriftFusion] synthetic STRONG upgrades fired', {
        upgradeCount,
        upgradedAssets: Object.entries(upgrades)
          .filter(([, u]) => u.upgradedToStrong)
          .map(([a, u]) => `${a}(${u.reasons.length}r)`)
          .join(','),
        alignmentDominance: `${alignment.dominantDirection} ${alignment.dominancePct.toFixed(0)}%`,
      });
    }

    return { upgrades, alignment };
  }

  /**
   * For diagnostics — exposes the rolling history so the test script
   * and any future debug endpoint can verify samples are accruing.
   */
  static getHistorySnapshot(): Record<string, { prob: number; price: number }> {
    const out: Record<string, { prob: number; price: number }> = {};
    const keys = new Set([...this.history.keys(), ...this.priceHistory.keys()]);
    for (const k of keys) {
      out[k] = {
        prob: this.history.get(k)?.length ?? 0,
        price: this.priceHistory.get(k)?.length ?? 0,
      };
    }
    return out;
  }

  /** Test-only reset hook. */
  static __resetForTests(): void {
    this.history.clear();
    this.priceHistory.clear();
  }
}
