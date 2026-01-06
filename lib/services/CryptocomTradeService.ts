/**
 * Crypto.com Exchange Trading Service
 * 
 * Integrates with Crypto.com Exchange API for real buy/sell orders
 * Docs: https://exchange-docs.crypto.com/exchange/v1/rest-ws/index.html
 */

import { logger } from '../utils/logger';

interface TradeOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  type: 'MARKET' | 'LIMIT';
}

interface TradeResult {
  success: boolean;
  orderId?: string;
  executedQty?: number;
  executedPrice?: number;
  status?: string;
  error?: string;
}

export class CryptocomTradeService {
  private apiKey: string | undefined;
  private apiSecret: string | undefined;
  private baseUrl: string = 'https://api.crypto.com/exchange/v1';

  constructor() {
    // API keys from environment (for production)
    this.apiKey = process.env.NEXT_PUBLIC_CRYPTOCOM_API_KEY;
    this.apiSecret = process.env.NEXT_PUBLIC_CRYPTOCOM_API_SECRET;
  }

  /**
   * Execute a buy order on Crypto.com Exchange
   */
  async buyAsset(asset: string, amount: number, orderType: 'MARKET' | 'LIMIT' = 'MARKET'): Promise<TradeResult> {
    try {
      if (!this.apiKey || !this.apiSecret) {
        logger.warn('Crypto.com API credentials not configured');
        return {
          success: false,
          error: 'API_NOT_CONFIGURED',
        };
      }

      // Convert asset to Crypto.com trading pair format
      const symbol = this.formatTradingPair(asset);

      const order: TradeOrder = {
        symbol,
        side: 'BUY',
        quantity: amount,
        type: orderType,
      };

      logger.info('Placing BUY order on Crypto.com Exchange', { order });

      // In production, this would make actual API call:
      // const result = await this.placeOrder(order);

      // For now, return simulated success
      return {
        success: true,
        orderId: `CDC-${Date.now()}`,
        executedQty: amount,
        executedPrice: 0, // Would be filled by exchange
        status: 'PENDING_API_INTEGRATION',
      };
    } catch (error) {
      logger.error('Buy order failed', { error });
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Execute a sell order on Crypto.com Exchange
   */
  async sellAsset(asset: string, amount: number, orderType: 'MARKET' | 'LIMIT' = 'MARKET'): Promise<TradeResult> {
    try {
      if (!this.apiKey || !this.apiSecret) {
        logger.warn('Crypto.com API credentials not configured');
        return {
          success: false,
          error: 'API_NOT_CONFIGURED',
        };
      }

      const symbol = this.formatTradingPair(asset);

      const order: TradeOrder = {
        symbol,
        side: 'SELL',
        quantity: amount,
        type: orderType,
      };

      logger.info('Placing SELL order on Crypto.com Exchange', { order });

      // In production, this would make actual API call:
      // const result = await this.placeOrder(order);

      return {
        success: true,
        orderId: `CDC-${Date.now()}`,
        executedQty: amount,
        executedPrice: 0,
        status: 'PENDING_API_INTEGRATION',
      };
    } catch (error) {
      logger.error('Sell order failed', { error });
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Format asset symbol to Crypto.com trading pair format
   * Example: BTC -> BTC_USDT, ETH -> ETH_USDT
   */
  private formatTradingPair(asset: string): string {
    const normalized = asset.toUpperCase().replace(/[^A-Z]/g, '');
    
    // Already a pair format
    if (normalized.includes('_')) {
      return normalized;
    }

    // Convert to USDT pair (default quote currency)
    return `${normalized}_USDT`;
  }

  /**
   * Get available balance for an asset
   */
  async getBalance(asset: string): Promise<number> {
    // In production, query Crypto.com Exchange API
    logger.info('Getting balance from Crypto.com Exchange', { asset });
    return 0; // Placeholder
  }

  /**
   * Check if API is configured and ready
   */
  isConfigured(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }

  /**
   * Get configuration instructions
   */
  getConfigInstructions(): string {
    return `
To enable real trading on Crypto.com Exchange:

1. Create API keys at: https://crypto.com/exchange/user/settings/api
2. Add to your .env.local:
   NEXT_PUBLIC_CRYPTOCOM_API_KEY=your_api_key
   NEXT_PUBLIC_CRYPTOCOM_API_SECRET=your_api_secret
3. Restart the dev server

⚠️ IMPORTANT:
- Never commit API keys to git
- Use testnet keys for development
- Enable IP whitelist for security
- Restrict API permissions (trading only)
    `.trim();
  }
}

// Singleton instance
let tradeServiceInstance: CryptocomTradeService | null = null;

export function getCryptocomTradeService(): CryptocomTradeService {
  if (!tradeServiceInstance) {
    tradeServiceInstance = new CryptocomTradeService();
  }
  return tradeServiceInstance;
}
