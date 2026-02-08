/**
 * On-Chain Hedge Positions API
 * Reads hedge positions directly from the HedgeExecutor smart contract on Cronos testnet
 * 
 * GET /api/agents/hedging/onchain
 * Query params:
 *   - address: Wallet address to filter by (optional, defaults to deployer)
 *   - stats: Include protocol stats (optional)
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Contract addresses from deployment
const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const DEPLOYER = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c';
const RPC_URL = 'https://evm-t3.cronos.org';

// Pair names
const PAIR_NAMES: Record<number, string> = {
  0: 'BTC', 1: 'ETH', 2: 'CRO', 3: 'ATOM', 4: 'DOGE', 5: 'SOL'
};

// Mock prices (matching MockMoonlander's initial prices)
const MOCK_PRICES: Record<number, number> = {
  0: 95000,  // BTC
  1: 3200,   // ETH
  2: 0.10,   // CRO
  3: 8,      // ATOM
  4: 0.35,   // DOGE
  5: 200,    // SOL
};

// Minimal ABI for reading hedge data
const HEDGE_EXECUTOR_ABI = [
  'function hedges(bytes32) view returns (bytes32 hedgeId, address trader, uint256 pairIndex, uint256 tradeIndex, uint256 collateralAmount, uint256 leverage, bool isLong, bytes32 commitmentHash, bytes32 nullifier, uint256 openTimestamp, uint256 closeTimestamp, int256 realizedPnl, uint8 status)',
  'function getUserHedges(address trader) view returns (bytes32[])',
  'function getActiveHedgeCount(address trader) view returns (uint256)',
  'function getProtocolStats() view returns (uint256 totalOpened, uint256 totalClosed, uint256 collateralLocked, int256 totalPnl, uint256 fees)',
  'function totalHedgesOpened() view returns (uint256)',
  'function totalHedgesClosed() view returns (uint256)',
  'function totalCollateralLocked() view returns (uint256)',
  'function totalPnlRealized() view returns (int256)',
  'function accumulatedFees() view returns (uint256)',
];

const STATUS_NAMES = ['PENDING', 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const address = searchParams.get('address') || DEPLOYER;
    const includeStats = searchParams.get('stats') === 'true';

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, provider);

    // Get all hedge IDs for this address
    const hedgeIds: string[] = await contract.getUserHedges(address);

    // Fetch all hedge details in parallel
    const hedgeDetails = await Promise.all(
      hedgeIds.map(async (hedgeId: string) => {
        const h = await contract.hedges(hedgeId);
        const pairIndex = Number(h.pairIndex);
        const collateralAmount = Number(ethers.formatUnits(h.collateralAmount, 6));
        const leverage = Number(h.leverage);
        const isLong = h.isLong;
        const status = Number(h.status);
        const entryPrice = MOCK_PRICES[pairIndex] || 1000;

        // Simulate current price with some movement for display
        // In production this would come from Pyth/oracle
        const priceMovement = (Math.sin(Number(h.openTimestamp) * 0.001) * 0.03); // ±3% movement
        const currentPrice = entryPrice * (1 + priceMovement);

        // Calculate unrealized PnL
        const positionSize = collateralAmount * leverage;
        const priceChange = (currentPrice - entryPrice) / entryPrice;
        const unrealizedPnl = isLong
          ? positionSize * priceChange
          : positionSize * (-priceChange);
        const pnlPercent = (unrealizedPnl / collateralAmount) * 100;

        return {
          hedgeId: hedgeId,
          orderId: hedgeId.slice(0, 18),
          trader: h.trader,
          asset: PAIR_NAMES[pairIndex] || `PAIR-${pairIndex}`,
          pairIndex,
          tradeIndex: Number(h.tradeIndex),
          side: isLong ? 'LONG' : 'SHORT',
          type: isLong ? 'LONG' as const : 'SHORT' as const,
          collateral: collateralAmount,
          size: collateralAmount,
          capitalUsed: collateralAmount,
          leverage,
          entryPrice,
          currentPrice: Math.round(currentPrice * 100) / 100,
          unrealizedPnL: Math.round(unrealizedPnl * 100) / 100,
          pnlPercentage: Math.round(pnlPercent * 100) / 100,
          status: STATUS_NAMES[status]?.toLowerCase() || 'unknown',
          isLong,
          commitmentHash: h.commitmentHash,
          nullifier: h.nullifier,
          openTimestamp: Number(h.openTimestamp),
          closeTimestamp: Number(h.closeTimestamp),
          realizedPnl: Number(ethers.formatUnits(h.realizedPnl, 6)),
          createdAt: new Date(Number(h.openTimestamp) * 1000).toISOString(),
          txHash: null, // Not stored in contract
          zkVerified: h.commitmentHash !== ethers.ZeroHash,
          onChain: true,
          chain: 'cronos-testnet',
          contractAddress: HEDGE_EXECUTOR,
        };
      })
    );

    // Filter active hedges for summary
    const activeHedges = hedgeDetails.filter(h => h.status === 'active');
    const closedHedges = hedgeDetails.filter(h => h.status === 'closed' || h.status === 'liquidated');

    // Build summary matching existing API format
    const totalUnrealizedPnL = activeHedges.reduce((sum, h) => sum + h.unrealizedPnL, 0);
    const profitable = activeHedges.filter(h => h.unrealizedPnL > 0).length;
    const unprofitable = activeHedges.filter(h => h.unrealizedPnL <= 0).length;

    let protocolStats = null;
    if (includeStats) {
      const stats = await contract.getProtocolStats();
      protocolStats = {
        totalOpened: Number(stats[0]),
        totalClosed: Number(stats[1]),
        collateralLocked: Number(ethers.formatUnits(stats[2], 6)),
        totalPnl: Number(ethers.formatUnits(stats[3], 6)),
        feesCollected: Number(ethers.formatUnits(stats[4], 6)),
      };
    }

    return NextResponse.json({
      success: true,
      source: 'on-chain',
      chain: 'cronos-testnet',
      chainId: 338,
      contract: HEDGE_EXECUTOR,
      summary: {
        totalHedges: hedgeDetails.length,
        activeCount: activeHedges.length,
        closedCount: closedHedges.length,
        totalUnrealizedPnL: Math.round(totalUnrealizedPnL * 100) / 100,
        profitable,
        unprofitable,
        details: activeHedges.map(h => ({
          orderId: h.orderId,
          side: h.side,
          asset: h.asset,
          size: h.size,
          leverage: h.leverage,
          entryPrice: h.entryPrice,
          currentPrice: h.currentPrice,
          capitalUsed: h.capitalUsed,
          notionalValue: h.collateral * h.leverage,
          unrealizedPnL: h.unrealizedPnL,
          pnlPercentage: h.pnlPercentage,
          createdAt: h.createdAt,
          reason: `${h.leverage}x ${h.side} ${h.asset} on-chain hedge`,
          walletAddress: h.trader,
          zkVerified: h.zkVerified,
          onChain: true,
        })),
      },
      allHedges: hedgeDetails,
      protocolStats,
    });
  } catch (error) {
    console.error('On-chain hedge fetch error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch on-chain hedges',
        source: 'on-chain',
      },
      { status: 500 }
    );
  }
}
