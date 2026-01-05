'use client';

import { useState, useEffect } from 'react';
import { Shield, TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

export function ActiveHedges({ address }: { address: string }) {
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
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [selectedHedge, setSelectedHedge] = useState<HedgePosition | null>(null);
  const [showClosedPositions, setShowClosedPositions] = useState(false);

  const activeHedges = hedges.filter(h => h.status === 'active');
  const closedHedges = hedges.filter(h => h.status === 'closed');

  useEffect(() => {
    // Load hedges from localStorage (settlement batch history)
    const loadHedges = () => {
      try {
        const settlements = localStorage.getItem('settlement_history');
        console.log('📊 [ActiveHedges] Loading from localStorage:', settlements);
        
        if (!settlements) {
          console.log('📊 [ActiveHedges] No settlement history found');
          setLoading(false);
          return;
        }

        const settlementData = JSON.parse(settlements);
        console.log('📊 [ActiveHedges] Parsed settlement data:', settlementData);
        const hedgePositions: HedgePosition[] = [];

        // Parse settlement batches to extract hedge positions
        Object.values(settlementData).forEach((batch: any) => {
          console.log('📊 [ActiveHedges] Processing batch:', batch);
          if (batch.type === 'hedge' && batch.managerSignature) {
            // Extract hedge details from batch
            const hedgeData = batch.hedgeDetails || {};
            console.log('✅ [ActiveHedges] Found hedge with signature:', hedgeData);
            
            // Simulate current price movement for demo
            const currentPrice = hedgeData.entryPrice * (1 + (Math.random() - 0.5) * 0.05);
            const pnl = hedgeData.type === 'SHORT' 
              ? (hedgeData.entryPrice - currentPrice) * hedgeData.size * hedgeData.leverage
              : (currentPrice - hedgeData.entryPrice) * hedgeData.size * hedgeData.leverage;
            const pnlPercent = (pnl / hedgeData.capitalUsed) * 100;

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
              status: batch.status === 'completed' ? 'active' : 'closed',
              openedAt: new Date(batch.timestamp),
              reason: hedgeData.reason || 'Portfolio protection',
            });
          }
        });

        // Calculate performance stats
        const activeCount = hedgePositions.filter(h => h.status === 'active').length;
        const closedHedges = hedgePositions.filter(h => h.status === 'closed');
        const winners = closedHedges.filter(h => h.pnl > 0).length;
        const winRate = closedHedges.length > 0 ? (winners / closedHedges.length) * 100 : 0;
        const totalPnL = hedgePositions.reduce((sum, h) => sum + h.pnl, 0);
        const bestTrade = Math.max(...hedgePositions.map(h => h.pnl), 0);
        const worstTrade = Math.min(...hedgePositions.map(h => h.pnl), 0);

        setHedges(hedgePositions.reverse()); // Newest first
        setStats({
          totalHedges: hedgePositions.length,
          activeHedges: activeCount,
          winRate,
          totalPnL,
          avgHoldTime: '2h 15m', // Calculate from actual data
          bestTrade,
          worstTrade,
        });
        setLoading(false);
      } catch (error) {
        console.error('Failed to load hedges:', error);
        setLoading(false);
      }
    };

    loadHedges();

    // Listen for storage events (when hedges are added)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'settlement_history') {
        console.log('📊 [ActiveHedges] Storage changed, reloading...');
        loadHedges();
      }
    };
    
    // Listen for custom event from ChatInterface
    const handleHedgeAdded = () => {
      console.log('📊 [ActiveHedges] Hedge added event received, reloading...');
      loadHedges();
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('hedgeAdded', handleHedgeAdded);

    // Refresh every 10 seconds for price updates
    const interval = setInterval(loadHedges, 10000);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('hedgeAdded', handleHedgeAdded);
    };
  }, [address]);

  const handleClosePosition = async (hedge: HedgePosition) => {
    setSelectedHedge(hedge);
    setShowCloseConfirm(true);
  };

  const confirmClosePosition = async () => {
    if (!selectedHedge) return;
    
    setClosingPosition(selectedHedge.id);
    setShowCloseConfirm(false);
    
    try {
      // Update localStorage to mark position as closed
      const settlements = localStorage.getItem('settlement_history');
      if (settlements) {
        const settlementData = JSON.parse(settlements);
        if (settlementData[selectedHedge.id]) {
          settlementData[selectedHedge.id].status = 'closed';
          settlementData[selectedHedge.id].closedAt = Date.now();
          settlementData[selectedHedge.id].finalPnL = selectedHedge.pnl;
          settlementData[selectedHedge.id].finalPnLPercent = selectedHedge.pnlPercent;
          
          localStorage.setItem('settlement_history', JSON.stringify(settlementData));
          console.log('✅ [ActiveHedges] Position closed:', selectedHedge.id);
          
          // Dispatch event to refresh
          window.dispatchEvent(new Event('hedgeAdded'));
          
          // Update local state immediately
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
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-96 border border-gray-700" />;
  }

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Shield className="w-6 h-6 text-emerald-400" />
            <h2 className="text-2xl font-semibold">Active Hedges & P/L</h2>
            <span className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
              {stats.activeHedges} Active
            </span>
          </div>
          {stats.totalHedges > 0 && (
            <div className={`text-2xl font-bold ${stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(2)} USDC
            </div>
          )}
        </div>

        {/* Performance Stats Grid */}
        {stats.totalHedges > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Win Rate</div>
              <div className="text-2xl font-bold text-emerald-400">{stats.winRate.toFixed(1)}%</div>
              <div className="text-xs text-gray-500 mt-1">
                {Math.round((stats.winRate / 100) * stats.totalHedges)} wins
              </div>
            </div>
            <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Total Hedges</div>
              <div className="text-2xl font-bold text-white">{stats.totalHedges}</div>
              <div className="text-xs text-gray-500 mt-1">{stats.activeHedges} active</div>
            </div>
            <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Best Trade</div>
              <div className="text-2xl font-bold text-green-400">+{stats.bestTrade.toFixed(2)}</div>
              <div className="text-xs text-gray-500 mt-1">USDC profit</div>
            </div>
            <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
              <div className="text-xs text-gray-400 mb-1">Avg Hold Time</div>
              <div className="text-2xl font-bold text-cyan-400">{stats.avgHoldTime}</div>
              <div className="text-xs text-gray-500 mt-1">per position</div>
            </div>
          </div>
        )}
      </div>

      {/* Hedge Positions */}
      {hedges.length === 0 ? (
        <div className="text-center py-12">
          <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Active Hedges</h3>
          <p className="text-gray-400 mb-4">
            Execute hedge recommendations from AI agents to protect your portfolio
          </p>
          <div className="text-sm text-gray-500">
            💡 Type "Hedge my portfolio" in the chat to get AI recommendations
          </div>
        </div>
      ) : (
        <>
          {/* Active Positions */}
          {activeHedges.length > 0 && (
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-semibold text-gray-400 flex items-center space-x-2">
                <span>Active Positions</span>
                <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">
                  {activeHedges.length}
                </span>
              </h3>
              <AnimatePresence>
                {activeHedges.map((hedge) => (
              <motion.div
                key={hedge.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                className={`p-4 rounded-lg border transition-colors ${
                  hedge.status === 'active'
                    ? 'bg-gray-900 border-emerald-500/30'
                    : 'bg-gray-900/50 border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${
                      hedge.type === 'SHORT' ? 'bg-red-500/10' : 'bg-green-500/10'
                    }`}>
                      {hedge.type === 'SHORT' ? (
                        <TrendingDown className="w-5 h-5 text-red-400" />
                      ) : (
                        <TrendingUp className="w-5 h-5 text-green-400" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-lg">{hedge.type} {hedge.asset}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          hedge.status === 'active'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-gray-700 text-gray-400'
                        }`}>
                          {hedge.status}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{hedge.reason}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xl font-bold ${
                      hedge.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)} USDC
                    </div>
                    <div className={`text-sm ${
                      hedge.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>handleClosePosition(hedge)}
                      disabled={closingPosition === hedge.id}
                      className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {closingPosition === hedge.id ? 'Closing...' : 'Close Position'} */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700">
                  <div>
                    <div className="text-xs text-gray-400">Size</div>
                    <div className="font-semibold">{hedge.size} BTC</div>
                    <div className="text-xs text-gray-500">{hedge.leverage}x leverage</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Entry Price</div>
                    <div className="font-semibold">${hedge.entryPrice.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">Current: ${hedge.currentPrice.toFixed(0)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Target</div>
                    <div className="font-semibold text-emerald-400">${hedge.targetPrice.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">
                      {((hedge.currentPrice - hedge.targetPrice) / hedge.targetPrice * 100).toFixed(1)}% away
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Stop Loss</div>
                    <div className="font-semibold text-red-400">${hedge.stopLoss.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">
                      {((hedge.stopLoss - hedge.currentPrice) / hedge.currentPrice * 100).toFixed(1)}% away
                    </div>
                  </div>
                </div>

                {/* Time & Capital Info */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700 text-xs text-gray-400">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>Opened {new Date(hedge.openedAt).toLocaleString()}</span>
                    </div>
                    <div>Capital: ${hedge.capitalUsed} USDC</div>
                  </div>
                  {hedge.status === 'active' && (
                    <button
                      onClick={() => handleClosePosition(hedge)}
                      disabled={closingPosition === hedge.id}
                      className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {closingPosition === hedge.id ? 'Closing...' : 'Close Position'}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
            </div>
          )}

          {/* Closed Positions */}
          {closedHedges.length > 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setShowClosedPositions(!showClosedPositions)}
                className="w-full text-sm font-semibold text-gray-400 hover:text-gray-300 flex items-center space-x-2 transition-colors"
              >
                <span>Closed Positions ({closedHedges.length})</span>
                <motion.div
                  animate={{ rotate: showClosedPositions ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </motion.div>
              </button>
              
              <AnimatePresence>
                {showClosedPositions && closedHedges.map((hedge) => (
                  <motion.div
                    key={hedge.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-4 rounded-lg border bg-gray-900/50 border-gray-700 opacity-75"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${
                          hedge.type === 'SHORT' ? 'bg-red-500/10' : 'bg-green-500/10'
                        }`}>
                          {hedge.type === 'SHORT' ? (
                            <TrendingDown className="w-5 h-5 text-red-400" />
                          ) : (
                            <TrendingUp className="w-5 h-5 text-green-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold">{hedge.type} {hedge.asset}</h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400">
                              Closed
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {hedge.closedAt && `Closed ${new Date(hedge.closedAt).toLocaleString()}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${
                          hedge.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)} USDC
                        </div>
                        <div className={`text-sm ${
                          hedge.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {hedge.pnlPercent >= 0 ? '+' : ''}{hedge.pnlPercent.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {/* Footer Info */}
      {hedges.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-700 flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>All hedges executed via x402 gasless</span>
            </div>
            <div className="flex items-center space-x-1">
              <Shield className="w-4 h-4 text-cyan-400" />
              <span>Manager-approved signatures</span>
            </div>
          </div>
          <a
            href={`https://explorer.cronos.org/testnet/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1 hover:text-cyan-400 transition-colors"
          >
            <span>View on Explorer</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Close Position Confirmation Modal */}
      <AnimatePresence>
        {showCloseConfirm && selectedHedge && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setShowCloseConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-900 rounded-2xl p-6 max-w-md w-full border border-red-500/30 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-3 bg-red-500/10 rounded-xl">
                  <XCircle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Close Position</h3>
                  <p className="text-sm text-gray-400">Finalize hedge with current P/L</p>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Position</span>
                    <span className="font-semibold">{selectedHedge.type} {selectedHedge.asset}</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Current P/L</span>
                    <span className={`font-bold text-lg ${selectedHedge.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {selectedHedge.pnl >= 0 ? '+' : ''}{selectedHedge.pnl.toFixed(2)} USDC
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Return</span>
                    <span className={`font-semibold ${selectedHedge.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {selectedHedge.pnlPercent >= 0 ? '+' : ''}{selectedHedge.pnlPercent.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30 flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-yellow-200">
                    Closing this position will lock in the current P/L. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCloseConfirm(false)}
                  className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClosePosition}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-lg font-semibold transition-colors"
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

}
