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
import { bluefinService, BluefinService, BLUEFIN_PAIRS } from '@/lib/services/sui/BluefinService';
import { createHedge, updateHedgeStatus } from '@/lib/db/hedges';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';

export const runtime = 'nodejs';
export const maxDuration = 15;
export const dynamic = 'force-dynamic';

const BLUEFIN_PRIVATE_KEY = process.env.BLUEFIN_PRIVATE_KEY?.trim() || null;
// Network from env - defaults to testnet, set BLUEFIN_NETWORK=mainnet for production
const BLUEFIN_NETWORK = (process.env.BLUEFIN_NETWORK || 'testnet') as 'mainnet' | 'testnet';

/**
 * GET - Get BlueFin account info and positions
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action') || 'status';

    if (!BLUEFIN_PRIVATE_KEY) {
      return NextResponse.json({
        success: false,
        error: 'BLUEFIN_PRIVATE_KEY not configured — BlueFin service unavailable',
      }, { status: 503 });
    }

    // Initialize real client
    await bluefinService.initialize(BLUEFIN_PRIVATE_KEY, BLUEFIN_NETWORK);

    if (action === 'status') {
      const balance = await bluefinService.getBalance();
      const positions = await bluefinService.getPositions();

      return NextResponse.json({
        success: true,
        mode: 'live',
        network: `sui-${BLUEFIN_NETWORK}`,
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
    return safeErrorResponse(error, 'BlueFin market data');
  }
}

/**
 * POST - Open a hedge position on BlueFin
 */
export async function POST(request: NextRequest) {
  // Rate limiting
  const { mutationLimiter } = await import('@/lib/security/rate-limiter');
  const limited = await mutationLimiter.checkDistributed(request);
  if (limited) return limited;

  try {
    const body = await request.json();

    // Authentication required
    const { requireAuth } = await import('@/lib/security/auth-middleware');
    const authResult = await requireAuth(request, body);
    if (authResult instanceof NextResponse) return authResult;

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

    // Use real service
    let result;
    if (!BLUEFIN_PRIVATE_KEY) {
      return NextResponse.json({
        success: false,
        error: 'BLUEFIN_PRIVATE_KEY not configured — BlueFin service unavailable',
      }, { status: 503 });
    }

    await bluefinService.initialize(BLUEFIN_PRIVATE_KEY, BLUEFIN_NETWORK);
    result = await bluefinService.openHedge({
      symbol,
      side: side.toUpperCase() as 'LONG' | 'SHORT',
      size: parseFloat(size),
      leverage: parseInt(leverage, 10),
      portfolioId,
      reason,
    });

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
        portfolioId: portfolioId ?? null,  // Use ?? to preserve portfolioId=-1 (community pool) and 0 (user)
        walletAddress: walletAddress || undefined,
        asset,
        market: symbol,
        side: side.toUpperCase() as 'LONG' | 'SHORT',
        size: parseFloat(size),
        leverage: parseInt(leverage, 10),
        notionalValue,
        entryPrice: result.executionPrice,
        simulationMode: false,
        reason: reason || `BlueFin ${side} ${asset}`,
        txHash: result.txDigest,
      });
    } catch (dbError) {
      logger.warn('Failed to record hedge in database', { error: dbError instanceof Error ? dbError.message : String(dbError) });
    }

    return NextResponse.json({
      success: true,
      mode: 'live',
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
        ? `https://suiscan.xyz/${BLUEFIN_NETWORK}/tx/${result.txDigest}`
        : null,
    });

  } catch (error) {
    logger.error('BlueFin POST failed', error instanceof Error ? error : undefined);
    return safeErrorResponse(error, 'BlueFin hedge open');
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

    // Use real service
    let result;
    if (!BLUEFIN_PRIVATE_KEY) {
      return NextResponse.json({
        success: false,
        error: 'BLUEFIN_PRIVATE_KEY not configured — BlueFin service unavailable',
      }, { status: 503 });
    }

    await bluefinService.initialize(BLUEFIN_PRIVATE_KEY, BLUEFIN_NETWORK);
    result = await bluefinService.closeHedge({
      symbol,
      size: size ? parseFloat(size) : undefined,
    });

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
        logger.warn('Failed to update hedge status', { error: dbError instanceof Error ? dbError.message : String(dbError) });
      }
    }

    return NextResponse.json({
      success: true,
      mode: 'live',
      chain: 'sui',
      protocol: 'bluefin',
      hedgeId: result.hedgeId,
      symbol,
      closedSize: result.filledSize,
      closePrice: result.executionPrice,
      fees: result.fees,
      txDigest: result.txDigest,
      explorerLink: result.txDigest
        ? `https://suiscan.xyz/${BLUEFIN_NETWORK}/tx/${result.txDigest}`
        : null,
    });

  } catch (error) {
    logger.error('BlueFin DELETE failed', error instanceof Error ? error : undefined);
    return safeErrorResponse(error, 'BlueFin hedge close');
  }
}
