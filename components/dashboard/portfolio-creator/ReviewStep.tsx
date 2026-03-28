'use client';

import { 
  CheckCircle, Loader2, Shield, Sparkles, 
  Target, Filter, Lock, Eye, AlertTriangle 
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { StrategyConfig, AssetFilter } from './types';

export function ReviewStep({ 
  strategy, 
  filters, 
  strategyPrivate,
  zkProofGenerated,
  isPending, 
  isConfirming,
  onCreate, 
  onBack 
}: {
  strategy: StrategyConfig;
  filters: AssetFilter;
  strategyPrivate: boolean;
  zkProofGenerated: boolean;
  isPending: boolean;
  isConfirming: boolean;
  onCreate: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
        <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#AF52DE]" />
        Review Configuration
      </h3>

      <div className="space-y-3 sm:space-y-4">
        {/* Strategy Summary */}
        <div className="bg-[#f5f5f7] rounded-[14px] p-4 border border-black/5">
          <h4 className="font-semibold text-[14px] sm:text-[15px] text-[#1d1d1f] mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-[#AF52DE]" />
            Strategy
          </h4>
          <div className="space-y-2 text-[12px] sm:text-[13px]">
            <div className="flex justify-between">
              <span className="text-[#86868b]">Name:</span>
              <span className="font-semibold text-[#1d1d1f]">{strategy.name || 'Unnamed Portfolio'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Target Yield:</span>
              <span className="font-semibold text-[#34C759]">{strategy.targetYield / 100}% APY</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Risk Tolerance:</span>
              <span className="font-semibold text-[#1d1d1f]">{strategy.riskTolerance}/100</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Max Drawdown:</span>
              <span className="font-semibold text-[#FF3B30]">{strategy.maxDrawdown}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Rebalance:</span>
              <span className="font-semibold text-[#1d1d1f] capitalize">{strategy.rebalanceFrequency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Hedging:</span>
              <span className="font-semibold text-[#1d1d1f]">{strategy.hedgingEnabled ? '✓ Enabled' : '✗ Disabled'}</span>
            </div>
          </div>
        </div>

        {/* Filters Summary */}
        <div className="bg-[#f5f5f7] rounded-[14px] p-4 border border-black/5">
          <h4 className="font-semibold text-[14px] sm:text-[15px] text-[#1d1d1f] mb-3 flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#007AFF]" />
            Asset Filters
          </h4>
          <div className="space-y-2 text-[12px] sm:text-[13px]">
            <div className="flex justify-between">
              <span className="text-[#86868b]">Min Market Cap:</span>
              <span className="font-semibold text-[#1d1d1f]">${((filters.minMarketCap ?? 0) / 1000000).toFixed(1)}M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Max Volatility:</span>
              <span className="font-semibold text-[#1d1d1f]">{filters.maxVolatility ?? 0}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Categories:</span>
              <span className="font-semibold text-[#1d1d1f]">{filters.allowedCategories?.length ?? 0} selected</span>
            </div>
          </div>
        </div>

        {/* Privacy Summary */}
        <div className={`rounded-[14px] p-4 border ${
          strategyPrivate
            ? 'bg-[#34C759]/5 border-[#34C759]/20'
            : 'bg-[#f5f5f7] border-black/5'
        }`}>
          <h4 className="font-semibold text-[14px] sm:text-[15px] text-[#1d1d1f] mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#34C759]" />
            Privacy Protection
          </h4>
          <div className="text-[12px] sm:text-[13px] space-y-2">
            <div className="flex items-center gap-2">
              {strategyPrivate ? (
                <>
                  <Lock className="w-4 h-4 text-[#34C759]" />
                  <span className="text-[#34C759] font-semibold">ZK-Protected Strategy</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-[#86868b]" />
                  <span className="text-[#86868b]">Public Strategy</span>
                </>
              )}
            </div>
            {strategyPrivate && zkProofGenerated && (
              <div className="text-[11px] sm:text-[12px] text-[#34C759]">
                ✓ ZK-STARK proof generated &bull; 521-bit security
              </div>
            )}
          </div>
        </div>
      </div>

      {isPending || isConfirming ? (
        <div className="bg-[#AF52DE]/5 border border-[#AF52DE]/20 rounded-[14px] p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 text-[#AF52DE] animate-spin" />
            <div>
              <p className="font-semibold text-[14px] sm:text-[15px] text-[#AF52DE]">
                {isPending ? 'Awaiting Signature...' : 'Creating Portfolio...'}
              </p>
              <p className="text-[11px] sm:text-[12px] text-[#86868b] mt-1">
                {isPending ? 'Please sign the transaction in your wallet' : 'Transaction is being confirmed on Cronos zkEVM'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 px-6 py-3 sm:py-3.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-[#1d1d1f] transition-all"
          >
            Back
          </button>
          <button
            onClick={onCreate}
            className="flex-1 px-6 py-3 sm:py-3.5 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-white transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
            Create Portfolio
          </button>
        </div>
      )}

      <div className="bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[14px] p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-[#FF9500] flex-shrink-0 mt-0.5" />
          <div className="text-[12px] sm:text-[13px]">
            <p className="font-semibold text-[#FF9500] mb-1">On-Chain Commitment</p>
            <p className="mb-2 text-[#424245] font-medium">This will commit your portfolio and strategy to Cronos zkEVM Testnet:</p>
            <ul className="list-disc list-inside space-y-1 text-[10px] sm:text-[11px] font-medium">
              <li className="text-[#424245]">Portfolio creation requires wallet signature</li>
              <li className="text-[#424245]">Strategy metadata stored on-chain with ZK proof</li>
              <li className="text-[#424245]">All operations are cryptographically verified</li>
              <li className="text-[#424245]">Gas fees covered by x402 gasless protocol</li>
              <li className="text-[#424245]">Immutable audit trail on blockchain</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
