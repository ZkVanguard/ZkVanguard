'use client';

import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Clock, Zap, Activity,
  AlertTriangle, ChevronDown, ChevronUp, Shield
} from 'lucide-react';
import type { FiveMinBTCSignal, FiveMinSignalHistory } from '@/lib/services/Polymarket5MinService';

// ─── Constants ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000;
const COUNTDOWN_INTERVAL_MS = 1_000;
const CONFIDENCE_BARS = [1, 2, 3, 4, 5] as const;

// ─── Cached module reference ─────────────────────────────────────────
// Avoids re-resolving the dynamic import on every poll cycle.
let serviceModulePromise: Promise<typeof import('@/lib/services/Polymarket5MinService')> | null = null;
function getService() {
  if (!serviceModulePromise) {
    serviceModulePromise = import('@/lib/services/Polymarket5MinService');
  }
  return serviceModulePromise;
}

// ─── Memoized sub-components ─────────────────────────────────────────

/** Static confidence bar — only re-renders when level or color changes */
const ConfidenceMeter = memo(function ConfidenceMeter({
  level, isUp,
}: { level: number; isUp: boolean }) {
  const filledClass = isUp ? 'bg-emerald-500' : 'bg-red-500';
  return (
    <div className="text-right">
      <div className="text-xs text-gray-500 mb-1">Confidence</div>
      <div className="flex gap-0.5">
        {CONFIDENCE_BARS.map(i => (
          <div
            key={i}
            className={`w-2 h-4 rounded-sm ${i <= level ? filledClass : 'bg-gray-200'}`}
          />
        ))}
      </div>
    </div>
  );
});

