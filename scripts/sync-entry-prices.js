#!/usr/bin/env node
/**
 * Sync entry prices from MockMoonlander on-chain to DB
 * This populates the entry_price column for existing hedges
 */
const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');
const { ethers } = require('ethers');

// Enable WebSocket for Neon serverless
neonConfig.webSocketConstructor = ws;

const DATABASE_URL = 'postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full';
const RPC_URL = 'https://evm-t3.cronos.org/';
const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const MOCK_MOONLANDER = '0x22E2F34a0637b0e959C2F10D2A0Ec7742B9956D7';

const HEDGE_EXECUTOR_ABI = [
  'function hedges(bytes32) view returns (bytes32 hedgeId, address trader, uint256 pairIndex, uint256 tradeIndex, uint256 collateralAmount, uint256 leverage, bool isLong, bytes32 commitmentHash, bytes32 nullifier, uint256 openTimestamp, uint256 closeTimestamp, int256 realizedPnl, uint8 status)',
];

const MOONLANDER_ABI = [
  'function getTrade(address executor, uint256 pairIndex, uint256 tradeIndex) view returns (tuple(address trader, uint256 pairIndex, uint256 index, uint256 leverage, uint256 openPrice, uint256 tp, uint256 sl, uint256 collateral, bool isOpen, bool buy))',
];

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const hedgeContract = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, provider);
  const moonlander = new ethers.Contract(MOCK_MOONLANDER, MOONLANDER_ABI, provider);

  // Asset to pair index mapping
  const ASSET_TO_PAIR = {
    'BTC': 0, 'ETH': 1, 'CRO': 2, 'ATOM': 3, 'DOGE': 4, 'SOL': 5
  };

  try {
    // Get all hedges that need entry prices
    const { rows } = await pool.query(
      `SELECT id, hedge_id_onchain, asset 
       FROM hedges 
       WHERE hedge_id_onchain IS NOT NULL 
       AND (entry_price IS NULL OR entry_price = current_price)`
    );

    console.log(`Found ${rows.length} hedges needing entry prices\n`);

    for (const row of rows) {
      console.log(`Processing hedge ${row.hedge_id_onchain} (${row.asset})...`);
      
      try {
        // Get hedge data from contract
        const onChainHedge = await hedgeContract.hedges(row.hedge_id_onchain);
        const pairIndex = Number(onChainHedge.pairIndex);
        const tradeIndex = Number(onChainHedge.tradeIndex);
        
        console.log(`  pairIndex: ${pairIndex}, tradeIndex: ${tradeIndex}`);

        // Get entry price from MockMoonlander
        const trade = await moonlander.getTrade(HEDGE_EXECUTOR, pairIndex, tradeIndex);
        const entryPrice = trade && trade.openPrice > 0n 
          ? Number(trade.openPrice) / 1e10 
          : 0;

        console.log(`  Entry price from Moonlander: $${entryPrice}`);

        if (entryPrice > 0) {
          // Update DB with entry price
          await pool.query(
            `UPDATE hedges 
             SET entry_price = $1, updated_at = NOW() 
             WHERE id = $2`,
            [entryPrice, row.id]
          );
          console.log(`  ✅ Updated entry_price to $${entryPrice}\n`);
        } else {
          console.log(`  ⚠️ No entry price found, skipping\n`);
        }
      } catch (err) {
        console.log(`  ❌ Error: ${err.message}\n`);
      }
    }

    // Show updated hedges
    console.log('\n=== UPDATED HEDGES ===');
    const updated = await pool.query(
      `SELECT asset, side, size, leverage, entry_price, current_price 
       FROM hedges WHERE status = 'active'`
    );
    for (const h of updated.rows) {
      const entry = parseFloat(h.entry_price || 0);
      const current = parseFloat(h.current_price || 0);
      const posSize = h.size * h.leverage;
      const priceChange = entry > 0 ? (current - entry) / entry : 0;
      const pnl = h.side === 'LONG' ? posSize * priceChange : posSize * (-priceChange);
      const pnlPct = h.size > 0 ? (pnl / h.size) * 100 : 0;
      console.log(`${h.asset} ${h.side} | entry: $${entry} | current: $${current} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`);
    }

  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await pool.end();
  }
}

main();
