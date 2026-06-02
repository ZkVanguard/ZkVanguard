/**
 * Hyperliquid LIVE TRADING service — T5-A Phase 3 entry point.
 *
 * Skeleton in place so PerpVenueExecutor can register it; throws a clear
 * VENUE_NOT_CONFIGURED error on every trade attempt until HYPERLIQUID_*
 * env vars are set. The signing + L1 settlement implementation is
 * intentionally NOT written here — Hyperliquid uses a custom EIP-712
 * scheme with their own type system; shipping unsigned-and-untested
 * signing code would be worse than throwing.
 *
 * To complete Phase 3 (operator + dev work):
 *  1. Provision a Hyperliquid trading wallet (Arbitrum-compatible address).
 *  2. Fund it with USDC on Arbitrum.
 *  3. Set Vercel env: HYPERLIQUID_PRIVATE_KEY, HYPERLIQUID_WALLET_ADDRESS,
 *     HYPERLIQUID_NETWORK ("mainnet" or "testnet").
 *  4. Replace `notImplemented()` with the real signing + POST flow per
 *     https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint
 *  5. Register this service in the PerpVenueExecutor at cron boot.
 *
 * Estimated: 1-2 days dev once wallet is provisioned, plus testing.
 */
import { logger } from '@/lib/utils/logger';
import type {
  TradingPerpVenue,
  PerpMarketSnapshot,
  PerpTradingResult,
  Side,
} from './PerpVenue';
import { HyperliquidService } from './HyperliquidService';

export class HyperliquidTradingService implements TradingPerpVenue {
  readonly name = 'hyperliquid';
  private readonly readClient = HyperliquidService.getInstance();

  private static _instance: HyperliquidTradingService | null = null;
  static getInstance(): HyperliquidTradingService {
    if (!this._instance) this._instance = new HyperliquidTradingService();
    return this._instance;
  }

  /** Read path delegates to the existing public-API HyperliquidService. */
  async getMarketSnapshot(symbol: string): Promise<PerpMarketSnapshot | null> {
    return this.readClient.getMarketSnapshot(symbol);
  }

  async canTrade(): Promise<boolean> {
    const hasKey = !!(process.env.HYPERLIQUID_PRIVATE_KEY || '').trim();
    const hasAddr = !!(process.env.HYPERLIQUID_WALLET_ADDRESS || '').trim();
    return hasKey && hasAddr;
  }

  async openPosition(params: {
    symbol: string;
    side: Side;
    notionalUsd: number;
    leverage: number;
    reason?: string;
  }): Promise<PerpTradingResult> {
    if (!(await this.canTrade())) {
      return this.notImplemented(params.symbol);
    }
    // TODO Phase 3 — sign + submit via Hyperliquid exchange endpoint
    return this.notImplemented(params.symbol, 'Signing flow not yet implemented; placeholder return.');
  }

  private notImplemented(symbol: string, note?: string): PerpTradingResult {
    const msg = note
      ? `Hyperliquid trading not implemented yet for ${symbol}: ${note}`
      : `Hyperliquid trading not configured (missing HYPERLIQUID_PRIVATE_KEY / HYPERLIQUID_WALLET_ADDRESS) — T5-A Phase 3 work needed.`;
    logger.warn('[HyperliquidTradingService] notImplemented', { symbol, note });
    return {
      success: false,
      venue: this.name,
      error: msg,
    };
  }
}
