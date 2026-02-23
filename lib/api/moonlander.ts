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
        const data = await res.json();
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
      logger.error('Moonlander API fetch failed, falling back to simulator', { err });
    }
  }

  // Fallback: For demo, return realistic simulated positions
  return [
    {
      id: '1',
      asset: 'BTC-PERP',
      type: 'SHORT',
      size: 0.5,
      entryPrice: 42000,
      currentPrice: 41500,
      pnl: 250,
      pnlPercent: 1.19,
      leverage: 5,
      liquidationPrice: 44100,
      margin: 4200
    },
    {
      id: '2',
      asset: 'ETH-PERP',
      type: 'LONG',
      size: 2.5,
      entryPrice: 2200,
      currentPrice: 2250,
      pnl: 125,
      pnlPercent: 2.27,
      leverage: 3,
      liquidationPrice: 1833,
      margin: 1833
    },
    {
      id: '3',
      asset: 'CRO-PERP',
      type: 'LONG',
      size: 1000,
      entryPrice: 0.08,
      currentPrice: 0.082,
      pnl: 20,
      pnlPercent: 2.5,
      leverage: 2,
      liquidationPrice: 0.068,
      margin: 40
    },
    {
      id: '4',
      asset: 'MATIC-PERP',
      type: 'SHORT',
      size: 500,
      entryPrice: 0.95,
      currentPrice: 0.98,
      pnl: -15,
      pnlPercent: -3.16,
      leverage: 4,
      liquidationPrice: 1.01,
      margin: 118.75
    },
    {
      id: '5',
      asset: 'BTC-PERP',
      type: 'LONG',
      size: 0.3,
      entryPrice: 41800,
      currentPrice: 41500,
      pnl: -90,
      pnlPercent: -0.72,
      leverage: 5,
      liquidationPrice: 39710,
      margin: 2508
    },
  ];
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
    
    // In production, this calls Moonlander smart contract
    // For demo, simulate successful position opening
    
    return {
      success: true,
      positionId: `pos-${Date.now()}`
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
