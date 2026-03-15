#!/usr/bin/env npx tsx
/**
 * Backfill portfolio_id for hedges that have NULL portfolio_id
 * 
 * The bug: `portfolioId || null` converts 0 (community pool) to NULL in JS.
 * This script identifies the correct portfolio_id for existing hedges and updates them.
 * 
 * Logic:
 *   - Wallet 0xb9966f... (deployer/treasury) → portfolio_id = -1 (community pool)
 *   - Wallet 0x97F77f... (community pool contract) → portfolio_id = -1
 *   - Wallet 0x742d35... (institutional) → portfolio_id = 3
 *   - Others → leave as-is (NULL) since we can't determine
 * 
 * Run: npx tsx scripts/database/backfill-portfolio-ids.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { query } from '../../lib/db/postgres';
import { COMMUNITY_POOL_PORTFOLIO_ID } from '../../lib/constants';

// Known wallet → portfolio mappings from deployments/auto-hedge-configs.json
const WALLET_TO_PORTFOLIO: Record<string, number> = {
  '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c': COMMUNITY_POOL_PORTFOLIO_ID, // Deployer/treasury → community pool
  '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30': COMMUNITY_POOL_PORTFOLIO_ID, // Community pool V3 proxy (current)
  '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B': COMMUNITY_POOL_PORTFOLIO_ID, // Community pool V2 proxy (deprecated)
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1': 3, // Institutional portfolio
};

async function backfillPortfolioIds() {
  console.log('🔧 Backfilling portfolio_id for hedges with NULL values\n');

  // 1. Find all hedges with NULL portfolio_id
  const nullHedges = await query(
    `SELECT id, order_id, wallet_address, asset, side, status, created_at, reason
     FROM hedges WHERE portfolio_id IS NULL ORDER BY created_at DESC`
  );

  console.log(`Found ${nullHedges.length} hedges with NULL portfolio_id\n`);

  if (nullHedges.length === 0) {
    console.log('✅ No hedges need backfilling');
    process.exit(0);
  }

  let updated = 0;
  let skipped = 0;

  for (const hedge of nullHedges) {
    const wallet = hedge.wallet_address;
    const portfolioId = wallet ? WALLET_TO_PORTFOLIO[wallet] : undefined;

    if (portfolioId !== undefined) {
      // We know the correct portfolio_id
      await query(
        'UPDATE hedges SET portfolio_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [portfolioId, hedge.id]
      );
      console.log(`  ✅ Updated hedge ${hedge.order_id?.slice(0, 20)}... → portfolio_id=${portfolioId} (wallet: ${wallet?.slice(0, 10)}...)`);
      updated++;
    } else {
      // Check if reason contains pool-related keywords
      const reason = (hedge.reason || '').toLowerCase();
      if (reason.includes('pool') || reason.includes('community') || reason.includes('auto loss protection')) {
        await query(
          'UPDATE hedges SET portfolio_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [COMMUNITY_POOL_PORTFOLIO_ID, hedge.id]
        );
        console.log(`  ✅ Updated hedge ${hedge.order_id?.slice(0, 20)}... → portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID} (reason match: "${hedge.reason?.slice(0, 50)}")`);
        updated++;
      } else {
        console.log(`  ⏭️  Skipped hedge ${hedge.order_id?.slice(0, 20)}... — unknown wallet: ${wallet}`);
        skipped++;
      }
    }
  }

  console.log(`\n📊 Results: ${updated} updated, ${skipped} skipped`);

  // 2. Verify the fix
  console.log('\n🔍 Verification:');
  const verifyNull = await query(
    'SELECT COUNT(*) as count FROM hedges WHERE portfolio_id IS NULL'
  );
  console.log(`  Remaining NULL portfolio_id: ${verifyNull[0].count}`);

  const verifyCommunity = await query(
    'SELECT COUNT(*) as count FROM hedges WHERE portfolio_id = $1',
    [COMMUNITY_POOL_PORTFOLIO_ID]
  );
  console.log(`  Community pool hedges (portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID}): ${verifyCommunity[0].count}`);

  const verifyAll = await query(
    `SELECT portfolio_id, COUNT(*) as count FROM hedges GROUP BY portfolio_id ORDER BY portfolio_id`
  );
  console.log('\n  Portfolio distribution:');
  verifyAll.forEach((r: any) => {
    console.log(`    portfolio_id=${r.portfolio_id ?? 'NULL'}: ${r.count} hedges`);
  });

  process.exit(0);
}

backfillPortfolioIds().catch(e => {
  console.error('❌ Backfill failed:', e);
  process.exit(1);
});
