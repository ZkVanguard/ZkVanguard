/**
 * On-Chain Hedge Positions API
 * Reads hedge positions directly from the HedgeExecutor smart contract on Cronos testnet
 * 
 * Uses ThrottledProvider for:
 *  - Concurrency control (max 3 parallel RPC calls)
 *  - Retry with exponential backoff on 429s
 *  - 30s response cache to avoid redundant calls
 * 
 * GET /api/agents/hedging/onchain
 * Query params:
 *   - address: Wallet address to filter by (optional, defaults to deployer)
 *   - stats: Include protocol stats (optional)
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getCronosProvider } from '@/lib/throttled-provider';
import { getAllOnChainHedges, getOnChainProtocolStats, batchUpdateHedgePrices, getTxHashesFromDb, cacheTxHashes } from '@/lib/db/hedges';
import { getCachedPrices, upsertPrices } from '@/lib/db/prices';
import { getHedgesByWallet } from '@/lib/hedge-ownership';

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
const MOCK_MOONLANDER = '0x22E2F34a0637b0e959C2F10D2A0Ec7742B9956D7';
const MOONLANDER_ABI = [
  'function getTrade(address trader, uint256 pairIndex, uint256 tradeIndex) view returns (tuple(address trader, uint256 pairIndex, uint256 index, uint256 collateralAmount, uint256 positionSizeUsd, uint256 openPrice, bool isLong, uint256 leverage, uint256 tp, uint256 sl, bool isOpen))',
  'function mockPrices(uint256) view returns (uint256)',
];

// ─── Bulk price cache (single Crypto.com API call, cached 15s) ────────────
let _priceCache: { prices: Record<number, number>; expiresAt: number } | null = null;

/**
 * Fetch live prices from Crypto.com Exchange API in a SINGLE HTTP call.
 * Results are cached for 15 seconds to avoid duplicate fetches.
 */
