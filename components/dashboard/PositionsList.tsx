'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Wallet, Bitcoin, Coins, DollarSign, RefreshCw, ArrowDownToLine, Sparkles, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useUserPortfolios } from '../../lib/contracts/hooks';
import { DepositModal } from './DepositModal';
import { WithdrawModal } from './WithdrawModal';
import type { PredictionMarket } from '@/lib/services/DelphiMarketService';
import { usePositions } from '@/contexts/PositionsContext';

interface OnChainPortfolio {
  id: number;
  owner: string;
  totalValue: string;  // Store as string to avoid BigInt serialization issues
  targetYield: string;
  riskTolerance: string;
  lastRebalance: string;
  isActive: boolean;
  assets: string[];
  predictions?: PredictionMarket[]; // Delphi predictions for this portfolio
  txHash?: string | null; // Transaction hash from portfolio creation
}

export function PositionsList({ address }: { address: string }) {
  const { isConnected } = useAccount();
  // Get only portfolios owned by the connected wallet
  const { data: userPortfolios, count: userPortfolioCount, isLoading: portfolioLoading } = useUserPortfolios(address);
  const { positionsData, derived, error: positionsError, refetch: refetchPositions } = usePositions();
  const [onChainPortfolios, setOnChainPortfolios] = useState<OnChainPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  
  // Derived from context
  const positions = positionsData?.positions || [];
  const totalValue = positionsData?.totalValue || 0;
  const lastUpdated = positionsData ? new Date(positionsData.lastUpdated) : null;
  const error = positionsError;
  
  // Deposit modal state
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<OnChainPortfolio | null>(null);

  // Withdraw modal state
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [selectedWithdrawPortfolio, setSelectedWithdrawPortfolio] = useState<OnChainPortfolio | null>(null);

  // Agent recommendation state
  const [agentRecommendation, setAgentRecommendation] = useState<any>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [showRecommendationModal, setShowRecommendationModal] = useState(false);
  const [analyzedPortfolio, setAnalyzedPortfolio] = useState<OnChainPortfolio | null>(null);

  // Expanded predictions state (portfolio ID -> boolean)
  const [expandedPredictions, setExpandedPredictions] = useState<Record<number, boolean>>({});
  
  // Collapseable strategies section - default to expanded for quick view
  const [strategiesCollapsed, setStrategiesCollapsed] = useState(false);

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
            (batch: any) => batch.type === 'hedge' && batch.status !== 'closed'
          ).length;
        }
      }

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
            hedgeSignals,
            totalValue: positionsData?.totalValue || 0,
          },
          predictions: (portfolio.predictions || []).map(p => ({
            question: p.question,
            probability: p.probability,
            impact: p.impact,
            recommendation: p.recommendation,
          })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setAgentRecommendation(data);
        setShowRecommendationModal(true);
      } else {
        console.error('Failed to get agent recommendation');
      }
    } catch (error) {
      console.error('Error fetching agent recommendation:', error);
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

  // Fetch on-chain portfolios from contract - uses userPortfolios from hook
  // Shows portfolios IMMEDIATELY, loads predictions in background
  const fetchOnChainPortfolios = async () => {
    if (!userPortfolios || userPortfolios.length === 0) {
      setOnChainPortfolios([]);
      return;
    }

    console.log(`📊 [PositionsList] Processing ${userPortfolios.length} user portfolios`);
    
    // STEP 1: Immediately show portfolios with basic data (no predictions yet)
    const quickPortfolios: OnChainPortfolio[] = [];
    for (const p of userPortfolios) {
      if (!p.isActive) continue;
      
      const portfolio: OnChainPortfolio = {
        id: p.id,
        owner: p.owner,
        totalValue: p.totalValue.toString(),
        targetYield: p.targetYield.toString(),
        riskTolerance: p.riskTolerance.toString(),
        lastRebalance: p.lastRebalance.toString(),
        isActive: p.isActive,
        assets: [],
        predictions: [], // Empty initially
        txHash: p.txHash, // Transaction hash from portfolio creation event
      };
      
      // Quick fetch assets (fast API call)
      try {
        const assetsRes = await fetch(`/api/portfolio/${p.id}`);
        if (assetsRes.ok) {
          const data = await assetsRes.json();
          portfolio.assets = data.assets || [];
        }
      } catch (err) {
        console.warn(`Failed to fetch assets for portfolio ${p.id}:`, err);
      }
      
      quickPortfolios.push(portfolio);
    }
    
    // Show portfolios immediately
    setOnChainPortfolios(quickPortfolios);
    console.log(`⚡ [PositionsList] Showing ${quickPortfolios.length} portfolios (predictions loading...)`);
    
    // STEP 2: Load predictions in background (don't block UI)
    // Skip predictions for now - they're slow and not critical
    // Predictions can be fetched on-demand when user clicks AI button
  };

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

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchPositions(), fetchOnChainPortfolios()]);
    setRefreshing(false);
  };

  const getTokenIcon = (symbol: string) => {
    switch (symbol.toUpperCase()) {
      case 'BTC':
      case 'WBTC':
        return <Bitcoin className="w-6 h-6 text-orange-500" />;
      case 'ETH':
      case 'WETH':
        return <Coins className="w-6 h-6 text-blue-400" />;
      case 'USDC':
      case 'USDT':
        return <DollarSign className="w-6 h-6 text-green-400" />;
      case 'CRO':
        return <Coins className="w-6 h-6 text-[#007AFF]" />;
      default:
        return <Coins className="w-6 h-6 text-[#86868b]" />;
    }
  };

  // Show loading state with progress bar until positions AND portfolios are ready
  if (loading || !positionsData || portfolioLoading || !hasInitiallyLoaded) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-[20px] shadow-sm border border-black/5 p-8">
          <div className="flex flex-col items-center justify-center">
            <div className="w-12 h-12 bg-[#007AFF]/10 rounded-full flex items-center justify-center mb-4">
              <RefreshCw className="w-6 h-6 text-[#007AFF] animate-spin" />
            </div>
            <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-2">Loading Portfolio</h3>
            <p className="text-[13px] text-[#86868b] mb-4">Fetching your positions and strategies...</p>
            {/* Progress bar */}
            <div className="w-full max-w-[200px] h-1.5 bg-[#f5f5f7] rounded-full overflow-hidden">
              <div className="h-full bg-[#007AFF] rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="bg-white rounded-[20px] shadow-sm border border-black/5 p-12 text-center">
        <div className="w-20 h-20 bg-[#f5f5f7] rounded-[22px] flex items-center justify-center mx-auto mb-5">
          <Wallet className="w-10 h-10 text-[#86868b]" />
        </div>
        <h3 className="text-[22px] font-semibold text-[#1d1d1f] mb-2 tracking-[-0.02em]">Connect Your Wallet</h3>
        <p className="text-[15px] text-[#86868b] max-w-[280px] mx-auto">
          Connect your wallet to view your token positions and portfolio strategies
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6">
      {/* Header with Total Value */}
      <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[18px] p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center justify-between sm:block">
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="text-[18px] sm:text-[22px] font-bold text-[#1d1d1f] tracking-[-0.02em]">Positions</h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#34C759] rounded-full">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                <span className="text-[9px] font-bold text-white">LIVE</span>
              </span>
            </div>
            <p className="text-[12px] text-[#86868b] hidden sm:block">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
            </p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="sm:hidden w-9 h-9 flex items-center justify-center rounded-full bg-[#f5f5f7] active:bg-[#e8e8ed] transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-[#86868b] ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex items-center justify-between sm:gap-4">
            <div className="sm:text-right">
              <div className="text-[10px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5">Total Value</div>
              <div className="text-[24px] sm:text-[28px] font-bold text-[#1d1d1f] leading-none tracking-[-0.02em]">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="hidden sm:flex w-10 h-10 items-center justify-center rounded-full bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-[#86868b] ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Quick Stats Row */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="p-2.5 sm:p-4 bg-[#f5f5f7] rounded-[12px] sm:rounded-[14px]">
            <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-1">Tokens</div>
            <div className="text-[20px] sm:text-[28px] font-bold text-[#1d1d1f] leading-none">{positions.length}</div>
          </div>
          <div className="p-2.5 sm:p-4 bg-[#007AFF]/5 rounded-[12px] sm:rounded-[14px] border border-[#007AFF]/10">
            <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-1">Portfolios</div>
            <div className="text-[20px] sm:text-[28px] font-bold text-[#007AFF] leading-none">{onChainPortfolios.length}</div>
          </div>
          {(() => {
            // Calculate weighted average 24h change from positions
            const weighted24hChange = totalValue > 0
              ? positions.reduce((acc, pos) => {
                  const posValue = parseFloat(pos.balanceUSD || '0');
                  const weight = posValue / totalValue;
                  return acc + (pos.change24h * weight);
                }, 0)
              : 0;
            const isPositive = weighted24hChange >= 0;
            return (
              <div className={`p-2.5 sm:p-4 ${isPositive ? 'bg-[#34C759]/5 border-[#34C759]/10' : 'bg-[#FF3B30]/5 border-[#FF3B30]/10'} rounded-[12px] sm:rounded-[14px] border`}>
                <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-1">24h</div>
                <div className={`text-[20px] sm:text-[28px] font-bold ${isPositive ? 'text-[#34C759]' : 'text-[#FF3B30]'} leading-none`}>
                  {isPositive ? '+' : ''}{weighted24hChange.toFixed(1)}%
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Portfolio Positions - PRIMARY CONTENT */}
      {onChainPortfolios.length > 0 && (
        <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[18px] overflow-hidden">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-black/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Your Portfolios</h3>
                <span className="px-1.5 py-0.5 bg-[#007AFF] text-white text-[10px] font-bold rounded-full min-w-[18px] text-center">
                  {onChainPortfolios.length}
                </span>
              </div>
              {totalValue > 0 && (
                <span className="text-[11px] sm:text-[13px] text-[#86868b]">
                  ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              )}
            </div>
          </div>

          <div className="divide-y divide-black/5">
            {onChainPortfolios.map((portfolio) => {
              // Use totalValue from blockchain - this is what's actually deposited in the portfolio contract
              const rawValue = parseFloat(portfolio.totalValue) || 0;
              const valueUSD = rawValue > 1e12 
                ? rawValue / 1e18  // 18 decimals (ETH-like)
                : rawValue / 1e6;  // 6 decimals (USDC-like)
              
              const yieldPercent = parseFloat(portfolio.targetYield) / 100;
              const riskValue = parseFloat(portfolio.riskTolerance) || 0;
              const riskLevel = riskValue <= 33 ? 'Low' : riskValue <= 66 ? 'Medium' : 'High';
              const riskColor = riskLevel === 'Low' ? 'text-[#34C759]' : riskLevel === 'Medium' ? 'text-[#FF9500]' : 'text-[#FF3B30]';
              const isOwner = portfolio.owner.toLowerCase() === address.toLowerCase();
              const hasFunds = valueUSD > 0 || portfolio.assets.length > 0;
              
              // Get deposited assets symbols
              const depositedAssets = portfolio.assets.map(a => {
                const addr = a.toLowerCase();
                if (addr === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0') return 'USDC';
                if (addr.includes('wcro') || addr === '0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23') return 'CRO';
                return a.slice(0, 6);
              });
              
              // For unfunded portfolios, show available wallet tokens
              const availableTokens = !hasFunds && positions.length > 0
                ? positions.filter(p => parseFloat(p.balanceUSD) > 0).map(p => `${p.symbol}: $${parseFloat(p.balanceUSD).toFixed(0)}`)
                : [];

              return (
                <div key={portfolio.id} className="px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-white/50 transition-colors">
                  {/* Compact Single Row Layout */}
                  <div className="flex items-center gap-3">
                    {/* ID & Status */}
                    <div className="flex items-center gap-1.5 min-w-[50px]">
                      <span className="text-[14px] sm:text-[15px] font-bold text-[#1d1d1f]">#{portfolio.id}</span>
                      {hasFunds ? (
                        <span className="w-2 h-2 bg-[#34C759] rounded-full flex-shrink-0" title="Funded" />
                      ) : (
                        <span className="w-2 h-2 bg-[#FF9500] rounded-full flex-shrink-0" title="Unfunded" />
                      )}
                    </div>
                    
                    {/* Stats Inline */}
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 text-[12px] sm:text-[13px] overflow-hidden">
                      <span className="text-[#34C759] font-semibold whitespace-nowrap">{yieldPercent}%</span>
                      <span className={`font-medium ${riskColor} whitespace-nowrap`}>{riskLevel}</span>
                      <span className="text-[#1d1d1f] font-bold whitespace-nowrap">
                        {valueUSD > 0 ? `$${valueUSD.toFixed(0)}` : '—'}
                      </span>
                      
                      {/* Show deposited assets OR available wallet tokens */}
                      {hasFunds && depositedAssets.length > 0 ? (
                        <span className="text-[#007AFF] text-[11px] truncate">
                          {depositedAssets.join(', ')}
                        </span>
                      ) : availableTokens.length > 0 ? (
                        <span className="text-[#86868b] text-[10px] truncate hidden sm:inline" title="Available to deposit">
                          Available: {availableTokens.join(', ')}
                        </span>
                      ) : null}
                    </div>
                    
                    {/* Quick Actions */}
                    {isOwner && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {hasFunds ? (
                          <>
                            <button 
                              className="p-1.5 sm:p-2 bg-[#007AFF] text-white rounded-lg text-[11px] font-semibold"
                              onClick={() => fetchAgentRecommendation(portfolio)}
                              disabled={recommendationLoading}
                              title="AI Analysis"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              className="p-1.5 sm:p-2 bg-[#FF3B30]/10 text-[#FF3B30] rounded-lg"
                              onClick={() => openWithdrawModal(portfolio)}
                              title="Withdraw"
                            >
                              <ArrowDownToLine className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button 
                            className="px-2.5 py-1.5 bg-[#34C759] text-white rounded-lg text-[11px] font-semibold"
                            onClick={() => openDepositModal(portfolio)}
                          >
                            Fund
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Transaction Hash - On-chain proof */}
                  {portfolio.txHash && (
                    <div className="mt-2 pl-[62px] sm:pl-[66px]">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[#86868b] uppercase tracking-wider">Created:</span>
                        <a
                          href={`https://explorer.cronos.org/testnet/tx/${portfolio.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[#007AFF] hover:underline font-mono flex items-center gap-1"
                          title="View creation transaction on Cronos Explorer"
                        >
                          {portfolio.txHash.slice(0, 10)}...{portfolio.txHash.slice(-8)}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Token Holdings - Wallet Balances (Secondary) */}
      {positions.length > 0 && parseFloat(positions[0].balanceUSD) > 0 && (
        <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[18px] overflow-hidden">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-black/5">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Wallet Balances</h3>
              <span className="text-[12px] sm:text-[13px] text-[#86868b]">{positions.length} tokens</span>
            </div>
          </div>

          <div className="divide-y divide-black/10">
            {positions.map((position, idx) => (
              <div key={idx} className="px-3 sm:px-4 py-3 sm:py-4 hover:bg-white/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className="w-9 h-9 sm:w-11 sm:h-11 bg-white rounded-[10px] sm:rounded-[12px] flex items-center justify-center flex-shrink-0">
                      {getTokenIcon(position.symbol)}
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
            ))}
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
                      <span>{reason}</span>
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
                  }
                  // HOLD and HEDGE just close (user is informed)
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
    </div>
  );
}
