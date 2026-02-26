#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');

async function checkNavHistory() {
  const sql = neon(process.env.DATABASE_URL);
  
  console.log('=== NAV HISTORY (First 10 records) ===\n');
  
  const records = await sql`
    SELECT id, timestamp, share_price, total_nav, total_shares, member_count, source
    FROM community_pool_nav_history
    ORDER BY timestamp ASC
    LIMIT 10
  `;
  
  console.log('ID | Timestamp | Share Price | Total NAV | Total Shares | Members | Source');
  console.log('-'.repeat(100));
  
  records.forEach(r => {
    const ts = new Date(r.timestamp).toISOString();
    console.log(`${r.id} | ${ts} | $${Number(r.share_price).toFixed(4)} | $${Number(r.total_nav).toFixed(2)} | ${Number(r.total_shares).toFixed(2)} | ${r.member_count} | ${r.source}`);
  });
  
  console.log('\n=== CALCULATED RETURNS ===\n');
  
  if (records.length >= 2) {
    const first = records[0];
    const last = records[records.length - 1];
    
    const baseNAV = 10000;
    const firstNormalizedNAV = baseNAV * Number(first.share_price);
    const lastNormalizedNAV = baseNAV * Number(last.share_price);
    const returnPct = ((lastNormalizedNAV - firstNormalizedNAV) / firstNormalizedNAV) * 100;
    
    console.log(`First record: $${Number(first.share_price).toFixed(4)} share price`);
    console.log(`Last record: $${Number(last.share_price).toFixed(4)} share price`);
    console.log(`First normalized NAV: ${firstNormalizedNAV.toFixed(2)}`);
    console.log(`Last normalized NAV: ${lastNormalizedNAV.toFixed(2)}`);
    console.log(`Calculated return: ${returnPct.toFixed(2)}%`);
    
    const directShareReturn = ((Number(last.share_price) - Number(first.share_price)) / Number(first.share_price)) * 100;
    console.log(`Direct share price return: ${directShareReturn.toFixed(2)}%`);
  }
  
  console.log('\n=== LATEST NAV HISTORY ===\n');
  
  const latest = await sql`
    SELECT id, timestamp, share_price, total_nav, total_shares, member_count, source
    FROM community_pool_nav_history
    ORDER BY timestamp DESC
    LIMIT 3
  `;
  
  console.log('Latest 3 records:');
  latest.forEach(r => {
    const ts = new Date(r.timestamp).toISOString();
    console.log(`${ts} | $${Number(r.share_price).toFixed(4)} | $${Number(r.total_nav).toFixed(2)} | ${r.source}`);
  });
}

checkNavHistory().catch(console.error);
