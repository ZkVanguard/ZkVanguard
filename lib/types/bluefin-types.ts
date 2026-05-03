/**
 * BlueFin Aggregator Types & Config
 *
 * Extracted from BluefinAggregatorService.ts to reduce file size
 * and allow shared imports without pulling in the full service.
 */

import type { QuoteResponse } from '@bluefin-exchange/bluefin7k-aggregator-sdk';

// ============================================
// COIN TYPE CONSTANTS (SUI mainnet)
// ============================================

export const SUI_COIN_TYPES: Record<string, Record<string, string>> = {
  mainnet: {
    USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    SUI:  '0x2::sui::SUI',
    WBTC: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    WETH: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    CRO:  '',
  },
  testnet: {
    USDC: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    SUI:  '0x2::sui::SUI',
    WBTC: '',
    WETH: '',
    CRO:  '',
  },
};

export const MAINNET_COIN_TYPES: Record<string, string> = {
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  SUI:  '0x2::sui::SUI',
  WBTC: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
  WETH: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
  CRO:  '',
};

export const ASSET_DECIMALS: Record<string, number> = {
  USDC: 6,
  SUI:  9,
  WBTC: 8,
  WETH: 8,
  CRO:  8,
  BTC:  8,
  ETH:  8,
};

export const ASSET_TO_COIN_KEY: Record<string, string> = {
  BTC: 'WBTC',
  ETH: 'WETH',
  SUI: 'SUI',
  CRO: 'CRO',
};

// ============================================
// TYPES
// ============================================

export type NetworkType = 'mainnet' | 'testnet';
export type PoolAsset = 'BTC' | 'ETH' | 'SUI' | 'CRO';

export interface SwapQuoteResult {
  asset: PoolAsset;
  fromCoinType: string;
  toCoinType: string;
  amountIn: string;
  expectedAmountOut: string;
  priceImpact: number;
  route: string;
  routerData: QuoteResponse | null;
  canSwapOnChain: boolean;
  isSimulated?: boolean;
  hedgeVia?: 'bluefin' | 'virtual';
}

export interface RebalanceSwapPlan {
  totalUsdcToSwap: number;
  swaps: SwapQuoteResult[];
  timestamp: number;
}

export interface SwapExecutionResult {
  asset: PoolAsset;
  success: boolean;
  txDigest?: string;
  amountIn: string;
  amountOut?: string;
  error?: string;
}

// ============================================
// SAFETY CONSTANTS
// ============================================

export const MAX_SWAP_SIZE_USD: Record<NetworkType, number> = {
  // Per-swap ceiling (USD). At billion-dollar NAV the cron breaks large
  // rebalances into many small swaps; this is the per-leg cap, NOT the
  // total daily cap. Override via BLUEFIN_MAX_SWAP_SIZE_USD_MAINNET.
  mainnet: Number(process.env.BLUEFIN_MAX_SWAP_SIZE_USD_MAINNET) > 0
    ? Number(process.env.BLUEFIN_MAX_SWAP_SIZE_USD_MAINNET)
    : 50_000,
  testnet: 100_000,
};

export const MAX_SLIPPAGE: Record<NetworkType, number> = {
  // Tightened from 2% → 0.5% (mainnet) to enforce near-zero loss on swap legs.
  // Override at runtime via BLUEFIN_MAX_SLIPPAGE_PCT (decimal, e.g. 0.005 = 0.5%).
  mainnet: Number(process.env.BLUEFIN_MAX_SLIPPAGE_PCT) > 0
    ? Number(process.env.BLUEFIN_MAX_SLIPPAGE_PCT)
    : 0.005,
  testnet: 0.05,
};

export const GAS_BUDGET: Record<NetworkType, number> = {
  mainnet: 100_000_000,
  testnet: 50_000_000,
};

export const MIN_GAS_RESERVE_MIST = 100_000_000;
