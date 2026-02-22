/**
 * Fee Calculation Utilities
 * 
 * Consistent fee calculations across the platform.
 * All amounts are in USDC unless otherwise specified.
 */

import { ON_CHAIN_FEES } from '@/lib/config/pricing';

// ============================================================================
// Constants
// ============================================================================

// USDC has 6 decimals
export const USDC_DECIMALS = 6;
export const USDC_MULTIPLIER = 10 ** USDC_DECIMALS;

// Basis points conversion
export const BPS_DENOMINATOR = 10000;

// ============================================================================
// Basic Conversions
// ============================================================================

/**
 * Convert USDC amount to raw value (with decimals)
 */
export function toUsdcRaw(amount: number): bigint {
  return BigInt(Math.round(amount * USDC_MULTIPLIER));
}

/**
 * Convert raw USDC value to decimal amount
 */
export function fromUsdcRaw(raw: bigint | string | number): number {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  return Number(value) / USDC_MULTIPLIER;
}

/**
 * Convert basis points to percentage
 */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * Convert percentage to basis points
 */
export function percentToBps(percent: number): number {
  return percent * 100;
}

// ============================================================================
// Hedge Fee Calculations
// ============================================================================

export interface HedgeFeeBreakdown {
  collateralUsdc: number;
  feeRateBps: number;
  feeRatePercent: number;
  feeUsdc: number;
  feeRaw: bigint;
  netCollateralUsdc: number;
  netCollateralRaw: bigint;
}

/**
 * Calculate hedge execution fee
 */
export function calculateHedgeFeeBreakdown(collateralUsdc: number): HedgeFeeBreakdown {
  const feeRateBps = ON_CHAIN_FEES.hedgeExecutor.feeRateBps;
  const feeRatePercent = bpsToPercent(feeRateBps);
  const feeUsdc = (collateralUsdc * feeRateBps) / BPS_DENOMINATOR;
  const netCollateralUsdc = collateralUsdc - feeUsdc;

  return {
    collateralUsdc,
    feeRateBps,
    feeRatePercent,
    feeUsdc,
    feeRaw: toUsdcRaw(feeUsdc),
    netCollateralUsdc,
    netCollateralRaw: toUsdcRaw(netCollateralUsdc),
  };
}

/**
 * Calculate collateral needed to achieve a specific net amount after fees
 */
export function calculateCollateralForNet(netAmountUsdc: number): number {
  const feeRateBps = ON_CHAIN_FEES.hedgeExecutor.feeRateBps;
  // net = collateral * (1 - fee/10000)
  // collateral = net / (1 - fee/10000)
  return netAmountUsdc / (1 - feeRateBps / BPS_DENOMINATOR);
}

/**
 * Check if collateral meets minimum requirements
 */
export function isCollateralSufficient(collateralUsdc: number): boolean {
  const minCollateral = ON_CHAIN_FEES.hedgeExecutor.minCollateralUsdc / USDC_MULTIPLIER;
  return collateralUsdc >= minCollateral;
}

// ============================================================================
// x402 Gasless Fee Calculations
// ============================================================================

export interface GaslessFeeEstimate {
  transactionCount: number;
  feePerTransaction: number;
  totalFeeUsdc: number;
  totalFeeRaw: bigint;
}

/**
 * Calculate gasless transaction fees
 */
export function calculateGaslessFees(transactionCount: number): GaslessFeeEstimate {
  const feePerTx = ON_CHAIN_FEES.x402Gasless.feePerTransactionUsdc;
  const totalFee = feePerTx * transactionCount;

  return {
    transactionCount,
    feePerTransaction: feePerTx,
    totalFeeUsdc: totalFee,
    totalFeeRaw: toUsdcRaw(totalFee),
  };
}

/**
 * Estimate gasless fees for a hedge operation
 * A typical hedge involves: 1 approve + 1 execute + 1 claim = 3 transactions
 */
export function estimateHedgeGaslessFees(includeApproval = true): GaslessFeeEstimate {
  const transactions = includeApproval ? 3 : 2;
  return calculateGaslessFees(transactions);
}

// ============================================================================
// Oracle Fee Calculations
// ============================================================================

export interface OracleFeeEstimate {
  callCount: number;
  feePerCall: number;
  totalFeeCro: number;
  currency: 'tCRO' | 'CRO';
}

/**
 * Calculate oracle fees for price updates
 */
export function calculateOracleFees(
  callCount: number,
  isTestnet = false
): OracleFeeEstimate {
  const feePerCall = isTestnet
    ? ON_CHAIN_FEES.oracle.feePerCallTcro
    : ON_CHAIN_FEES.oracle.feeCro;

  return {
    callCount,
    feePerCall,
    totalFeeCro: feePerCall * callCount,
    currency: isTestnet ? 'tCRO' : 'CRO',
  };
}

// ============================================================================
// SUI Protocol Fee Calculations
// ============================================================================

export interface SuiProtocolFeeBreakdown {
  amountUsdc: number;
  feeRateBps: number;
  feeRatePercent: number;
  feeUsdc: number;
  netAmountUsdc: number;
}