async function fetchLivePrices(pairIndices: number[]): Promise<Record<number, number>> {
  // Return cached prices if still valid
  if (_priceCache && Date.now() < _priceCache.expiresAt) {
    const cached: Record<number, number> = {};
    for (const idx of pairIndices) {
      cached[idx] = _priceCache.prices[idx] ?? FALLBACK_PRICES[idx] ?? 1000;
    }
    return cached;
  }

  const prices: Record<number, number> = {};

  try {
    // Single API call — fetch ALL tickers at once
    const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Crypto.com API ${response.status}`);

    const data = await response.json();
    const tickers: Array<{ i: string; a: string }> = data.result?.data || [];

    const symbolToIndex: Record<string, number> = {
      'BTC_USDT': 0, 'ETH_USDT': 1, 'CRO_USDT': 2,
      'ATOM_USDT': 3, 'DOGE_USDT': 4, 'SOL_USDT': 5,
    };

    for (const t of tickers) {
      const idx = symbolToIndex[t.i];
      if (idx !== undefined) {
        const p = parseFloat(t.a);
        if (p > 0) prices[idx] = p;
      }
    }

    // Cache the full map for 15s
    _priceCache = { prices: { ...prices }, expiresAt: Date.now() + 15_000 };
  } catch (err) {
    console.warn('Live price fetch failed, using fallbacks:', err instanceof Error ? err.message : err);
  }

  // Fill in missing with fallbacks
  for (const idx of pairIndices) {
    if (!prices[idx]) prices[idx] = FALLBACK_PRICES[idx] || 1000;
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

// Fetch tx hashes from contract event logs (throttled)
// Scans ALL events from the contract and matches hedgeIds from topics,
// avoiding hardcoded event signatures that may differ from the deployed implementation.
async function fetchTxHashes(
  contract: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  hedgeIds: string[],
  tp: ReturnType<typeof getCronosProvider>
): Promise<Record<string, string>> {
  const txHashMap: Record<string, string> = {};
  try {
    const contractAddress = await contract.getAddress();
    const latestBlock = await tp.call('blockNumber', () => provider.getBlockNumber(), 15_000);
    
    // Wider scan range, respecting RPC max block distance of 2000
    const MAX_SCAN_BLOCKS = 50_000;
    const CHUNK_SIZE = 2000;
    const startBlock = Math.max(0, latestBlock - MAX_SCAN_BLOCKS);
    const hedgeIdSet = new Set(hedgeIds);
    const remainingIds = new Set(hedgeIds);
    
    // Throttle log queries through the semaphore
    const chunks: Array<{ from: number; to: number }> = [];
    for (let from = startBlock; from <= latestBlock; from += CHUNK_SIZE) {
      chunks.push({ from, to: Math.min(from + CHUNK_SIZE - 1, latestBlock) });
    }

    const logResults = await tp.throttledAll(
      chunks.map(({ from, to }) => ({
        key: `logs-all-${from}-${to}`,
        fn: async () => {
          try {
            // Scan ALL events from the contract (no topic filter)
            // to handle upgraded implementations with different event signatures
            return await provider.getLogs({
              address: contractAddress,
              fromBlock: from,
              toBlock: to,
            });
          } catch {
            return [];
          }
        },
        ttl: 120_000, // Cache log results for 120s
      }))
    );

    for (const logs of logResults) {
      for (const log of logs) {
        // Match hedgeId from topic[1] (indexed first param in HedgeOpened variants)
        const hedgeId = log.topics[1];
        if (hedgeId && hedgeIdSet.has(hedgeId)) {
          txHashMap[hedgeId] = log.transactionHash;
          remainingIds.delete(hedgeId);
        }
      }
    }
    
    if (remainingIds.size > 0) {
      console.warn(`Could not find tx hashes for ${remainingIds.size}/${hedgeIds.length} hedges (may be outside ${MAX_SCAN_BLOCKS}-block scan window)`);
    }
  } catch (err) {
    console.warn('Could not fetch events for tx hashes:', err instanceof Error ? err.message : err);
  }
  return txHashMap;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const address = searchParams.get('address') || searchParams.get('walletAddress');
    const includeStats = searchParams.get('stats') === 'true';
    const forceRpc = searchParams.get('forceRpc') === 'true'; // Debug flag to bypass DB

    // ═══════════════════════════════════════════════════════════
    // DB-FIRST APPROACH: Serve from Neon DB (instant, no RPC)
    // ═══════════════════════════════════════════════════════════
    if (!forceRpc) {
      const dbStart = Date.now();
      
      // Fetch user's owned hedges from hedge_ownership table if filtering by wallet
      const userOwnedCommitments = address ? await getHedgesByWallet(address) : null;
      
      const [dbHedges, dbStats, cachedPrices] = await Promise.all([
        getAllOnChainHedges(false), // All hedges (active + closed)
        includeStats ? getOnChainProtocolStats() : Promise.resolve(null),
        getCachedPrices(['BTC', 'ETH', 'CRO', 'ATOM', 'DOGE', 'SOL'], 30_000),
      ]);

      if (dbHedges.length > 0) {
        // Filter by wallet ownership - ALWAYS filter when address is provided
        let filteredHedges = dbHedges;
        if (address) {
          // Check both: direct wallet_address match OR commitment_hash in user's owned hedges
          const ownedCommitmentSet = new Set(Object.keys(userOwnedCommitments || {}));
          
          filteredHedges = dbHedges.filter(h => {
            // Direct match (non-gasless hedges)
            if (h.wallet_address?.toLowerCase() === address.toLowerCase()) return true;
            // Ownership registry match (gasless hedges) - by commitment_hash
            if (h.commitment_hash && ownedCommitmentSet.has(h.commitment_hash.toLowerCase())) return true;
            return false;
          });
          
          console.log(`🔍 Filtered hedges for ${address.slice(0,10)}...: ${filteredHedges.length}/${dbHedges.length}`);
        }

        // Overlay live prices from cache (or DB-stored prices if cache miss)
        const priceMap: Record<string, number> = {};
        for (const symbol of ['BTC', 'ETH', 'CRO', 'ATOM', 'DOGE', 'SOL']) {
          const cached = cachedPrices[symbol];
          priceMap[symbol] = cached?.price ?? FALLBACK_PRICES[Object.keys(PAIR_NAMES).find(k => PAIR_NAMES[parseInt(k)] === symbol) as unknown as number] ?? 1000;
        }

        // If price cache is stale, refresh from Crypto.com (fire-and-forget)
        if (Object.keys(cachedPrices).length < 6) {
          fetchLivePrices([0, 1, 2, 3, 4, 5]).then(livePrices => {
            const priceUpdates = Object.entries(livePrices).map(([idx, price]) => ({
              symbol: PAIR_SYMBOLS[parseInt(idx)],
              price,
              source: 'cryptocom-exchange',
            }));
            upsertPrices(priceUpdates).catch(() => {});
            // Also update hedge prices in DB
            const priceMapForDb: Record<string, { price: number; source: string }> = {};
            for (const [idx, price] of Object.entries(livePrices)) {
              priceMapForDb[PAIR_SYMBOLS[parseInt(idx)]] = { price, source: 'cryptocom-exchange' };
            }
            batchUpdateHedgePrices(priceMapForDb).catch(() => {});
          }).catch(() => {});
        }

        // Build response from DB data
        const hedgeDetails = filteredHedges.map(h => {
          const currentPrice = priceMap[h.asset] || h.current_price || h.entry_price || 1000;
          const entryPrice = h.entry_price || currentPrice;
          
          // Calculate unrealized PnL (with safety checks for NaN)
          const size = h.size || 0;
          const leverage = h.leverage || 1;
          const positionSize = size * leverage;
          const priceChange = entryPrice > 0 ? (currentPrice - entryPrice) / entryPrice : 0;
          const unrealizedPnl = h.side === 'LONG'
            ? positionSize * priceChange
            : positionSize * (-priceChange);
          const pnlPercent = size > 0 ? (unrealizedPnl / size) * 100 : 0;
          
          // Get TRUE owner from hedge_ownership registry (for gasless hedges)
          // Fall back to hedge.wallet_address for non-gasless hedges
          const commitmentKey = h.commitment_hash?.toLowerCase();
          const trueOwner = (commitmentKey && userOwnedCommitments?.[commitmentKey]?.walletAddress) 
            || h.wallet_address 
            || DEPLOYER;

          return {
            hedgeId: h.hedge_id_onchain || h.order_id,
            orderId: h.order_id.slice(0, 18),
            trader: trueOwner,
            asset: h.asset,
            pairIndex: Object.keys(PAIR_NAMES).find(k => PAIR_NAMES[parseInt(k)] === h.asset) || 0,
            side: h.side,
            type: h.side,
            collateral: size,
            size: size,
            capitalUsed: size,
            leverage: leverage,
            entryPrice,
            currentPrice: Math.round(currentPrice * 100) / 100,
            unrealizedPnL: h.status === 'active' ? Math.round(unrealizedPnl * 100) / 100 : 0,
            pnlPercentage: h.status === 'active' ? Math.round(pnlPercent * 100) / 100 : 0,
            status: h.status,
            isLong: h.side === 'LONG',
            commitmentHash: h.commitment_hash || ethers.ZeroHash,
            nullifier: h.nullifier || ethers.ZeroHash,
            openTimestamp: Math.floor(new Date(h.created_at).getTime() / 1000),
            closeTimestamp: h.closed_at ? Math.floor(new Date(h.closed_at).getTime() / 1000) : 0,
            realizedPnl: h.realized_pnl || 0,
            createdAt: new Date(h.created_at).toISOString(),
            txHash: h.tx_hash || null,
            proxyWallet: h.proxy_wallet || null,
            proxyVault: ZK_PROXY_VAULT,
            zkVerified: !!h.commitment_hash && h.commitment_hash !== ethers.ZeroHash,
            onChain: true,
            chain: h.chain || 'cronos-testnet',
            contractAddress: h.contract_address || HEDGE_EXECUTOR,
            priceSource: h.status === 'active' ? (cachedPrices[h.asset] ? 'db-cache' : 'db-stored') : 'closed',
          };
        });

        const activeHedges = hedgeDetails.filter(h => h.status === 'active');
        const closedHedges = hedgeDetails.filter(h => h.status === 'closed' || h.status === 'liquidated');
        const totalUnrealizedPnL = activeHedges.reduce((sum, h) => sum + h.unrealizedPnL, 0);
        const profitable = activeHedges.filter(h => h.unrealizedPnL > 0).length;
        const unprofitable = activeHedges.filter(h => h.unrealizedPnL <= 0).length;

        let protocolStats = null;
        if (includeStats && dbStats) {
          protocolStats = {
            totalOpened: parseInt(dbStats.total_count || '0'),
            totalClosed: parseInt(dbStats.closed_count || '0'),
            collateralLocked: parseFloat(dbStats.collateral_locked || '0'),
            totalPnl: parseFloat(dbStats.total_pnl || '0'),
            feesCollected: parseFloat(dbStats.fees_collected || '0'),
          };
        }

        console.log(`⚡ DB-first onchain: ${hedgeDetails.length} hedges in ${Date.now() - dbStart}ms (NO RPC calls)`);

        return NextResponse.json({
          success: true,
          source: 'db-cache',
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
          dbElapsed: Date.now() - dbStart + 'ms',
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    // FALLBACK: RPC mode (DB empty or forceRpc=true)
    // ═══════════════════════════════════════════════════════════
    console.log('⚠️ DB empty or forceRpc=true — falling back to RPC (slow)');
    const tp = getCronosProvider(RPC_URL);
    const provider = tp.provider;
    const contract = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, provider);

    // ── Step 1: Fetch hedge IDs + live prices in parallel ──
    const [hedgeIdsResult, livePrices] = await Promise.all([
      // Hedge IDs (throttled, cached)
      tp.throttledAll([
        {
          key: `hedgeIds-${address}`,
          fn: async () => [...(await contract.getUserHedges(address))] as string[],
        },
        {
          key: address === DEPLOYER ? `hedgeIds-${RELAYER}` : null,
          fn: async () => address === DEPLOYER
            ? [...(await contract.getUserHedges(RELAYER))] as string[]
            : [] as string[],
        },
      ]),
      // Live prices — single Crypto.com API call, cached 15s
      fetchLivePrices([0, 1, 2, 3, 4, 5]),
    ]);

    const hedgeIds = [...new Set([...hedgeIdsResult[0], ...hedgeIdsResult[1]])];

    // ── Step 2: Read all hedge data (throttled, cached) ──
    const rawHedges = await tp.throttledAll(
      hedgeIds.map((hedgeId, idx) => ({
        key: `hedge-${hedgeId}`,
        fn: async () => {
          const data = await contract.hedges(hedgeId);
          return { hedgeId, hedgeIndex: idx, data };
        },
      }))
    );

    // ── Step 3: Fetch entry prices from MockMoonlander in parallel ──
    const entryPriceMap: Record<string, number> = {};
    try {
      const moonlander = new ethers.Contract(MOCK_MOONLANDER, MOONLANDER_ABI, provider);
      const tradeResults = await tp.throttledAll(
        rawHedges.map(({ hedgeId, data: h }) => ({
          key: `trade-${hedgeId}`,
          fn: async () => {
            try {
              const trade = await moonlander.getTrade(HEDGE_EXECUTOR, Number(h.pairIndex), Number(h.tradeIndex));
              return { hedgeId, openPrice: trade && trade.openPrice > 0n ? Number(trade.openPrice) / 1e10 : 0 };
            } catch {
              return { hedgeId, openPrice: 0 };
            }
          },
        }))
      );
      for (const { hedgeId, openPrice } of tradeResults) {
        if (openPrice > 0) entryPriceMap[hedgeId] = openPrice;
      }
    } catch {
      console.warn('Could not fetch entry prices from MockMoonlander');
    }

    // ── Step 3b: DB-first tx hash lookup (instant), event scan only for misses ──
    const skipTxHashes = searchParams.get('txhashes') === 'false';
    let txHashMap: Record<string, string> = {};
    if (!skipTxHashes) {
      // 1. Check Neon DB first — instant lookup
      txHashMap = await getTxHashesFromDb(hedgeIds);
      const dbHits = Object.keys(txHashMap).length;
      const missingIds = hedgeIds.filter(id => !txHashMap[id]);

      if (missingIds.length > 0) {
        // 2. Fall back to event log scan ONLY for DB-misses
        const scannedHashes = await fetchTxHashes(contract, provider, missingIds, tp);
        Object.assign(txHashMap, scannedHashes);

        // 3. Persist discovered hashes back to DB (fire-and-forget)
        const newEntries = Object.entries(scannedHashes).map(([hedgeId, txHash]) => ({ hedgeId, txHash }));
        if (newEntries.length > 0) {
          cacheTxHashes(newEntries).catch(() => {});
        }
      }

      // 4. Last resort — check deployment file for demo hedge hashes
      const stillMissing = hedgeIds.filter(id => !txHashMap[id]);
      if (stillMissing.length > 0) {
        try {
          const fs = await import('fs/promises');
          const path = await import('path');
          const deployPath = path.join(process.cwd(), 'deployments', 'cronos-testnet.json');
          const deployData = JSON.parse(await fs.readFile(deployPath, 'utf-8'));
          const demoHedges = deployData.demoHedges || [];
          for (const demo of demoHedges) {
            if (demo.hedgeId && demo.txHash && stillMissing.includes(demo.hedgeId)) {
              txHashMap[demo.hedgeId] = demo.txHash;
            }
          }
        } catch { /* deployment file not available */ }
      }

      if (dbHits > 0) {
        console.log(`⚡ TX hashes: ${dbHits} from DB, ${Object.keys(txHashMap).length - dbHits} from scan/deploy`);
      }
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
        const stats = await tp.call('protocolStats', () => contract.getProtocolStats(), 15_000);
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
