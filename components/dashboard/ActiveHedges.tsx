'use client';

import { useState, useCallback, memo, useMemo, useRef } from 'react';
import { Shield, TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, ExternalLink, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getMarketDataService } from '../../lib/services/RealMarketDataService';
import { usePolling, useToggle } from '@/lib/hooks';
import { cache } from '@/lib/utils/cache';

interface HedgePosition {
  id: string;
  type: 'SHORT' | 'LONG';
  asset: string;
  size: number;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  capitalUsed: number;
  pnl: number;
  pnlPercent: number;
  status: 'active' | 'closed' | 'triggered';
  openedAt: Date;
  closedAt?: Date;
  reason: string;
}

interface PerformanceStats {
  totalHedges: number;
  activeHedges: number;
  winRate: number;
  totalPnL: number;
  avgHoldTime: string;
  bestTrade: number;
  worstTrade: number;
}

interface ActiveHedgesProps {
  address?: string;
  compact?: boolean;
}

export const ActiveHedges = memo(function ActiveHedges({ address, compact = false }: ActiveHedgesProps) {
  const [hedges, setHedges] = useState<HedgePosition[]>([]);
  const [stats, setStats] = useState<PerformanceStats>({
    totalHedges: 0,
    activeHedges: 0,
    winRate: 0,
    totalPnL: 0,
    avgHoldTime: '0h',
    bestTrade: 0,
    worstTrade: 0,
  });
  const [loading, setLoading] = useState(true);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [showCloseConfirm, _toggleCloseConfirm, openCloseConfirm, closeCloseConfirm] = useToggle(false);
  const [selectedHedge, setSelectedHedge] = useState<HedgePosition | null>(null);
  const [showClosedPositions, toggleClosedPositions] = useToggle(false);
  const processingRef = useRef(false);
  const lastProcessedRef = useRef<string>('');

  const activeHedges = useMemo(() => hedges.filter(h => h.status === 'active'), [hedges]);
  const closedHedges = useMemo(() => hedges.filter(h => h.status === 'closed'), [hedges]);

  const loadHedges = useCallback(async () => {
    if (processingRef.current) return;

    try {
      processingRef.current = true;
      const settlements = localStorage.getItem('settlement_history');
      
      if (!settlements) {
        setHedges([]);
        setLoading(false);
        return;
      }

      const dataHash = settlements.substring(0, 100);
      if (dataHash === lastProcessedRef.current) {
        setLoading(false);
        return;
      }
      lastProcessedRef.current = dataHash;

      const cacheKey = `active-hedges-${dataHash}`;
      const cached = cache.get<HedgePosition[]>(cacheKey);
      if (cached) {
        setHedges(cached);
        setLoading(false);
        return;
      }

      const settlementData = JSON.parse(settlements);
      const hedgePositions: HedgePosition[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const batch of Object.values(settlementData) as any[]) {
        if (batch.type === 'hedge' && batch.managerSignature) {
          const hedgeData = batch.hedgeDetails || {};
          const isClosed = batch.status === 'closed';
          
          let currentPrice: number;
          let pnl: number;
          let pnlPercent: number;
          
          if (isClosed) {
            currentPrice = hedgeData.entryPrice || 43500;
            pnl = batch.finalPnL || 0;
            pnlPercent = batch.finalPnLPercent || 0;
          } else {
            try {
              const marketData = getMarketDataService();
              const assetSymbol = hedgeData.asset?.replace('-PERP', '') || 'BTC';
              const priceData = await marketData.getTokenPrice(assetSymbol);
              currentPrice = priceData.price;
            } catch {
              currentPrice = hedgeData.entryPrice;
            }
            pnl = hedgeData.type === 'SHORT' 
              ? (hedgeData.entryPrice - currentPrice) * hedgeData.size * hedgeData.leverage
              : (currentPrice - hedgeData.entryPrice) * hedgeData.size * hedgeData.leverage;
            pnlPercent = (pnl / hedgeData.capitalUsed) * 100;
          }

          hedgePositions.push({
            id: batch.batchId,
            type: hedgeData.type || 'SHORT',
            asset: hedgeData.asset || 'BTC-PERP',
            size: hedgeData.size || 0.007,
            leverage: hedgeData.leverage || 10,
            entryPrice: hedgeData.entryPrice || 43500,
            currentPrice,
            targetPrice: hedgeData.targetPrice || 42800,
            stopLoss: hedgeData.stopLoss || 45200,
            capitalUsed: hedgeData.capitalUsed || 15,
            pnl,
            pnlPercent,
            status: isClosed ? 'closed' : 'active',
            openedAt: new Date(batch.timestamp),
            closedAt: isClosed ? new Date(batch.closedAt) : undefined,
            reason: hedgeData.reason || 'Portfolio protection',
          });
        }
      }

      cache.set(cacheKey, hedgePositions);

      const activeCount = hedgePositions.filter(h => h.status === 'active').length;
      const closedHedgesList = hedgePositions.filter(h => h.status === 'closed');
      const winners = closedHedgesList.filter(h => h.pnl > 0).length;
      const winRate = closedHedgesList.length > 0 ? (winners / closedHedgesList.length) * 100 : 0;
      const totalPnL = hedgePositions.reduce((sum, h) => sum + h.pnl, 0);
      const bestTrade = Math.max(...hedgePositions.map(h => h.pnl), 0);
      const worstTrade = Math.min(...hedgePositions.map(h => h.pnl), 0);

      setHedges(hedgePositions.reverse());
      setStats({
        totalHedges: hedgePositions.length,
        activeHedges: activeCount,
        winRate,
        totalPnL,
        avgHoldTime: '2h 15m',
        bestTrade,
        worstTrade,
      });
      setLoading(false);
    } catch (error) {
      console.error('❌ [ActiveHedges] Error loading hedges:', error);
      setLoading(false);
    } finally {
      processingRef.current = false;
    }
  }, []);

  usePolling(loadHedges, 30000);

  const handleClosePosition = async (hedge: HedgePosition) => {
    setSelectedHedge(hedge);
    openCloseConfirm();
  };

  const confirmClosePosition = async () => {
    if (!selectedHedge) return;
    
    setClosingPosition(selectedHedge.id);
    closeCloseConfirm();
    
    try {
      const settlements = localStorage.getItem('settlement_history');
      if (settlements) {
        const settlementData = JSON.parse(settlements);
        if (settlementData[selectedHedge.id]) {
          settlementData[selectedHedge.id].status = 'closed';
          settlementData[selectedHedge.id].closedAt = Date.now();
          settlementData[selectedHedge.id].finalPnL = selectedHedge.pnl;
          settlementData[selectedHedge.id].finalPnLPercent = selectedHedge.pnlPercent;
          
          localStorage.setItem('settlement_history', JSON.stringify(settlementData));
          window.dispatchEvent(new Event('hedgeAdded'));
          
          setHedges(prev => prev.map(h => 
            h.id === selectedHedge.id 
              ? { ...h, status: 'closed' as const, closedAt: new Date() }
              : h
          ));
        }
      }
    } catch (error) {
      console.error('Failed to close position:', error);
      alert('Failed to close position. Please try again.');
    } finally {
      setClosingPosition(null);
      setSelectedHedge(null);
    }
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="space-y-2 sm:space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 sm:h-32 animate-pulse bg-[#f5f5f7] rounded-[12px] sm:rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 pb-4 sm:pb-6">
      {/* No Hedges State - Compact for Overview */}
      {hedges.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-[#f5f5f7] rounded-[14px] sm:rounded-[16px] flex items-center justify-center mb-3 sm:mb-4">
            <Shield className="w-6 h-6 sm:w-7 sm:h-7 text-[#007AFF]" strokeWidth={2} />
          </div>
          <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-1.5 sm:mb-2 tracking-[-0.01em]">
            No Active Hedges
          </h3>
          <p className="text-[13px] sm:text-[14px] text-[#86868b] leading-[1.4] max-w-[240px] mb-3 sm:mb-4">
            Execute hedge recommendations from AI agents to protect your portfolio
          </p>
          <div className="flex items-center gap-2 text-[12px] sm:text-[13px] text-[#86868b]">
            <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-[#f5f5f7] rounded-full">
              <span>💬</span>
              <span className="font-medium text-[#1d1d1f]">Chat with AI</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-[#34C759]/10 rounded-full">
              <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#34C759]" />
              <span className="font-medium text-[#34C759]">Auto-protect</span>
            </span>
          </div>
        </div>
      ) : compact ? (
        /* Compact view for Overview - just show summary */
        <div>
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-[11px] font-bold text-[#34C759] uppercase tracking-[0.04em] px-1.5 sm:px-2 py-0.5 sm:py-1 bg-[#34C759]/10 rounded-full">
                {stats.activeHedges} Active
              </span>
            </div>
            <div className={`text-[17px] sm:text-[20px] font-bold ${stats.totalPnL >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
              {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(2)} USDC
            </div>
          </div>
          
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-2 mb-3 sm:mb-4">
            <div className="p-2 sm:p-3 bg-[#f5f5f7] rounded-[10px] sm:rounded-[12px]">
              <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5 sm:mb-1">Win Rate</div>
              <div className="text-[17px] sm:text-[20px] font-bold text-[#34C759] leading-none">{stats.winRate.toFixed(0)}%</div>
            </div>
            <div className="p-2 sm:p-3 bg-[#f5f5f7] rounded-[10px] sm:rounded-[12px]">
              <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5 sm:mb-1">Total P/L</div>
              <div className={`text-[17px] sm:text-[20px] font-bold leading-none ${stats.totalPnL >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(0)}
              </div>
            </div>
          </div>

          {/* Active positions preview */}
          <div className="space-y-2">
            {activeHedges.slice(0, 2).map((hedge) => (
              <div key={hedge.id} className="flex items-center justify-between p-2 sm:p-3 bg-[#f5f5f7] rounded-[10px] sm:rounded-[12px]">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-[8px] sm:rounded-[10px] flex items-center justify-center ${
                    hedge.type === 'SHORT' ? 'bg-[#FF3B30]/10' : 'bg-[#34C759]/10'
                  }`}>
                    {hedge.type === 'SHORT' ? (
                      <TrendingDown className="w-4 h-4 text-[#FF3B30]" strokeWidth={2.5} />
                    ) : (
                      <TrendingUp className="w-4 h-4 text-[#34C759]" strokeWidth={2.5} />
                    )}
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-[#1d1d1f]">{hedge.type} {hedge.asset}</div>
                    <div className="text-[11px] text-[#86868b]">{hedge.reason}</div>
                  </div>
                </div>
                <div className={`text-[15px] font-bold ${hedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                  {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)}
                </div>
              </div>
            ))}
            {activeHedges.length > 2 && (
              <div className="text-center text-[13px] text-[#86868b] pt-1">
                +{activeHedges.length - 2} more positions
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {/* Performance Overview Card */}
          {stats.totalHedges > 0 && (
            <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/5 p-3 sm:p-5">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="text-[9px] sm:text-[11px] font-semibold text-[#34C759] uppercase tracking-[0.06em] px-2 sm:px-2.5 py-0.5 sm:py-1 bg-[#34C759]/10 rounded-full">
                    {stats.activeHedges} Active
                  </span>
                  <span className="text-[11px] sm:text-[13px] text-[#86868b]">
                    of {stats.totalHedges} total
                  </span>
                </div>
                <div className={`text-[18px] sm:text-[24px] font-bold leading-none ${stats.totalPnL >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                  {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(2)} USDC
                </div>
              </div>

              {/* Compact Stats Grid */}
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                <div className="p-2 sm:p-3 bg-[#34C759]/10 rounded-[10px] sm:rounded-[12px]">
                  <div className="text-[8px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5 sm:mb-1">Win Rate</div>
                  <div className="text-[14px] sm:text-[20px] font-bold text-[#34C759] leading-none">{stats.winRate.toFixed(0)}%</div>
                </div>
                <div className="p-2 sm:p-3 bg-[#f5f5f7] rounded-[10px] sm:rounded-[12px]">
                  <div className="text-[8px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5 sm:mb-1">Total</div>
                  <div className="text-[14px] sm:text-[20px] font-bold text-[#1d1d1f] leading-none">{stats.totalHedges}</div>
                </div>
                <div className="p-2 sm:p-3 bg-[#34C759]/10 rounded-[10px] sm:rounded-[12px]">
                  <div className="text-[8px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5 sm:mb-1">Best</div>
                  <div className="text-[12px] sm:text-[17px] font-bold text-[#34C759] leading-none">+{stats.bestTrade.toFixed(0)}</div>
                </div>
                <div className="p-2 sm:p-3 bg-[#007AFF]/10 rounded-[10px] sm:rounded-[12px]">
                  <div className="text-[8px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5 sm:mb-1">Avg</div>
                  <div className="text-[12px] sm:text-[17px] font-bold text-[#007AFF] leading-none">{stats.avgHoldTime}</div>
                </div>
              </div>
            </div>
          )}

          {/* Active Positions - Preview or Full View */}
          {activeHedges.length > 0 && (
            <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/5 p-3 sm:p-5">
              {!showClosedPositions ? (
                /* Compact Preview - Horizontal Scroll (Apple Music style) */
                <div>
                  <h3 className="text-[13px] sm:text-[15px] font-semibold text-[#1d1d1f] mb-2 sm:mb-3 tracking-[-0.01em]">
                    Active Positions
                  </h3>
                  <div className="flex gap-2 sm:gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-3 sm:-mx-5 px-3 sm:px-5">
                    {activeHedges.slice(0, 5).map((hedge) => (
                      <div
                        key={hedge.id}
                        className="flex-shrink-0 w-[240px] sm:w-[280px] p-3 sm:p-4 bg-[#f5f5f7] rounded-[12px] sm:rounded-[14px] border border-[#e8e8ed]"
                      >
                        <div className="flex items-center gap-2 mb-2 sm:mb-3">
                          <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-[8px] sm:rounded-[10px] flex items-center justify-center ${
                            hedge.type === 'SHORT' ? 'bg-[#FF3B30]/10' : 'bg-[#34C759]/10'
                          }`}>
                            {hedge.type === 'SHORT' ? (
                              <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FF3B30]" strokeWidth={2.5} />
                            ) : (
                              <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#34C759]" strokeWidth={2.5} />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] sm:text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em] truncate">
                              {hedge.type} {hedge.asset}
                            </div>
                            <div className="text-[9px] sm:text-[11px] text-[#86868b] truncate">{hedge.reason}</div>
                          </div>
                        </div>
                        
                        <div className="text-right mb-2 sm:mb-3">
                          <div className={`text-[18px] sm:text-[22px] font-bold leading-none mb-0.5 sm:mb-1 ${
                            hedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'
                          }`}>
                            {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)}
                          </div>
                          <div className={`text-[11px] sm:text-[13px] font-medium ${
                            hedge.pnlPercent >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'
                          }`}>
                            {hedge.pnlPercent >= 0 ? '+' : ''}{hedge.pnlPercent.toFixed(1)}%
                          </div>
                        </div>

                        <div className="pt-2 sm:pt-3 border-t border-[#e8e8ed] space-y-1.5 sm:space-y-2">
                          <div className="flex justify-between text-[10px] sm:text-[11px]">
                            <span className="text-[#86868b]">Entry</span>
                            <span className="text-[#1d1d1f] font-medium">${hedge.entryPrice.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-[10px] sm:text-[11px]">
                            <span className="text-[#86868b]">Current</span>
                            <span className="text-[#1d1d1f] font-medium">${hedge.currentPrice.toFixed(0)}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleClosePosition(hedge)}
                          disabled={closingPosition === hedge.id}
                          className="w-full mt-2 sm:mt-3 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 text-[#FF3B30] rounded-[8px] sm:rounded-[10px] text-[11px] sm:text-[13px] font-semibold transition-colors disabled:opacity-50 active:scale-[0.98]"
                        >
                          {closingPosition === hedge.id ? 'Closing...' : 'Close'}
                        </button>
                      </div>
                    ))}
                  </div>
                  {activeHedges.length > 5 && (
                    <div className="mt-2 sm:mt-3 text-center">
                      <button
                        onClick={toggleClosedPositions}
                        className="text-[11px] sm:text-[13px] font-medium text-[#007AFF] hover:text-[#0051D5] transition-colors"
                      >
                        +{activeHedges.length - 5} more positions
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Full View - All Active Positions */
                <div className="space-y-3">
                  <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-3 tracking-[-0.01em]">
                    All Active Positions
                  </h3>
                  <AnimatePresence>
                    {activeHedges.map((hedge) => (
                      <motion.div
                        key={hedge.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -100 }}
                        className="p-4 bg-[#f5f5f7] rounded-[14px] border border-[#e8e8ed]"
                      >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          hedge.type === 'SHORT' ? 'bg-[#FF3B30]/10' : 'bg-[#34C759]/10'
                        }`}>
                          {hedge.type === 'SHORT' ? (
                            <TrendingDown className="w-5 h-5 text-[#FF3B30]" />
                          ) : (
                            <TrendingUp className="w-5 h-5 text-[#34C759]" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-semibold text-[#1d1d1f]">{hedge.type} {hedge.asset}</span>
                            <span className="text-[11px] px-2 py-0.5 bg-[#34C759]/20 text-[#34C759] rounded-full font-medium">
                              Active
                            </span>
                          </div>
                          <div className="text-[13px] text-[#86868b] mt-0.5">{hedge.reason}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[20px] font-bold ${hedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                          {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)} USDC
                        </div>
                        <div className={`text-[13px] font-medium ${hedge.pnlPercent >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                          {hedge.pnlPercent >= 0 ? '+' : ''}{hedge.pnlPercent.toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {/* Position Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-[#e8e8ed]">
                      <div>
                        <div className="text-[11px] font-medium text-[#86868b] uppercase">Size</div>
                        <div className="text-[15px] font-semibold text-[#1d1d1f]">{hedge.size} BTC</div>
                        <div className="text-[11px] text-[#86868b]">{hedge.leverage}x leverage</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-[#86868b] uppercase">Entry</div>
                        <div className="text-[15px] font-semibold text-[#1d1d1f]">${hedge.entryPrice.toLocaleString()}</div>
                        <div className="text-[11px] text-[#86868b]">Now: ${hedge.currentPrice.toFixed(0)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-[#86868b] uppercase">Target</div>
                        <div className="text-[15px] font-semibold text-[#34C759]">${hedge.targetPrice.toLocaleString()}</div>
                        <div className="text-[11px] text-[#86868b]">
                          {((hedge.currentPrice - hedge.targetPrice) / hedge.targetPrice * 100).toFixed(1)}% away
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-medium text-[#86868b] uppercase">Stop Loss</div>
                        <div className="text-[15px] font-semibold text-[#FF3B30]">${hedge.stopLoss.toLocaleString()}</div>
                        <div className="text-[11px] text-[#86868b]">
                          {((hedge.stopLoss - hedge.currentPrice) / hedge.currentPrice * 100).toFixed(1)}% away
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#e8e8ed] text-[11px] text-[#86868b]">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(hedge.openedAt).toLocaleString()}</span>
                        </div>
                        <div>Capital: ${hedge.capitalUsed} USDC</div>
                      </div>
                      <button
                        onClick={() => handleClosePosition(hedge)}
                        disabled={closingPosition === hedge.id}
                        className="px-3 py-1.5 bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 text-[#FF3B30] rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                      >
                        {closingPosition === hedge.id ? 'Closing...' : 'Close Position'}
                      </button>
                    </div>
                  </motion.div>
                ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          {/* Closed Positions - Only in expanded view */}
          {closedHedges.length > 0 && showClosedPositions && (
            <div className="bg-white rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/5 p-5 mt-4">
              <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-3 tracking-[-0.01em]">
                Closed Positions ({closedHedges.length})
              </h3>
              
              <div className="space-y-3">
                {closedHedges.map((hedge) => (
                  <div
                    key={hedge.id}
                    className="p-4 bg-[#f5f5f7] rounded-[14px] border border-[#e8e8ed] opacity-75"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-[12px] flex items-center justify-center ${
                          hedge.type === 'SHORT' ? 'bg-[#FF3B30]/10' : 'bg-[#34C759]/10'
                        }`}>
                          {hedge.type === 'SHORT' ? (
                            <TrendingDown className="w-5 h-5 text-[#FF3B30]" strokeWidth={2} />
                          ) : (
                            <TrendingUp className="w-5 h-5 text-[#34C759]" strokeWidth={2} />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">{hedge.type} {hedge.asset}</span>
                            <span className="text-[11px] px-2 py-0.5 bg-[#86868b]/20 text-[#86868b] rounded-full font-semibold">
                              Closed
                            </span>
                          </div>
                          <div className="text-[11px] text-[#86868b] mt-0.5">
                            {hedge.closedAt && `Closed ${new Date(hedge.closedAt).toLocaleString()}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[17px] font-bold ${hedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                          {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)} USDC
                        </div>
                        <div className={`text-[13px] ${hedge.pnlPercent >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                          {hedge.pnlPercent >= 0 ? '+' : ''}{hedge.pnlPercent.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer Info - Only show when viewing all */}
      {hedges.length > 0 && showClosedPositions && (
        <div className="mt-6 pt-6 border-t border-[#e8e8ed] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#86868b]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-[#34C759]" />
              <span>x402 gasless</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-[#007AFF]" />
              <span>Manager-approved</span>
            </div>
          </div>
          <a
            href={`https://explorer.cronos.org/testnet/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-[#007AFF] transition-colors"
          >
            <span>View on Explorer</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Close Position Modal */}
      <AnimatePresence>
        {showCloseConfirm && selectedHedge && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={closeCloseConfirm}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-[#e8e8ed]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-[#FF3B30]/10 rounded-xl flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-[#FF3B30]" />
                </div>
                <div>
                  <h3 className="text-[17px] font-semibold text-[#1d1d1f]">Close Position</h3>
                  <p className="text-[13px] text-[#86868b]">Finalize hedge with current P/L</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="p-4 bg-[#f5f5f7] rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] text-[#86868b]">Position</span>
                    <span className="text-[15px] font-semibold text-[#1d1d1f]">{selectedHedge.type} {selectedHedge.asset}</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] text-[#86868b]">Current P/L</span>
                    <span className={`text-[17px] font-bold ${selectedHedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                      {selectedHedge.pnl >= 0 ? '+' : ''}{selectedHedge.pnl.toFixed(2)} USDC
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-[#86868b]">Return</span>
                    <span className={`text-[15px] font-semibold ${selectedHedge.pnlPercent >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                      {selectedHedge.pnlPercent >= 0 ? '+' : ''}{selectedHedge.pnlPercent.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-[#FF9500]/10 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#FF9500] mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-[#1d1d1f]">
                    Closing this position will lock in the current P/L. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={closeCloseConfirm}
                  className="flex-1 px-4 py-3 bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] rounded-xl text-[15px] font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClosePosition}
                  className="flex-1 px-4 py-3 bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white rounded-xl text-[15px] font-semibold transition-colors"
                >
                  Close Position
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
