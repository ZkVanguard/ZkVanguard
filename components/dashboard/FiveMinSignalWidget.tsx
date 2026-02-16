'use client';

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { 
  TrendingUp, TrendingDown, Clock, Zap, Activity, 
  AlertTriangle, ChevronDown, ChevronUp, Shield
} from 'lucide-react';
import type { FiveMinBTCSignal, FiveMinSignalHistory } from '@/lib/services/Polymarket5MinService';

interface FiveMinSignalWidgetProps {
  onQuickHedge?: (direction: 'LONG' | 'SHORT') => void;
}

function FiveMinSignalWidgetInner({ onQuickHedge }: FiveMinSignalWidgetProps) {
  const [signal, setSignal] = useState<FiveMinBTCSignal | null>(null);
  const [history, setHistory] = useState<FiveMinSignalHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [countdown, setCountdown] = useState<number>(0);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const windowEndRef = useRef<number>(0);
  const lastMarketIdRef = useRef<string>('');

  const fetchSignal = useCallback(async () => {
    try {
      const { Polymarket5MinService } = await import('@/lib/services/Polymarket5MinService');
      const [latestSignal, signalHistory] = await Promise.all([
        Polymarket5MinService.getLatest5MinSignal(),
        Polymarket5MinService.getSignalHistory(),
      ]);
      
      if (latestSignal) {
        setSignal(latestSignal);
        setLastUpdated(Date.now());
        // Only update the window end time when we get a NEW market (different window)
        // This prevents countdown from jumping back to stale cached timeRemainingSeconds
        if (latestSignal.marketId !== lastMarketIdRef.current) {
          windowEndRef.current = latestSignal.windowEndTime || (Date.now() + latestSignal.timeRemainingSeconds * 1000);
          lastMarketIdRef.current = latestSignal.marketId;
        }
        setError(null);
      } else {
        setError('No active 5-min market');
      }
      
      if (signalHistory) {
        setHistory(signalHistory);
      }
    } catch {
      setError('Signal unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 15 seconds
  useEffect(() => {
    fetchSignal();
    intervalRef.current = setInterval(fetchSignal, 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchSignal]);

  // Countdown timer: compute from absolute windowEndTime (no dependency on countdown state)
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      if (windowEndRef.current > 0) {
        const remaining = Math.max(0, Math.floor((windowEndRef.current - Date.now()) / 1000));
        setCountdown(remaining);
        // Force immediate re-fetch when window expires to get the next market
        if (remaining === 0 && lastMarketIdRef.current) {
          fetchSignal();
        }
      }
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchSignal]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-[20px] border border-gray-200/60 p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="h-8 bg-gray-200 rounded w-2/3 mb-2" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

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

  const isUp = signal.direction === 'UP';
  const isStrong = signal.signalStrength === 'STRONG';
  const dirColor = isUp ? 'text-emerald-600' : 'text-red-500';
  const dirBg = isUp ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200';
  const strengthBadge = isStrong 
    ? 'bg-amber-100 text-amber-700 border-amber-300' 
    : signal.signalStrength === 'MODERATE' 
      ? 'bg-blue-100 text-blue-700 border-blue-300' 
      : 'bg-gray-100 text-gray-500 border-gray-300';

  // Normalize probabilities so they always sum to exactly 100%
  const rawUp = Math.round(signal.upProbability);
  const rawDown = Math.round(signal.downProbability);
  const total = rawUp + rawDown;
  const displayUp = total !== 100 ? Math.round((signal.upProbability / (signal.upProbability + signal.downProbability)) * 100) : rawUp;
  const displayDown = 100 - displayUp;

  // "Updated X s ago" for freshness
  const updatedAgo = lastUpdated > 0 ? Math.floor((Date.now() - lastUpdated) / 1000) : 0;

  return (
    <div className={`bg-white/90 backdrop-blur-xl rounded-[20px] border ${isStrong ? (isUp ? 'border-emerald-300 shadow-emerald-100' : 'border-red-300 shadow-red-100') : 'border-gray-200/60'} shadow-sm transition-all duration-300`}>
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

          {/* Confidence meter */}
          <div className="text-right">
            <div className="text-xs text-gray-500 mb-1">Confidence</div>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-2 h-4 rounded-sm ${
                    i <= Math.ceil(signal.confidence / 20)
                      ? isUp ? 'bg-emerald-500' : 'bg-red-500'
                      : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Probability bar */}
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
          <span>UP {displayUp}%</span>
          <span>DOWN {displayDown}%</span>
        </div>
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

      {/* Expandable details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600 transition-colors border-t border-gray-100"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span className="ml-1">{expanded ? 'Less' : 'Details'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {/* Signal details */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-gray-400 mb-0.5">Volume</div>
              <div className="font-semibold text-gray-700">
                ${signal.volume ? signal.volume.toLocaleString() : 'N/A'}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-gray-400 mb-0.5">Recommendation</div>
              <div className="font-semibold text-gray-700">
                {signal.recommendation === 'WAIT' ? '⏸ Wait' : signal.recommendation === 'HEDGE_SHORT' ? '🔴 Hedge Short' : '🟢 Hedge Long'}
              </div>
            </div>
            {signal.priceToBeat && (
              <div className="bg-gray-50 rounded-lg p-2 col-span-2">
                <div className="text-gray-400 mb-0.5">Price to Beat</div>
                <div className="font-semibold text-gray-700">
                  ${signal.priceToBeat.toLocaleString()}
                </div>
              </div>
            )}
          </div>

          {/* History / Streak */}
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
                  <div className="font-semibold text-gray-700">
                    {history.avgConfidence.toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div className="text-gray-400">Signals</div>
                  <div className="font-semibold text-gray-700">{history.signals.length}</div>
                </div>
              </div>
              {/* Mini signal history visualization */}
              <div className="flex gap-0.5 mt-2">
                {history.signals.slice(-20).map((s, i) => (
                  <div
                    key={i}
                    className={`flex-1 h-3 rounded-sm ${s.direction === 'UP' ? 'bg-emerald-400' : 'bg-red-400'}`}
                    title={`${s.direction} ${s.probability.toFixed(0)}%`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Risk warning */}
          {isStrong && (
            <div className={`flex items-start gap-2 text-[10px] ${isUp ? 'text-emerald-600' : 'text-red-500'} bg-gray-50 rounded-lg p-2`}>
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>
                Strong {signal.direction} signal detected. Agents have auto-weighted this signal 
                3x in risk/hedge calculations.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const FiveMinSignalWidget = memo(FiveMinSignalWidgetInner);