/** Probability bar — only re-renders when percentages change */
const ProbabilityBar = memo(function ProbabilityBar({
  displayUp, displayDown,
}: { displayUp: number; displayDown: number }) {
  return (
    <>
      <div className="mt-3 relative h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-emerald-500 rounded-full transition-all duration-500"
          style={{ width: `${displayUp}%` }}
        />
        <div
          className="absolute right-0 top-0 h-full bg-red-500 rounded-full transition-all duration-500"
          style={{ width: `${displayDown}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-gray-400">
        <span>UP {displayUp.toFixed(1)}%</span>
        <span>DOWN {displayDown.toFixed(1)}%</span>
      </div>
    </>
  );
});

/** Expandable details panel — conditionally rendered, isolated rendering */
const SignalDetails = memo(function SignalDetails({
  signal, history, isUp, onQuickHedge,
}: {
  signal: FiveMinBTCSignal;
  history: FiveMinSignalHistory | null;
  isUp: boolean;
  onQuickHedge?: (dir: 'LONG' | 'SHORT') => void;
}) {
  const volumeDisplay = useMemo(
    () => signal.volume ? `$${signal.volume.toLocaleString()}` : 'N/A',
    [signal.volume],
  );
  const priceDisplay = useMemo(
    () => signal.priceToBeat ? `$${signal.priceToBeat.toLocaleString()}` : null,
    [signal.priceToBeat],
  );
  const recLabel = signal.recommendation === 'WAIT'
    ? '⏸ Wait'
    : signal.recommendation === 'HEDGE_SHORT' ? '🔴 Hedge Short' : '🟢 Hedge Long';

  // Pre-slice history for mini-viz (avoid slicing on every render frame)
  const historyBars = useMemo(
    () => history?.signals.slice(-20) ?? [],
    [history?.signals],
  );

  return (
    <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 rounded-lg p-2">
          <div className="text-gray-400 mb-0.5">Volume</div>
          <div className="font-semibold text-gray-700">{volumeDisplay}</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-2">
          <div className="text-gray-400 mb-0.5">Recommendation</div>
          <div className="font-semibold text-gray-700">{recLabel}</div>
        </div>
        {priceDisplay && (
          <div className="bg-gray-50 rounded-lg p-2 col-span-2">
            <div className="text-gray-400 mb-0.5">Price to Beat</div>
            <div className="font-semibold text-gray-700">{priceDisplay}</div>
          </div>
        )}
      </div>

      {history && (
        <div className="bg-gray-50 rounded-lg p-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Activity className="w-3 h-3 text-gray-400" />
            <span className="text-xs font-medium text-gray-600">Signal History (30 min)</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-gray-400">Streak</div>
              <div className={`font-semibold ${history.streak.direction === 'UP' ? 'text-emerald-600' : 'text-red-500'}`}>
                {history.streak.count}x {history.streak.direction}
              </div>
            </div>
            <div>
              <div className="text-gray-400">Avg Conf.</div>
              <div className="font-semibold text-gray-700">{history.avgConfidence}%</div>
            </div>
            <div>
              <div className="text-gray-400">Signals</div>
              <div className="font-semibold text-gray-700">{history.signals.length}</div>
            </div>
          </div>
          {historyBars.length > 0 && (
            <div className="flex gap-0.5 mt-2">
              {historyBars.map((s, i) => (
                <div
                  key={i}
                  className={`flex-1 h-3 rounded-sm ${s.direction === 'UP' ? 'bg-emerald-400' : 'bg-red-400'}`}
                  title={`${s.direction} ${s.probability.toFixed(0)}%`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {signal.signalStrength === 'STRONG' && (
        <div className={`flex items-start gap-2 text-[10px] ${isUp ? 'text-emerald-600' : 'text-red-500'} bg-gray-50 rounded-lg p-2`}>
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            Strong {signal.direction} signal detected. Agents have auto-weighted this signal
            3x in risk/hedge calculations.
          </span>
        </div>
      )}
    </div>
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function normalizeProbs(up: number, down: number): [number, number] {
  const sum = up + down;
  if (sum === 0) return [50, 50];
  // Keep 1-decimal precision so small shifts are visible (e.g. 50.5 vs 49.5)
  const nUp = Math.round((up / sum) * 1000) / 10;
  const nDown = Math.round((100 - nUp) * 10) / 10;
  return [nUp, nDown];
}

// ─── Main widget ─────────────────────────────────────────────────────

interface FiveMinSignalWidgetProps {
  onQuickHedge?: (direction: 'LONG' | 'SHORT') => void;
}

function FiveMinSignalWidgetInner({ onQuickHedge }: FiveMinSignalWidgetProps) {
  const [signal, setSignal] = useState<FiveMinBTCSignal | null>(null);
  const [history, setHistory] = useState<FiveMinSignalHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(0);

  // Refs for stable interval control & request dedup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const windowEndRef = useRef(0);
  const lastMarketIdRef = useRef('');
  const fetchingRef = useRef(false);    // dedup guard
  const mountedRef = useRef(true);      // unmount guard

  const fetchSignal = useCallback(async () => {
    // Guard: skip if another fetch is in-flight (dedup at widget level)
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const mod = await getService();
      const [latestSignal, signalHistory] = await Promise.all([
        mod.Polymarket5MinService.getLatest5MinSignal(),
        mod.Polymarket5MinService.getSignalHistory(),
      ]);

      // Bail if unmounted during async gap
      if (!mountedRef.current) return;

      if (latestSignal) {
        setSignal(latestSignal);
        setLastUpdated(Date.now());
        if (latestSignal.marketId !== lastMarketIdRef.current) {
          windowEndRef.current = latestSignal.windowEndTime
            || (Date.now() + latestSignal.timeRemainingSeconds * 1000);
          lastMarketIdRef.current = latestSignal.marketId;
        }
        setError(null);
      } else {
        setError('No active 5-min market');
      }
      if (signalHistory) setHistory(signalHistory);
    } catch {
      if (mountedRef.current) setError('Signal unavailable');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  // ── Lifecycle: poll + countdown ─────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    fetchSignal();
    intervalRef.current = setInterval(fetchSignal, POLL_INTERVAL_MS);

    countdownRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      if (windowEndRef.current > 0) {
        const remaining = Math.max(0, Math.floor((windowEndRef.current - Date.now()) / 1000));
        setCountdown(remaining);
        if (remaining === 0 && lastMarketIdRef.current) {
          fetchSignal();
        }
      }
    }, COUNTDOWN_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchSignal]);

  // ── Memoised derived values ─────────────────────────────
  const [displayUp, displayDown] = useMemo(
    () => signal ? normalizeProbs(signal.upProbability, signal.downProbability) : [50, 50],
    [signal?.upProbability, signal?.downProbability],
  );

  const confidenceLevel = useMemo(
    () => signal ? Math.ceil(signal.confidence / 20) : 0,
    [signal?.confidence],
  );

  const isUp = signal?.direction === 'UP';
  const isStrong = signal?.signalStrength === 'STRONG';

  const containerBorder = useMemo(() => {
    if (!isStrong) return 'border-gray-200/60';
    return isUp ? 'border-emerald-300 shadow-emerald-100' : 'border-red-300 shadow-red-100';
  }, [isStrong, isUp]);

  const dirColor = isUp ? 'text-emerald-600' : 'text-red-500';
  const dirBg = isUp ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200';
  const strengthBadge = isStrong
    ? 'bg-amber-100 text-amber-700 border-amber-300'
    : signal?.signalStrength === 'MODERATE'
      ? 'bg-blue-100 text-blue-700 border-blue-300'
      : 'bg-gray-100 text-gray-500 border-gray-300';

  const updatedAgo = lastUpdated > 0 ? Math.floor((Date.now() - lastUpdated) / 1000) : 0;

  // ── Render: loading skeleton ───────────────────────────
  if (loading) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-[20px] border border-gray-200/60 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="h-8 bg-gray-200 rounded w-2/3 mb-2" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  // ── Render: error / empty ──────────────────────────────
  if (error || !signal) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-[20px] border border-gray-200/60 p-4">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Activity className="w-4 h-4" />
          <span>5-Min BTC Signal</span>
          <span className="ml-auto text-xs text-gray-400">{error || 'Waiting...'}</span>
        </div>
      </div>
    );
  }

  // ── Render: main widget ────────────────────────────────
  return (
    <div className={`bg-white/90 backdrop-blur-xl rounded-[20px] border ${containerBorder} shadow-sm transition-all duration-300`}>
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              5-Min BTC Signal
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${strengthBadge}`}>
              {signal.signalStrength}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            {updatedAgo > 0 && (
              <span className="text-[9px] text-gray-400 mr-1">{updatedAgo}s ago</span>
            )}
            <Clock className="w-3 h-3" />
            <span className={countdown < 60 ? 'text-red-500 font-semibold animate-pulse' : ''}>
              {formatTime(countdown)}
            </span>
          </div>
        </div>

        {/* Main signal */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${dirBg}`}>
              {isUp ? (
                <TrendingUp className={`w-5 h-5 ${dirColor}`} />
              ) : (
                <TrendingDown className={`w-5 h-5 ${dirColor}`} />
              )}
            </div>
            <div>
              <div className={`text-lg font-bold ${dirColor}`}>
                BTC {signal.direction}
              </div>
              <div className="text-xs text-gray-500">
                {signal.probability.toFixed(1)}% probability
              </div>
            </div>
          </div>

          <ConfidenceMeter level={confidenceLevel} isUp={isUp} />
        </div>

        <ProbabilityBar displayUp={displayUp} displayDown={displayDown} />
      </div>

      {/* Quick Hedge Action */}
      {isStrong && onQuickHedge && (
        <div className="px-4 pb-2">
          <button
            onClick={() => onQuickHedge(isUp ? 'LONG' : 'SHORT')}
            className={`w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              isUp
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            <Shield className="w-3 h-3" />
            Quick {isUp ? 'Long' : 'Short'} Hedge
          </button>
        </div>
      )}

      {/* Expandable toggle */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full px-4 py-2 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600 transition-colors border-t border-gray-100"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span className="ml-1">{expanded ? 'Less' : 'Details'}</span>
      </button>

      {/* Expanded details (memoised sub-component) */}
      {expanded && (
        <SignalDetails
          signal={signal}
          history={history}
          isUp={isUp}
          onQuickHedge={onQuickHedge}
        />
      )}
    </div>
  );
}

export const FiveMinSignalWidget = memo(FiveMinSignalWidgetInner);
