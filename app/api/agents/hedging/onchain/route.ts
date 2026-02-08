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
import { MarketDataMCPClient } from '@/lib/services/market-data-mcp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Contract addresses from deployment
const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const ZK_PROXY_VAULT = '0x7F75Ca65D32752607fF481F453E4fbD45E61FdFd';
const DEPLOYER = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c';
const RELAYER = '0xb61C1cF5152015E66d547F9c1c45cC592a870D10';
const RPC_URL = 'https://evm-t3.cronos.org';

// Pair names
const PAIR_NAMES: Record<number, string> = {
  0: 'BTC', 1: 'ETH', 2: 'CRO', 3: 'ATOM', 4: 'DOGE', 5: 'SOL'
};

// Pair index → symbol mapping for live price lookups
const PAIR_SYMBOLS: Record<number, string> = {
  0: 'BTC', 1: 'ETH', 2: 'CRO', 3: 'ATOM', 4: 'DOGE', 5: 'SOL'
};

// Fallback prices only used if Crypto.com API is completely unreachable
const FALLBACK_PRICES: Record<number, number> = {
  0: 71230, 1: 2111, 2: 0.081, 3: 1.979, 4: 0.097, 5: 88.02
};

// MockMoonlander contract — reads actual openPrice for each trade
const MOCK_MOONLANDER = '0xAb4946d7BD583a74F5E5051b22332fA674D7BE54';
const MOONLANDER_ABI = [
  'function getTrade(address trader, uint256 pairIndex, uint256 tradeIndex) view returns (tuple(address trader, uint256 pairIndex, uint256 index, uint256 collateralAmount, uint256 positionSizeUsd, uint256 openPrice, bool isLong, uint256 leverage, uint256 tp, uint256 sl, bool isOpen))',
  'function mockPrices(uint256) view returns (uint256)',
];

/**
 * Fetch live prices from Crypto.com Exchange API via MCP client
 * Returns a map of pairIndex → current USD price
 */
async function fetchLivePrices(pairIndices: number[]): Promise<Record<number, number>> {
  const prices: Record<number, number> = {};
  const client = MarketDataMCPClient.getInstance();
  
  try {
    await client.connect();
    const uniquePairs = [...new Set(pairIndices)];
    
    // Fetch all needed prices in parallel
    const results = await Promise.allSettled(
      uniquePairs.map(async (idx) => {
        const symbol = PAIR_SYMBOLS[idx];
        if (!symbol) return { idx, price: FALLBACK_PRICES[idx] || 1000 };
        const data = await client.getPrice(symbol);
        return { idx, price: data.price };
      })
    );
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.price > 0) {
        prices[result.value.idx] = result.value.price;
      }
    }
  } catch (err) {
    console.warn('Live price fetch failed, using fallbacks:', err instanceof Error ? err.message : err);
  }
  
  // Fill in any missing prices with fallbacks
  for (const idx of pairIndices) {
    if (!prices[idx]) {
      prices[idx] = FALLBACK_PRICES[idx] || 1000;
    }
  }
  
  return prices;
}

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
  // Events for tx hash lookup
  'event HedgeOpened(bytes32 indexed hedgeId, address indexed trader, uint256 pairIndex, bool isLong, uint256 collateral, uint256 leverage, bytes32 commitmentHash)',
];

const STATUS_NAMES = ['PENDING', 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];

// Derive ZK proxy wallet address (mirrors ZKProxyVault._deriveProxyAddress)
function deriveProxyAddress(owner: string, nonce: number, zkBindingHash: string): string {
  const packed = ethers.solidityPacked(
    ['string', 'address', 'uint256', 'bytes32'],
    ['CHRONOS_PDA_V1', owner, nonce, zkBindingHash]
  );
  const hash = ethers.keccak256(packed);
  // Take last 20 bytes as address
  return '0x' + hash.slice(-40);
}

