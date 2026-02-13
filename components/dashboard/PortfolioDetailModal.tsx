'use client';

import { useState } from 'react';
import { X, TrendingUp, PieChart, History, Brain, Settings, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';
import PerformanceChart from './PerformanceChart';

interface Asset {
  symbol: string;
  address: string;
  allocation: number;
  value: number;
  change24h: number;
  price?: number;
  chain?: string;
}

interface Transaction {
  type: 'deposit' | 'withdraw' | 'rebalance';
  timestamp: number;
  amount?: number;
  token?: string;
  changes?: { from: number; to: number; asset: string }[];
  txHash: string;
}

interface Portfolio {
  id: number;
  name: string;
  totalValue: number;
  status: 'FUNDED' | 'EMPTY' | 'NEW';
  targetAPY: number;
  riskLevel: 'Low' | 'Medium' | 'High';
  currentYield: number;
  assets: Asset[];
  lastRebalanced: number;
  transactions: Transaction[];
  aiAnalysis: {
    summary: string;
    recommendations: string[];
    riskAssessment: string;
  };
}

interface PortfolioDetailModalProps {
  portfolio: Portfolio;
  onClose: () => void;
  walletAddress?: string;
}

export default function PortfolioDetailModal({ portfolio, onClose, walletAddress }: PortfolioDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'analysis' | 'settings'>('overview');
  const [riskLevel, setRiskLevel] = useState<'Low' | 'Medium' | 'High'>(portfolio.riskLevel);
  const [targetAPY, setTargetAPY] = useState(portfolio.targetAPY);
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [rebalanceThreshold, setRebalanceThreshold] = useState(5);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: PieChart },
    { id: 'transactions', label: 'History', icon: History },
    { id: 'analysis', label: 'AI Analysis', icon: Brain },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (value: number) => {
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#007AFF] to-[#0066CC] px-6 py-5 text-white flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{portfolio.name}</h2>
            <p className="text-white/80 text-sm mt-1">
              {formatCurrency(portfolio.totalValue)} • {portfolio.status}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 px-6 flex gap-1">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-3 font-medium transition-all relative ${
                  activeTab === tab.id
                    ? 'text-[#007AFF]'
                    : 'text-[#86868b] hover:text-[#1d1d1f]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#007AFF]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Key Metrics */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-[#f5f5f7] rounded-xl p-4">
                  <p className="text-[#86868b] text-sm mb-1">Total Value</p>
                  <p className="text-2xl font-bold text-[#1d1d1f]">{formatCurrency(portfolio.totalValue)}</p>
                </div>
                <div className="bg-[#f5f5f7] rounded-xl p-4">
                  <p className="text-[#86868b] text-sm mb-1">Current Yield</p>
                  <p className="text-2xl font-bold text-[#34C759]">{portfolio.currentYield}%</p>
                </div>
                <div className="bg-[#f5f5f7] rounded-xl p-4">
                  <p className="text-[#86868b] text-sm mb-1">Target APY</p>
                  <p className="text-2xl font-bold text-[#1d1d1f]">{portfolio.targetAPY}%</p>
                </div>
                <div className="bg-[#f5f5f7] rounded-xl p-4">
                  <p className="text-[#86868b] text-sm mb-1">Risk Level</p>
                  <p className={`text-2xl font-bold ${
                    portfolio.riskLevel === 'High' ? 'text-[#FF3B30]' :
                    portfolio.riskLevel === 'Medium' ? 'text-[#FF9500]' :
                    'text-[#34C759]'
                  }`}>{portfolio.riskLevel}</p>
                </div>
              </div>

              {/* Asset Allocation */}
              <div>
                <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
                  <PieChart className="w-5 h-5 text-[#007AFF]" />
                  Asset Allocation
                </h3>
                <div className="space-y-3">
                  {portfolio.assets.map((asset, idx) => (
                    <div key={idx} className="bg-[#f5f5f7] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${
                            idx === 0 ? 'bg-[#007AFF]' :
                            idx === 1 ? 'bg-[#34C759]' :
                            idx === 2 ? 'bg-[#FF9500]' :
                            'bg-[#FF3B30]'
                          }`} />
                          <span className="font-semibold text-[#1d1d1f]">{asset.symbol}</span>
                        </div>
                        <span className="text-[#86868b] text-sm">{asset.allocation}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[#1d1d1f] font-medium">{formatCurrency(asset.value)}</span>
                        <span className={`text-sm flex items-center gap-1 ${
                          asset.change24h >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'
                        }`}>
                          {asset.change24h >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                          {Math.abs(asset.change24h).toFixed(2)}%
                        </span>
                      </div>
                      {/* Allocation Bar */}
                      <div className="mt-3 bg-white rounded-full h-2 overflow-hidden">
                        <div 
                          className={`h-full ${
                            idx === 0 ? 'bg-[#007AFF]' :
                            idx === 1 ? 'bg-[#34C759]' :
                            idx === 2 ? 'bg-[#FF9500]' :
                            'bg-[#FF3B30]'
                          }`}
                          style={{ width: `${asset.allocation}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Performance Chart */}
              <div>
                <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-[#007AFF]" />
                  Performance
                </h3>
                {walletAddress ? (
                  <PerformanceChart 
                    walletAddress={walletAddress} 
                    currentValue={portfolio.totalValue}
                    assets={portfolio.assets.map(a => ({
                      symbol: a.symbol,
                      value: a.value,
                      change24h: a.change24h,
                    }))}
                  />
                ) : (
                  <div className="bg-[#f5f5f7] rounded-xl p-8 text-center">
                    <TrendingUp className="w-12 h-12 text-[#86868b] mx-auto mb-3" />
                    <p className="text-[#86868b]">Connect wallet to view performance</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
                <History className="w-5 h-5 text-[#007AFF]" />
                Transaction History
              </h3>
              {portfolio.transactions.length === 0 ? (
                <div className="bg-[#f5f5f7] rounded-xl p-8 text-center">
                  <History className="w-12 h-12 text-[#86868b] mx-auto mb-3" />
                  <p className="text-[#86868b]">No transactions yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {portfolio.transactions.map((tx, idx) => (
                    <div key={idx} className="bg-[#f5f5f7] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            tx.type === 'deposit' ? 'bg-[#34C759]/20' :
                            tx.type === 'withdraw' ? 'bg-[#FF3B30]/20' :
                            'bg-[#007AFF]/20'
                          }`}>
                            {tx.type === 'deposit' && <ArrowUpRight className="w-5 h-5 text-[#34C759]" />}
                            {tx.type === 'withdraw' && <ArrowDownRight className="w-5 h-5 text-[#FF3B30]" />}
                            {tx.type === 'rebalance' && <RefreshCw className="w-5 h-5 text-[#007AFF]" />}
                          </div>
                          <div>
                            <p className="font-semibold text-[#1d1d1f] capitalize">{tx.type}</p>
                            <p className="text-sm text-[#86868b]">{formatDate(tx.timestamp)}</p>
                          </div>
                        </div>
                        {tx.amount && (
                          <div className="text-right">
                            <p className="font-semibold text-[#1d1d1f]">{formatCurrency(tx.amount)}</p>
                            {tx.token && <p className="text-sm text-[#86868b]">{tx.token}</p>}
                          </div>
                        )}
                      </div>
                      {tx.changes && (
                        <div className="mt-3 pl-13 space-y-1">
                          {tx.changes.map((change, cidx) => (
                            <p key={cidx} className="text-sm text-[#86868b]">
                              {change.asset}: {change.from}% → {change.to}%
                            </p>
                          ))}
                        </div>
                      )}
                      <a 
                        href={`https://explorer.cronos.org/testnet/tx/${tx.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#007AFF] hover:underline mt-2 inline-block"
                      >
                        View on Explorer →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
                  <Brain className="w-5 h-5 text-[#007AFF]" />
                  AI Analysis
                </h3>
                <div className="bg-[#f5f5f7] rounded-xl p-5">
                  <p className="text-[#1d1d1f] leading-relaxed">{portfolio.aiAnalysis.summary}</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-[#1d1d1f] mb-3">Recommendations</h4>
                <div className="space-y-2">
                  {portfolio.aiAnalysis.recommendations.map((rec, idx) => (
                    <div key={idx} className="bg-[#f5f5f7] rounded-lg p-4 flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-[#007AFF] text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {idx + 1}
                      </div>
                      <p className="text-[#1d1d1f]">{rec}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-[#1d1d1f] mb-3">Risk Assessment</h4>
                <div className="bg-[#f5f5f7] rounded-xl p-5">
                  <p className="text-[#1d1d1f] leading-relaxed">{portfolio.aiAnalysis.riskAssessment}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#007AFF]" />
                Portfolio Settings
              </h3>

              {/* Risk Level */}
              <div className="bg-[#f5f5f7] rounded-xl p-6">
                <label className="block text-sm font-medium text-[#1d1d1f] mb-3">Risk Level</label>
                <div className="flex gap-3">
                  {(['Low', 'Medium', 'High'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setRiskLevel(level)}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all ${
                        riskLevel === level
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-white text-[#424245] hover:bg-gray-50'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-[#86868b] mt-3">
                  {riskLevel === 'Low' && 'Conservative approach with stable assets'}
                  {riskLevel === 'Medium' && 'Balanced mix of stable and growth assets'}
                  {riskLevel === 'High' && 'Aggressive strategy for maximum returns'}
                </p>
              </div>

              {/* Target APY */}
              <div className="bg-[#f5f5f7] rounded-xl p-6">
                <label className="block text-sm font-medium text-[#1d1d1f] mb-3">
                  Target APY: {targetAPY}%
                </label>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={targetAPY}
                  onChange={(e) => setTargetAPY(Number(e.target.value))}
                  className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-[#007AFF]"
                />
                <div className="flex justify-between text-sm text-[#86868b] mt-2">
                  <span>1%</span>
                  <span>50%</span>
                </div>
              </div>

              {/* Auto-Rebalance */}
              <div className="bg-[#f5f5f7] rounded-xl p-6">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <label className="block text-sm font-medium text-[#1d1d1f]">Auto-Rebalance</label>
                    <p className="text-sm text-[#86868b] mt-1">Automatically maintain target allocations</p>
                  </div>
                  <button
                    onClick={() => setAutoRebalance(!autoRebalance)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      autoRebalance ? 'bg-[#34C759]' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        autoRebalance ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {autoRebalance && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <label className="block text-sm font-medium text-[#1d1d1f] mb-3">
                      Rebalance Threshold: {rebalanceThreshold}%
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={rebalanceThreshold}
                      onChange={(e) => setRebalanceThreshold(Number(e.target.value))}
                      className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-[#007AFF]"
                    />
                    <p className="text-sm text-[#86868b] mt-2">
                      Rebalance when allocation drifts by {rebalanceThreshold}%
                    </p>
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    // TODO: Implement save functionality
                    alert('Settings saved successfully!');
                  }}
                  className="flex-1 bg-[#007AFF] text-white py-3 px-6 rounded-xl font-medium hover:bg-[#0051D5] transition-colors"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setRiskLevel(portfolio.riskLevel);
                    setTargetAPY(portfolio.targetAPY);
                    setAutoRebalance(true);
                    setRebalanceThreshold(5);
                  }}
                  className="px-6 py-3 bg-white text-[#424245] rounded-xl font-medium hover:bg-gray-50 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
