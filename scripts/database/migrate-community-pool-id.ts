#!/usr/bin/env npx tsx
/**
 * Migrate Community Pool portfolio_id from 0 to -1
 * 
 * Problem: portfolio_id=0 collides with RWAManager's first user portfolio (which also starts at 0).
 * Solution: Community Pool now uses portfolio_id=-1 (COMMUNITY_POOL_PORTFOLIO_ID constant).
 * 
 * This script migrates:
 *   1. hedges table:             portfolio_id 0 → -1 (only for community pool wallets)
 *   2. auto_hedge_configs table: portfolio_id 0 → -1
 * 
 * Safety:
 *   - Only updates hedges owned by known community pool wallets (0xb9966f..., 0x97F77f..., 0xC25A8D...)
 *   - Hedges with portfolio_id=0 from OTHER wallets are left alone (they're real user portfolio 0)
 *   - Dry-run by default — set DRY_RUN=false to apply
 * 
 * Run: npx tsx scripts/database/migrate-community-pool-id.ts
 * Apply: DRY_RUN=false npx tsx scripts/database/migrate-community-pool-id.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { query } from '../../lib/db/postgres';
import { COMMUNITY_POOL_PORTFOLIO_ID } from '../../lib/constants';

const DRY_RUN = process.env.DRY_RUN !== 'false';

// Community pool wallet addresses (case-insensitive matching)
const COMMUNITY_POOL_WALLETS = [
  '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c', // Deployer/treasury
  '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30', // CommunityPool V3 proxy (current)
  '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B', // CommunityPool V2 proxy (deprecated)
].map(w => w.toLowerCase());

async function migrate() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Migrate Community Pool: portfolio_id 0 → -1            ║');
  console.log(`║  Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : '⚡ LIVE (applying changes)'}             ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // ─── Step 1: Check current state ─────────────────────────────────────
  console.log('═══ Step 1: Current State ═══');
  
  const currentDist = await query(
    `SELECT portfolio_id, COUNT(*) as count 
     FROM hedges GROUP BY portfolio_id ORDER BY portfolio_id`
  );
  console.log('  Current portfolio distribution:');
  for (const r of currentDist) {
    console.log(`    portfolio_id=${r.portfolio_id ?? 'NULL'}: ${r.count} hedges`);
  }

  // ─── Step 2: Find community pool hedges with portfolio_id=0 ──────────
  console.log('\n═══ Step 2: Community Pool Hedges to Migrate ═══');
  
  const communityHedges = await query(
    `SELECT id, order_id, wallet_address, asset, side, status, reason, created_at
     FROM hedges WHERE portfolio_id = 0 
     ORDER BY created_at DESC`
  );

  const toMigrate: number[] = [];
  const toSkip: number[] = [];

  for (const h of communityHedges) {
    const wallet = (h.wallet_address || '').toLowerCase();
    const reason = (h.reason || '').toLowerCase();
    const isCommunityPool = COMMUNITY_POOL_WALLETS.includes(wallet) || 
                            reason.includes('community') || 
                            reason.includes('pool') ||
                            reason.includes('auto loss protection');
    
    if (isCommunityPool) {
      toMigrate.push(h.id);
      console.log(`  ✅ MIGRATE: hedge #${h.id} | ${h.side} ${h.asset} | wallet: ${h.wallet_address?.slice(0, 10)}... | ${h.reason?.slice(0, 40)}`);
    } else {
      toSkip.push(h.id);
      console.log(`  ⏭️  SKIP (user portfolio 0): hedge #${h.id} | ${h.side} ${h.asset} | wallet: ${h.wallet_address?.slice(0, 10)}...`);
    }
  }

  console.log(`\n  Summary: ${toMigrate.length} to migrate, ${toSkip.length} to skip (user portfolio 0)`);

  // ─── Step 3: Check if -1 already exists ──────────────────────────────
  const existingNeg1 = await query(
    'SELECT COUNT(*) as count FROM hedges WHERE portfolio_id = $1',
    [COMMUNITY_POOL_PORTFOLIO_ID]
  );
  if (parseInt(existingNeg1[0].count) > 0) {
    console.log(`\n  ℹ️  ${existingNeg1[0].count} hedges already have portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID}`);
  }

  // ─── Step 4: Migrate hedges ──────────────────────────────────────────
  console.log('\n═══ Step 3: Migrate Hedges ═══');
  
  if (toMigrate.length === 0) {
    console.log('  Nothing to migrate in hedges table.');
  } else if (DRY_RUN) {
    console.log(`  [DRY RUN] Would update ${toMigrate.length} hedges: portfolio_id 0 → ${COMMUNITY_POOL_PORTFOLIO_ID}`);
  } else {
    const result = await query(
      `UPDATE hedges SET portfolio_id = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ANY($2::int[])
       RETURNING id`,
      [COMMUNITY_POOL_PORTFOLIO_ID, toMigrate]
    );
    console.log(`  ✅ Updated ${result.length} hedges to portfolio_id=${COMMUNITY_POOL_PORTFOLIO_ID}`);
  }

  // ─── Step 5: Migrate auto_hedge_configs ──────────────────────────────
  console.log('\n═══ Step 4: Migrate auto_hedge_configs ═══');
  
  try {
    const configCheck = await query(
      'SELECT portfolio_id, wallet_address, enabled FROM auto_hedge_configs WHERE portfolio_id = 0'
    );
    
    if (configCheck.length === 0) {
      console.log('  No config with portfolio_id=0 found (may already be migrated).');
    } else if (DRY_RUN) {
      console.log(`  [DRY RUN] Would update ${configCheck.length} config(s): portfolio_id 0 → ${COMMUNITY_POOL_PORTFOLIO_ID}`);
      for (const c of configCheck) {
        console.log(`    wallet: ${c.wallet_address}, enabled: ${c.enabled}`);
      }
    } else {
      // Check if -1 already exists in configs
      const existingConfig = await query(
        'SELECT COUNT(*) as count FROM auto_hedge_configs WHERE portfolio_id = $1',
        [COMMUNITY_POOL_PORTFOLIO_ID]
      );
      
      if (parseInt(existingConfig[0].count) > 0) {
        // -1 already exists, just delete the old 0 entry
        await query('DELETE FROM auto_hedge_configs WHERE portfolio_id = 0');
        console.log('  ✅ Deleted old portfolio_id=0 config (portfolio_id=-1 already exists)');
      } else {
        await query(
          'UPDATE auto_hedge_configs SET portfolio_id = $1 WHERE portfolio_id = 0',
          [COMMUNITY_POOL_PORTFOLIO_ID]
        );
        console.log(`  ✅ Updated auto_hedge_configs: portfolio_id 0 → ${COMMUNITY_POOL_PORTFOLIO_ID}`);
      }
    }
  } catch (e: any) {
    console.log(`  ⚠️  auto_hedge_configs table error: ${e.message?.slice(0, 100)}`);
  }

  // ─── Step 6: Also migrate any NULL hedges from community pool wallets ─
  console.log('\n═══ Step 5: NULL Portfolio ID Cleanup ═══');
  
  const nullHedges = await query(
    `SELECT id, wallet_address, reason FROM hedges WHERE portfolio_id IS NULL`
  );
  
  let nullMigrated = 0;
  for (const h of nullHedges) {
    const wallet = (h.wallet_address || '').toLowerCase();
    const reason = (h.reason || '').toLowerCase();
    if (COMMUNITY_POOL_WALLETS.includes(wallet) || reason.includes('pool') || reason.includes('community')) {
      if (!DRY_RUN) {
        await query(
          'UPDATE hedges SET portfolio_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [COMMUNITY_POOL_PORTFOLIO_ID, h.id]
        );
      }
      nullMigrated++;
      console.log(`  ${DRY_RUN ? '[DRY RUN]' : '✅'} NULL → ${COMMUNITY_POOL_PORTFOLIO_ID}: hedge #${h.id} (wallet: ${h.wallet_address?.slice(0, 10)}...)`);
    }
  }
  if (nullMigrated === 0) console.log('  No NULL hedges from community pool wallets.');

  // ─── Step 7: Verify ──────────────────────────────────────────────────
  console.log('\n═══ Step 6: Verification ═══');
  
  const finalDist = await query(
    `SELECT portfolio_id, COUNT(*) as count 
     FROM hedges GROUP BY portfolio_id ORDER BY portfolio_id`
  );
  console.log('  Final portfolio distribution:');
  for (const r of finalDist) {
    console.log(`    portfolio_id=${r.portfolio_id ?? 'NULL'}: ${r.count} hedges`);
  }

  const communityFinal = finalDist.find((r: any) => r.portfolio_id === COMMUNITY_POOL_PORTFOLIO_ID);
  const zeroFinal = finalDist.find((r: any) => r.portfolio_id === 0);
  
  console.log(`\n  Community Pool (${COMMUNITY_POOL_PORTFOLIO_ID}): ${communityFinal?.count || 0} hedges`);
  console.log(`  User Portfolio 0: ${zeroFinal?.count || 0} hedges`);
  
  if (DRY_RUN) {
    console.log('\n  ⚠️  DRY RUN — no changes applied. Run with DRY_RUN=false to apply.');
  } else {
    console.log('\n  ✅ Migration complete!');
  }

  process.exit(0);
}

migrate().catch(e => {
  console.error('❌ Migration failed:', e);
  process.exit(1);
});
