'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useCreatePortfolio, usePortfolioCount } from '../../lib/contracts/hooks';
import { Plus, Loader2, CheckCircle, XCircle } from 'lucide-react';

export function CreatePortfolioButton() {
  const { isConnected } = useAccount();
  const { data: portfolioCount } = usePortfolioCount();
  const { createPortfolio, isPending, isConfirming, isConfirmed, error } = useCreatePortfolio();
  
  const [targetYield, setTargetYield] = useState('1000'); // 10% in basis points
  const [riskTolerance, setRiskTolerance] = useState('50'); // 50%
  const [showForm, setShowForm] = useState(false);

  const handleCreate = () => {
    try {
      const yieldBps = BigInt(targetYield);
      const risk = BigInt(riskTolerance);
      createPortfolio(yieldBps, risk);
    } catch (err) {
      console.error('Failed to create portfolio:', err);
    }
  };

  if (!isConnected) {
    return (
      <div className="glass p-6 rounded-xl border border-white/10">
        <p className="text-gray-400 text-center">Connect wallet to create portfolio</p>
      </div>
    );
  }

  if (isConfirmed) {
    return (
      <div className="glass p-6 rounded-xl border border-green-500/30 bg-green-500/5">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle className="w-6 h-6 text-green-400" />
          <h3 className="text-xl font-bold text-green-400">Portfolio Created!</h3>
        </div>
        <p className="text-gray-300 mb-4">
          Your portfolio has been created on-chain. Portfolio #{portfolioCount?.toString() || '...'}
        </p>
        <button
          onClick={() => {
            setShowForm(false);
            window.location.reload(); // Refresh to see new portfolio
          }}
          className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors"
        >
          View Dashboard
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass p-6 rounded-xl border border-red-500/30 bg-red-500/5">
        <div className="flex items-center gap-3 mb-4">
          <XCircle className="w-6 h-6 text-red-400" />
          <h3 className="text-xl font-bold text-red-400">Transaction Failed</h3>
        </div>
        <p className="text-gray-300 mb-4 text-sm">
          {error.message || 'Failed to create portfolio'}
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="glass p-6 rounded-xl border border-white/10">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full px-6 py-4 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 rounded-lg font-bold text-white transition-all duration-300 flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Create New Portfolio
        </button>
      ) : (
        <div className="space-y-4">
          <h3 className="text-xl font-bold gradient-text">Create On-Chain Portfolio</h3>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Target Yield (Basis Points)
              </label>
              <input
                type="number"
                value={targetYield}
                onChange={(e) => setTargetYield(e.target.value)}
                placeholder="1000 = 10%"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-cyan-500 focus:outline-none"
                disabled={isPending || isConfirming}
              />
              <p className="text-xs text-gray-500 mt-1">
                Example: 1000 = 10%, 500 = 5%
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Risk Tolerance (0-100)
              </label>
              <input
                type="number"
                value={riskTolerance}
                onChange={(e) => setRiskTolerance(e.target.value)}
                placeholder="50 = Medium Risk"
                min="0"
                max="100"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-cyan-500 focus:outline-none"
                disabled={isPending || isConfirming}
              />
              <p className="text-xs text-gray-500 mt-1">
                0 = Low Risk, 50 = Medium, 100 = High Risk
              </p>
            </div>
          </div>

          {isPending || isConfirming ? (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                <div>
                  <p className="font-semibold text-cyan-400">
                    {isPending ? 'Waiting for signature...' : 'Confirming transaction...'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {isPending ? 'Please sign the transaction in your wallet' : 'Transaction is being mined on Cronos Testnet'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 rounded-lg font-semibold transition-colors"
              >
                Create Portfolio
              </button>
            </div>
          )}

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-xs text-amber-400">
              ⚠️ This will create a real on-chain transaction on Cronos Testnet. You'll need tCRO for gas fees (~0.1-0.2 tCRO).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
