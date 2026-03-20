/**
 * WDK Treasury Status Component
 * 
 * Displays the status of the server-managed WDK treasury wallet.
 * The treasury wallet is used by AI agents to execute trades and manage pool funds.
 * 
 * SECURITY: No wallet credentials are ever exposed to the browser.
 * All WDK operations happen server-side via secure API endpoints.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

interface TreasuryStatus {
  address: string;
  balance: string;
  isOperational: boolean;
  lastActivity?: string;
}

interface WdkTreasuryStatusProps {
  className?: string;
  showBalance?: boolean;
}

export function WdkWalletConnect({ className = '', showBalance = false }: WdkTreasuryStatusProps) {
  const [status, setStatus] = useState<TreasuryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTreasuryStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/community-pool/treasury/status');
      if (!res.ok) {
        throw new Error('Treasury service unavailable');
      }
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError('Treasury offline');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTreasuryStatus();
    // Refresh every 30 seconds
    const interval = setInterval(fetchTreasuryStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchTreasuryStatus]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg ${className}`}>
        <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
        <span className="text-sm text-gray-400">Connecting to WDK Treasury...</span>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className={`flex items-center gap-2 p-3 bg-red-900/20 border border-red-700/30 rounded-lg ${className}`}>
        <div className="w-2 h-2 bg-red-500 rounded-full" />
        <span className="text-sm text-red-400">Treasury: {error || 'Unavailable'}</span>
      </div>
    );
  }

  return (
    <div className={`p-3 bg-gradient-to-r from-emerald-900/20 to-teal-900/20 border border-emerald-700/30 rounded-lg ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status.isOperational ? 'bg-emerald-500 animate-pulse' : 'bg-yellow-500'}`} />
          <span className="text-sm font-medium text-emerald-400">WDK Treasury</span>
          <span className="text-xs px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded">
            Agent Wallet
          </span>
        </div>
        {showBalance && status.balance && (
          <span className="text-xs text-gray-400">
            ${parseFloat(status.balance).toFixed(2)} USDT
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs font-mono text-gray-500">
          {status.address.slice(0, 6)}...{status.address.slice(-4)}
        </span>
        <span className="text-xs text-gray-600">•</span>
        <span className="text-xs text-gray-500">
          {status.isOperational ? 'Operational' : 'Maintenance'}
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Deposit USDT from your wallet above. The AI agent manages pool funds securely.
      </p>
    </div>
  );
}

// Also export as WdkTreasuryStatus for clarity
export { WdkWalletConnect as WdkTreasuryStatus };