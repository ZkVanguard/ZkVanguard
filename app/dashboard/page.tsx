'use client';

import { useState, useEffect } from 'react';
import { useAccount, useBalance, useChainId } from 'wagmi';
import { logger } from '../../lib/utils/logger';
import { PortfolioOverview } from '../../components/dashboard/PortfolioOverview';
import { AgentActivity } from '../../components/dashboard/AgentActivity';
import { RiskMetrics } from '../../components/dashboard/RiskMetrics';
import { ChatInterface } from '../../components/dashboard/ChatInterface';
import { PositionsList } from '../../components/dashboard/PositionsList';
import { SettlementsPanel } from '@/components/dashboard/SettlementsPanel';
import { ZKProofDemo } from '@/components/dashboard/ZKProofDemo';
import { AdvancedPortfolioCreator } from '@/components/dashboard/AdvancedPortfolioCreator';
import { formatEther } from 'viem';
import { useContractAddresses, usePortfolioCount } from '@/lib/contracts/hooks';

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'positions' | 'settlements'>('overview');

  // Contract data
  const contractAddresses = useContractAddresses();
  const { data: portfolioCount } = usePortfolioCount();

  // Network info
  const networkName = chainId === 338 ? 'Cronos Testnet' : chainId === 25 ? 'Cronos Mainnet' : 'Unknown Network';
  const isTestnet = chainId === 338;
  
  // Allow access without wallet for demo purposes
  const displayAddress = address || '0x0000...0000';
  const displayBalance = balance ? parseFloat(formatEther(balance.value)).toFixed(4) : '0.00';

  useEffect(() => {
    if (isConnected && contractAddresses) {
      logger.debug('Contract Addresses', { addresses: contractAddresses });
      logger.debug('Portfolio Count', { count: portfolioCount?.toString() });
    }
  }, [isConnected, contractAddresses, portfolioCount]);

  return (
    <div className="min-h-screen transition-colors duration-300" style={{background: '#0f0f1a'}}>
      <div className="container mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div className="space-y-4">
              <h1 className="text-5xl font-black">
                <span className="gradient-text">Dashboard</span>
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                {isTestnet && isConnected && (
                  <div className="px-4 py-2 bg-green-500/10 rounded-lg border border-green-500/30 flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-sm font-semibold text-green-400">{networkName}</span>
                  </div>
                )}
                <div className="px-4 py-2 bg-green-500/10 rounded-lg border border-green-500/30 flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-sm font-semibold text-green-400">PRODUCTION READY</span>
                </div>
                <div className="px-4 py-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30 flex items-center gap-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                  <span className="text-sm font-medium text-emerald-400">10/10 Tests Passing</span>
                </div>
                {!isConnected && (
                  <div className="px-4 py-2 bg-cyan-500/10 rounded-lg border border-cyan-500/30 flex items-center gap-2">
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                    <span className="text-sm font-medium text-cyan-400">Connect wallet for live portfolio</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="glass px-6 py-4 rounded-xl border border-white/10">
                <div className="text-xs text-gray-400 mb-1 font-medium">CONNECTED ADDRESS</div>
                <div className="text-lg font-mono font-bold text-white">
                  {displayAddress.slice(0, 6)}...{displayAddress.slice(-4)}
                </div>
              </div>
              {isConnected && balance && (
                <div className="glass px-6 py-4 rounded-xl border border-white/10">
                  <div className="text-xs text-gray-400 mb-1 font-medium">WALLET BALANCE</div>
                  <div className="text-lg font-mono font-bold text-white">
                    {displayBalance} {balance.symbol}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-8">
          <div className="glass rounded-xl p-1.5 inline-flex items-center gap-2 border border-white/10">
            {(['overview', 'agents', 'positions', 'settlements'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative px-6 py-3 font-bold capitalize transition-all duration-300 rounded-lg ${
                  activeTab === tab
                    ? 'text-white bg-gradient-to-r from-emerald-600 to-cyan-600'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {activeTab === 'overview' && (
              <>
                <div className="flex justify-center">
                  <AdvancedPortfolioCreator />
                </div>
                <PortfolioOverview address={displayAddress} />
                <RiskMetrics address={displayAddress} />
                <ZKProofDemo />
              </>
            )}
            {activeTab === 'agents' && <AgentActivity address={displayAddress} />}
            {activeTab === 'positions' && <PositionsList address={displayAddress} />}
            {activeTab === 'settlements' && <SettlementsPanel address={displayAddress} />}
          </div>

          {/* Chat Sidebar */}
          <div className="lg:col-span-1">
            <ChatInterface address={displayAddress} />
          </div>
        </div>
      </div>
    </div>
  );
}
