'use client';

import { useState, memo, useMemo, useRef, useEffect, useCallback } from 'react';
import { Shield, TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, ExternalLink, AlertTriangle, Sparkles, Zap, Brain, RefreshCw, Wallet, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePolling, useToggle } from '@/lib/hooks';
import { logger } from '@/lib/utils/logger';

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
  status: 'active' | 'closed' | 'triggered' | 'pending' | 'liquidated' | 'cancelled';
  openedAt: Date;
  closedAt?: Date;
  reason: string;
  txHash?: string;
  walletAddress?: string;
  walletVerified?: boolean;
  // ZK verification fields
  zkVerified?: boolean;
  walletBindingHash?: string;
  commitmentHash?: string;
  // On-chain fields
  onChain?: boolean;
  chain?: string;
  contractAddress?: string;
  hedgeId?: string;
  // Proxy wallet (ZK privacy)
  proxyWallet?: string;
  proxyVault?: string;
}

interface CloseReceipt {
  success: boolean;
  asset: string;
  side: string;
  collateral: number;
  leverage: number;
  realizedPnl: number;
  fundsReturned: number;
  balanceBefore: number;
  balanceAfter: number;
  txHash: string;
  explorerLink: string;
  trader: string;
  gasless: boolean;
  gasSavings?: { userGasCost: string; relayerGasCost: string; totalSaved: string };
  elapsed?: string;
  finalStatus: string;
  error?: string;
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

interface AIRecommendation {
  strategy: string;
  confidence: number;
  expectedReduction: number;
  description: string;
  actions: {
    action: string;
    asset: string;
    size: number;
    leverage: number;
    protocol: string;
    reason: string;
  }[];
  agentSource?: string;
}

interface ActiveHedgesProps {
  address?: string;
  compact?: boolean;
  onCreateHedge?: () => void;
  onOpenChat?: () => void;
}

export const ActiveHedges = memo(function ActiveHedges({ address, compact = false, onCreateHedge, onOpenChat }: ActiveHedgesProps) {
  // EIP-712 signature helper for closing hedges
  const signCloseHedge = async (hedgeId: string): Promise<{ signature: string; timestamp: number } | null> => {
    try {
      if (typeof window === 'undefined' || !(window as unknown as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<string> } }).ethereum) {
        logger.warn('No wallet provider found, skipping signature', { component: 'ActiveHedges' });
        return null;
      }
      const ethereum = (window as unknown as { ethereum: { request: (args: { method: string; params: unknown[] }) => Promise<string> } }).ethereum;
      // Use eth_accounts (no popup) since wallet is already connected; fall back to eth_requestAccounts only if needed
      let accounts = await ethereum.request({ method: 'eth_accounts', params: [] }) as unknown as string[];
      if (!accounts || accounts.length === 0) {
        accounts = await ethereum.request({ method: 'eth_requestAccounts', params: [] }) as unknown as string[];
      }
      if (!accounts || accounts.length === 0) return null;
      const signer = accounts[0];
      const timestamp = Math.floor(Date.now() / 1000);

      const domain = {
        name: 'Chronos Vanguard',
        version: '1',
        chainId: 338,
        verifyingContract: '0x090b6221137690EbB37667E4644287487CE462B9',
      };
      const types = {
        CloseHedge: [
          { name: 'hedgeId', type: 'bytes32' },
          { name: 'action', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      };
      const value = { hedgeId, action: 'close', timestamp: String(timestamp) };

      // EIP-712 structured signing via MetaMask
      const msgParams = JSON.stringify({
        types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...types },
        primaryType: 'CloseHedge',
        domain,
        message: value,
      });

      const signature = await ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [signer, msgParams],
      });

      logger.info('🔑 Signed close-hedge message', { component: 'ActiveHedges', signer });
      return { signature, timestamp };
    } catch (err) {
      logger.warn('Wallet signature declined or failed', { component: 'ActiveHedges', error: err });
      return null;
    }
  };

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
  const [closeReceipt, setCloseReceipt] = useState<CloseReceipt | null>(null);
  const processingRef = useRef(false);
  const _lastProcessedRef = useRef<string>('');
  
  // AI Recommendations state
  const [recommendations, setRecommendations] = useState<AIRecommendation[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [executingRecommendation, setExecutingRecommendation] = useState<string | null>(null);

  const activeHedges = useMemo(() => hedges.filter(h => h.status === 'active' || h.status === 'pending'), [hedges]);
  const closedHedges = useMemo(() => hedges.filter(h => h.status === 'closed' || h.status === 'liquidated' || h.status === 'cancelled'), [hedges]);

  const loadHedges = useCallback(async () => {
    if (processingRef.current) return;

    try {
      processingRef.current = true;
      
      // Fetch on-chain hedges from HedgeExecutor contract
      let onChainHedges: HedgePosition[] = [];

      try {
        const onChainResponse = await fetch('/api/agents/hedging/onchain?stats=true');
        if (onChainResponse.ok) {
          const onChainData = await onChainResponse.json();
          if (onChainData.success && onChainData.summary?.details) {
            logger.debug('🔗 On-chain hedges loaded', { component: 'ActiveHedges', count: onChainData.summary.details.length });
            onChainHedges = onChainData.summary.details.map((h: { orderId: string; hedgeId: string; side: 'SHORT' | 'LONG'; asset: string; size: number; leverage: number; entryPrice: number; currentPrice: number; capitalUsed: number; notionalValue: number; unrealizedPnL: number; pnlPercentage: number; createdAt: string; reason: string; walletAddress: string; txHash: string | null; proxyWallet: string; proxyVault: string; commitmentHash: string; zkVerified: boolean; onChain: boolean }) => ({
              id: `onchain-${h.orderId}`,
              type: h.side as 'SHORT' | 'LONG',
              asset: h.asset,
              size: h.size,
              leverage: h.leverage,
              entryPrice: h.entryPrice,
              currentPrice: h.currentPrice,
              targetPrice: 0,
              stopLoss: 0,
              capitalUsed: h.capitalUsed || h.size,
              pnl: h.unrealizedPnL || 0,
              pnlPercent: h.pnlPercentage || 0,
              status: 'active' as const,
              openedAt: h.createdAt ? new Date(h.createdAt) : new Date(),
              reason: h.reason || `${h.leverage}x ${h.side} ${h.asset} on-chain hedge`,
              walletAddress: h.walletAddress,
              txHash: h.txHash || undefined,
              zkVerified: h.zkVerified,
              walletVerified: true,
              onChain: true,
              chain: 'cronos-testnet',
              hedgeId: h.hedgeId || h.orderId,
              contractAddress: '0x090b6221137690EbB37667E4644287487CE462B9',
              proxyWallet: h.proxyWallet,
              proxyVault: h.proxyVault,
              commitmentHash: h.commitmentHash,
            }));
          }
        }
      } catch (onChainErr) {
        logger.error('❌ On-chain hedges not available', onChainErr instanceof Error ? onChainErr : undefined, { component: 'ActiveHedges' });
      }

      // Use on-chain hedges only (DB cleared)
      const allHedges = [...onChainHedges];
      
      if (allHedges.length > 0) {
        const totalPnL = allHedges.reduce((sum, h) => sum + (h.pnl || 0), 0);
        const profitable = allHedges.filter(h => h.pnl > 0).length;
        const _unprofitable = allHedges.filter(h => h.pnl <= 0).length;
        const winRate = allHedges.length > 0 ? (profitable / allHedges.length) * 100 : 0;
        const pnlValues = allHedges.map(h => h.pnl || 0);
        const bestTrade = pnlValues.length > 0 ? Math.max(...pnlValues) : 0;
        const worstTrade = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;

        setStats({
          totalHedges: allHedges.length,
          activeHedges: allHedges.length,
          winRate: Math.round(winRate),
          totalPnL,
          avgHoldTime: '24h',
          bestTrade,
          worstTrade,
        });
        setHedges(allHedges);
        setLoading(false);
        processingRef.current = false;
        return;
      }

    } catch (error) {
      logger.error('❌ [ActiveHedges] Error loading hedges', error instanceof Error ? error : undefined, { component: 'ActiveHedges' });
      setHedges([]);
      setLoading(false);
    } finally {
      processingRef.current = false;
    }
  }, [address]);

  usePolling(loadHedges, 30000);

  // Listen for hedge creation events to refresh immediately
  useEffect(() => {
    const handleHedgeAdded = () => {
      logger.debug('🔄 [ActiveHedges] Hedge added event received, refreshing...', { component: 'ActiveHedges' });
      loadHedges();
    };

    window.addEventListener('hedgeAdded', handleHedgeAdded);
    return () => window.removeEventListener('hedgeAdded', handleHedgeAdded);
  }, [loadHedges]);

  // Load AI recommendations
  const loadRecommendations = useCallback(async () => {
    if (!address) return;
    
    setLoadingRecommendations(true);
    try {
      const response = await fetch('/api/agents/hedging/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      
      if (response.ok) {
        const data = await response.json();
        logger.debug('🤖 AI Recommendations', { component: 'ActiveHedges', data });
        if (data.recommendations) {
          setRecommendations(data.recommendations);
        }
      }
    } catch (error) {
      logger.error('Failed to load AI recommendations', error instanceof Error ? error : undefined, { component: 'ActiveHedges' });
    } finally {
      setLoadingRecommendations(false);
    }
  }, [address]);

  // Load recommendations on mount and when address changes
  useEffect(() => {
    if (address) {
      loadRecommendations();
    }
  }, [address, loadRecommendations]);

  // Execute AI recommendation
  const executeRecommendation = async (rec: AIRecommendation) => {
    if (!rec.actions || rec.actions.length === 0) return;
    
    const action = rec.actions[0];
    setExecutingRecommendation(rec.strategy);
    
    try {
      // Get current price for the asset
      let currentPrice = 1000;
      try {
        const tickerResponse = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers');
        const tickerData = await tickerResponse.json();
        const ticker = tickerData.result?.data?.find((t: { i: string; a: string }) => t.i === `${action.asset}_USDT`);
        if (ticker) currentPrice = parseFloat(ticker.a);
      } catch (e) {
        logger.warn('Failed to fetch price, using fallback', { component: 'ActiveHedges' });
      }

      const notionalValue = action.size * currentPrice;
      
      const response = await fetch('/api/agents/hedging/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId: 1,
          asset: action.asset,
          side: action.action,
          notionalValue,
          leverage: action.leverage || 5,
          reason: `AI Recommended: ${rec.description}`,
          autoApprovalEnabled: true,
          autoApprovalThreshold: 1000000,
          walletAddress: address, // Associate hedge with connected wallet
        }),
      });

      if (response.ok) {
        const data = await response.json();
        logger.info('✅ AI Hedge executed', { component: 'ActiveHedges', data });
        
        // Refresh hedges and recommendations
        window.dispatchEvent(new Event('hedgeAdded'));
        loadRecommendations();
      } else {
        const error = await response.json();
        logger.error('❌ Failed to execute AI hedge', undefined, { component: 'ActiveHedges', data: error });
        alert(`Failed to execute: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      logger.error('❌ Error executing AI recommendation', error instanceof Error ? error : undefined, { component: 'ActiveHedges' });
      alert('Failed to execute recommendation');
    } finally {
      setExecutingRecommendation(null);
    }
  };

  const handleClosePosition = async (hedge: HedgePosition) => {
    setSelectedHedge(hedge);
    openCloseConfirm();
  };

  const confirmClosePosition = async () => {
    if (!selectedHedge) return;
    
    setClosingPosition(selectedHedge.id);
    closeCloseConfirm();
    
    try {
      // For on-chain hedges, call the on-chain close API which triggers actual fund withdrawal
      if (selectedHedge.onChain && selectedHedge.hedgeId) {
        try {
          // Sign the close request with the user's wallet (EIP-712)
          const sigResult = await signCloseHedge(selectedHedge.hedgeId);

          const closePayload: Record<string, unknown> = {
            hedgeId: selectedHedge.hedgeId,
          };

          if (sigResult) {
            closePayload.signature = sigResult.signature;
            closePayload.walletAddress = address;
            closePayload.signatureTimestamp = sigResult.timestamp;
          }

          const response = await fetch('/api/agents/hedging/close-onchain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(closePayload),
          });

          const data = await response.json();
          
          if (response.ok && data.success) {
            logger.info('✅ Hedge closed on-chain via x402 gasless, funds withdrawn', { component: 'ActiveHedges', data: {
              txHash: data.txHash,
              fundsReturned: data.fundsReturned,
              withdrawTo: data.withdrawalDestination,
              gasless: data.gasless,
              gasSaved: data.gasSavings?.totalSaved,
            }});
            
            // Show close receipt modal instead of alert
            setCloseReceipt({
              success: true,
              asset: data.asset || selectedHedge.asset,
              side: data.side || selectedHedge.type,
              collateral: data.collateral || selectedHedge.capitalUsed,
              leverage: data.leverage || selectedHedge.leverage,
              realizedPnl: data.realizedPnl || 0,
              fundsReturned: data.fundsReturned || 0,
              balanceBefore: data.balanceBefore || 0,
              balanceAfter: data.balanceAfter || 0,
              txHash: data.txHash || '',
              explorerLink: data.explorerLink || `https://explorer.cronos.org/testnet/tx/${data.txHash}`,
              trader: data.trader || selectedHedge.walletAddress || '',
              gasless: data.gasless || false,
              gasSavings: data.gasSavings,
              elapsed: data.elapsed,
              finalStatus: data.finalStatus || 'closed',
            });
            
            // Remove from local state
            setHedges(prev => prev.filter(h => h.id !== selectedHedge.id));
            window.dispatchEvent(new Event('hedgeAdded'));
            return;
          } else {
            throw new Error(data.error || 'Close failed');
          }
        } catch (onChainErr) {
          logger.error('❌ On-chain close failed', onChainErr instanceof Error ? onChainErr : undefined, { component: 'ActiveHedges' });
          setCloseReceipt({
            success: false,
            asset: selectedHedge.asset,
            side: selectedHedge.type,
            collateral: selectedHedge.capitalUsed,
            leverage: selectedHedge.leverage,
            realizedPnl: 0,
            fundsReturned: 0,
            balanceBefore: 0,
            balanceAfter: 0,
            txHash: '',
            explorerLink: '',
            trader: selectedHedge.walletAddress || '',
            gasless: false,
            finalStatus: 'failed',
            error: onChainErr instanceof Error ? onChainErr.message : 'Unknown error',
          });
          return;
        }
      }

      // Fallback: Try to close in database for non-on-chain hedges
      try {
        const response = await fetch('/api/agents/hedging/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: selectedHedge.id,
            realizedPnl: selectedHedge.pnl,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          logger.info('✅ Hedge closed in database', { component: 'ActiveHedges', data });
          
          // Remove from local state
          setHedges(prev => prev.filter(h => h.id !== selectedHedge.id));
          
          // Also update localStorage for fallback
          const settlements = localStorage.getItem('settlement_history');
          if (settlements) {
            const settlementData = JSON.parse(settlements);
            if (settlementData[selectedHedge.id]) {
              settlementData[selectedHedge.id].status = 'closed';
              settlementData[selectedHedge.id].closedAt = Date.now();
              settlementData[selectedHedge.id].finalPnL = selectedHedge.pnl;
              settlementData[selectedHedge.id].finalPnLPercent = selectedHedge.pnlPercent;
              localStorage.setItem('settlement_history', JSON.stringify(settlementData));
            }
          }
          
          window.dispatchEvent(new Event('hedgeAdded'));
          return;
        }
      } catch (apiErr) {
        logger.error('Failed to close in database, falling back to localStorage', apiErr instanceof Error ? apiErr : undefined, { component: 'ActiveHedges' });
      }

      // Fallback to localStorage only
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
      logger.error('Failed to close position', error instanceof Error ? error : undefined, { component: 'ActiveHedges' });
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
            Create manual hedges or wait for AI recommendations to protect your portfolio
          </p>
          <button
            onClick={() => onCreateHedge?.()}
            className="mb-3 px-4 py-2 bg-[#007AFF] text-white rounded-[12px] text-[13px] sm:text-[14px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Create Manual Hedge
          </button>
          <div className="flex items-center gap-2 text-[12px] sm:text-[13px] text-[#86868b]">
            <button
              onClick={() => onOpenChat?.()}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-[#007AFF]/10 hover:bg-[#007AFF]/20 rounded-full transition-colors cursor-pointer"
            >
              <span>💬</span>
              <span className="font-medium text-[#007AFF]">Chat with AI</span>
            </button>
            <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-[#34C759]/10 rounded-full">
              <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#34C759]" />
              <span className="font-medium text-[#34C759]">Auto-protect</span>
            </span>
          </div>
        </div>
      ) : compact ? (
        /* Compact view for Overview - show summary with clear status */
        <div>
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="flex items-center gap-2">
              {stats.activeHedges > 0 ? (
                <>
                <span className="text-[10px] sm:text-[11px] font-bold text-[#34C759] uppercase tracking-[0.04em] px-1.5 sm:px-2 py-0.5 sm:py-1 bg-[#34C759]/10 rounded-full">
                  {stats.activeHedges} Active
                </span>
                {activeHedges.some(h => h.onChain) && (
                  <span className="text-[9px] sm:text-[10px] font-bold text-[#FF9500] uppercase tracking-[0.04em] px-1.5 py-0.5 bg-[#FF9500]/10 rounded-full">
                    ⛓ On-Chain
                  </span>
                )}
                </>
              ) : (
                <span className="text-[10px] sm:text-[11px] font-bold text-[#86868b] uppercase tracking-[0.04em] px-1.5 sm:px-2 py-0.5 sm:py-1 bg-[#f5f5f7] rounded-full">
                  {stats.totalHedges} Closed
                </span>
              )}
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

          {/* Show active or recent closed positions */}
          <div className="space-y-2">
            {activeHedges.length > 0 ? (
              /* Active positions */
              activeHedges.slice(0, 2).map((hedge) => (
                <div key={hedge.id} className="flex items-center justify-between p-2 sm:p-3 bg-[#34C759]/5 rounded-[10px] sm:rounded-[12px] border border-[#34C759]/20">
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
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-semibold text-[#1d1d1f]">{hedge.type} {hedge.asset}</span>
                        <span className="px-1.5 py-0.5 bg-[#34C759] text-white text-[9px] font-bold rounded">ACTIVE</span>
                        {hedge.zkVerified && (
                          <span className="px-1.5 py-0.5 bg-[#5856D6] text-white text-[9px] font-bold rounded flex items-center gap-0.5" title="ZK-verified ownership">
                            <Lock className="w-2.5 h-2.5" />ZK
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] space-y-0.5\">
                        <div className="text-[#1d1d1f] font-medium">{hedge.reason}</div>
                        {hedge.txHash && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wider">TX:</span>
                            <a
                              href={`https://explorer.cronos.org/testnet/tx/${hedge.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                              title="View on Cronos Explorer"
                            >
                              <span className="font-mono">{hedge.txHash.slice(0, 8)}...{hedge.txHash.slice(-6)}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={`text-[15px] font-bold ${hedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                    {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)}
                  </div>
                </div>
              ))
            ) : closedHedges.length > 0 ? (
              /* Show recent closed positions when no active */
              closedHedges.slice(0, 2).map((hedge) => (
                <div key={hedge.id} className="flex items-center justify-between p-2 sm:p-3 bg-[#f5f5f7] rounded-[10px] sm:rounded-[12px] opacity-80">
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
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-semibold text-[#1d1d1f]">{hedge.type} {hedge.asset}</span>
                        <span className="px-1.5 py-0.5 bg-[#86868b] text-white text-[9px] font-bold rounded">CLOSED</span>
                        {hedge.zkVerified && (
                          <span className="px-1.5 py-0.5 bg-[#5856D6] text-white text-[9px] font-bold rounded flex items-center gap-0.5" title="ZK-verified ownership">
                            <Lock className="w-2.5 h-2.5" />ZK
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#86868b]">
                        <span>{hedge.closedAt ? `Closed ${new Date(hedge.closedAt).toLocaleDateString()}` : hedge.reason}</span>
                        {hedge.txHash && (
                          <a
                            href={`https://explorer.cronos.org/testnet/tx/${hedge.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="font-mono">{hedge.txHash.slice(0, 6)}...{hedge.txHash.slice(-4)}</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={`text-[15px] font-bold ${hedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                    {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)}
                  </div>
                </div>
              ))
            ) : null}
            {activeHedges.length > 2 && (
              <div className="text-center text-[13px] text-[#86868b] pt-1">
                +{activeHedges.length - 2} more active
              </div>
            )}
            {activeHedges.length === 0 && closedHedges.length > 2 && (
              <div className="text-center text-[13px] text-[#86868b] pt-1">
                +{closedHedges.length - 2} more closed
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
                  {activeHedges.some(h => h.onChain) && (
                    <span className="text-[9px] sm:text-[10px] font-bold text-[#FF9500] uppercase tracking-[0.04em] px-2 py-0.5 bg-[#FF9500]/10 rounded-full">
                      ⛓ {activeHedges.filter(h => h.onChain).length} On-Chain
                    </span>
                  )}
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

          {/* AI Recommendations Section */}
          {recommendations.length > 0 && (
            <div className="bg-gradient-to-br from-[#5856D6]/5 to-[#007AFF]/5 rounded-[16px] sm:rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[#5856D6]/20 p-3 sm:p-5">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-[#5856D6] to-[#007AFF] rounded-[10px] flex items-center justify-center">
                    <Brain className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-[13px] sm:text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
                      AI Recommendations
                    </h3>
                    <p className="text-[10px] sm:text-[11px] text-[#86868b]">Powered by Crypto.com AI</p>
                  </div>
                </div>
                <button
                  onClick={loadRecommendations}
                  disabled={loadingRecommendations}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 text-[#5856D6] ${loadingRecommendations ? 'animate-spin' : ''}`} />
                </button>
              </div>
              
              <div className="space-y-2 sm:space-y-3">
                {recommendations.map((rec, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="p-3 sm:p-4 bg-white rounded-[12px] sm:rounded-[14px] border border-[#e8e8ed]"
                  >
                    <div className="flex items-start justify-between mb-2 sm:mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] sm:text-[15px] font-semibold text-[#1d1d1f]">
                            {rec.strategy}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold ${
                            rec.confidence >= 0.8 ? 'bg-[#34C759]/10 text-[#34C759]' :
                            rec.confidence >= 0.6 ? 'bg-[#FF9500]/10 text-[#FF9500]' :
                            'bg-[#86868b]/10 text-[#86868b]'
                          }`}>
                            {(rec.confidence * 100).toFixed(0)}% confident
                          </span>
                        </div>
                        <p className="text-[11px] sm:text-[12px] text-[#86868b] leading-relaxed">
                          {rec.description}
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <div className="text-[11px] sm:text-[12px] text-[#86868b]">Risk Reduction</div>
                        <div className="text-[15px] sm:text-[17px] font-bold text-[#34C759]">
                          -{(rec.expectedReduction * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    
                    {/* Actions */}
                    {rec.actions && rec.actions.length > 0 && (
                      <div className="space-y-2">
                        {rec.actions.map((action, actionIndex) => (
                          <div key={actionIndex} className="flex items-center justify-between p-2 sm:p-2.5 bg-[#f5f5f7] rounded-[8px] sm:rounded-[10px]">
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-[6px] sm:rounded-[8px] flex items-center justify-center ${
                                action.action === 'SHORT' ? 'bg-[#FF3B30]/10' : 'bg-[#34C759]/10'
                              }`}>
                                {action.action === 'SHORT' ? (
                                  <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#FF3B30]" strokeWidth={2.5} />
                                ) : (
                                  <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#34C759]" strokeWidth={2.5} />
                                )}
                              </div>
                              <div>
                                <div className="text-[11px] sm:text-[13px] font-semibold text-[#1d1d1f]">
                                  {action.action} {action.asset}
                                </div>
                                <div className="text-[9px] sm:text-[10px] text-[#86868b]">
                                  {action.size} @ {action.leverage}x via {action.protocol}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => executeRecommendation(rec)}
                              disabled={executingRecommendation === rec.strategy}
                              className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-gradient-to-r from-[#5856D6] to-[#007AFF] text-white rounded-[6px] sm:rounded-[8px] text-[10px] sm:text-[11px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1"
                            >
                              {executingRecommendation === rec.strategy ? (
                                <>
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  <span>Executing...</span>
                                </>
                              ) : (
                                <>
                                  <Zap className="w-3 h-3" />
                                  <span>Execute</span>
                                </>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
              
              <div className="mt-3 pt-3 border-t border-[#5856D6]/10 flex items-center justify-center gap-2 text-[10px] sm:text-[11px] text-[#86868b]">
                <Sparkles className="w-3 h-3 text-[#5856D6]" />
                <span>AI-powered insights from Crypto.com AI Agent SDK</span>
              </div>
            </div>
          )}

          {/* No Recommendations - Show loading or prompt */}
          {recommendations.length === 0 && !loadingRecommendations && address && (
            <div className="bg-gradient-to-br from-[#5856D6]/5 to-[#007AFF]/5 rounded-[16px] sm:rounded-[20px] border border-[#5856D6]/20 p-4 sm:p-5">
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-gradient-to-br from-[#5856D6] to-[#007AFF] rounded-[14px] flex items-center justify-center mb-3">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-[14px] sm:text-[15px] font-semibold text-[#1d1d1f] mb-1">Get AI Recommendations</h3>
                <p className="text-[11px] sm:text-[12px] text-[#86868b] mb-3 max-w-[280px]">
                  Let our AI analyze your portfolio and suggest optimal hedging strategies
                </p>
                <button
                  onClick={loadRecommendations}
                  className="px-4 py-2 bg-gradient-to-r from-[#5856D6] to-[#007AFF] text-white rounded-[10px] text-[12px] sm:text-[13px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  Analyze Portfolio
                </button>
              </div>
            </div>
          )}

          {/* Loading Recommendations */}
          {loadingRecommendations && (
            <div className="bg-gradient-to-br from-[#5856D6]/5 to-[#007AFF]/5 rounded-[16px] sm:rounded-[20px] border border-[#5856D6]/20 p-4 sm:p-5">
              <div className="flex items-center justify-center gap-3">
                <RefreshCw className="w-5 h-5 text-[#5856D6] animate-spin" />
                <span className="text-[13px] text-[#1d1d1f] font-medium">Analyzing portfolio with AI...</span>
              </div>
            </div>
          )}

          {/* Active Positions - Preview or Full View */}
          {activeHedges.length > 0 ? (
            <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/5 p-3 sm:p-5">
              {!showClosedPositions ? (
                /* Compact Preview - Horizontal Scroll (Apple Music style) */
                <div>
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <h3 className="text-[13px] sm:text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
                      Active Positions
                    </h3>
                    <button
                      onClick={() => onCreateHedge?.()}
                      className="px-3 py-1.5 bg-[#007AFF] text-white rounded-[10px] text-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-1.5"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>Create Hedge</span>
                    </button>
                  </div>
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
                            <div className="flex items-center gap-1.5">
                              <div className="text-[13px] sm:text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em] truncate">
                                {hedge.type} {hedge.asset}
                              </div>
                              <span className="inline-flex items-center px-1.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] rounded-[4px] text-[9px] sm:text-[10px] font-bold">
                                {hedge.leverage}x
                              </span>
                              {hedge.zkVerified && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#5856D6]/10 text-[#5856D6] rounded-[4px] text-[9px] font-bold" title="ZK-verified ownership">
                                  <Lock className="w-2.5 h-2.5" />ZK
                                </span>
                              )}
                              {hedge.walletVerified && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#5856D6]/10 text-[#5856D6] rounded-[4px] text-[9px] font-bold" title="Wallet ownership verified">
                                  <Wallet className="w-2.5 h-2.5" />
                                  <span>✓</span>
                                </span>
                              )}
                              {hedge.onChain && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#FF9500]/10 text-[#FF9500] rounded-[4px] text-[9px] font-bold" title="On-chain verified position">
                                  ⛓ ON-CHAIN
                                </span>
                              )}
                            </div>
                            {/* Reason text hidden - not needed for display */}
                            {hedge.txHash && (
                              <div className="text-[9px] sm:text-[11px] space-y-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] sm:text-[10px] uppercase tracking-wider">TX:</span>
                                <a
                                  href={`https://explorer.cronos.org/testnet/tx/${hedge.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                                  title="View on Cronos Explorer"
                                >
                                  <span className="font-mono text-[9px] sm:text-[10px]">{hedge.txHash.slice(0, 8)}...{hedge.txHash.slice(-6)}</span>
                                  <ExternalLink className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                                </a>
                              </div>
                            </div>
                            )}
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
                            <span className="text-[#86868b] font-medium">Entry</span>
                            <span className="text-[#1d1d1f] font-semibold">${hedge.entryPrice.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-[10px] sm:text-[11px]">
                            <span className="text-[#86868b] font-medium">Current</span>
                            <span className="text-[#1d1d1f] font-semibold">${hedge.currentPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
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
                            <span className="inline-flex items-center px-2 py-0.5 bg-[#007AFF]/10 text-[#007AFF] rounded-[6px] text-[10px] font-bold">
                              {hedge.leverage}x
                            </span>
                            <span className="text-[11px] px-2 py-0.5 bg-[#34C759]/20 text-[#34C759] rounded-full font-medium">
                              Active
                            </span>
                            {hedge.zkVerified && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-[#5856D6]/10 text-[#5856D6] rounded-full text-[10px] font-bold" title="ZK-verified ownership">
                                <Lock className="w-3 h-3" />ZK
                              </span>
                            )}
                            {hedge.onChain && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#FF9500]/10 text-[#FF9500] rounded-full text-[10px] font-bold" title="On-chain verified position on Cronos testnet">
                                ⛓ ON-CHAIN
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#86868b] mt-0.5 space-y-0.5">
                            <div className="text-[13px] font-medium text-[#1d1d1f]">{hedge.reason}</div>
                            {hedge.onChain && hedge.contractAddress && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider text-[#FF9500]">CONTRACT:</span>
                                <a
                                  href={`https://explorer.cronos.org/testnet3/address/${hedge.contractAddress}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                                  title="View HedgeExecutor on Cronos Explorer"
                                >
                                  <span className="font-mono">{hedge.contractAddress.slice(0, 10)}...{hedge.contractAddress.slice(-6)}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                            {hedge.txHash && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider">TRANSACTION:</span>
                                <a
                                  href={`https://explorer.cronos.org/testnet/tx/${hedge.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                                  title="View on Cronos Explorer"
                                >
                                  <span className="font-mono">{hedge.txHash.slice(0, 10)}...{hedge.txHash.slice(-8)}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
                            {hedge.proxyWallet && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider text-[#5856D6]">ZK PRIVACY ID:</span>
                                <a
                                  href={`https://explorer.cronos.org/testnet/address/${hedge.proxyWallet}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                                  title="ZK Privacy Address — identity obfuscation via PDA derivation"
                                >
                                  <span className="font-mono">{hedge.proxyWallet.slice(0, 10)}...{hedge.proxyWallet.slice(-6)}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                                <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-[#5856D6]/10 text-[#5856D6] rounded text-[8px] font-bold">
                                  <Lock className="w-2 h-2" />ZK ID
                                </span>
                              </div>
                            )}
                            {hedge.commitmentHash && hedge.commitmentHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider text-[#5856D6]">ZK COMMITMENT:</span>
                                <span className="font-mono text-[10px] text-[#86868b]">{hedge.commitmentHash.slice(0, 14)}...{hedge.commitmentHash.slice(-8)}</span>
                              </div>
                            )}
                          </div>
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
                        <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Size</div>
                        <div className="text-[15px] font-bold text-[#1d1d1f]">{hedge.size} {hedge.asset.replace('-PERP', '')}</div>
                        <div className="text-[11px] font-medium text-[#007AFF]">{hedge.leverage}x leverage</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Entry</div>
                        <div className="text-[15px] font-bold text-[#1d1d1f]">${hedge.entryPrice.toLocaleString()}</div>
                        <div className="text-[11px] font-medium text-[#1d1d1f]">Now: ${hedge.currentPrice.toFixed(0)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Target</div>
                        <div className="text-[15px] font-bold text-[#34C759]">${hedge.targetPrice.toLocaleString()}</div>
                        <div className="text-[11px] font-medium text-[#1d1d1f]">
                          {((hedge.currentPrice - hedge.targetPrice) / hedge.targetPrice * 100).toFixed(1)}% away
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Stop Loss</div>
                        <div className="text-[15px] font-bold text-[#FF3B30]">${hedge.stopLoss.toLocaleString()}</div>
                        <div className="text-[11px] text-[#86868b]">
                          {((hedge.stopLoss - hedge.currentPrice) / hedge.currentPrice * 100).toFixed(1)}% away
                        </div>
                      </div>
                    </div>

                    {/* ZK Privacy & Proxy Wallet Section */}
                    {hedge.onChain && hedge.zkVerified && (
                      <div className="mt-4 pt-4 border-t border-[#e8e8ed]">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 rounded-lg bg-[#5856D6]/10 flex items-center justify-center">
                            <Shield className="w-3.5 h-3.5 text-[#5856D6]" />
                          </div>
                          <span className="text-[12px] font-semibold text-[#5856D6] uppercase tracking-wider">ZK Privacy Shield</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="p-2.5 bg-[#5856D6]/5 rounded-lg border border-[#5856D6]/10">
                            <div className="text-[9px] font-bold text-[#5856D6] uppercase tracking-wider mb-1">ZK Privacy Address</div>
                            {hedge.proxyWallet ? (
                              <a
                                href={`https://explorer.cronos.org/testnet/address/${hedge.proxyWallet}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[#007AFF] hover:underline"
                              >
                                <span className="font-mono text-[11px]">{hedge.proxyWallet.slice(0, 8)}...{hedge.proxyWallet.slice(-6)}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ) : (
                              <span className="font-mono text-[11px] text-[#86868b]">Deriving...</span>
                            )}
                            <div className="text-[9px] text-[#86868b] mt-0.5">Privacy ID — not a fund holder</div>
                          </div>
                          <div className="p-2.5 bg-[#5856D6]/5 rounded-lg border border-[#5856D6]/10">
                            <div className="text-[9px] font-bold text-[#5856D6] uppercase tracking-wider mb-1">ZK Verification</div>
                            <div className="flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5 text-[#34C759]" />
                              <span className="text-[12px] font-semibold text-[#34C759]">Verified</span>
                            </div>
                            <div className="text-[9px] text-[#86868b] mt-0.5">STARK proof on-chain</div>
                          </div>
                          <div className="p-2.5 bg-[#5856D6]/5 rounded-lg border border-[#5856D6]/10">
                            <div className="text-[9px] font-bold text-[#5856D6] uppercase tracking-wider mb-1">Funds Location</div>
                            <a
                              href="https://explorer.cronos.org/testnet/address/0x090b6221137690EbB37667E4644287487CE462B9"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[#007AFF] hover:underline"
                            >
                              <span className="font-mono text-[11px]">HedgeExecutor</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                            <div className="text-[9px] text-[#86868b] mt-0.5">
                              Withdraw → {hedge.walletAddress ? `${hedge.walletAddress.slice(0, 6)}...${hedge.walletAddress.slice(-4)}` : 'your wallet'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#e8e8ed] text-[11px] text-[#86868b]">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(hedge.openedAt).toLocaleString()}</span>
                        </div>
                        <div>Capital: ${hedge.capitalUsed?.toLocaleString()} USDC</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {hedge.onChain && (
                          <span className="text-[9px] text-[#5856D6] font-medium">
                            <Lock className="w-2.5 h-2.5 inline mr-0.5" />Funds return to your wallet on close
                          </span>
                        )}
                        <button
                          onClick={() => handleClosePosition(hedge)}
                          disabled={closingPosition === hedge.id}
                          className="px-4 py-1.5 bg-[#FF3B30]/10 hover:bg-[#FF3B30]/20 text-[#FF3B30] rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {closingPosition === hedge.id ? (
                            <><RefreshCw className="w-3 h-3 animate-spin" />Closing &amp; Withdrawing...</>
                          ) : (
                            <>{hedge.onChain ? '⚡ Close & Withdraw (Gasless)' : 'Close Position'}</>
                          )}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          ) : closedHedges.length > 0 ? (
            /* Show closed positions when no active hedges */
            <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/5 p-3 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-[13px] sm:text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
                    Closed Positions
                  </h3>
                  <span className="text-[11px] text-[#86868b]">{closedHedges.length} total</span>
                </div>
                <button
                  onClick={() => onCreateHedge?.()}
                  className="px-3 py-1.5 bg-[#007AFF] text-white rounded-[10px] text-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all flex items-center gap-1.5"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Create Hedge</span>
                </button>
              </div>
              <div className="space-y-2">
                {closedHedges.map((hedge) => (
                  <div
                    key={hedge.id}
                    className="flex items-center justify-between p-3 bg-[#f5f5f7] rounded-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${
                        hedge.type === 'SHORT' ? 'bg-[#FF3B30]/10' : 'bg-[#34C759]/10'
                      }`}>
                        {hedge.type === 'SHORT' ? (
                          <TrendingDown className="w-4 h-4 text-[#FF3B30]" strokeWidth={2} />
                        ) : (
                          <TrendingUp className="w-4 h-4 text-[#34C759]" strokeWidth={2} />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-semibold text-[#1d1d1f]">{hedge.type} {hedge.asset}</span>
                          <span className="px-1.5 py-0.5 bg-[#86868b]/20 text-[#86868b] text-[9px] font-bold rounded">CLOSED</span>
                        </div>
                        <div className="text-[11px] text-[#86868b] space-y-0.5">
                          <div>{hedge.closedAt ? `Closed ${new Date(hedge.closedAt).toLocaleDateString()}` : hedge.reason}</div>
                          {hedge.txHash && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] uppercase tracking-wider">TX:</span>
                              <a
                                href={`https://explorer.cronos.org/testnet/tx/${hedge.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="font-mono">{hedge.txHash.slice(0, 10)}...{hedge.txHash.slice(-8)}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[15px] font-bold ${hedge.pnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                        {hedge.pnl >= 0 ? '+' : ''}{hedge.pnl.toFixed(2)}
                      </div>
                      <div className={`text-[11px] ${hedge.pnlPercent >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                        {hedge.pnlPercent >= 0 ? '+' : ''}{hedge.pnlPercent.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Closed Positions - Only in expanded view when there ARE active hedges */}
          {closedHedges.length > 0 && activeHedges.length > 0 && showClosedPositions && (
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
                          <div className="text-[11px] text-[#86868b] mt-0.5 space-y-0.5">
                            <div>{hedge.closedAt && `Closed ${new Date(hedge.closedAt).toLocaleDateString()}`}</div>
                            {hedge.txHash && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider">TRANSACTION:</span>
                                <a
                                  href={`https://explorer.cronos.org/testnet/tx/${hedge.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-0.5 text-[#007AFF] hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                  title="View on Cronos Explorer"
                                >
                                  <span className="font-mono">{hedge.txHash.slice(0, 10)}...{hedge.txHash.slice(-8)}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            )}
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

          {/* AI Multi-Agent Recommendations Section */}
          {!compact && (
            <div className="bg-gradient-to-br from-[#f8f9ff] to-[#f0f4ff] rounded-[16px] sm:rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-[#007AFF]/10 p-3 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-[12px] flex items-center justify-center">
                    <Brain className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">
                      AI Multi-Agent Recommendations
                    </h3>
                    <span className="text-[11px] text-[#86868b]">
                      LeadAgent • RiskAgent • HedgingAgent orchestration
                    </span>
                  </div>
                </div>
                <button
                  onClick={loadRecommendations}
                  disabled={loadingRecommendations}
                  className="p-2 rounded-[10px] hover:bg-[#007AFF]/10 transition-colors disabled:opacity-50"
                  title="Refresh recommendations"
                >
                  <RefreshCw className={`w-4 h-4 text-[#007AFF] ${loadingRecommendations ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {loadingRecommendations ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 border-2 border-[#007AFF]/30 border-t-[#007AFF] rounded-full animate-spin" />
                    <span className="text-[13px] text-[#86868b]">Multi-agent analysis in progress...</span>
                  </div>
                </div>
              ) : recommendations.length > 0 ? (
                <div className="space-y-3">
                  {recommendations.map((rec, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="p-4 bg-white rounded-[14px] border border-[#007AFF]/10 hover:border-[#007AFF]/30 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[14px] font-semibold text-[#1d1d1f]">
                              {rec.strategy}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              rec.confidence >= 0.7 
                                ? 'bg-[#34C759]/10 text-[#34C759]' 
                                : rec.confidence >= 0.5 
                                  ? 'bg-[#FF9500]/10 text-[#FF9500]'
                                  : 'bg-[#86868b]/10 text-[#86868b]'
                            }`}>
                              {(rec.confidence * 100).toFixed(0)}% Confidence
                            </span>
                          </div>
                          <p className="text-[12px] text-[#86868b] leading-relaxed">
                            {rec.description}
                          </p>
                          {rec.agentSource && (
                            <div className="flex items-center gap-1 mt-2">
                              <Sparkles className="w-3 h-3 text-[#5856D6]" />
                              <span className="text-[10px] text-[#5856D6] font-medium">
                                {rec.agentSource}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-[#86868b] mb-1">Risk Reduction</div>
                          <div className="text-[15px] font-bold text-[#34C759]">
                            {((rec.expectedReduction || 0) * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      {rec.actions && rec.actions.length > 0 && (
                        <div className="flex items-center justify-between pt-3 border-t border-[#e8e8ed]">
                          <div className="flex items-center gap-3 text-[11px] text-[#86868b]">
                            <span className={`font-semibold ${
                              rec.actions[0].action === 'SHORT' ? 'text-[#FF3B30]' : 'text-[#34C759]'
                            }`}>
                              {rec.actions[0].action} {rec.actions[0].asset}
                            </span>
                            <span>Size: {rec.actions[0].size?.toFixed(4) || '0.25'}</span>
                            <span>{rec.actions[0].leverage || 5}x leverage</span>
                          </div>
                          <button
                            onClick={() => executeRecommendation(rec)}
                            disabled={executingRecommendation === rec.strategy}
                            className="px-4 py-2 bg-[#007AFF] text-white rounded-[10px] text-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {executingRecommendation === rec.strategy ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Executing...
                              </>
                            ) : (
                              <>
                                <Zap className="w-3.5 h-3.5" />
                                Execute
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-[#f5f5f7] rounded-[14px] flex items-center justify-center mx-auto mb-3">
                    <Brain className="w-6 h-6 text-[#86868b]" />
                  </div>
                  <p className="text-[13px] text-[#86868b] mb-3">
                    No recommendations yet. Click refresh to run multi-agent analysis.
                  </p>
                  <button
                    onClick={loadRecommendations}
                    className="px-4 py-2 bg-[#007AFF] text-white rounded-[10px] text-[13px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
                  >
                    Run AI Analysis
                  </button>
                </div>
              )}
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

                {selectedHedge.onChain && (
                  <div className="p-3 bg-[#AF52DE]/10 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-[#AF52DE]" />
                      <span className="text-[12px] font-semibold text-[#AF52DE]">⚡ x402 Gasless Close &amp; Withdraw</span>
                    </div>
                    <p className="text-[11px] text-[#1d1d1f]">
                      This will execute <code className="text-[10px] bg-[#AF52DE]/10 px-1 py-0.5 rounded">closeHedge()</code> via x402 gasless relay. 
                      Your collateral {selectedHedge.pnl >= 0 ? '+ profit' : '- loss'} will be transferred directly back to your wallet — <strong>zero gas fees</strong>.
                    </p>
                    <div className="flex items-center gap-1 text-[10px] text-[#86868b]">
                      <span>Contract:</span>
                      <span className="font-mono">0x090b...62B9</span>
                      <span>→</span>
                      <span className="font-semibold text-[#1d1d1f]">Your original wallet</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#86868b]">Estimated return</span>
                      <span className="font-semibold text-[#1d1d1f]">
                        {Math.max(0, selectedHedge.capitalUsed + selectedHedge.pnl).toLocaleString()} USDC
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#86868b]">Gas cost to you</span>
                      <span className="font-semibold text-[#34C759]">$0.00 ✅</span>
                    </div>
                  </div>
                )}
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
                  {selectedHedge.onChain ? '⚡ Close & Withdraw (Gasless)' : 'Close Position'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Close Receipt Modal — shows full transaction details after close */}
      <AnimatePresence>
        {closeReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setCloseReceipt(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className={`p-5 ${closeReceipt.success ? 'bg-gradient-to-r from-[#34C759]/10 to-[#007AFF]/10' : 'bg-[#FF3B30]/10'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${closeReceipt.success ? 'bg-[#34C759]/20' : 'bg-[#FF3B30]/20'}`}>
                    {closeReceipt.success ? (
                      <CheckCircle className="w-7 h-7 text-[#34C759]" />
                    ) : (
                      <XCircle className="w-7 h-7 text-[#FF3B30]" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-[18px] font-bold text-[#1d1d1f]">
                      {closeReceipt.success ? 'Position Closed' : 'Close Failed'}
                    </h3>
                    <p className="text-[12px] text-[#86868b]">
                      {closeReceipt.success
                        ? `${closeReceipt.asset} ${closeReceipt.side} x${closeReceipt.leverage} — ${closeReceipt.finalStatus}`
                        : closeReceipt.error}
                    </p>
                  </div>
                </div>
              </div>

              {closeReceipt.success && (
                <div className="p-5 space-y-4">
                  {/* Fund Flow Visualization */}
                  <div className="p-4 bg-[#f5f5f7] rounded-xl space-y-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#86868b]">Fund Flow</div>
                    
                    {/* Step 1: Contract releases */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#007AFF]/10 flex items-center justify-center text-[10px] font-bold text-[#007AFF]">1</div>
                      <div className="flex-1">
                        <div className="text-[11px] font-medium text-[#1d1d1f]">HedgeExecutor closes trade on DEX</div>
                        <div className="text-[9px] text-[#86868b] font-mono">0x090b...62B9 → closeHedge()</div>
                      </div>
                    </div>
                    
                    {/* Step 2: DEX returns */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#007AFF]/10 flex items-center justify-center text-[10px] font-bold text-[#007AFF]">2</div>
                      <div className="flex-1">
                        <div className="text-[11px] font-medium text-[#1d1d1f]">DEX returns collateral {closeReceipt.realizedPnl >= 0 ? '+ profit' : '- loss'}</div>
                        <div className="text-[9px] text-[#86868b]">Moonlander → HedgeExecutor</div>
                      </div>
                    </div>
                    
                    {/* Step 3: Funds sent to wallet */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#34C759]/10 flex items-center justify-center text-[10px] font-bold text-[#34C759]">3</div>
                      <div className="flex-1">
                        <div className="text-[11px] font-medium text-[#1d1d1f]">USDC sent to your wallet</div>
                        <div className="text-[9px] text-[#86868b] font-mono">→ {closeReceipt.trader.slice(0, 8)}...{closeReceipt.trader.slice(-6)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Financial Summary */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Collateral</span>
                      <span className="text-[13px] font-semibold text-[#1d1d1f]">{closeReceipt.collateral.toLocaleString()} USDC</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Realized P/L</span>
                      <span className={`text-[13px] font-bold ${closeReceipt.realizedPnl >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                        {closeReceipt.realizedPnl >= 0 ? '+' : ''}{closeReceipt.realizedPnl.toLocaleString()} USDC
                      </span>
                    </div>
                    <div className="h-px bg-[#e8e8ed]" />
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-[#1d1d1f]">Returned to Wallet</span>
                      <span className={`text-[15px] font-bold ${closeReceipt.fundsReturned > 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                        {closeReceipt.fundsReturned > 0 ? closeReceipt.fundsReturned.toLocaleString() : '0'} USDC
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#86868b]">Balance before</span>
                      <span className="font-mono text-[#86868b]">{closeReceipt.balanceBefore.toLocaleString()} USDC</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#86868b]">Balance after</span>
                      <span className="font-mono font-semibold text-[#1d1d1f]">{closeReceipt.balanceAfter.toLocaleString()} USDC</span>
                    </div>
                  </div>

                  {/* Gas Savings */}
                  {closeReceipt.gasless && closeReceipt.gasSavings && (
                    <div className="p-3 bg-[#AF52DE]/5 rounded-xl border border-[#AF52DE]/10">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Zap className="w-3.5 h-3.5 text-[#AF52DE]" />
                        <span className="text-[11px] font-semibold text-[#AF52DE]">x402 Gasless</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#86868b]">Your gas cost</span>
                        <span className="font-semibold text-[#34C759]">{closeReceipt.gasSavings.userGasCost}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#86868b]">Gas sponsored by relayer</span>
                        <span className="font-mono text-[#86868b]">{closeReceipt.gasSavings.relayerGasCost}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] mt-1">
                        <span className="text-[#86868b]">You saved</span>
                        <span className="font-bold text-[#34C759]">{closeReceipt.gasSavings.totalSaved}</span>
                      </div>
                    </div>
                  )}

                  {/* Transaction Link */}
                  {closeReceipt.txHash && (
                    <a
                      href={closeReceipt.explorerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 p-3 bg-[#007AFF]/5 rounded-xl text-[#007AFF] hover:bg-[#007AFF]/10 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span className="text-[12px] font-semibold">View on Cronos Explorer</span>
                      <span className="text-[10px] font-mono text-[#86868b]">{closeReceipt.txHash.slice(0, 10)}...{closeReceipt.txHash.slice(-8)}</span>
                    </a>
                  )}

                  {closeReceipt.elapsed && (
                    <div className="text-center text-[10px] text-[#86868b]">
                      Transaction completed in {closeReceipt.elapsed}
                    </div>
                  )}
                </div>
              )}

              {/* Dismiss Button */}
              <div className="p-5 pt-0">
                <button
                  onClick={() => setCloseReceipt(null)}
                  className={`w-full px-4 py-3 rounded-xl text-[15px] font-semibold transition-colors ${
                    closeReceipt.success
                      ? 'bg-[#34C759] hover:bg-[#34C759]/90 text-white'
                      : 'bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white'
                  }`}
                >
                  {closeReceipt.success ? 'Done' : 'Dismiss'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
