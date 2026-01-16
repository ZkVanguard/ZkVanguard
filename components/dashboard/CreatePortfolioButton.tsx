'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useCreatePortfolio, useUserPortfolios } from '../../lib/contracts/hooks';
import { Plus, Loader2, CheckCircle, XCircle } from 'lucide-react';

export function CreatePortfolioButton() {
  const { isConnected, address } = useAccount();
  // Get only portfolios owned by the connected wallet
  const { count: userPortfolioCount } = useUserPortfolios(address);
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
      <div className="bg-white p-6 rounded-xl border border-[#E5E5EA] shadow-sm">
        <p className="text-[#86868b] text-center">Connect wallet to create portfolio</p>
      </div>
    );
  }

  if (isConfirmed) {
    return (
      <div className="bg-white p-6 rounded-xl border border-[#34C759]/30 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle className="w-6 h-6 text-[#34C759]" />
          <h3 className="text-xl font-bold text-[#34C759]">Portfolio Created!</h3>
        </div>
        <p className="text-[#1d1d1f] mb-4">
          Your portfolio has been created on-chain. You now have {userPortfolioCount + 1} portfolio(s).
        </p>
        <button
          onClick={() => {
            setShowForm(false);
            window.location.reload(); // Refresh to see new portfolio
          }}
          className="w-full px-4 py-2 bg-[#34C759] hover:bg-[#34C759]/90 text-white rounded-lg font-semibold transition-colors"
        >
          View Dashboard
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-xl border border-[#FF3B30]/30 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <XCircle className="w-6 h-6 text-[#FF3B30]" />
          <h3 className="text-xl font-bold text-[#FF3B30]">Transaction Failed</h3>
        </div>
        <p className="text-[#1d1d1f] mb-4 text-sm">
          {error.message || 'Failed to create portfolio'}
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="w-full px-4 py-2 bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-white rounded-lg font-semibold transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl border border-[#E5E5EA] shadow-sm">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full px-6 py-4 bg-gradient-to-r from-[#34C759] to-[#007AFF] hover:opacity-90 rounded-lg font-bold text-white transition-all duration-300 flex items-center justify-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Create New Portfolio
        </button>
      ) : (
        <div className="space-y-4">
          <h3 className="text-xl font-bold gradient-text">Create On-Chain Portfolio</h3>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                Target Yield (Basis Points)
              </label>
              <input
                type="number"
                value={targetYield}
                onChange={(e) => setTargetYield(e.target.value)}
                placeholder="1000 = 10%"
                className="w-full px-4 py-2 bg-[#f5f5f7] border border-[#e8e8ed] rounded-lg text-[#1d1d1f] focus:border-[#007AFF] focus:outline-none"
                disabled={isPending || isConfirming}
              />
              <p className="text-xs text-[#86868b] mt-1">
                Example: 1000 = 10%, 500 = 5%
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                Risk Tolerance (0-100)
              </label>
              <input
                type="number"
                value={riskTolerance}
                onChange={(e) => setRiskTolerance(e.target.value)}
                placeholder="50 = Medium Risk"
                min="0"
                max="100"
                className="w-full px-4 py-2 bg-[#f5f5f7] border border-[#e8e8ed] rounded-lg text-[#1d1d1f] focus:border-[#007AFF] focus:outline-none"
                disabled={isPending || isConfirming}
              />
              <p className="text-xs text-[#86868b] mt-1">
                0 = Low Risk, 50 = Medium, 100 = High Risk
              </p>
            </div>
          </div>

          {isPending || isConfirming ? (
            <div className="bg-[#007AFF]/10 border border-[#007AFF]/30 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-[#007AFF] animate-spin" />
                <div>
                  <p className="font-semibold text-[#007AFF]">
                    {isPending ? 'Waiting for signature...' : 'Confirming transaction...'}
                  </p>
                  <p className="text-xs text-[#86868b] mt-1">
                    {isPending ? 'Please sign the transaction in your wallet' : 'Transaction is being mined on Cronos Testnet'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-[#34C759] to-[#007AFF] hover:opacity-90 text-white rounded-lg font-semibold transition-colors"
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
