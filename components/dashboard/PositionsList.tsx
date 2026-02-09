'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { TrendingUp, TrendingDown, Wallet, Bitcoin, Coins, DollarSign, RefreshCw, ArrowDownToLine, Sparkles, ExternalLink, Shield, Target, PieChart, Activity, Clock, Plus, Zap } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useUserPortfolios } from '../../lib/contracts/hooks';
import { DepositModal } from './DepositModal';
import { WithdrawModal } from './WithdrawModal';
import PortfolioDetailModal from './PortfolioDetailModal';
import { AdvancedPortfolioCreator } from './AdvancedPortfolioCreator';
import { DelphiMarketService, type PredictionMarket } from '@/lib/services/DelphiMarketService';
import { usePositions } from '@/contexts/PositionsContext';
import { logger } from '@/lib/utils/logger';

interface Position {
  symbol: string;
  balance: string;
  balanceUSD: string;
  price: string;
  change24h: number;
}

interface AgentRecommendation {
  action: 'WITHDRAW' | 'HEDGE' | 'ADD_FUNDS' | 'HOLD';
  confidence: number;
  reasoning: string[];
  riskScore: number;
  agentAnalysis: {
    riskAgent: string;
    hedgingAgent: string;
    leadAgent: string;
  };
  recommendations: string[];
}

interface SettlementBatch {
  type: string;
  status: string;
}

interface PortfolioAssetDetail {
  symbol: string;
  address: string;
  allocation: number;
  value: number;
  change24h: number;
}

interface PortfolioTransaction {
  type: 'deposit' | 'withdraw' | 'rebalance';
  timestamp: number;
  amount?: number;
  token?: string;
  changes?: { from: number; to: number; asset: string }[];
  txHash: string;
}

interface PortfolioDetail {
  id: number;
  name: string;
  totalValue: number;
  status: 'FUNDED' | 'EMPTY' | 'NEW';
  targetAPY: number;
  riskLevel: 'Low' | 'Medium' | 'High';
  currentYield: number;
  assets: PortfolioAssetDetail[];
  lastRebalanced: number;
  transactions: PortfolioTransaction[];
  aiAnalysis: {
    summary: string;
    recommendations: string[];
    riskAssessment: string;
  };
}

interface PositionsListProps {
  address: string;
  onOpenHedge?: (market: PredictionMarket) => void;
}

interface AssetBalance {
  token: string;
  symbol: string;
  balance: string;
  valueUSD: number;
}

interface OnChainPortfolio {
  id: number;
  owner: string;
  totalValue: string;  // Store as string to avoid BigInt serialization issues
  calculatedValueUSD?: number; // Actual USD value calculated from asset balances
  targetYield: string;
  riskTolerance: string;
  lastRebalance: string;
  isActive: boolean;
  assets: string[];
  assetBalances?: AssetBalance[]; // Detailed balance info per asset
  predictions?: PredictionMarket[]; // Delphi predictions for this portfolio
  txHash?: string | null; // Transaction hash from portfolio creation
}

// Memoized token icon component for better performance
const TokenIcon = memo(({ symbol }: { symbol: string }) => {
  const iconClasses = "w-6 h-6";
  switch (symbol.toUpperCase()) {
    case 'BTC':
    case 'WBTC':
      return <Bitcoin className={`${iconClasses} text-orange-500`} />;
    case 'ETH':
    case 'WETH':
      return <Coins className={`${iconClasses} text-blue-400`} />;
    case 'USDC':
    case 'USDT':
      return <DollarSign className={`${iconClasses} text-green-400`} />;
    case 'CRO':
      return <Coins className={`${iconClasses} text-[#007AFF]`} />;
    default:
      return <Coins className={`${iconClasses} text-[#86868b]`} />;
  }
});
TokenIcon.displayName = 'TokenIcon';

