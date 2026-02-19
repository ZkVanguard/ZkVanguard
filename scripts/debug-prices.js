const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Kt7IEjubwA2V@ep-fancy-frost-ahtb29ry-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=verify-full',
  ssl: { rejectUnauthorized: false }
});

async function debug() {
  // Check active hedges in DB
  console.log('=== ACTIVE HEDGES IN DB ===');
  const hedges = await pool.query(`
    SELECT asset, side, size, leverage, entry_price, current_price, status 
    FROM hedges 
    WHERE status = 'active' AND on_chain = true
  `);
  hedges.rows.forEach(h => {
    console.log(`${h.asset} ${h.side} | size: ${h.size} x${h.leverage} | entry: ${h.entry_price} | current: ${h.current_price}`);
  });

  // Check price cache
  console.log('\n=== PRICE CACHE ===');
  const prices = await pool.query('SELECT symbol, price, updated_at FROM price_cache');
  prices.rows.forEach(p => {
    console.log(`${p.symbol}: $${p.price} (updated: ${p.updated_at})`);
  });

  // Get live prices from Crypto.com for comparison
  console.log('\n=== LIVE CRYPTO.COM PRICES ===');
  try {
    const res = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers');
    const data = await res.json();
    const tickers = data.result?.data || [];
    const symbols = ['BTC_USDT', 'ETH_USDT', 'CRO_USDT', 'SOL_USDT'];
    symbols.forEach(sym => {
      const t = tickers.find(t => t.i === sym);
      if (t) console.log(`${sym}: $${t.a}`);
    });
  } catch (e) {
    console.log('Failed to fetch live prices:', e.message);
  }

  pool.end();
}

debug();
