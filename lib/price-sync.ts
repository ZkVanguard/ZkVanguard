/**
 * Sync live Crypto.com prices to MockMoonlander on-chain.
 * 
 * ⚠️ TESTNET ONLY - This module is for syncing mock prices during development.
 * On mainnet, Moonlander has its own oracle and this module should not be used.
 * 
 * Called before every open/close to ensure the contract uses real market data
 * instead of stale hardcoded prices.
 * 
 * Also ensures MockMoonlander has enough USDT to settle trades
 * (mints if needed — this is a test contract).
 */
import { ethers } from 'ethers';
import { getCurrentChainId, CHAIN_IDS, isMainnet, getRpcUrl } from '@/lib/utils/network';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';

// ⚠️ TESTNET-ONLY ADDRESSES
// On mainnet, use real Moonlander oracle (no price sync needed)
const MOCK_MOONLANDER_TESTNET = '0x22E2F34a0637b0e959C2F10D2A0Ec7742B9956D7';
const USDT_TESTNET = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';

// Dynamic getters that throw on mainnet to prevent accidental usage
function getMockMoonlanderAddress(): string {
  if (isMainnet()) {
    throw new Error('MockMoonlander price sync is testnet-only. Mainnet uses real Moonlander oracle.');
  }
  return MOCK_MOONLANDER_TESTNET;
}

function getUsdtAddress(): string {
  if (isMainnet()) {
    throw new Error('Testnet USDT is testnet-only. Mainnet uses official WDK USDT.');
  }
  return USDT_TESTNET;
}

const MOONLANDER_ABI = [
  'function setMockPrice(uint256 pairIndex, uint256 price) external',
  'function mockPrices(uint256) view returns (uint256)',
  'function owner() view returns (address)',
];

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function mint(address to, uint256 amount) external',
];

// Crypto.com ticker symbol → pair index
const TICKER_TO_PAIR: Record<string, number> = {
  'BTC_USDT': 0, 'ETH_USDT': 1, 'CRO_USDT': 2,
  'ATOM_USDT': 3, 'DOGE_USDT': 4, 'SOL_USDT': 5,
};

const PAIR_TO_TICKER: Record<number, string> = {
  0: 'BTC_USDT', 1: 'ETH_USDT', 2: 'CRO_USDT',
  3: 'ATOM_USDT', 4: 'DOGE_USDT', 5: 'SOL_USDT',
};

const PAIR_NAMES: Record<number, string> = {
  0: 'BTC', 1: 'ETH', 2: 'CRO', 3: 'ATOM', 4: 'DOGE', 5: 'SOL',
};

