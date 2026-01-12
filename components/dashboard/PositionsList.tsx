'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, ExternalLink, Wallet, Bitcoin, Coins, DollarSign, RefreshCw, ArrowDownToLine, AlertTriangle, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useAccount } from 'wagmi';
import { usePortfolioCount } from '../../lib/contracts/hooks';
import { DepositModal } from './DepositModal';
import { WithdrawModal } from './WithdrawModal';
import { DelphiMarketService, type PredictionMarket } from '@/lib/services/DelphiMarketService';
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
}

export function PositionsList({ address }: { address: string }) {
  const { isConnected } = useAccount();
  const { data: portfolioCount, refetch } = usePortfolioCount();
  const { positionsData, error: positionsError, refetch: refetchPositions } = usePositions();
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
  
  // Collapseable strategies section
  const [strategiesCollapsed, setStrategiesCollapsed] = useState(true);

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

      const response = await fetch('/api/agents/portfolio-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId: portfolio.id,
          currentValue: parseFloat(portfolio.totalValue) / 1e6, // Assuming USDC 6 decimals
          targetYield: parseFloat(portfolio.targetYield) / 100,
          riskTolerance: parseFloat(portfolio.riskTolerance),
          assets: portfolioAssets,
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

  // Fetch on-chain portfolios from contract
  const fetchOnChainPortfolios = async () => {
    if (!portfolioCount || portfolioCount === 0n) {
      setOnChainPortfolios([]);
      return;
    }

    console.log(`📊 [PositionsList] Fetching ${portfolioCount.toString()} on-chain portfolios`);
    const count = Number(portfolioCount);
    
    // Fetch all portfolios in parallel for better performance
    const portfolioPromises = [];
    for (let i = 0; i < count; i++) {
      portfolioPromises.push(
        fetch(`/api/portfolio/${i}`)
          .then(res => res.ok ? res.json() : null)
          .then(async (p) => {
            if (!p || p.error || !p.isActive) return null;
            
            const portfolio: OnChainPortfolio = {
              id: i,
              owner: p.owner,
              totalValue: p.totalValue || '0',
              targetYield: p.targetYield || '0',
              riskTolerance: p.riskTolerance || '0',
              lastRebalance: p.lastRebalance || '0',
              isActive: p.isActive,
              assets: p.assets || [],
            };
            
            // Fetch Delphi/Polymarket predictions
            try {
              // Get assets from both wallet positions AND portfolio contract
              const walletAssets = positionsData?.positions
                ?.filter(pos => parseFloat(pos.balance) > 0)
                .map(pos => pos.symbol.toUpperCase().replace(/^(W|DEV)/, '')) || [];
              
              // Map contract addresses to symbols
              const contractAssets = (portfolio.assets || []).map(addr => {
                const lowerAddr = addr.toLowerCase();
                if (lowerAddr === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0') return 'USDC';
                if (lowerAddr.includes('wcro') || lowerAddr === '0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23') return 'CRO';
                if (lowerAddr.includes('weth')) return 'ETH';
                if (lowerAddr.includes('wbtc')) return 'BTC';
                return 'CRYPTO'; // Generic fallback
              });
              
              // Combine unique assets, always include major cryptos for broader predictions
              const allAssets = [...new Set([...walletAssets, ...contractAssets, 'BTC', 'ETH', 'CRO'])];
              
              console.log(`Fetching predictions for portfolio ${i} with assets:`, allAssets);
              
              const predictions = await DelphiMarketService.getPortfolioRelevantPredictions(
                allAssets,
                parseFloat(portfolio.riskTolerance),
                parseFloat(portfolio.targetYield)
              );
              
              console.log(`Got ${predictions.length} predictions for portfolio ${i}`);
              portfolio.predictions = predictions;
            } catch (error) {
              console.warn(`Failed to fetch predictions for portfolio ${i}:`, error);
              portfolio.predictions = [];
            }
            
            return portfolio;
          })
          .catch(err => {
            console.warn(`Portfolio ${i} fetch failed:`, err);
            return null;
          })
      );
    }
    
    // Wait for all portfolios in parallel
    const results = await Promise.all(portfolioPromises);
    const loadedPortfolios = results.filter((p): p is OnChainPortfolio => p !== null);

    console.log(`✅ [PositionsList] Loaded ${loadedPortfolios.length} on-chain portfolios`);
    setOnChainPortfolios(loadedPortfolios);
  };

  useEffect(() => {
    async function loadAll() {
      // Only show loading skeleton on initial load
      if (!hasInitiallyLoaded) {
        setLoading(true);
      }
      await fetchOnChainPortfolios();
      setLoading(false);
      setHasInitiallyLoaded(true);
    }
    
    if (address && isConnected) {
      loadAll();
    }
  }, [address, isConnected]); // Removed positionsData from dependencies to prevent clearing on auto-refresh

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchPositions(), fetchOnChainPortfolios()]);
    refetch();
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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-[20px] p-6 animate-pulse">
          <div className="h-8 bg-[#f5f5f7] rounded-lg w-1/3 mb-4" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-20 bg-[#f5f5f7] rounded-[14px]" />
            <div className="h-20 bg-[#f5f5f7] rounded-[14px]" />
            <div className="h-20 bg-[#f5f5f7] rounded-[14px]" />
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
          <div className="p-2.5 sm:p-4 bg-[#34C759]/5 rounded-[12px] sm:rounded-[14px] border border-[#34C759]/10">
            <div className="text-[9px] sm:text-[11px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-1">24h</div>
            <div className="text-[20px] sm:text-[28px] font-bold text-[#34C759] leading-none">+2.4%</div>
          </div>
        </div>
      </div>

      {/* Token Holdings */}
      <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[18px] overflow-hidden">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-black/5">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Token Holdings</h3>
            <span className="text-[12px] sm:text-[13px] text-[#86868b]">{positions.length} assets</span>
          </div>
        </div>

        {positions.length === 0 || (positions.length === 1 && parseFloat(positions[0].balanceUSD) === 0) ? (
          <div className="p-6 sm:p-8 text-center">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-[14px] sm:rounded-[16px] flex items-center justify-center mx-auto mb-3 sm:mb-4">
              <Coins className="w-6 h-6 sm:w-7 sm:h-7 text-[#86868b]" />
            </div>
            <h4 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-2">No Token Holdings</h4>
            <p className="text-[14px] text-[#86868b] max-w-[280px] mx-auto mb-4">
              Your wallet has no token balances yet
            </p>
            {error && <p className="text-[13px] text-[#FF3B30]">{error}</p>}
            <div className="inline-flex items-center gap-2 mt-2">
              <span className="px-3 py-1.5 bg-[#f5f5f7] rounded-full text-[13px] text-[#1d1d1f] font-medium">Get testnet CRO</span>
              <span className="px-3 py-1.5 bg-[#f5f5f7] rounded-full text-[13px] text-[#1d1d1f] font-medium">Bridge tokens</span>
            </div>
          </div>
        ) : (
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
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-[11px] sm:text-[13px] text-[#86868b] hidden sm:inline">
                        ${parseFloat(position.price || '0').toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
                
                {/* Allocation Bar - Hidden on mobile */}
                {totalValue > 0 && (
                  <div className="mt-2 sm:mt-3 flex items-center gap-2 sm:gap-3">
                    <div className="flex-1 h-1 sm:h-1.5 bg-[#f5f5f7] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#007AFF] to-[#34C759] rounded-full transition-all"
                        style={{ width: `${Math.min((parseFloat(position.balanceUSD || '0') / totalValue) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] sm:text-[12px] font-medium text-[#86868b] w-10 sm:w-12 text-right">
                      {((parseFloat(position.balanceUSD || '0') / totalValue) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* On-Chain Portfolio Strategies */}
      {onChainPortfolios.length > 0 && (
        <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[18px] overflow-hidden">
          <button
            onClick={() => setStrategiesCollapsed(!strategiesCollapsed)}
            className="w-full px-4 sm:px-6 py-3 sm:py-4 border-b border-black/5 active:bg-[#e8e8ed] sm:hover:bg-[#e8e8ed] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Strategies</h3>
                <span className="px-1.5 py-0.5 bg-[#007AFF] text-white text-[10px] font-bold rounded-full min-w-[18px] text-center">
                  {onChainPortfolios.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {totalValue > 0 && (
                  <span className="text-[11px] sm:text-[13px] text-[#86868b]">
                    ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                )}
                {strategiesCollapsed ? (
                  <ChevronDown className="w-5 h-5 text-[#86868b]" />
                ) : (
                  <ChevronUp className="w-5 h-5 text-[#86868b]" />
                )}
              </div>
            </div>
          </button>

          {!strategiesCollapsed && (
            <div className="divide-y divide-black/10">
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
              const riskBg = riskLevel === 'Low' ? 'bg-[#34C759]/10' : riskLevel === 'Medium' ? 'bg-[#FF9500]/10' : 'bg-[#FF3B30]/10';
              const isOwner = portfolio.owner.toLowerCase() === address.toLowerCase();
              const hasFunds = valueUSD > 0 || portfolio.assets.length > 0;

              return (
                <div key={portfolio.id} className="p-3 sm:p-4 hover:bg-white/50 transition-colors">
                  {/* Portfolio Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">#{portfolio.id}</h4>
                      {isOwner && (
                        <span className="px-1.5 py-0.5 bg-[#007AFF] text-white text-[9px] font-bold rounded-full">
                          YOURS
                        </span>
                      )}
                      <span className="text-[11px] text-[#86868b] font-mono hidden sm:inline">
                        {portfolio.owner.slice(0, 6)}...{portfolio.owner.slice(-4)}
                      </span>
                    </div>
                    {hasFunds ? (
                      <span className="px-2 py-0.5 bg-[#34C759]/10 text-[#34C759] text-[10px] font-semibold rounded-full">
                        Funded
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-[#FF9500]/10 text-[#FF9500] text-[10px] font-semibold rounded-full">
                        Unfunded
                      </span>
                    )}
                  </div>

                  {/* Stats Grid - Compact on mobile */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="p-2 sm:p-3 bg-white rounded-[10px] sm:rounded-[12px]">
                      <div className="text-[8px] sm:text-[10px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5">Yield</div>
                      <div className="text-[16px] sm:text-[20px] font-bold text-[#34C759] leading-none">{yieldPercent}%</div>
                    </div>
                    <div className={`p-2 sm:p-3 bg-white rounded-[10px] sm:rounded-[12px]`}>
                      <div className="text-[8px] sm:text-[10px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5">Risk</div>
                      <div className={`text-[16px] sm:text-[20px] font-bold ${riskColor} leading-none`}>{riskLevel}</div>
                    </div>
                    <div className="p-2 sm:p-3 bg-white rounded-[10px] sm:rounded-[12px]">
                      <div className="text-[8px] sm:text-[10px] font-semibold text-[#86868b] uppercase tracking-[0.04em] mb-0.5">Value</div>
                      <div className="text-[16px] sm:text-[20px] font-bold text-[#1d1d1f] leading-none">
                        {valueUSD > 0 ? `$${valueUSD.toFixed(0)}` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Assets - Inline on mobile */}
                  {portfolio.assets.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {portfolio.assets.map((asset, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] rounded text-[10px] font-medium">
                          {asset.toLowerCase() === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0' ? 'USDC' : `${asset.slice(0, 4)}...`}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Predictions - Compact on mobile */}
                  {portfolio.predictions && portfolio.predictions.length > 0 && (
                    <div className="mb-3 p-2 sm:p-3 bg-[#AF52DE]/5 rounded-[10px] border border-[#AF52DE]/10">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-[#AF52DE]" />
                          <span className="text-[10px] font-semibold text-[#AF52DE]">
                            {portfolio.predictions.length} Signals
                          </span>
                        </div>
                        {portfolio.predictions.length > 1 && (
                          <button
                            onClick={() => setExpandedPredictions(prev => ({
                              ...prev,
                              [portfolio.id]: !prev[portfolio.id]
                            }))}
                            className="text-[10px] text-[#AF52DE] font-medium"
                          >
                            {expandedPredictions[portfolio.id] ? 'Less' : 'More'}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1">
                        {(expandedPredictions[portfolio.id] 
                          ? portfolio.predictions 
                          : portfolio.predictions.slice(0, 1)
                        ).map((pred) => (
                          <div key={pred.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-[#1d1d1f] truncate flex-1 mr-2">{pred.question}</span>
                            <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                              pred.recommendation === 'HEDGE' ? 'bg-[#FF3B30]/10 text-[#FF3B30]' :
                              pred.recommendation === 'MONITOR' ? 'bg-[#FF9500]/10 text-[#FF9500]' :
                              'bg-[#34C759]/10 text-[#34C759]'
                            }`}>
                              {pred.recommendation}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons - Stack on mobile */}
                  {isOwner && (
                    <div className="flex flex-wrap gap-2">
                      {hasFunds ? (
                        <>
                          <button 
                            className="flex-1 min-w-[100px] px-3 py-2 sm:py-2.5 bg-[#007AFF] active:bg-[#0051D5] sm:hover:bg-[#0051D5] text-white rounded-[10px] text-[12px] sm:text-[13px] font-semibold transition-colors flex items-center justify-center gap-1.5"
                            onClick={() => fetchAgentRecommendation(portfolio)}
                            disabled={recommendationLoading}
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            {recommendationLoading ? '...' : 'AI'}
                          </button>
                          <button 
                            className="px-3 py-2 sm:py-2.5 bg-[#f5f5f7] active:bg-[#e8e8ed] sm:hover:bg-[#e8e8ed] text-[#1d1d1f] rounded-[10px] text-[12px] sm:text-[13px] font-semibold transition-colors"
                            onClick={() => openDepositModal(portfolio)}
                          >
                            Add
                          </button>
                          <button 
                            className="px-3 py-2 sm:py-2.5 bg-[#FF3B30]/10 active:bg-[#FF3B30]/20 sm:hover:bg-[#FF3B30]/20 text-[#FF3B30] rounded-[10px] text-[12px] sm:text-[13px] font-semibold transition-colors flex items-center gap-1"
                            onClick={() => openWithdrawModal(portfolio)}
                          >
                            <ArrowDownToLine className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Withdraw</span>
                          </button>
                        </>
                      ) : (
                        <button 
                          className="flex-1 px-3 py-2 sm:py-2.5 bg-[#34C759] active:bg-[#2DB550] sm:hover:bg-[#2DB550] text-white rounded-[10px] text-[12px] sm:text-[13px] font-semibold transition-colors"
                          onClick={() => openDepositModal(portfolio)}
                        >
                          Fund Portfolio
                        </button>
                      )}
                    </div>
                  )}

                  {/* Footer - Compact */}
                  <div className="mt-3 pt-2 border-t border-black/5 flex items-center justify-between text-[10px] sm:text-[11px] text-[#86868b]">
                    <span>{new Date(Number(portfolio.lastRebalance) * 1000).toLocaleDateString()}</span>
                    <a
                      href={`https://explorer.cronos.org/testnet/address/${portfolio.owner}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[#007AFF] active:text-[#0051D5] sm:hover:text-[#0051D5] transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
          )}
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
                    agentRecommendation.riskScore > 70 ? 'text-red-400' :
                    agentRecommendation.riskScore > 40 ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>{agentRecommendation.riskScore}/100</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      agentRecommendation.riskScore > 70 ? 'bg-red-500' :
                      agentRecommendation.riskScore > 40 ? 'bg-yellow-500' :
                      'bg-green-500'
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

            <div className="p-6 border-t border-gray-800 flex gap-3">
              <button
                onClick={() => setShowRecommendationModal(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition-colors"
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
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  agentRecommendation.action === 'WITHDRAW' 
                    ? 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700'
                    : agentRecommendation.action === 'ADD_FUNDS'
                    ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700'
                    : agentRecommendation.action === 'HEDGE'
                    ? 'bg-gradient-to-r from-orange-600 to-yellow-600 hover:from-orange-700 hover:to-yellow-700'
                    : 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700'
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
