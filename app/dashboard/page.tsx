'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { PortfolioOverview } from '@/components/dashboard/PortfolioOverview';
import { AgentActivity } from '@/components/dashboard/AgentActivity';
import { RiskMetrics } from '@/components/dashboard/RiskMetrics';
import { ChatInterface } from '@/components/dashboard/ChatInterface';
import { PositionsList } from '@/components/dashboard/PositionsList';
import { SettlementsPanel } from '@/components/dashboard/SettlementsPanel';
import { ZKProofDemo } from '@/components/dashboard/ZKProofDemo';

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'positions' | 'settlements'>('overview');

  // Allow access without wallet for demo purposes
  const displayAddress = address || '0x0000...0000';

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <div className="mt-2 flex items-center space-x-2">
            <div className="px-3 py-1 bg-yellow-500/10 border border-yellow-500/30 rounded-full text-xs text-yellow-400">
              [DEMO] Demo Environment - Showcasing Platform Capabilities
            </div>
            {!isConnected && (
              <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/30 rounded-full text-xs text-blue-400">
                Connect wallet for live data
              </div>
            )}
          </div>
        </div>
        <div className="text-sm text-gray-400">
          {displayAddress.slice(0, 6)}...{displayAddress.slice(-4)}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-4 mb-8 border-b border-gray-700">
        {(['overview', 'agents', 'positions', 'settlements'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {activeTab === 'overview' && (
            <>
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
  );
}