// ─── In-memory price cache (avoid excessive API calls) ───────────────────────
let _cachedPrices: { prices: Record<number, number>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10_000; // 10s cache

/**
 * Fetch ALL live prices from central proactive price feed.
 * Returns prices as { pairIndex: price_usd }.
 */
export async function fetchLivePricesFromCDC(): Promise<Record<number, number>> {
  // Return cached if fresh
  if (_cachedPrices && Date.now() - _cachedPrices.fetchedAt < CACHE_TTL_MS) {
    return _cachedPrices.prices;
  }

  const prices: Record<number, number> = {};

  try {
    const marketDataService = getMarketDataService();
    const symbols = ['BTC', 'ETH', 'CRO', 'ATOM', 'DOGE', 'SOL'];
    const priceMap = await marketDataService.getTokenPrices(symbols);
    
    // Map symbol prices to pair indices
    const symbolToPair: Record<string, number> = {
      'BTC': 0, 'ETH': 1, 'CRO': 2, 'ATOM': 3, 'DOGE': 4, 'SOL': 5
    };
    
    for (const [symbol, priceData] of priceMap) {
      const pairIdx = symbolToPair[symbol.toUpperCase()];
      if (pairIdx !== undefined && priceData.price > 0) {
        prices[pairIdx] = priceData.price;
      }
    }

    _cachedPrices = { prices, fetchedAt: Date.now() };
    console.log(`📡 Live prices (proactive cache): BTC=$${prices[0]} ETH=$${prices[1]} CRO=$${prices[2]}`);
  } catch (err) {
    console.warn('⚠️ Price fetch failed:', err instanceof Error ? err.message : err);
  }

  return prices;
}

/**
 * Sync live Crypto.com prices to MockMoonlander on-chain.
 * 
 * @param ownerSigner - The deployer wallet that owns MockMoonlander
 * @param pairIndices - Which pairs to update (default: all)
 * @returns The live prices that were synced
 */
export async function syncPricesToChain(
  ownerSigner: ethers.Wallet,
  pairIndices: number[] = [0, 1, 2, 3, 4, 5]
): Promise<Record<number, number>> {
  const livePrices = await fetchLivePricesFromCDC();
  if (Object.keys(livePrices).length === 0) {
    console.warn('⚠️ No live prices available, skipping on-chain sync');
    return {};
  }

  const moonlander = new ethers.Contract(getMockMoonlanderAddress(), MOONLANDER_ABI, ownerSigner);
  const feeData = await ownerSigner.provider!.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits('5000', 'gwei');

  // Update each pair price on-chain
  const txPromises: Promise<void>[] = [];
  for (const idx of pairIndices) {
    const usdPrice = livePrices[idx];
    if (!usdPrice) continue;

    // MockMoonlander stores prices scaled to 10 decimals
    const scaledPrice = BigInt(Math.round(usdPrice * 1e10));

    txPromises.push(
      (async () => {
        try {
          // Check current on-chain price to avoid unnecessary txs
          const currentOnChain = await moonlander.mockPrices(idx);
          const currentUsd = Number(currentOnChain) / 1e10;
          const pctDiff = Math.abs((usdPrice - currentUsd) / currentUsd) * 100;

          // Only update if price differs by >0.1% (avoid spam txs)
          if (pctDiff < 0.1) {
            return;
          }

          const tx = await moonlander.setMockPrice(idx, scaledPrice, { gasPrice });
          await tx.wait();
          console.log(`  ✅ ${PAIR_NAMES[idx]}: $${currentUsd.toFixed(2)} → $${usdPrice.toFixed(2)} (${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(1)}%)`);
        } catch (err) {
          console.warn(`  ⚠️ Failed to update ${PAIR_NAMES[idx]} price:`, err instanceof Error ? err.message : err);
        }
      })()
    );
  }

  await Promise.all(txPromises);
  return livePrices;
}

/**
 * Sync price for a SINGLE pair (faster — one tx instead of six).
 * Call this before opening/closing a specific pair's trade.
 */
export async function syncSinglePriceToChain(
  ownerSigner: ethers.Wallet,
  pairIndex: number
): Promise<number> {
  const livePrices = await fetchLivePricesFromCDC();
  const usdPrice = livePrices[pairIndex];
  if (!usdPrice) {
    console.warn(`⚠️ No live price for pair ${pairIndex}, skipping sync`);
    return 0;
  }

  const moonlander = new ethers.Contract(getMockMoonlanderAddress(), MOONLANDER_ABI, ownerSigner);
  const scaledPrice = BigInt(Math.round(usdPrice * 1e10));

  try {
    const feeData = await ownerSigner.provider!.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('5000', 'gwei');
    const tx = await moonlander.setMockPrice(pairIndex, scaledPrice, { gasPrice });
    await tx.wait();
    console.log(`📈 Synced ${PAIR_NAMES[pairIndex]} price on-chain: $${usdPrice}`);
  } catch (err) {
    console.warn(`⚠️ Price sync failed for ${PAIR_NAMES[pairIndex]}:`, err instanceof Error ? err.message : err);
  }

  return usdPrice;
}

/**
 * Ensure MockMoonlander has enough USDT to settle a trade.
 * Mints additional USDT if needed (test contract — permissionless mint).
 */
export async function ensureMoonlanderLiquidity(
  signer: ethers.Wallet,
  requiredAmount: bigint
): Promise<void> {
  const usdt = new ethers.Contract(getUsdtAddress(), USDC_ABI, signer);
  const moonBalance = await usdt.balanceOf(getMockMoonlanderAddress());

  // Need at least 2x the trade amount to cover potential PnL returns
  const cushion = requiredAmount * 3n;
  if (moonBalance >= cushion) return;

  const deficit = cushion - moonBalance;
  console.log(`💰 MockMoonlander needs ${ethers.formatUnits(deficit, 6)} more USDT (has ${ethers.formatUnits(moonBalance, 6)}, needs ${ethers.formatUnits(cushion, 6)})`);

  try {
    const feeData = await signer.provider!.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('5000', 'gwei');
    const tx = await usdt.mint(getMockMoonlanderAddress(), deficit, { gasPrice });
    await tx.wait();
    const newBal = await usdt.balanceOf(getMockMoonlanderAddress());
    console.log(`  ✅ Minted ${ethers.formatUnits(deficit, 6)} USDT to MockMoonlander (new balance: ${ethers.formatUnits(newBal, 6)})`);
  } catch (err) {
    console.warn('⚠️ Failed to mint USDT to MockMoonlander:', err instanceof Error ? err.message : err);
  }
}

// Export getter functions for testnet addresses (throws on mainnet)
export { getMockMoonlanderAddress, getUsdtAddress, PAIR_NAMES, PAIR_TO_TICKER };
