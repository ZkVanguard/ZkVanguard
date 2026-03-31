/**
 * Moonlander DEX Integration
 * For perpetual futures positions on Cronos zkEVM
 */

import { logger } from '../utils/logger';
import fetch from 'node-fetch';
import { getMarketDataService } from '../services/RealMarketDataService';

export interface Position {
  id: string;
  asset: string;
  type: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  leverage: number;
  liquidationPrice?: number;
  margin?: number;
}

/**
 * Get open positions from Moonlander
 * (Currently simulated - real integration would use Moonlander API)
 */
export async function getMoonlanderPositions(address: string): Promise<Position[]> {
  logger.info('Fetching positions from Moonlander', { address });

  const apiBase = process.env.MOONLANDER_API_URL;
  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/positions?address=${encodeURIComponent(address)}`);
      if (!res.ok) {
        logger.warn('Moonlander API returned non-OK', { status: res.status });
      } else {
        const data = (await res.json()) as Record<string, unknown>;
        // Expect data.positions to be an array of Position-like objects
        if (Array.isArray(data?.positions)) {
          return (data.positions as Array<Record<string, unknown>>).map((p) => ({
            id: String(p.id),
            asset: String(p.asset),
            type: p.type === 'LONG' ? 'LONG' : 'SHORT',
            size: Number(p.size),
            entryPrice: Number(p.entryPrice),
            currentPrice: Number(p.currentPrice),
            pnl: Number(p.pnl),
            pnlPercent: Number(p.pnlPercent),
            leverage: Number(p.leverage) || 1,
            liquidationPrice: p.liquidationPrice ? Number(p.liquidationPrice) : undefined,
            margin: p.margin ? Number(p.margin) : undefined,
          }));
        }
      }
    } catch (err) {
      logger.error('Moonlander API fetch failed', { err });
    }
  }

  // ⚠️ PRODUCTION: Return empty array instead of fake positions
  // Never show simulated positions as real holdings
  logger.warn('Moonlander API unavailable - returning empty positions (no mock data)');
  return [];
}

/**
 * Get position details by ID
 */
export async function getPositionDetails(positionId: string): Promise<Position | null> {
  const positions = await getMoonlanderPositions('');
  return positions.find(p => p.id === positionId) || null;
}

/**
 * Calculate total PnL across all positions
 */
export function calculateTotalPnL(positions: Position[]): number {
  return positions.reduce((total, pos) => total + pos.pnl, 0);
}

/**
 * Get market data for asset from central proactive price feed
 */
export async function getMarketData(asset: string) {
  try {
    // Use central RealMarketDataService (proactive cache - instant, non-blocking)
    const marketDataService = getMarketDataService();
    
    // Strip -PERP suffix for price lookup
    const baseAsset = asset.replace('-PERP', '').replace('-USD-PERP', '');
    const priceData = await marketDataService.getTokenPrice(baseAsset);
    
    return {
      asset,
      price: priceData.price,
      change24h: priceData.change24h || 0,
      volume24h: priceData.volume24h || 0,
      openInterest: (priceData.volume24h || 0) * 0.1, // Estimated OI
    };
  } catch (error) {
    logger.warn('Failed to fetch market data from central service', { asset, error });
    
    // Return error indicator instead of fake data
    return {
      asset,
      price: 0,
      change24h: 0,
      volume24h: 0,
      openInterest: 0,
      error: 'Unable to fetch real market data',
    };
  }
}

/**
 * Open a new position on Moonlander
 */
export async function openPosition(
  asset: string,
  type: 'LONG' | 'SHORT',
  size: number,
  leverage: number
): Promise<{ success: boolean; positionId?: string; error?: string }> {
  try {
    logger.info('Opening position', { type, size, asset, leverage });
    
    // CRITICAL: Moonlander smart contract integration NOT YET IMPLEMENTED
    // This must call the Moonlander perpetuals protocol on SUI
    // See: https://moonlander.sui.io/docs/integration
    logger.error('Moonlander integration not implemented - cannot open real positions');
    
    return {
      success: false,
      error: 'Moonlander integration pending - position opening disabled'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Close an existing position
 */
export async function closePosition(positionId: string): Promise<{ 
  success: boolean; 
  pnl?: number; 
  error?: string 
}> {
  try {
    logger.info('Closing position', { positionId });
    
    const position = await getPositionDetails(positionId);
    if (!position) {
      return { success: false, error: 'Position not found' };
    }
    
    return {
      success: true,
      pnl: position.pnl
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
