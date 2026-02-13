// Check active hedges for Portfolio #3
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

// Price fetching
async function fetchPrice(symbol) {
  const baseSymbol = symbol.replace('-PERP', '').replace('-USD-PERP', '');
  const url = `https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=${baseSymbol}_USD`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    const price = data?.result?.data?.[0]?.a;
    return price ? parseFloat(price) : null;
  } catch {
    return null;
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Check active hedges
    const result = await pool.query(`
      SELECT id, portfolio_id, asset, market, side, size, entry_price, 
             status, current_pnl, leverage, on_chain, created_at 
      FROM hedges 
      WHERE status = 'active' 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ACTIVE HEDGES');
    console.log('═══════════════════════════════════════════════════\n');
    
    if (result.rows.length === 0) {
      console.log('  No active hedges found.\n');
    } else {
      result.rows.forEach((h, i) => {
        console.log(`  ${i + 1}. Hedge #${h.id}`);
        console.log(`     Portfolio: ${h.portfolio_id}`);
        console.log(`     Asset: ${h.asset} | Market: ${h.market}`);
        console.log(`     Side: ${h.side} | Size: $${parseFloat(h.size).toLocaleString()}`);
        console.log(`     Entry: $${parseFloat(h.entry_price || 0).toLocaleString()}`);
        console.log(`     PnL: $${parseFloat(h.current_pnl || 0).toLocaleString()}`);
        console.log(`     Leverage: ${h.leverage}x | On-chain: ${h.on_chain ? 'Yes' : 'No'}`);
        console.log(`     Created: ${h.created_at}`);
        console.log('');
      });
    }
    
    // Check hedges for Portfolio #3 specifically
    const p3Result = await pool.query(`
      SELECT id, asset, side, size, status, current_pnl, on_chain 
      FROM hedges 
      WHERE portfolio_id = 3 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    console.log('═══════════════════════════════════════════════════');
    console.log('  PORTFOLIO #3 HEDGES');
    console.log('═══════════════════════════════════════════════════\n');
    
    if (p3Result.rows.length === 0) {
      console.log('  No hedges found for Portfolio #3.\n');
    } else {
      p3Result.rows.forEach((h, i) => {
        console.log(`  ${i + 1}. #${h.id}: ${h.side} ${h.asset} | $${parseFloat(h.size).toLocaleString()} | Status: ${h.status} | PnL: $${parseFloat(h.current_pnl || 0).toLocaleString()} | On-chain: ${h.on_chain ? 'Yes' : 'No'}`);
      });
      console.log('');
    }
    
    // Update PnL for all active hedges
    console.log('═══════════════════════════════════════════════════');
    console.log('  UPDATING PNL WITH LIVE PRICES');
    console.log('═══════════════════════════════════════════════════\n');
    
    for (const hedge of result.rows) {
      const currentPrice = await fetchPrice(hedge.asset);
      if (!currentPrice) {
        console.log(`  ⚠️  No price for ${hedge.asset}`);
        continue;
      }
      
      const entryPrice = parseFloat(hedge.entry_price || 0);
      const notionalValue = parseFloat(hedge.size) * parseFloat(hedge.leverage || 1);
      
      // Calculate PnL
      let pnlMultiplier;
      if (hedge.side === 'SHORT') {
        pnlMultiplier = (entryPrice - currentPrice) / entryPrice;
      } else {
        pnlMultiplier = (currentPrice - entryPrice) / entryPrice;
      }
      
      const unrealizedPnL = notionalValue * pnlMultiplier;
      const pnlPercentage = pnlMultiplier * 100;
      
      // Update in database
      await pool.query(
        `UPDATE hedges SET current_pnl = $1, current_price = $2, price_updated_at = NOW() WHERE id = $3`,
        [unrealizedPnL, currentPrice, hedge.id]
      );
      
      console.log(`  ✅ #${hedge.id} ${hedge.side} ${hedge.asset}`);
      console.log(`     Entry: $${entryPrice.toLocaleString()} → Current: $${currentPrice.toLocaleString()}`);
      console.log(`     PnL: ${unrealizedPnL >= 0 ? '+' : ''}$${unrealizedPnL.toFixed(2)} (${pnlPercentage >= 0 ? '+' : ''}${pnlPercentage.toFixed(2)}%)`);
      console.log('');
    }
    
    console.log('═══════════════════════════════════════════════════');
    console.log('  PNL UPDATE COMPLETE ✓');
    console.log('═══════════════════════════════════════════════════\n');
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
