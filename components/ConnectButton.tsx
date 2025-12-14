'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Wallet } from 'lucide-react';
import { useState } from 'react';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isLoading } = useConnect();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState('');

  const handleConnect = async () => {
    try {
      setError('');
      if (connectors[0]) {
        await connect({ connector: connectors[0] });
      } else {
        setError('Please install MetaMask');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
      console.error('Connection error:', err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  };

  if (isConnected && address) {
    return (
      <button
        onClick={handleDisconnect}
        className="px-4 py-2 glass border border-white/20 hover:border-emerald-500 rounded-lg transition-all flex items-center space-x-2"
      >
        <Wallet className="w-4 h-4 text-emerald-400" />
        <span className="text-white">{address.slice(0, 6)}...{address.slice(-4)}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={handleConnect}
        disabled={isLoading}
        className="px-6 py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:shadow-lg hover:shadow-emerald-500/30 rounded-lg font-medium transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed text-white"
      >
        <Wallet className="w-4 h-4" />
        <span>{isLoading ? 'Connecting...' : 'Connect Wallet'}</span>
      </button>
      {error && <span className="text-xs text-red-400 mt-1">{error}</span>}
    </div>
  );
}
