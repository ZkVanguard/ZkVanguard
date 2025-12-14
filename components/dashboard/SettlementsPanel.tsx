'use client';

import { useState, useEffect } from 'react';
import { Clock, CheckCircle, XCircle } from 'lucide-react';

interface Settlement {
  id: string;
  recipient: string;
  amount: number;
  token: string;
  status: 'pending' | 'completed' | 'failed';
  priority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: Date;
}

export function SettlementsPanel({ address }: { address: string }) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch real data from API
    setTimeout(() => {
      setSettlements([
        {
          id: '1',
          recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
          amount: 1500,
          token: 'USDC',
          status: 'completed',
          priority: 'HIGH',
          timestamp: new Date(Date.now() - 1000 * 60 * 30),
        },
        {
          id: '2',
          recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
          amount: 750,
          token: 'USDT',
          status: 'pending',
          priority: 'MEDIUM',
          timestamp: new Date(Date.now() - 1000 * 60 * 5),
        },
        {
          id: '3',
          recipient: '0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889',
          amount: 3000,
          token: 'USDC',
          status: 'pending',
          priority: 'URGENT',
          timestamp: new Date(),
        },
      ]);
      setLoading(false);
    }, 1000);
  }, [address]);

  if (loading) {
    return <div className="bg-gray-800 rounded-xl p-6 animate-pulse h-96" />;
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'pending':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return null;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-red-500/20 text-red-500';
      case 'HIGH':
        return 'bg-orange-500/20 text-orange-500';
      case 'MEDIUM':
        return 'bg-yellow-500/20 text-yellow-500';
      case 'LOW':
        return 'bg-gray-500/20 text-gray-500';
      default:
        return 'bg-gray-500/20 text-gray-500';
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Settlements</h2>
        <button 
          onClick={() => alert('New Settlement feature coming soon!')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
        >
          New Settlement
        </button>
      </div>

      <div className="space-y-3">
        {settlements.map((settlement) => (
          <div
            key={settlement.id}
            className="p-4 bg-gray-900 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-3">
                {getStatusIcon(settlement.status)}
                <div>
                  <div className="font-medium text-white">
                    {settlement.amount} {settlement.token}
                  </div>
                  <div className="text-sm text-gray-400">
                    {settlement.recipient.slice(0, 10)}...{settlement.recipient.slice(-8)}
                  </div>
                </div>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${getPriorityColor(settlement.priority)}`}>
                {settlement.priority}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
