'use client';

import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import {
  calculateHedgeFeeBreakdown,
  estimateTotalHedgeCost,
  formatUsdc,
  formatFeeRate,
} from '@/lib/utils/fees';
import { ON_CHAIN_FEES } from '@/lib/config/pricing';

interface FeeDisplayProps {
  collateralUsdc: number;
  isTestnet?: boolean;
  showDetails?: boolean;
}

export function FeeDisplay({ collateralUsdc, isTestnet = true, showDetails = false }: FeeDisplayProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const hedgeFee = calculateHedgeFeeBreakdown(collateralUsdc);
  const totalCost = estimateTotalHedgeCost(collateralUsdc, isTestnet);

  return (
    <div className="bg-[#f5f5f7] rounded-[12px] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[14px] text-[#86868b]">Fee Breakdown</span>
        <div className="relative">
          <button
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="p-1"
          >
            <InformationCircleIcon className="w-4 h-4 text-[#86868b]" />
          </button>
          {showTooltip && (
            <div className="absolute right-0 top-6 w-64 bg-[#1d1d1f] text-white text-[12px] p-3 rounded-[8px] z-10 shadow-lg">
              <p className="mb-2">
                <strong>Platform Fee:</strong> {formatFeeRate(ON_CHAIN_FEES.hedgeExecutor.feeRateBps)} on all hedge operations
              </p>
              <p className="mb-2">
                <strong>Gasless:</strong> Transactions are sponsored - no gas fees for you
              </p>
              <p>
                <strong>Oracle:</strong> Price feeds are fetched automatically
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {/* Collateral */}
        <div className="flex justify-between text-[14px]">
          <span className="text-[#1d1d1f]">Collateral</span>
          <span className="text-[#1d1d1f] font-medium">{formatUsdc(collateralUsdc)}</span>
        </div>

        {/* Platform Fee */}
        <div className="flex justify-between text-[14px]">
          <span className="text-[#86868b]">
            Platform Fee ({formatFeeRate(hedgeFee.feeRateBps)})
          </span>
          <span className="text-[#FF3B30]">-{formatUsdc(hedgeFee.feeUsdc, 4)}</span>
        </div>

        {/* Gasless Savings */}
        <div className="flex justify-between text-[14px]">
          <span className="text-[#86868b]">Gas Fees</span>
          <span className="text-[#34C759]">$0.00 (sponsored)</span>
        </div>

        {showDetails && (
          <>
            {/* Oracle Fee (shown only in details) */}
            <div className="flex justify-between text-[14px]">
              <span className="text-[#86868b]">Oracle Fee</span>
              <span className="text-[#86868b]">
                {totalCost.estimatedOracleFee.amount} {totalCost.estimatedOracleFee.currency}
              </span>
            </div>
          </>
        )}

        {/* Divider */}
        <div className="border-t border-[#d2d2d7] my-2" />

        {/* Net Collateral */}
        <div className="flex justify-between text-[15px]">
          <span className="text-[#1d1d1f] font-medium">Effective Collateral</span>
          <span className="text-[#1d1d1f] font-semibold">
            {formatUsdc(hedgeFee.netCollateralUsdc)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface FeeCalculatorProps {
  onCollateralChange?: (collateral: number) => void;
}

export function FeeCalculator({ onCollateralChange }: FeeCalculatorProps) {
  const [collateral, setCollateral] = useState(1000);

  const handleChange = (value: number) => {
    setCollateral(value);
    onCollateralChange?.(value);
  };

  const presets = [100, 500, 1000, 5000, 10000];

  return (
    <div className="bg-white rounded-[16px] p-6 border border-black/5">
      <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-4">Fee Calculator</h3>
      
      {/* Input */}
      <div className="mb-4">
        <label className="text-[14px] text-[#86868b] mb-2 block">
          Collateral Amount (USDC)
        </label>
        <input
          type="number"
          value={collateral}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="w-full px-4 py-3 rounded-[10px] border border-[#d2d2d7] text-[16px] text-[#1d1d1f] focus:outline-none focus:border-[#007AFF]"
          placeholder="Enter amount"
          min={1}
        />
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-6">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => handleChange(preset)}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              collateral === preset
                ? 'bg-[#007AFF] text-white'
                : 'bg-[#f5f5f7] text-[#86868b] hover:bg-[#e8e8ed]'
            }`}
          >
            ${preset.toLocaleString()}
          </button>
        ))}
      </div>

      {/* Fee Display */}
      <FeeDisplay collateralUsdc={collateral} showDetails={true} />
    </div>
  );
}

interface TierFeeSummaryProps {
  tierName: string;
  feeRateBps: number;
  monthlyVolume: number;
}

export function TierFeeSummary({ tierName, feeRateBps, monthlyVolume }: TierFeeSummaryProps) {
  const monthlyFees = (monthlyVolume * feeRateBps) / 10000;

  return (
    <div className="bg-gradient-to-br from-[#007AFF]/5 to-[#34C759]/5 rounded-[16px] p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[15px] font-semibold text-[#1d1d1f]">{tierName} Tier</h4>
        <span className="bg-[#007AFF]/10 text-[#007AFF] text-[12px] font-medium px-2 py-1 rounded-full">
          {formatFeeRate(feeRateBps)} fee
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 text-[14px]">
        <div>
          <span className="text-[#86868b]">Monthly Volume</span>
          <p className="text-[#1d1d1f] font-medium">{formatUsdc(monthlyVolume)}</p>
        </div>
        <div>
          <span className="text-[#86868b]">Est. Fees</span>
          <p className="text-[#1d1d1f] font-medium">{formatUsdc(monthlyFees)}</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Performance Fee Display (20% of profits)
// ============================================================================

interface PerformanceFeeDisplayProps {
  grossProfitUsdc: number;
}

export function PerformanceFeeDisplay({ grossProfitUsdc }: PerformanceFeeDisplayProps) {
  const feePercent = ON_CHAIN_FEES.performanceFee.feeRatePercent;
  const feeUsdc = grossProfitUsdc * (feePercent / 100);
  const netProfit = grossProfitUsdc - feeUsdc;
  
  return (
    <div className="bg-gradient-to-br from-[#34C759]/5 to-[#007AFF]/5 rounded-[16px] p-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[15px] font-semibold text-[#1d1d1f]">Performance Fee</h4>
        <span className="bg-[#34C759]/10 text-[#34C759] text-[12px] font-medium px-2 py-1 rounded-full">
          {feePercent}% of profits
        </span>
      </div>
      
      <p className="text-[13px] text-[#86868b] mb-4">
        Industry standard: We only profit when you profit. High-water mark ensures 
        you&apos;re never charged twice on the same gains.
      </p>
      
      <div className="space-y-2 text-[14px]">
        <div className="flex justify-between">
          <span className="text-[#1d1d1f]">Gross Profit</span>
          <span className="text-[#34C759] font-medium">+{formatUsdc(grossProfitUsdc)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#86868b]">Performance Fee ({feePercent}%)</span>
          <span className="text-[#FF9500]">-{formatUsdc(feeUsdc)}</span>
        </div>
        <div className="border-t border-[#d2d2d7] my-2" />
        <div className="flex justify-between">
          <span className="text-[#1d1d1f] font-medium">Your Net Profit</span>
          <span className="text-[#34C759] font-semibold">+{formatUsdc(netProfit)}</span>
        </div>
        <div className="flex justify-between text-[12px]">
          <span className="text-[#86868b]">You keep</span>
          <span className="text-[#86868b]">{100 - feePercent}% of all profits</span>
        </div>
      </div>
    </div>
  );
}

export default FeeDisplay;
