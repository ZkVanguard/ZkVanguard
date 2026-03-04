#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { query } from '../lib/db/postgres';

(async () => {
  console.log('📊 NAV History Check\n');
  
  const h = await query('SELECT COUNT(*) as count FROM community_pool_nav_history');
  console.log('Total NAV snapshots:', h[0].count);
  
  if (parseInt(h[0].count) > 0) {
    const latest = await query('SELECT * FROM community_pool_nav_history ORDER BY timestamp DESC LIMIT 5');
    console.log('\nLatest 5 snapshots:');
    latest.forEach((snap: any, i: number) => {
      console.log(`  ${i+1}. Share Price: $${parseFloat(snap.share_price).toFixed(6)} | NAV: $${parseFloat(snap.total_nav).toFixed(2)}`);
      console.log(`     Time: ${new Date(snap.timestamp).toLocaleString()}`);
    });
  }
  
  process.exit(0);
})();
