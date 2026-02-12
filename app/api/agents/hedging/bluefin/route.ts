/**
 * BlueFin SUI Hedge Execution API
 * 
 * Executes hedges on SUI network via BlueFin perpetual DEX.
 * 
 * POST /api/agents/hedging/bluefin
 * - Opens a hedge position on BlueFin
 * 
 * GET /api/agents/hedging/bluefin
 * - Gets current positions and account status
 * 
 * DELETE /api/agents/hedging/bluefin
 * - Closes a hedge position
 */

import { NextRequest, NextResponse } from 'next/server';
import { bluefinService, mockBluefinService, BluefinService, BLUEFIN_PAIRS } from '@/lib/services/BluefinService';
import { createHedge, updateHedgeStatus } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Use mock service in development/testnet
const USE_MOCK = process.env.BLUEFIN_USE_MOCK !== 'false';
const BLUEFIN_PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY;

/**
 * GET - Get BlueFin account info and positions
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'status';

    if (USE_MOCK || !BLUEFIN_PRIVATE_KEY) {
      // Return mock data
      const positions = await mockBluefinService.getPositions();
      return NextResponse.json({
        success: true,
        mode: 'mock',
        network: 'sui-testnet',
        positions,
        supportedPairs: Object.keys(BLUEFIN_PAIRS),
        message: 'Using mock BlueFin service (set BLUEFIN_PRIVATE_KEY for live trading)',
      });
    }

    // Initialize real client
    await bluefinService.initialize(BLUEFIN_PRIVATE_KEY, 'testnet');

    if (action === 'status') {
      const balance = await bluefinService.getBalance();
      const positions = await bluefinService.getPositions();

      return NextResponse.json({
        success: true,
        mode: 'live',
        network: 'sui-testnet',
        address: bluefinService.getAddress(),
        balance,
        positions,
        supportedPairs: Object.keys(BLUEFIN_PAIRS),
      });
    }

    if (action === 'market') {
      const symbol = searchParams.get('symbol') || 'SUI-PERP';
      const marketData = await bluefinService.getMarketData(symbol);
      const orderbook = await bluefinService.getOrderBook(symbol);

      return NextResponse.json({
        success: true,
        symbol,
        ...marketData,
        orderbook,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  } catch (error) {
    logger.error('BlueFin GET failed', error instanceof Error ? error : undefined);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * POST - Open a hedge position on BlueFin
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      asset,
      side,
      size,
      leverage = 5,
      portfolioId,
      walletAddress,
      reason,
    } = body;

    // Validate required fields
    if (!asset || !side || !size) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: asset, side, size',
      }, { status: 400 });
    }

    // Convert asset to BlueFin pair
    const symbol = BluefinService.assetToPair(asset);
    if (!symbol) {
      return NextResponse.json({
        success: false,
        error: `Unsupported asset: ${asset}. Supported: BTC, ETH, SUI, SOL, APT, ARB, DOGE, PEPE`,
      }, { status: 400 });
    }

    // Validate pair exists
    const pairConfig = BLUEFIN_PAIRS[symbol as keyof typeof BLUEFIN_PAIRS];
    if (!pairConfig) {
      return NextResponse.json({
        success: false,
        error: `Invalid pair: ${symbol}`,
      }, { status: 400 });
    }

    // Check leverage limits
    if (leverage > pairConfig.maxLeverage) {
      return NextResponse.json({
        success: false,
        error: `Leverage ${leverage}x exceeds max ${pairConfig.maxLeverage}x for ${symbol}`,
      }, { status: 400 });
    }

    logger.info('🌊 Opening BlueFin hedge', {
      asset,
      symbol,
      side,
      size,
      leverage,
      portfolioId,
    });

    // Use mock or real service
    let result;
    if (USE_MOCK || !BLUEFIN_PRIVATE_KEY) {
      result = await mockBluefinService.openHedge({
        symbol,
        side: side.toUpperCase() as 'LONG' | 'SHORT',
        size: parseFloat(size),
        leverage: parseInt(leverage),
      });
    } else {
      await bluefinService.initialize(BLUEFIN_PRIVATE_KEY, 'testnet');
      result = await bluefinService.openHedge({
        symbol,
        side: side.toUpperCase() as 'LONG' | 'SHORT',
        size: parseFloat(size),
        leverage: parseInt(leverage),
        portfolioId,
        reason,
      });
    }

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error,
      }, { status: 500 });
    }

    // Record in database
    try {
      const notionalValue = parseFloat(size) * (result.executionPrice || 0);
      await createHedge({
        orderId: result.hedgeId,
        portfolioId: portfolioId || null,
        walletAddress: walletAddress || undefined,
        asset,
        market: symbol,
        side: side.toUpperCase() as 'LONG' | 'SHORT',
        size: parseFloat(size),
        leverage: parseInt(leverage),
        notionalValue,
        entryPrice: result.executionPrice,
        simulationMode: USE_MOCK,
        reason: reason || `BlueFin ${side} ${asset}`,
        txHash: result.txDigest,
      });
    } catch (dbError) {
      logger.warn('Failed to record hedge in database', dbError instanceof Error ? dbError : undefined);
    }

    return NextResponse.json({
      success: true,
      mode: USE_MOCK ? 'mock' : 'live',
      chain: 'sui',
      protocol: 'bluefin',
      hedgeId: result.hedgeId,
      orderId: result.orderId,
      txDigest: result.txDigest,
      symbol,
      side,
      size: result.filledSize,
      leverage,
      executionPrice: result.executionPrice,
      fees: result.fees,
      explorerLink: result.txDigest 
        ? `https://suiscan.xyz/testnet/tx/${result.txDigest}`
        : null,
    });

  } catch (error) {
    logger.error('BlueFin POST failed', error instanceof Error ? error : undefined);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * DELETE - Close a hedge position on BlueFin
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { asset, symbol: providedSymbol, size, hedgeId } = body;

    // Get symbol from asset or use provided symbol
    const symbol = providedSymbol || BluefinService.assetToPair(asset);
    if (!symbol) {
      return NextResponse.json({
        success: false,
        error: 'Must provide either asset or symbol',
      }, { status: 400 });
    }

    logger.info('🌊 Closing BlueFin position', { symbol, size });

    // Use mock or real service
    let result;
    if (USE_MOCK || !BLUEFIN_PRIVATE_KEY) {
      result = await mockBluefinService.closeHedge({ symbol });
    } else {
      await bluefinService.initialize(BLUEFIN_PRIVATE_KEY, 'testnet');
      result = await bluefinService.closeHedge({
        symbol,
        size: size ? parseFloat(size) : undefined,
      });
    }

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: result.error,
      }, { status: 500 });
    }

    // Update database if hedgeId provided
    if (hedgeId) {
      try {
        await updateHedgeStatus(hedgeId, 'closed');
      } catch (dbError) {
        logger.warn('Failed to update hedge status', dbError instanceof Error ? dbError : undefined);
      }
    }

    return NextResponse.json({
      success: true,
      mode: USE_MOCK ? 'mock' : 'live',
      chain: 'sui',
      protocol: 'bluefin',
      hedgeId: result.hedgeId,
      symbol,
      closedSize: result.filledSize,
      closePrice: result.executionPrice,
      fees: result.fees,
      txDigest: result.txDigest,
      explorerLink: result.txDigest
        ? `https://suiscan.xyz/testnet/tx/${result.txDigest}`
        : null,
    });

  } catch (error) {
    logger.error('BlueFin DELETE failed', error instanceof Error ? error : undefined);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