/**
 * Calculate SUI protocol fee
 */
export function calculateSuiProtocolFee(amountUsdc: number): SuiProtocolFeeBreakdown {
  const feeRateBps = ON_CHAIN_FEES.suiProtocol.feeRateBps;
  const feeRatePercent = bpsToPercent(feeRateBps);
  const feeUsdc = (amountUsdc * feeRateBps) / BPS_DENOMINATOR;

  return {
    amountUsdc,
    feeRateBps,
    feeRatePercent,
    feeUsdc,
    netAmountUsdc: amountUsdc - feeUsdc,
  };
}

// ============================================================================
// Performance Fee Calculations (20% of profits - industry standard)
// ============================================================================

export interface PerformanceFeeBreakdown {
  grossProfitUsdc: number;
  highWaterMark: number;
  chargeableProfitUsdc: number;
  feePercent: number;
  feeUsdc: number;
  netProfitUsdc: number;
  userKeepsPercent: number;
}

/**
 * Calculate performance fee on hedge profits
 * Uses high-water mark: only charges on profits above previous peak
 */
export function calculatePerformanceFeeBreakdown(
  grossProfitUsdc: number,
  highWaterMark: number = 0
): PerformanceFeeBreakdown {
  const feePercent = ON_CHAIN_FEES.performanceFee.feeRatePercent;
  
  // Only charge on profits above high-water mark
  const chargeableProfitUsdc = ON_CHAIN_FEES.performanceFee.highWaterMark
    ? Math.max(0, grossProfitUsdc - highWaterMark)
    : Math.max(0, grossProfitUsdc);
  
  const feeUsdc = chargeableProfitUsdc > 0 ? (chargeableProfitUsdc * feePercent) / 100 : 0;
  const netProfitUsdc = grossProfitUsdc - feeUsdc;

  return {
    grossProfitUsdc,
    highWaterMark,
    chargeableProfitUsdc,
    feePercent,
    feeUsdc,
    netProfitUsdc,
    userKeepsPercent: 100 - feePercent,
  };
}

/**
 * Estimate platform earnings from a profitable hedge
 */
export function estimatePlatformEarnings(
  collateralUsdc: number,
  profitPercent: number
): {
  grossProfit: number;
  performanceFee: number;
  hedgeExecutionFee: number;
  totalPlatformEarnings: number;
  userNetProfit: number;
} {
  const grossProfit = collateralUsdc * (profitPercent / 100);
  const perfFee = calculatePerformanceFeeBreakdown(grossProfit);
  const hedgeFee = calculateHedgeFeeBreakdown(collateralUsdc);
  
  return {
    grossProfit,
    performanceFee: perfFee.feeUsdc,
    hedgeExecutionFee: hedgeFee.feeUsdc,
    totalPlatformEarnings: perfFee.feeUsdc + hedgeFee.feeUsdc,
    userNetProfit: perfFee.netProfitUsdc,
  };
}

// ============================================================================
// Total Cost Estimation
// ============================================================================

export interface TotalHedgeCost {
  collateralUsdc: number;
  hedgeFeeUsdc: number;
  estimatedGaslessFeeUsdc: number;
  estimatedOracleFee: {
    amount: number;
    currency: 'tCRO' | 'CRO';
  };
  totalPlatformFeeUsdc: number;
  effectiveCollateralUsdc: number;
  summary: string;
}

/**
 * Calculate total estimated cost for a hedge operation
 */
export function estimateTotalHedgeCost(
  collateralUsdc: number,
  isTestnet = false
): TotalHedgeCost {
  const hedgeFee = calculateHedgeFeeBreakdown(collateralUsdc);
  const gaslessFee = estimateHedgeGaslessFees(true);
  const oracleFee = calculateOracleFees(1, isTestnet);

  const totalPlatformFee = hedgeFee.feeUsdc + gaslessFee.totalFeeUsdc;

  return {
    collateralUsdc,
    hedgeFeeUsdc: hedgeFee.feeUsdc,
    estimatedGaslessFeeUsdc: gaslessFee.totalFeeUsdc,
    estimatedOracleFee: {
      amount: oracleFee.totalFeeCro,
      currency: oracleFee.currency,
    },
    totalPlatformFeeUsdc: totalPlatformFee,
    effectiveCollateralUsdc: hedgeFee.netCollateralUsdc,
    summary: `$${collateralUsdc.toFixed(2)} collateral - $${hedgeFee.feeUsdc.toFixed(4)} platform fee = $${hedgeFee.netCollateralUsdc.toFixed(2)} effective`,
  };
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format USDC amount for display
 */
export function formatUsdc(amount: number, decimals = 2): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(2)}K`;
  }
  return `$${amount.toFixed(decimals)}`;
}

/**
 * Format fee rate for display
 */
export function formatFeeRate(bps: number): string {
  return `${bpsToPercent(bps).toFixed(2)}%`;
}

/**
 * Format basis points for display
 */
export function formatBps(bps: number): string {
  return `${bps} bps`;
}