// Fetch tx hashes from HedgeOpened event logs
async function fetchTxHashes(
  contract: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  hedgeIds: string[]
): Promise<Record<string, string>> {
  const txHashMap: Record<string, string> = {};
  try {
    // Query HedgeOpened events using event topic
    // Cronos testnet limits getLogs to 2000 blocks, so query in chunks
    const hedgeOpenedTopic = ethers.id('HedgeOpened(bytes32,address,uint256,bool,uint256,uint256,bytes32)');
    const contractAddress = await contract.getAddress();
    const latestBlock = await provider.getBlockNumber();
    
    // Scan back in 2000-block chunks (up to ~50K blocks = ~2 days)
    const MAX_SCAN_BLOCKS = 50000;
    const CHUNK_SIZE = 2000;
    const startBlock = Math.max(0, latestBlock - MAX_SCAN_BLOCKS);
    
    for (let from = startBlock; from <= latestBlock; from += CHUNK_SIZE) {
      const to = Math.min(from + CHUNK_SIZE - 1, latestBlock);
      try {
        const logs = await provider.getLogs({
          address: contractAddress,
          topics: [hedgeOpenedTopic],
          fromBlock: from,
          toBlock: to,
        });

        for (const log of logs) {
          const hedgeId = log.topics[1];
          if (hedgeId && hedgeIds.includes(hedgeId)) {
            txHashMap[hedgeId] = log.transactionHash;
          }
        }
      } catch {
        // Skip failed chunks silently
      }
    }
  } catch (err) {
    console.warn('Could not fetch HedgeOpened events for tx hashes:', err instanceof Error ? err.message : err);
  }
  return txHashMap;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const address = searchParams.get('address') || DEPLOYER;
    const includeStats = searchParams.get('stats') === 'true';

    // Use a non-batching provider to avoid Cronos RPC batch size limit (max 10)
    const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
      batchMaxCount: 1,
    });
    const contract = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, provider);

    // Get all hedge IDs — merge deployer + relayer hedges (privacy relayer uses separate wallet)
    const deployerHedges: string[] = await contract.getUserHedges(address);
    const relayerHedges: string[] = address === DEPLOYER 
      ? await contract.getUserHedges(RELAYER)
      : [];
    // Merge and deduplicate
    const hedgeIds = [...new Set([...deployerHedges, ...relayerHedges])];

    // Fetch tx hashes from event logs in parallel with hedge details
    const txHashMap = await fetchTxHashes(contract, provider, hedgeIds);

    // First pass: read all hedge data to determine which pair prices we need
    const BATCH_SIZE = 5;
    const rawHedges: Array<{ hedgeId: string; hedgeIndex: number; data: Awaited<ReturnType<typeof contract.hedges>> }> = [];
    for (let i = 0; i < hedgeIds.length; i += BATCH_SIZE) {
      const batch = hedgeIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (hedgeId: string, batchIndex: number) => {
          const data = await contract.hedges(hedgeId);
          return { hedgeId, hedgeIndex: i + batchIndex, data };
        })
      );
      rawHedges.push(...batchResults);
    }

    // Fetch LIVE prices from Crypto.com API for all active pairs
    const activePairIndices = rawHedges
      .filter(h => Number(h.data.status) === 1)
      .map(h => Number(h.data.pairIndex));
    const livePrices = await fetchLivePrices(activePairIndices);
    console.log('📊 Live prices from Crypto.com:', Object.entries(livePrices).map(([k, v]) => `${PAIR_SYMBOLS[Number(k)]}=$${v}`).join(', '));

    // Fetch entry prices from MockMoonlander for all hedges
    // Note: MockMoonlander trader = HedgeExecutor contract (not user/relayer), 
    // because HedgeExecutor calls MockMoonlander internally
    const entryPriceMap: Record<string, number> = {};
    try {
      const moonlander = new ethers.Contract(MOCK_MOONLANDER, MOONLANDER_ABI, provider);
      const pricePromises = rawHedges.map(async ({ hedgeId, data: h }) => {
        try {
          const trade = await moonlander.getTrade(HEDGE_EXECUTOR, Number(h.pairIndex), Number(h.tradeIndex));
          if (trade && trade.openPrice > 0n) {
            entryPriceMap[hedgeId] = Number(trade.openPrice) / 1e10;
          }
        } catch {
          // Trade may not exist on MockMoonlander (closed/liquidated)
        }
      });
      await Promise.all(pricePromises);
    } catch {
      console.warn('Could not fetch entry prices from MockMoonlander');
    }

    // Second pass: build hedge details with real prices
    const hedgeDetails = rawHedges.map(({ hedgeId, hedgeIndex, data: h }) => {
        const pairIndex = Number(h.pairIndex);
        const collateralAmount = Number(ethers.formatUnits(h.collateralAmount, 6));
        const leverage = Number(h.leverage);
        const isLong = h.isLong;
        const status = Number(h.status);

        // Use actual entry price from MockMoonlander, fallback to live price
        const entryPrice = entryPriceMap[hedgeId] || livePrices[pairIndex] || FALLBACK_PRICES[pairIndex] || 1000;
        const currentPrice = status === 1 ? (livePrices[pairIndex] || entryPrice) : entryPrice;

        // Calculate unrealized PnL using real price delta
        const positionSize = collateralAmount * leverage;
        const priceChange = (currentPrice - entryPrice) / entryPrice;
        const unrealizedPnl = isLong
          ? positionSize * priceChange
          : positionSize * (-priceChange);
        const pnlPercent = (unrealizedPnl / collateralAmount) * 100;

        // Derive ZK proxy wallet address for this hedge
        const proxyWallet = deriveProxyAddress(
          h.trader,
          hedgeIndex,
          h.commitmentHash
        );

        return {
          hedgeId: hedgeId,
          orderId: hedgeId.slice(0, 18),
          trader: h.trader,
          asset: PAIR_SYMBOLS[pairIndex] || PAIR_NAMES[pairIndex] || `PAIR-${pairIndex}`,
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
          txHash: txHashMap[hedgeId] || null,
          proxyWallet,
          proxyVault: ZK_PROXY_VAULT,
          zkVerified: h.commitmentHash !== ethers.ZeroHash,
          onChain: true,
          chain: 'cronos-testnet',
          contractAddress: HEDGE_EXECUTOR,
          priceSource: status === 1 ? 'crypto.com' : 'closed',
        };
    });

    // Filter active hedges for summary
    const activeHedges = hedgeDetails.filter(h => h.status === 'active');
    const closedHedges = hedgeDetails.filter(h => h.status === 'closed' || h.status === 'liquidated');

    // Build summary matching existing API format
    const totalUnrealizedPnL = activeHedges.reduce((sum, h) => sum + h.unrealizedPnL, 0);
    const profitable = activeHedges.filter(h => h.unrealizedPnL > 0).length;
    const unprofitable = activeHedges.filter(h => h.unrealizedPnL <= 0).length;

    let protocolStats = null;
    if (includeStats) {
      try {
        const stats = await contract.getProtocolStats();
        protocolStats = {
          totalOpened: Number(stats[0]),
          totalClosed: Number(stats[1]),
          collateralLocked: Number(ethers.formatUnits(stats[2], 6)),
          totalPnl: Number(ethers.formatUnits(stats[3], 6)),
          feesCollected: Number(ethers.formatUnits(stats[4], 6)),
        };
      } catch {
        // Fallback: read individual stats
        protocolStats = {
          totalOpened: hedgeDetails.length,
          totalClosed: closedHedges.length,
          collateralLocked: activeHedges.reduce((s, h) => s + h.collateral, 0),
          totalPnl: 0,
          feesCollected: 0,
        };
      }
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
          hedgeId: h.hedgeId,
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
          txHash: h.txHash,
          proxyWallet: h.proxyWallet,
          proxyVault: h.proxyVault,
          commitmentHash: h.commitmentHash,
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