// Memoized position row component
const PositionRow = memo(({ position, idx }: { position: Position; idx: number }) => (
  <div key={idx} className="px-3 sm:px-4 py-3 sm:py-4 hover:bg-white/50 transition-colors">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-9 h-9 sm:w-11 sm:h-11 bg-white rounded-[10px] sm:rounded-[12px] flex items-center justify-center flex-shrink-0">
          <TokenIcon symbol={position.symbol} />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] sm:text-[15px] font-semibold text-[#1d1d1f]">{position.symbol}</div>
          <div className="text-[11px] sm:text-[13px] text-[#86868b] truncate">
            {parseFloat(position.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </div>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[15px] sm:text-[17px] font-bold text-[#1d1d1f]">
          ${parseFloat(position.balanceUSD || '0').toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="flex items-center gap-1.5 justify-end">
          <span className="text-[11px] sm:text-[12px] text-[#86868b]">
            @${parseFloat(position.price || '0').toFixed(4)}
          </span>
          {position.change24h !== 0 && (
            <span className={`text-[11px] sm:text-[12px] font-medium flex items-center ${position.change24h >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
              {position.change24h >= 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
              {Math.abs(position.change24h).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  </div>
));
PositionRow.displayName = 'PositionRow';

export function PositionsList({ address, onOpenHedge }: PositionsListProps) {
  const { isConnected } = useAccount();
  // Get only portfolios owned by the connected wallet
  const { data: userPortfolios, count: _userPortfolioCount, isLoading: portfolioLoading } = useUserPortfolios(address);
  const { positionsData, derived, error: positionsError, refetch: refetchPositions } = usePositions();
  const [onChainPortfolios, setOnChainPortfolios] = useState<OnChainPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  
  // Derived from context
  const positions = positionsData?.positions || [];
  const totalValue = positionsData?.totalValue || 0;
  const lastUpdated = positionsData ? new Date(positionsData.lastUpdated) : null;
  const _error = positionsError;
  
  // Deposit modal state
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<OnChainPortfolio | null>(null);

  // Withdraw modal state
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [selectedWithdrawPortfolio, setSelectedWithdrawPortfolio] = useState<OnChainPortfolio | null>(null);

  // Portfolio detail modal state
  const [portfolioDetailOpen, setPortfolioDetailOpen] = useState(false);
  const [selectedDetailPortfolio, setSelectedDetailPortfolio] = useState<PortfolioDetail | null>(null);

  // Agent recommendation state
  const [agentRecommendation, setAgentRecommendation] = useState<AgentRecommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [showRecommendationModal, setShowRecommendationModal] = useState(false);
  const [analyzedPortfolio, setAnalyzedPortfolio] = useState<OnChainPortfolio | null>(null);

  // Expanded predictions state (portfolio ID -> boolean)
  const [_expandedPredictions, _setExpandedPredictions] = useState<Record<number, boolean>>({});
  
  // Collapseable strategies section - default to expanded for quick view
  const [_strategiesCollapsed, _setStrategiesCollapsed] = useState(false);

  const openDepositModal = (portfolio: OnChainPortfolio) => {
    setSelectedPortfolio(portfolio);
    setDepositModalOpen(true);
  };

  const closeDepositModal = () => {
    setDepositModalOpen(false);
    setSelectedPortfolio(null);
  };

  const openWithdrawModal = (portfolio: OnChainPortfolio) => {
    setSelectedWithdrawPortfolio(portfolio);
    setWithdrawModalOpen(true);
  };

  // Fetch agent recommendation for portfolio action
  const fetchAgentRecommendation = async (portfolio: OnChainPortfolio) => {
    setRecommendationLoading(true);
    setAnalyzedPortfolio(portfolio);
    try {
      const portfolioAssets = portfolio.assets.map(asset => {
        const addr = asset.toLowerCase();
        if (addr === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0') return 'USDC';
        if (addr.includes('wcro')) return 'CRO';
        return asset.slice(0, 6);
      });

      // FETCH REAL PREDICTIONS from Polymarket/Delphi
      logger.info('Fetching real prediction market data for assets', { component: 'PositionsList', data: portfolioAssets });
      let predictions: PredictionMarket[] = [];
      try {
        predictions = await DelphiMarketService.getRelevantMarkets(portfolioAssets);
        logger.info(`Got ${predictions.length} predictions from Polymarket/Delphi`, { component: 'PositionsList', data: predictions.slice(0, 3).map(p => ({ q: p.question.slice(0, 50), prob: p.probability, rec: p.recommendation })) });
      } catch (predError) {
        logger.warn('Failed to fetch predictions', { component: 'PositionsList', error: String(predError) });
        predictions = [];
      }

      // Calculate REAL metrics from positions context
      const realMetrics = derived ? {
        volatility: derived.weightedVolatility,
        sharpeRatio: derived.sharpeRatio,
        topAssets: derived.topAssets,
        totalChange24h: derived.totalChange24h,
      } : null;

      const riskScore = realMetrics 
        ? Math.round((realMetrics.volatility * 50) + (
            positionsData?.totalValue && realMetrics.topAssets.length > 0
              ? (realMetrics.topAssets[0].value / positionsData.totalValue) * 50
              : 0
          ))
        : 50;

      // Count active hedge signals from localStorage
      let hedgeSignals = 0;
      if (typeof window !== 'undefined') {
        const settlements = localStorage.getItem('settlement_history');
        if (settlements) {
          const settlementData = JSON.parse(settlements);
          hedgeSignals = Object.values(settlementData).filter(
            (batch) => {
              const b = batch as SettlementBatch;
              return b.type === 'hedge' && b.status !== 'closed';
            }
          ).length;
        }
      }

      // Filter predictions that recommend HEDGE or have HIGH impact
      const highRiskPredictions = predictions.filter(
        p => p.recommendation === 'HEDGE' || (p.impact === 'HIGH' && p.probability > 60)
      );
      logger.info(`High risk predictions: ${highRiskPredictions.length}`, { component: 'PositionsList', data: highRiskPredictions.map(p => ({ q: p.question.slice(0, 40), prob: p.probability })) });

      const response = await fetch('/api/agents/portfolio-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId: portfolio.id,
          currentValue: parseFloat(portfolio.totalValue) / 1e6, // Assuming USDC 6 decimals
          targetYield: parseFloat(portfolio.targetYield) / 100,
          riskTolerance: parseFloat(portfolio.riskTolerance),
          assets: portfolioAssets,
          // Pass real calculated metrics
          realMetrics: {
            riskScore,
            volatility: realMetrics?.volatility || 0.3,
            sharpeRatio: realMetrics?.sharpeRatio || 0,
            hedgeSignals: hedgeSignals + highRiskPredictions.length, // Include prediction signals
            totalValue: positionsData?.totalValue || 0,
          },
          // Pass REAL predictions from Polymarket/Delphi
          predictions: predictions.map(p => ({
            question: p.question,
            probability: p.probability,
            impact: p.impact,
            recommendation: p.recommendation,
            source: p.source || 'polymarket',
          })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setAgentRecommendation(data);
        setShowRecommendationModal(true);
      } else {
        logger.error('Failed to get agent recommendation', undefined, { component: 'PositionsList' });
      }
    } catch (error) {
      logger.error('Error fetching agent recommendation', error, { component: 'PositionsList' });
    } finally {
      setRecommendationLoading(false);
    }
  };

  const closeWithdrawModal = () => {
    setWithdrawModalOpen(false);
    setSelectedWithdrawPortfolio(null);
  };

  const handleDepositSuccess = () => {
    // Refresh data after successful deposit
    refetchPositions();
    fetchOnChainPortfolios();
  };

  const handleWithdrawSuccess = () => {
    // Refresh data after successful withdrawal
    refetchPositions();
    fetchOnChainPortfolios();
  };

  // Fetch on-chain portfolios from contract - OPTIMIZED with parallel fetching
  const fetchOnChainPortfolios = useCallback(async () => {
    if (!userPortfolios || userPortfolios.length === 0) {
      setOnChainPortfolios([]);
      return;
    }

    logger.info(`Processing ${userPortfolios.length} user portfolios (parallel)`, { component: 'PositionsList' });
    const startTime = Date.now();
    
    // PARALLEL: Fetch all portfolio assets simultaneously
    const portfolioPromises = userPortfolios
      .filter(p => p.isActive)
      .map(async (p) => {
        const portfolio: OnChainPortfolio = {
          id: p.id,
          owner: p.owner,
          totalValue: p.totalValue.toString(),
          targetYield: p.targetYield.toString(),
          riskTolerance: p.riskTolerance.toString(),
          lastRebalance: p.lastRebalance.toString(),
          isActive: p.isActive,
          assets: [],
          assetBalances: [],
          calculatedValueUSD: 0,
          predictions: [], // Empty - fetch on-demand only
          txHash: p.txHash,
        };
        
        // Fetch assets and calculated value from API
        try {
          const assetsRes = await fetch(`/api/portfolio/${p.id}`);
          if (assetsRes.ok) {
            const data = await assetsRes.json();
            portfolio.assets = data.assets || [];
            portfolio.assetBalances = data.assetBalances || [];
            portfolio.calculatedValueUSD = data.calculatedValueUSD || 0;
            
            // Also update totalValue if API provides a better one
            if (data.totalValue) {
              portfolio.totalValue = data.totalValue;
            }
          }
        } catch (err) {
          logger.warn(`Failed to fetch assets for portfolio ${p.id}`, { component: 'PositionsList', error: String(err) });
        }
        
        return portfolio;
      });
    
    // Wait for all portfolios in parallel
    const portfolios = await Promise.all(portfolioPromises);
    setOnChainPortfolios(portfolios);
    logger.info(`Loaded ${portfolios.length} portfolios in ${Date.now() - startTime}ms`, { component: 'PositionsList' });
  }, [userPortfolios]);

  useEffect(() => {
    async function loadAll() {
      await fetchOnChainPortfolios();
      setHasInitiallyLoaded(true);
    }
    
    if (address && isConnected) {
      loadAll();
    }
  }, [address, isConnected, userPortfolios, positionsData]); // Re-fetch when userPortfolios changes

  // Only set loading to false when BOTH positions AND portfolios are ready
  useEffect(() => {
    if (positionsData && hasInitiallyLoaded && !portfolioLoading) {
      setLoading(false);
    }
  }, [positionsData, hasInitiallyLoaded, portfolioLoading]);

  // Safety timeout - force loading off after 10 seconds to prevent infinite loading
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.warn('[PositionsList] Forcing loading=false after timeout');
        setLoading(false);
        setHasInitiallyLoaded(true);
      }
    }, 10000);
    return () => clearTimeout(timeoutId);
  }, [loading]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchPositions(), fetchOnChainPortfolios()]);
    setRefreshing(false);
  }, [refetchPositions, fetchOnChainPortfolios]);

  // Memoize weighted 24h change calculation
  const weighted24hChange = useMemo(() => {
    if (totalValue === 0 || positions.length === 0) return 0;
    return positions.reduce((acc, pos) => {
      const posValue = parseFloat(pos.balanceUSD || '0');
      const weight = posValue / totalValue;
      return acc + (pos.change24h * weight);
    }, 0);
  }, [positions, totalValue]);

  // First check if wallet is connected - before any loading checks
  if (!isConnected) {
    return (
      <div className="bg-white rounded-[20px] shadow-sm border border-black/5 p-12 text-center">
        <div className="w-20 h-20 bg-[#f5f5f7] rounded-[22px] flex items-center justify-center mx-auto mb-5">
          <Wallet className="w-10 h-10 text-[#86868b]" />
        </div>
        <h3 className="text-[22px] font-semibold text-[#1d1d1f] mb-2 tracking-[-0.02em]">Connect Your Wallet</h3>
        <p className="text-[15px] text-[#86868b] max-w-[280px] mx-auto mb-6">
          Connect your wallet to view your token positions and portfolio strategies
        </p>
        
        {/* AI Assistant CTA - available even without wallet */}
        <div className="mt-6 pt-6 border-t border-[#e8e8ed]">
          <div className="flex items-center justify-center gap-2 text-[#007AFF] mb-3">
            <Sparkles className="w-5 h-5" />
            <span className="text-[15px] font-semibold">AI Portfolio Assistant Available</span>
          </div>
          <p className="text-[13px] text-[#86868b] max-w-[320px] mx-auto">
            While you connect, feel free to chat with our AI assistant to learn about portfolio strategies and DeFi concepts
          </p>
        </div>
      </div>
    );
  }

  // Show loading state with detailed skeleton for expected tokens (only when connected)
  if (loading || !positionsData || portfolioLoading || !hasInitiallyLoaded) {
    const expectedTokens = ['CRO', 'devUSDC', 'WCRO'];
    
    return (
      <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
        {/* Header skeleton */}
        <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[18px] p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="h-6 w-32 bg-[#e8e8ed] rounded animate-pulse" />
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#007AFF]/10 rounded-full">
                  <RefreshCw className="w-3 h-3 text-[#007AFF] animate-spin" />
                  <span className="text-[9px] font-bold text-[#007AFF]">LOADING</span>
                </span>
              </div>
              <div className="h-3 w-48 bg-[#e8e8ed] rounded animate-pulse" />
            </div>
            <div className="text-right">
              <div className="h-8 w-32 bg-[#e8e8ed] rounded animate-pulse mb-1" />
              <div className="h-3 w-24 bg-[#e8e8ed] rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* Token skeletons with loading indicators */}
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Loading Positions</h3>
            <span className="text-[11px] text-[#86868b]">Fetching balances...</span>
          </div>
          
          {expectedTokens.map((token, index) => (
            <div
              key={token}
              className="bg-white rounded-[14px] p-4 border border-[#e8e8ed] shadow-sm"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Token icon skeleton */}
                  <div className="w-10 h-10 bg-[#f5f5f7] rounded-full animate-pulse" />
                  
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[15px] font-semibold text-[#1d1d1f]">{token}</span>
                      <span className="text-[11px] text-[#86868b] bg-[#f5f5f7] px-2 py-0.5 rounded flex items-center gap-1">
                        <div className="w-1.5 h-1.5 bg-[#007AFF] rounded-full animate-pulse" />
                        Loading
                      </span>
                    </div>
                    <div className="h-3 w-24 bg-[#f5f5f7] rounded animate-pulse" />
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="h-5 w-20 bg-[#f5f5f7] rounded animate-pulse mb-1" />
                  <div className="h-3 w-16 bg-[#f5f5f7] rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Progress indicator */}
        <div className="bg-white rounded-[14px] p-4 border border-[#e8e8ed]">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-[#007AFF] animate-spin flex-shrink-0" />
            <div className="flex-1">
              <p className="text-[13px] text-[#1d1d1f] font-medium mb-1">Fetching market data</p>
              <div className="w-full h-1.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                <div className="h-full bg-[#007AFF] rounded-full animate-[loading_2s_ease-in-out_infinite]" style={{ width: '60%' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-6">
      {/* Apple Light Theme Header */}
      <div className="relative overflow-hidden rounded-2xl bg-[#f5f5f7] p-6 sm:p-8">
        <div className="relative z-10">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-[24px] sm:text-[28px] font-bold text-[#1d1d1f] tracking-[-0.02em]">Portfolio Overview</h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#34C759]/10 rounded-full">
                  <span className="w-1.5 h-1.5 bg-[#34C759] rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-[#34C759]">LIVE</span>
                </span>
              </div>
              <p className="text-[13px] text-[#86868b]">
                {lastUpdated ? `Last synced ${lastUpdated.toLocaleTimeString()}` : 'Syncing...'}
              </p>
            </div>
            
            {/* Total Value - Prominent Display */}
            <div className="sm:text-right">
              <div className="text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.05em] mb-1">Total Portfolio Value</div>
              <div className="text-[32px] sm:text-[42px] font-bold text-[#1d1d1f] leading-none tracking-[-0.02em]">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-white hover:bg-[#e8e8ed] rounded-lg text-[12px] text-[#1d1d1f] font-medium transition-all disabled:opacity-50 shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Stats Cards Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Tokens */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#FF9500]/10 flex items-center justify-center">
                  <Coins className="w-4 h-4 text-[#FF9500]" />
                </div>
                <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Tokens</span>
              </div>
              <div className="text-[26px] font-bold text-[#1d1d1f]">{positions.length}</div>
            </div>
            
            {/* Portfolios */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#007AFF]/10 flex items-center justify-center">
                  <PieChart className="w-4 h-4 text-[#007AFF]" />
                </div>
                <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Portfolios</span>
              </div>
              <div className="text-[26px] font-bold text-[#007AFF]">{onChainPortfolios.length}</div>
            </div>
            
            {/* 24h Change */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg ${weighted24hChange >= 0 ? 'bg-[#34C759]/10' : 'bg-[#FF3B30]/10'} flex items-center justify-center`}>
                  {weighted24hChange >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-[#34C759]" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-[#FF3B30]" />
                  )}
                </div>
                <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">24h</span>
              </div>
              <div className={`text-[26px] font-bold ${weighted24hChange >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                {weighted24hChange >= 0 ? '+' : ''}{weighted24hChange.toFixed(2)}%
              </div>
            </div>
            
            {/* Active Strategies */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#AF52DE]/10 flex items-center justify-center">
                  <Activity className="w-4 h-4 text-[#AF52DE]" />
                </div>
                <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Active</span>
              </div>
              <div className="text-[26px] font-bold text-[#AF52DE]">
                {onChainPortfolios.filter(p => parseFloat(p.totalValue) > 0 || p.assets.length > 0).length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Portfolio Positions - PRIMARY CONTENT */}
      {onChainPortfolios.length > 0 && (
        <div className="space-y-4">
          {/* Portfolio Section Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#007AFF] rounded-xl flex items-center justify-center">
                <PieChart className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-[17px] sm:text-[19px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Your Portfolios</h3>
                <p className="text-[12px] text-[#86868b]">{onChainPortfolios.length} active strategies on-chain</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 bg-[#34C759]/10 text-[#34C759] text-[12px] font-semibold rounded-full">
                {onChainPortfolios.filter(p => {
                  const calcValue = p.calculatedValueUSD || 0;
                  const rawValue = parseFloat(p.totalValue) || 0;
                  const valueUSD = calcValue > 0 ? calcValue : (rawValue > 1e12 ? rawValue / 1e18 : rawValue / 1e6);
                  return valueUSD > 0;
                }).length} Funded
              </span>
            </div>
          </div>

          {/* Portfolio Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {onChainPortfolios.map((portfolio) => {
              // Use calculatedValueUSD if available (from API), otherwise fall back to totalValue
              let valueUSD = portfolio.calculatedValueUSD || 0;
              
              // If no calculated value, try to parse from totalValue
              if (valueUSD === 0) {
                const rawValue = parseFloat(portfolio.totalValue) || 0;
                valueUSD = rawValue > 1e12 
                  ? rawValue / 1e18
                  : rawValue / 1e6;
              }
              
              // Get deposited assets and their symbols
              const depositedAssets = portfolio.assetBalances?.map(ab => ab.symbol) || 
                portfolio.assets.map(a => {
                  const addr = a.toLowerCase();
                  if (addr === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0') return 'USDC';
                  if (addr.includes('wcro') || addr === '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4') return 'WCRO';
                  return a.slice(0, 6);
                });
              
              // If still no value but has assets, estimate from wallet positions (fallback)
              if (valueUSD === 0 && portfolio.assets.length > 0 && positions.length > 0) {
                let estimatedValue = 0;
                for (const assetSymbol of depositedAssets) {
                  const matchingPosition = positions.find(p => 
                    p.symbol.toUpperCase() === assetSymbol.toUpperCase() ||
                    (assetSymbol.includes('USD') && p.symbol.toLowerCase().includes('usdc'))
                  );
                  if (matchingPosition) {
                    const posValue = parseFloat(matchingPosition.balanceUSD || '0');
                    estimatedValue += posValue > 0 ? posValue : 0;
                  }
                }
                if (estimatedValue > 0) {
                  valueUSD = estimatedValue;
                }
              }
              
              const yieldPercent = parseFloat(portfolio.targetYield) / 100;
              const riskValue = parseFloat(portfolio.riskTolerance) || 0;
              const riskLevel = riskValue <= 33 ? 'Low' : riskValue <= 66 ? 'Medium' : 'High';
              const riskColor = riskLevel === 'Low' ? '#34C759' : riskLevel === 'Medium' ? '#FF9500' : '#FF3B30';
              const riskBg = riskLevel === 'Low' ? 'bg-[#34C759]/10' : riskLevel === 'Medium' ? 'bg-[#FF9500]/10' : 'bg-[#FF3B30]/10';
              const isOwner = portfolio.owner.toLowerCase() === address.toLowerCase();
              
              // Portfolio has assets registered (even if balance is 0)
              const hasRegisteredAssets = portfolio.assets.length > 0;
              // Portfolio has actual funds (value > 0)
              const hasFunds = valueUSD > 0;
              // Show as active if has funds OR has registered assets
              const isActivePortfolio = hasFunds || hasRegisteredAssets;
              
              // Get all registered asset symbols
              const registeredAssets = portfolio.assets.map(a => {
                const addr = a.toLowerCase();
                if (addr === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0') return 'devUSDC';
                if (addr === '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4') return 'WCRO';
                return a.slice(0, 6);
              });
              
              const lastRebalanceTime = parseInt(portfolio.lastRebalance) * 1000;
              const lastRebalanceDate = lastRebalanceTime > 0 ? new Date(lastRebalanceTime) : null;
              const daysSinceRebalance = lastRebalanceDate ? Math.floor((Date.now() - lastRebalanceTime) / (1000 * 60 * 60 * 24)) : null;

              return (
                <div 
                  key={portfolio.id} 
                  className={`relative overflow-hidden rounded-2xl transition-all duration-300 hover:scale-[1.01] cursor-pointer ${
                    isActivePortfolio 
                      ? 'bg-white shadow-sm hover:shadow-md border border-black/5' 
                      : 'bg-[#f5f5f7] border-2 border-dashed border-[#d1d1d6]'
                  }`}
                  onClick={async () => {
                    logger.info(`Opening portfolio #${portfolio.id} detail - Fetching fresh data...`, { component: 'PositionsList' });
                    logger.debug(`Current portfolio.assets: ${JSON.stringify(portfolio.assets)}`, { component: 'PositionsList' });
                    logger.debug(`Current portfolio.assetBalances: ${JSON.stringify(portfolio.assetBalances)}`, { component: 'PositionsList' });
                    
                    // Force refresh portfolio data from API (bypass cache)
                    try {
                      const freshRes = await fetch(`/api/portfolio/${portfolio.id}?refresh=true`);
                      if (freshRes.ok) {
                        const freshData = await freshRes.json();
                        logger.debug(`Fresh API data received for portfolio ${portfolio.id}`, { component: 'PositionsList' });
                        portfolio.assets = freshData.assets || [];
                        portfolio.assetBalances = freshData.assetBalances || [];
                        portfolio.calculatedValueUSD = freshData.calculatedValueUSD || 0;
                      }
                    } catch (err) {
                      logger.warn('Failed to fetch fresh portfolio data', { component: 'PositionsList', error: String(err) });
                    }
                    
                    // Calculate real allocation percentages
                    const totalPortfolioValue = portfolio.calculatedValueUSD || valueUSD;
                    const assetsWithAllocation = portfolio.assetBalances?.map((ab) => {
                      const assetAllocation = totalPortfolioValue > 0 
                        ? Math.round((ab.valueUSD / totalPortfolioValue) * 100) 
                        : 0;
                      return {
                        symbol: ab.symbol,
                        address: ab.token,
                        allocation: assetAllocation,
                        value: ab.valueUSD,
                        change24h: 0 // TODO: Get real 24h change from price feed
                      };
                    }) || [];

                    logger.debug(`Assets with allocation for portfolio ${portfolio.id}`, { component: 'PositionsList', data: assetsWithAllocation });

                    // Fetch real transaction history
                    let transactions: PortfolioTransaction[] = [];
                    try {
                      const txRes = await fetch(`/api/portfolio/${portfolio.id}/transactions`);
                      if (txRes.ok) {
                        const txData = await txRes.json();
                        transactions = txData.transactions || [];
                        logger.debug(`Fetched ${transactions.length} transactions for portfolio ${portfolio.id}`, { component: 'PositionsList' });
                      }
                    } catch (err) {
                      logger.warn('Failed to fetch transactions', { component: 'PositionsList', error: String(err) });
                    }

                    // Open detail modal with portfolio data
                    setSelectedDetailPortfolio({
                      id: portfolio.id,
                      name: `Portfolio #${portfolio.id}`,
                      totalValue: totalPortfolioValue,
                      status: hasFunds ? 'FUNDED' : hasRegisteredAssets ? 'EMPTY' : 'NEW',
                      targetAPY: yieldPercent,
                      riskLevel,
                      currentYield: yieldPercent, // Use same for now
                      assets: assetsWithAllocation,
                      lastRebalanced: lastRebalanceTime,
                      transactions,
                      aiAnalysis: {
                        summary: 'Your portfolio is performing well with balanced asset allocation across stable and growth assets.',
                        recommendations: [
                          'Consider rebalancing if market volatility increases',
                          'Current asset mix aligns with your risk tolerance',
                          'Monitor yield performance against target APY'
                        ],
                        riskAssessment: `This ${riskLevel.toLowerCase()} risk portfolio maintains diversification across ${registeredAssets.length} assets with automated rebalancing.`
                      }
                    });
                    setPortfolioDetailOpen(true);
                  }}
                >
                  {/* Subtle accent for active portfolios */}
                  {isActivePortfolio && (
                    <div className={`absolute top-0 left-0 right-0 h-1 ${hasFunds ? 'bg-[#007AFF]' : 'bg-[#FF9500]'}`} />
                  )}
                  
                  <div className="p-4 sm:p-5">
                    {/* Card Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          isActivePortfolio 
                            ? 'bg-[#007AFF]' 
                            : 'bg-[#e8e8ed]'
                        }`}>
                          <span className={`text-[18px] font-bold ${isActivePortfolio ? 'text-white' : 'text-[#86868b]'}`}>
                            #{portfolio.id}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-bold text-[#1d1d1f]">Portfolio #{portfolio.id}</span>
                            {hasFunds ? (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-[#34C759]/10 rounded-full">
                                <span className="w-1.5 h-1.5 bg-[#34C759] rounded-full animate-pulse" />
                                <span className="text-[10px] font-bold text-[#34C759]">FUNDED</span>
                              </span>
                            ) : hasRegisteredAssets ? (
                              <span className="px-2 py-0.5 bg-[#FF9500]/10 rounded-full text-[10px] font-bold text-[#FF9500]">
                                EMPTY
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-[#86868b]/10 rounded-full text-[10px] font-bold text-[#86868b]">
                                NEW
                              </span>
                            )}
                          </div>
                          {portfolio.txHash && (
                            <a
                              href={`https://explorer.cronos.org/testnet/tx/${portfolio.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-[#86868b] hover:text-[#007AFF] transition-colors flex items-center gap-1 mt-0.5"
                            >
                              <span className="font-mono">{portfolio.txHash.slice(0, 8)}...{portfolio.txHash.slice(-6)}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      
                      {/* Value Display */}
                      <div className="text-right">
                        <div className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider mb-0.5">Value</div>
                        <div className={`text-[22px] font-black tracking-tight ${hasFunds ? 'text-[#1d1d1f]' : 'text-[#86868b]'}`}>
                          ${valueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>

                    {/* Strategy Metrics Row */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {/* Target Yield */}
                      <div className="bg-[#34C759]/5 rounded-xl p-3 border border-[#34C759]/10">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Target className="w-3.5 h-3.5 text-[#34C759]" />
                          <span className="text-[10px] font-semibold text-[#86868b] uppercase">Yield</span>
                        </div>
                        <div className="text-[18px] font-black text-[#34C759]">{yieldPercent}%</div>
                        <div className="text-[10px] text-[#86868b]">Target APY</div>
                      </div>
                      
                      {/* Risk Level */}
                      <div className={`${riskBg} rounded-xl p-3 border border-current/10`} style={{ borderColor: `${riskColor}20` }}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Shield className="w-3.5 h-3.5" style={{ color: riskColor }} />
                          <span className="text-[10px] font-semibold text-[#86868b] uppercase">Risk</span>
                        </div>
                        <div className="text-[18px] font-black" style={{ color: riskColor }}>{riskLevel}</div>
                        <div className="w-full bg-black/5 rounded-full h-1.5 mt-1">
                          <div 
                            className="h-1.5 rounded-full transition-all" 
                            style={{ 
                              width: `${riskValue}%`, 
                              backgroundColor: riskColor 
                            }} 
                          />
                        </div>
                      </div>
                      
                      {/* Assets or Status */}
                      <div className="bg-[#007AFF]/5 rounded-xl p-3 border border-[#007AFF]/10">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Coins className="w-3.5 h-3.5 text-[#007AFF]" />
                          <span className="text-[10px] font-semibold text-[#86868b] uppercase">Assets</span>
                        </div>
                        {hasRegisteredAssets ? (
                          <>
                            <div className="text-[18px] font-black text-[#007AFF]">{registeredAssets.length}</div>
                            <div className="text-[10px] text-[#007AFF] truncate">{registeredAssets.join(', ')}</div>
                          </>
                        ) : (
                          <>
                            <div className="text-[18px] font-black text-[#86868b]">0</div>
                            <div className="text-[10px] text-[#86868b]">No assets yet</div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Last Activity */}
                    {lastRebalanceDate && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-[#f5f5f7] rounded-lg mb-4">
                        <Clock className="w-3.5 h-3.5 text-[#86868b]" />
                        <span className="text-[11px] text-[#86868b]">
                          Last rebalanced {daysSinceRebalance === 0 ? 'today' : daysSinceRebalance === 1 ? 'yesterday' : `${daysSinceRebalance} days ago`}
                        </span>
                        <span className="text-[11px] text-[#86868b]/60">
                          ({lastRebalanceDate.toLocaleDateString()})
                        </span>
                      </div>
                    )}

                    {/* Action Buttons */}
                    {isOwner && (
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {hasFunds ? (
                          <>
                            <button 
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#007AFF] text-white rounded-xl text-[13px] font-semibold hover:bg-[#0066CC] transition-all active:scale-[0.98]"
                              onClick={() => fetchAgentRecommendation(portfolio)}
                              disabled={recommendationLoading}
                            >
                              <Sparkles className="w-4 h-4" />
                              AI Analysis
                            </button>
                            <button 
                              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FF3B30]/10 text-[#FF3B30] rounded-xl text-[13px] font-semibold hover:bg-[#FF3B30]/20 transition-all active:scale-[0.98]"
                              onClick={() => openWithdrawModal(portfolio)}
                            >
                              <ArrowDownToLine className="w-4 h-4" />
                              Withdraw
                            </button>
                            <button 
                              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#34C759]/10 text-[#34C759] rounded-xl text-[13px] font-semibold hover:bg-[#34C759]/20 transition-all active:scale-[0.98]"
                              onClick={() => openDepositModal(portfolio)}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button 
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#34C759] text-white rounded-xl text-[14px] font-semibold hover:bg-[#30B855] transition-all active:scale-[0.98]"
                            onClick={() => openDepositModal(portfolio)}
                          >
                            <Zap className="w-4 h-4" />
                            {hasRegisteredAssets ? 'Deposit More Funds' : 'Fund This Portfolio'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State - No Portfolios or Positions */}
      {onChainPortfolios.length === 0 && (positions.length === 0 || totalValue === 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-8 text-center">
          <div className="max-w-md mx-auto">
            {/* Icon */}
            <div className="w-16 h-16 bg-gradient-to-br from-[#007AFF]/10 to-[#AF52DE]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-[#007AFF]" />
            </div>
            
            {/* Title */}
            <h3 className="text-[20px] font-semibold text-[#1d1d1f] mb-2 tracking-[-0.02em]">
              Get Started with AI-Powered Portfolio Management
            </h3>
            
            {/* Description */}
            <p className="text-[15px] text-[#86868b] mb-6">
              No positions yet? No problem! Create your first AI-managed portfolio with custom risk settings, 
              automated hedging, and ZK-protected strategies.
            </p>
            
            {/* Features List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-left">
              <div className="flex items-start gap-3 p-3 bg-[#f5f5f7] rounded-xl">
                <Target className="w-5 h-5 text-[#007AFF] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-semibold text-[#1d1d1f]">Portfolio Strategy</p>
                  <p className="text-[11px] text-[#86868b]">AI-optimized allocation</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-[#f5f5f7] rounded-xl">
                <Shield className="w-5 h-5 text-[#34C759] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-semibold text-[#1d1d1f]">Risk Management</p>
                  <p className="text-[11px] text-[#86868b]">Automated hedging</p>
                </div>
              </div>
            </div>
            
            {/* CTA - Create Portfolio Button */}
            <div className="flex flex-col items-center gap-3">
              <AdvancedPortfolioCreator />
              <p className="text-[12px] text-[#86868b]">
                Or chat with AI Assistant for guidance
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Token Holdings - Wallet Balances - REDESIGNED */}
      {positions.length > 0 && parseFloat(positions[0].balanceUSD) > 0 && (
        <div className="space-y-4">
          {/* Wallet Section Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#FF9500] rounded-xl flex items-center justify-center">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-[17px] sm:text-[19px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Wallet Balances</h3>
                <p className="text-[12px] text-[#86868b]">{positions.length} tokens available</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider">Total</div>
              <div className="text-[18px] font-bold text-[#1d1d1f]">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Token Cards */}
          <div className="bg-white rounded-2xl shadow-lg border border-black/5 overflow-hidden">
            {positions.map((position, idx) => {
              const positionValue = parseFloat(position.balanceUSD || '0');
              const percentOfTotal = totalValue > 0 ? (positionValue / totalValue) * 100 : 0;
              
              return (
                <div 
                  key={`${position.symbol}-${idx}`} 
                  className={`px-4 sm:px-5 py-4 hover:bg-[#f5f5f7]/50 transition-all ${
                    idx !== positions.length - 1 ? 'border-b border-black/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* Token Icon */}
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      position.symbol === 'CRO' ? 'bg-[#007AFF]' :
                      position.symbol.includes('USD') ? 'bg-[#34C759]' :
                      'bg-[#FF9500]'
                    }`}>
                      <TokenIcon symbol={position.symbol} />
                    </div>
                    
                    {/* Token Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[16px] font-bold text-[#1d1d1f]">{position.symbol}</span>
                        {position.change24h !== 0 && (
                          <span className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            position.change24h >= 0 
                              ? 'bg-[#34C759]/10 text-[#34C759]' 
                              : 'bg-[#FF3B30]/10 text-[#FF3B30]'
                          }`}>
                            {position.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {Math.abs(position.change24h).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[12px] text-[#86868b]">
                        <span>{parseFloat(position.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {position.symbol}</span>
                        <span>@${parseFloat(position.price || '0').toFixed(4)}</span>
                      </div>
                      {/* Allocation Bar */}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all ${
                              position.symbol === 'CRO' ? 'bg-[#007AFF]' :
                              position.symbol.includes('USD') ? 'bg-[#34C759]' :
                              'bg-[#FF9500]'
                            }`}
                            style={{ width: `${percentOfTotal}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-semibold text-[#86868b] min-w-[40px] text-right">
                          {percentOfTotal.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    
                    {/* Value */}
                    <div className="text-right">
                      <div className="text-[20px] font-black text-[#1d1d1f]">
                        ${positionValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deposit Modal */}
      {selectedPortfolio && (
        <DepositModal
          isOpen={depositModalOpen}
          onClose={closeDepositModal}
          portfolioId={selectedPortfolio.id}
          targetYield={parseFloat(selectedPortfolio.targetYield) / 100}
          riskTolerance={parseFloat(selectedPortfolio.riskTolerance)}
          onSuccess={handleDepositSuccess}
        />
      )}

      {/* Withdraw Modal */}
      {selectedWithdrawPortfolio && (
        <WithdrawModal
          isOpen={withdrawModalOpen}
          onClose={closeWithdrawModal}
          portfolioId={selectedWithdrawPortfolio.id}
          assets={selectedWithdrawPortfolio.assets}
          totalValue={parseFloat(selectedWithdrawPortfolio.totalValue)}
          onSuccess={handleWithdrawSuccess}
        />
      )}

      {/* Agent Recommendation Modal */}
      {showRecommendationModal && agentRecommendation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] max-w-2xl w-full border border-black/5 shadow-2xl">
            <div className="p-6 border-b border-black/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#AF52DE] rounded-[12px] flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-[20px] font-bold text-[#1d1d1f]">AI Analysis</h3>
                </div>
                <button
                  onClick={() => setShowRecommendationModal(false)}
                  className="w-8 h-8 flex items-center justify-center bg-[#f5f5f7] hover:bg-[#e8e8ed] rounded-full transition-colors"
                >
                  <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Action Recommendation */}
              <div className={`p-4 rounded-lg border-2 ${
                agentRecommendation.action === 'WITHDRAW' ? 'bg-red-500/10 border-red-500/50' :
                agentRecommendation.action === 'HEDGE' ? 'bg-orange-500/10 border-orange-500/50' :
                agentRecommendation.action === 'ADD_FUNDS' ? 'bg-green-500/10 border-green-500/50' :
                'bg-blue-500/10 border-blue-500/50'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xl font-bold text-[#1d1d1f]">
                    {agentRecommendation.action === 'WITHDRAW' && '🚨 WITHDRAW'}
                    {agentRecommendation.action === 'HEDGE' && '🛡️ HEDGE'}
                    {agentRecommendation.action === 'ADD_FUNDS' && '✅ ADD FUNDS'}
                    {agentRecommendation.action === 'HOLD' && '📊 HOLD'}
                  </div>
                  <div className="text-sm text-[#86868b]">
                    Confidence: <span className="font-semibold text-[#1d1d1f]">{(agentRecommendation.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              {/* Multi-Agent Reasoning */}
              <div>
                <div className="text-sm font-semibold text-[#AF52DE] mb-3">Agent Reasoning:</div>
                <div className="space-y-2">
                  {agentRecommendation.reasoning.map((reason: string, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 text-sm text-[#1d1d1f]">
                      <span className="text-[#AF52DE] mt-1">•</span>
                      <span className="text-[#86868b]">{reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk Score */}
              <div className="bg-[#f5f5f7] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[#86868b]">Portfolio Risk Score</span>
                  <span className={`text-lg font-bold ${
                    agentRecommendation.riskScore > 70 ? 'text-[#FF3B30]' :
                    agentRecommendation.riskScore > 40 ? 'text-[#FF9500]' :
                    'text-[#34C759]'
                  }`}>{agentRecommendation.riskScore}/100</span>
                </div>
                <div className="w-full bg-[#e8e8ed] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      agentRecommendation.riskScore > 70 ? 'bg-[#FF3B30]' :
                      agentRecommendation.riskScore > 40 ? 'bg-[#FF9500]' :
                      'bg-[#34C759]'
                    }`}
                    style={{ width: `${agentRecommendation.riskScore}%` }}
                  />
                </div>
              </div>

              {/* Agent Analysis Details */}
              <div>
                <div className="text-sm font-semibold text-[#AF52DE] mb-3">Multi-Agent Analysis:</div>
                <div className="space-y-2">
                  <div className="bg-[#f5f5f7] rounded-lg p-3">
                    <div className="text-xs text-[#86868b] mb-1">Risk Agent</div>
                    <div className="text-sm text-[#1d1d1f]">{agentRecommendation.agentAnalysis.riskAgent}</div>
                  </div>
                  <div className="bg-[#f5f5f7] rounded-lg p-3">
                    <div className="text-xs text-[#86868b] mb-1">Hedging Agent</div>
                    <div className="text-sm text-[#1d1d1f]">{agentRecommendation.agentAnalysis.hedgingAgent}</div>
                  </div>
                  <div className="bg-[#f5f5f7] rounded-lg p-3">
                    <div className="text-xs text-[#86868b] mb-1">Lead Agent</div>
                    <div className="text-sm text-[#1d1d1f]">{agentRecommendation.agentAnalysis.leadAgent}</div>
                  </div>
                </div>
              </div>

              {/* Recommendations */}
              {agentRecommendation.recommendations.length > 0 && (
                <div>
                  <div className="text-sm font-semibold text-[#AF52DE] mb-3">Additional Recommendations:</div>
                  <div className="space-y-1">
                    {agentRecommendation.recommendations.map((rec: string, idx: number) => (
                      <div key={idx} className="text-sm text-[#86868b]">• {rec}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-black/5 flex gap-3">
              <button
                onClick={() => setShowRecommendationModal(false)}
                className="flex-1 px-4 py-2 bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] rounded-[12px] text-sm font-semibold transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowRecommendationModal(false);
                  // Act on recommendation
                  if (agentRecommendation.action === 'ADD_FUNDS' && analyzedPortfolio) {
                    openDepositModal(analyzedPortfolio);
                  } else if (agentRecommendation.action === 'WITHDRAW' && analyzedPortfolio) {
                    openWithdrawModal(analyzedPortfolio);
                  } else if (agentRecommendation.action === 'HEDGE' && onOpenHedge && analyzedPortfolio?.predictions?.[0]) {
                    // Call the hedge handler with the portfolio's prediction
                    onOpenHedge(analyzedPortfolio.predictions[0]);
                  }
                  // HOLD just closes (user is informed)
                }}
                className={`flex-1 px-4 py-2 rounded-[12px] text-sm font-semibold text-white transition-colors ${
                  agentRecommendation.action === 'WITHDRAW' 
                    ? 'bg-[#FF3B30] hover:bg-[#FF3B30]/90'
                    : agentRecommendation.action === 'ADD_FUNDS'
                    ? 'bg-[#34C759] hover:bg-[#34C759]/90'
                    : agentRecommendation.action === 'HEDGE'
                    ? 'bg-[#FF9500] hover:bg-[#FF9500]/90'
                    : 'bg-[#007AFF] hover:bg-[#007AFF]/90'
                }`}
              >
                {agentRecommendation.action === 'WITHDRAW' && '🚨 Withdraw Funds'}
                {agentRecommendation.action === 'ADD_FUNDS' && '✅ Add More Funds'}
                {agentRecommendation.action === 'HEDGE' && '🛡️ Open Hedge Position'}
                {agentRecommendation.action === 'HOLD' && '📊 Continue Holding'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Portfolio Detail Modal */}
      {portfolioDetailOpen && selectedDetailPortfolio && (
        <PortfolioDetailModal
          portfolio={selectedDetailPortfolio}
          onClose={() => {
            setPortfolioDetailOpen(false);
            setSelectedDetailPortfolio(null);
          }}
        />
      )}
    </div>
  );
}
