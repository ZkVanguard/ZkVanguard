/**
 * Unified Price Service Interface
 * Consolidates all price fetching implementations under a common interface
 * for better maintainability and testability
 */

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h?: number;
  priceChange24h?: number;
  marketCap?: number;
  source?: string;
}

export interface IPriceService {
  /**
   * Get current price for a single symbol
   */
  getPrice(symbol: string): Promise<PriceData>;
  
  /**
   * Get prices for multiple symbols (batched)
   */
  getPrices(symbols: string[]): Promise<PriceData[]>;
  
  /**
   * Check if service is available/connected
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Get service name for logging
   */
  getServiceName(): string;
}

export enum PriceServiceType {
  MCP = 'mcp',
  COINGECKO = 'coingecko',
  VVS = 'vvs',
  SIMULATED = 'simulated'
}
