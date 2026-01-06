'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, ExternalLink, Wallet, Bitcoin, Coins, DollarSign, RefreshCw, ArrowDownToLine } from 'lucide-react';
import { useAccount } from 'wagmi';
import { usePortfolioCount } from '../../lib/contracts/hooks';
import { formatEther } from 'viem';
import { DepositModal } from './DepositModal';
import { WithdrawModal } from './WithdrawModal';

interface TokenPosition {
  symbol: string;
  balance: string;
  usdValue: number;
  price: number;
  change24h: number;
  token: string;
}

interface OnChainPortfolio {
  id: number;
  owner: string;
  totalValue: bigint;
  targetYield: bigint;
  riskTolerance: bigint;
  lastRebalance: bigint;
  isActive: boolean;
  assets: string[];
}

export function PositionsList({ address }: { address: string }) {
  const { isConnected } = useAccount();
  const { data: portfolioCount, refetch } = usePortfolioCount();
  const [positions, setPositions] = useState<TokenPosition[]>([]);
  const [onChainPortfolios, setOnChainPortfolios] = useState<OnChainPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [totalValue, setTotalValue] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Deposit modal state
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<OnChainPortfolio | null>(null);

  // Withdraw modal state
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [selectedWithdrawPortfolio, setSelectedWithdrawPortfolio] = useState<OnChainPortfolio | null>(null);

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

  const closeWithdrawModal = () => {
    setWithdrawModalOpen(false);
    setSelectedWithdrawPortfolio(null);
  };

  const handleDepositSuccess = () => {
    // Refresh data after successful deposit
    fetchPositions();
    fetchOnChainPortfolios();
  };

  const handleWithdrawSuccess = () => {
    // Refresh data after successful withdrawal
    fetchPositions();
    fetchOnChainPortfolios();
  };

  // Fetch wallet token positions via API (real holdings)
  const fetchPositions = async () => {
    try {
      setError(null);
      console.log('📊 [PositionsList] Fetching positions for:', address);
      
      const res = await fetch(`/api/positions?address=${encodeURIComponent(address)}`);
      
      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }
      
      const data = await res.json();
      console.log('📊 [PositionsList] API response:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setPositions(data.positions || []);
      setTotalValue(data.totalValue || 0);
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error('Failed to fetch positions:', err);
      setError(err.message);
    }
  };

  // Fetch on-chain portfolios from contract
  const fetchOnChainPortfolios = async () => {
    if (!portfolioCount || portfolioCount === 0n) {
      setOnChainPortfolios([]);
      return;
    }

    console.log(`📊 [PositionsList] Fetching ${portfolioCount.toString()} on-chain portfolios`);
    const count = Number(portfolioCount);
    const loadedPortfolios: OnChainPortfolio[] = [];
    
    for (let i = 0; i < count; i++) {
      try {
        const res = await fetch(`/api/portfolio/${i}`);
        if (res.ok) {
          const p = await res.json();
          if (p && !p.error && p.isActive) {
            loadedPortfolios.push({
              id: i,
              owner: p.owner,
              totalValue: BigInt(p.totalValue || 0),
              targetYield: BigInt(p.targetYield || 0),
              riskTolerance: BigInt(p.riskTolerance || 0),
              lastRebalance: BigInt(p.lastRebalance || 0),
              isActive: p.isActive,
              assets: p.assets || [],
            });
          }
        }
      } catch (err) {
        console.warn(`Portfolio ${i} fetch failed:`, err);
      }
    }

    console.log(`✅ [PositionsList] Loaded ${loadedPortfolios.length} on-chain portfolios`);
    setOnChainPortfolios(loadedPortfolios);
  };

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      await Promise.all([fetchPositions(), fetchOnChainPortfolios()]);
      setLoading(false);
    }
    
    if (address && isConnected) {
      loadAll();
    }
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      if (address && isConnected) {
        fetchPositions();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [address, isConnected, portfolioCount]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchPositions(), fetchOnChainPortfolios()]);
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
        return <Coins className="w-6 h-6 text-cyan-400" />;
      default:
        return <Coins className="w-6 h-6 text-gray-400" />;
    }
  };

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-96 border border-gray-700" />;
  }

  if (!isConnected) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="text-center py-12">
          <Wallet className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
          <p className="text-gray-400">
            Connect your wallet to view your token positions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Token Positions - Real Wallet Holdings */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-2xl font-semibold">Token Positions</h2>
              <span className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
                Live Data
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Real wallet holdings • {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-gray-400">Total Value</div>
              <div className="text-xl font-bold text-emerald-400">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {positions.length === 0 || (positions.length === 1 && positions[0].usdValue === 0) ? (
          <div className="text-center py-8 text-gray-400">
            <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="font-semibold">No Token Holdings Found</p>
            <p className="text-sm mt-1 mb-3">Your wallet ({address.slice(0, 6)}...{address.slice(-4)}) has no token balances</p>
            {error && <p className="text-xs text-red-400 mt-2">Error: {error}</p>}
            <div className="mt-4 p-4 bg-gray-900 rounded-lg text-left text-sm">
              <p className="text-gray-300 mb-2">To see positions here, you need tokens in your wallet:</p>
              <ul className="list-disc list-inside text-gray-500 space-y-1">
                <li>Get testnet CRO from a faucet</li>
                <li>Bridge tokens to Cronos Testnet</li>
                <li>Swap for tokens on VVS Finance</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map((position, idx) => (
              <div key={idx} className="bg-gray-900 rounded-lg p-4 border border-gray-700 hover:border-cyan-500/50 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getTokenIcon(position.symbol)}
                    <div>
                      <div className="font-semibold text-lg">{position.symbol}</div>
                      <div className="text-sm text-gray-400">
                        {parseFloat(position.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} tokens
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg">
                      ${position.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-sm text-gray-400">
                        ${position.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                      {position.change24h !== 0 && (
                        <span className={`text-xs flex items-center ${position.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {position.change24h >= 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                          {Math.abs(position.change24h).toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Percentage bar */}
                {totalValue > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Portfolio Allocation</span>
                      <span>{((position.usdValue / totalValue) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div
                        className="bg-gradient-to-r from-cyan-500 to-emerald-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min((position.usdValue / totalValue) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* On-Chain Portfolios Section */}
      {onChainPortfolios.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-2xl font-semibold">On-Chain Portfolio Strategies</h2>
                <span className="text-xs px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded-full border border-cyan-500/30">
                  {onChainPortfolios.length} Active
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Smart contract strategies on Cronos Testnet • Deposit tokens to activate
              </p>
            </div>
            {totalValue > 0 && (
              <div className="text-right">
                <div className="text-xs text-gray-400">Available to Deposit</div>
                <div className="text-lg font-bold text-emerald-400">
                  ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {onChainPortfolios.map((portfolio) => {
              // totalValue is stored in the smallest unit - assume 6 decimals for USDC-like tokens
              // If it's a large number (> 1e12), it's likely 18 decimals, otherwise 6 decimals
              const rawValue = Number(portfolio.totalValue);
              const valueUSD = rawValue > 1e12 
                ? rawValue / 1e18  // 18 decimals (ETH-like)
                : rawValue / 1e6;  // 6 decimals (USDC-like)
              const yieldPercent = Number(portfolio.targetYield) / 100;
              const riskLevel = Number(portfolio.riskTolerance) <= 33 ? 'Low' : Number(portfolio.riskTolerance) <= 66 ? 'Medium' : 'High';
              const riskColor = riskLevel === 'Low' ? 'text-green-400' : riskLevel === 'Medium' ? 'text-yellow-400' : 'text-red-400';
              const isOwner = portfolio.owner.toLowerCase() === address.toLowerCase();
              const hasFunds = rawValue > 0 || portfolio.assets.length > 0;
              
              console.log(`Portfolio #${portfolio.id}: rawValue=${rawValue}, assets=${portfolio.assets.length}, hasFunds=${hasFunds}`);

              return (
                <div key={portfolio.id} className={`bg-gray-900 rounded-lg p-5 border ${isOwner ? 'border-cyan-500/50' : 'border-gray-700'} hover:border-cyan-500/50 transition-all`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">Portfolio #{portfolio.id}</h3>
                        {isOwner && (
                          <span className="text-xs px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded-full">
                            Your Portfolio
                          </span>
                        )}
                        {hasFunds && (
                          <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">
                            Funded
                          </span>
                        )}
                        {!hasFunds && (
                          <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full">
                            Needs Funding
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 font-mono">
                        Owner: {portfolio.owner.slice(0, 6)}...{portfolio.owner.slice(-4)}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      portfolio.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {portfolio.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Strategy Settings */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Target Yield</div>
                      <div className="text-lg font-bold text-emerald-400">{yieldPercent}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Risk Level</div>
                      <div className={`text-lg font-bold ${riskColor}`}>
                        {riskLevel} ({Number(portfolio.riskTolerance)}/100)
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Deposited</div>
                      <div className="text-lg font-bold">
                        {valueUSD > 0 ? `$${valueUSD.toFixed(2)}` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Show deposited assets if any */}
                  {portfolio.assets.length > 0 && (
                    <div className="mb-4 p-3 bg-gray-800 rounded-lg">
                      <div className="text-xs text-gray-400 mb-2">Deposited Assets:</div>
                      <div className="flex flex-wrap gap-2">
                        {portfolio.assets.map((asset, idx) => (
                          <span key={idx} className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs font-mono">
                            {asset.toLowerCase() === '0xc01efaaf7c5c61bebfaeb358e1161b537b8bc0e0' ? 'devUSDC' : `${asset.slice(0, 6)}...${asset.slice(-4)}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Funded Portfolio Actions */}
                  {hasFunds && isOwner && (
                    <div className="bg-gray-800 rounded-lg p-4 mb-4 border border-emerald-500/30">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-300">Portfolio funded with ${valueUSD.toFixed(2)}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Earning {yieldPercent}% target yield • You can withdraw anytime
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                            onClick={() => openDepositModal(portfolio)}
                          >
                            Add More
                          </button>
                          <button 
                            className="px-4 py-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                            onClick={() => openWithdrawModal(portfolio)}
                          >
                            <ArrowDownToLine className="w-4 h-4" />
                            Withdraw
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Empty Portfolio CTA */}
                  {!hasFunds && isOwner && (
                    <div className="bg-gray-800 rounded-lg p-4 mb-4 border border-dashed border-gray-600">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-300">This strategy is ready but unfunded</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Deposit tokens to start earning {yieldPercent}% target yield
                          </p>
                        </div>
                        <button 
                          className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 rounded-lg text-sm font-semibold transition-colors"
                          onClick={() => openDepositModal(portfolio)}
                        >
                          Fund Portfolio
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                    <span>Created: {new Date(Number(portfolio.lastRebalance) * 1000).toLocaleDateString()}</span>
                    <a
                      href={`https://explorer.cronos.org/testnet/address/${portfolio.owner}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      View on Explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-white">{positions.length}</div>
            <div className="text-xs text-gray-400">Token Types</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-cyan-400">{onChainPortfolios.length}</div>
            <div className="text-xs text-gray-400">On-Chain Portfolios</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-400">
              ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-gray-400">Total Holdings</div>
          </div>
        </div>
      </div>

      {/* Deposit Modal */}
      {selectedPortfolio && (
        <DepositModal
          isOpen={depositModalOpen}
          onClose={closeDepositModal}
          portfolioId={selectedPortfolio.id}
          targetYield={Number(selectedPortfolio.targetYield) / 100}
          riskTolerance={Number(selectedPortfolio.riskTolerance)}
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
          totalValue={Number(selectedWithdrawPortfolio.totalValue)}
          onSuccess={handleWithdrawSuccess}
        />
      )}
    </div>
  );
}
