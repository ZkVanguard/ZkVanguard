#!/usr/bin/env node
/**
 * Setup Upstash QStash Schedules
 * 
 * Replaces Vercel Cron Jobs with QStash schedules for much higher frequency.
 * Free tier: 500 messages/day — our config uses ~384/day.
 * 
 * Schedules:
 *   Master Cron:      every 5 min  (288/day) — orchestrates all sub-crons
 *   --- OR individual schedules (uncomment below) ---
 *   Community Pool:   every 30 min (48/day)
 *   Pool NAV Monitor: every 15 min (96/day)
 *   Auto Rebalance:   every 15 min (96/day)
 *   Hedge Monitor:    every 15 min (96/day)
 *   Liquidation Guard:every 10 min (144/day)
 *   Total individual:            ~480/day (within 500 free tier)
 * 
 * Prerequisites:
 *   1. Create free account at https://console.upstash.com
 *   2. Go to QStash tab → copy your QSTASH_TOKEN
 *   3. Set environment variables (locally or in Vercel):
 *      - QSTASH_TOKEN
 *      - QSTASH_CURRENT_SIGNING_KEY  
 *      - QSTASH_NEXT_SIGNING_KEY
 * 
 * Usage:
 *   node scripts/setup-qstash-schedules.js
 *   node scripts/setup-qstash-schedules.js --individual   # Setup per-cron schedules
 *   node scripts/setup-qstash-schedules.js --list         # List existing schedules
 *   node scripts/setup-qstash-schedules.js --delete-all   # Remove all schedules
 */

const BASE_URL = process.env.BASE_URL 
  || process.env.APP_URL 
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  || 'https://zkvanguard.xyz';

// Use region-specific URL (us-east-1 for this account)
const QSTASH_API = process.env.QSTASH_URL 
  ? `${process.env.QSTASH_URL}/v2`
  : 'https://qstash.upstash.io/v2';

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

if (!QSTASH_TOKEN) {
  console.error('❌ QSTASH_TOKEN environment variable is required');
  console.error('   Get it from: https://console.upstash.com → QStash → Token');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${QSTASH_TOKEN}`,
  'Content-Type': 'application/json',
};

// ── Schedule Configurations ──────────────────────────────────

const MASTER_SCHEDULE = {
  destination: `${BASE_URL}/api/cron/master`,
  cron: '*/5 * * * *', // Every 5 minutes
  retries: 3,
  // Callback for failure notifications (optional)
  // failureCallback: `${BASE_URL}/api/webhooks/qstash-failure`,
};

const INDIVIDUAL_SCHEDULES = [
  {
    name: 'Pyth Price Update',
    destination: `${BASE_URL}/api/cron/pyth-update`,
    cron: '*/30 * * * *', // Every 30 minutes - keep oracle prices fresh
    retries: 3,
  },
  {
    name: 'Community Pool',
    destination: `${BASE_URL}/api/cron/community-pool`,
    cron: '*/30 * * * *', // Every 30 minutes
    retries: 3,
  },
  {
    name: 'SUI Community Pool',
    destination: `${BASE_URL}/api/cron/sui-community-pool`,
    cron: '*/30 * * * *', // Every 30 minutes — USDC pool AI management
    retries: 3,
  },
  {
    name: 'Pool NAV Monitor',
    destination: `${BASE_URL}/api/cron/pool-nav-monitor`,
    cron: '*/15 * * * *', // Every 15 minutes
    retries: 3,
  },
  {
    name: 'Auto Rebalance',
    destination: `${BASE_URL}/api/cron/auto-rebalance`,
    cron: '*/15 * * * *', // Every 15 minutes
    retries: 3,
  },
  {
    name: 'Hedge Monitor',
    destination: `${BASE_URL}/api/cron/hedge-monitor`,
    cron: '*/15 * * * *', // Every 15 minutes
    retries: 3,
  },
  {
    name: 'Liquidation Guard',
    destination: `${BASE_URL}/api/cron/liquidation-guard`,
    cron: '*/10 * * * *', // Every 10 minutes
    retries: 3,
  },
];

// ── API Helpers ──────────────────────────────────────────────

async function createSchedule(config) {
  const { destination, cron, retries } = config;
  const name = config.name || 'Master Cron';

  console.log(`📅 Creating schedule: ${name}`);
  console.log(`   URL:  ${destination}`);
  console.log(`   Cron: ${cron}`);

  // QStash expects destination in URL path (not encoded)
  const response = await fetch(`${QSTASH_API}/schedules/${destination}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Upstash-Cron': cron,
      'Upstash-Retries': String(retries || 3),
      'Upstash-Method': 'GET',
      'Upstash-Timeout': '300s', // 5 min timeout
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`   ❌ Failed: ${response.status} ${error}`);
    return null;
  }

  const result = await response.json();
  console.log(`   ✅ Created: scheduleId=${result.scheduleId}`);
  return result;
}

async function listSchedules() {
  const response = await fetch(`${QSTASH_API}/schedules`, { headers });
  
  if (!response.ok) {
    console.error(`❌ Failed to list schedules: ${response.status}`);
    return [];
  }

  const schedules = await response.json();
  
  if (schedules.length === 0) {
    console.log('📭 No schedules found');
    return [];
  }

  console.log(`\n📋 Found ${schedules.length} schedule(s):\n`);
  for (const s of schedules) {
    console.log(`  ID:    ${s.scheduleId}`);
    console.log(`  URL:   ${s.destination}`);
    console.log(`  Cron:  ${s.cron}`);
    console.log(`  State: ${s.isPaused ? '⏸️  Paused' : '▶️  Active'}`);
    console.log('');
  }

  return schedules;
}

async function deleteAllSchedules() {
  const schedules = await listSchedules();
  
  if (schedules.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  for (const s of schedules) {
    const response = await fetch(`${QSTASH_API}/schedules/${s.scheduleId}`, {
      method: 'DELETE',
      headers,
    });

    if (response.ok) {
      console.log(`🗑️  Deleted: ${s.scheduleId} (${s.destination})`);
    } else {
      console.error(`❌ Failed to delete ${s.scheduleId}: ${response.status}`);
    }
  }

  console.log('\n✅ All schedules deleted');
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Upstash QStash Schedule Manager         ║');
  console.log('║     Chronos Vanguard — Auto-Hedging         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\nBase URL: ${BASE_URL}\n`);

  if (args.includes('--list')) {
    await listSchedules();
    return;
  }

  if (args.includes('--delete-all')) {
    await deleteAllSchedules();
    return;
  }

  if (args.includes('--individual')) {
    // Create individual schedules for each cron job
    console.log('🔧 Setting up INDIVIDUAL schedules (5 crons)\n');
    
    // First clean up existing
    const existing = await listSchedules();
    if (existing.length > 0) {
      console.log('Cleaning up existing schedules...\n');
      await deleteAllSchedules();
      console.log('');
    }

    let created = 0;
    for (const config of INDIVIDUAL_SCHEDULES) {
      const result = await createSchedule(config);
      if (result) created++;
      console.log('');
    }

    console.log(`\n✅ Created ${created}/${INDIVIDUAL_SCHEDULES.length} individual schedules`);
    console.log(`📊 Estimated daily messages: ~480/500 (free tier)\n`);
  } else {
    // Default: Create master schedule only
    console.log('🔧 Setting up MASTER schedule (1 cron → chains all sub-tasks)\n');
    
    // First clean up existing
    const existing = await listSchedules();
    if (existing.length > 0) {
      console.log('Cleaning up existing schedules...\n');
      await deleteAllSchedules();
      console.log('');
    }

    const result = await createSchedule(MASTER_SCHEDULE);
    
    if (result) {
      console.log(`\n✅ Master schedule created!`);
      console.log(`📊 Estimated daily messages: ~288/500 (free tier)`);
      console.log(`\n⏰ Your crons will now run every 5 minutes — 144x more frequent than before!\n`);
    }
  }

  // Print required env vars reminder
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Required Vercel Environment Variables:');
  console.log('  QSTASH_TOKEN                  (set ✅)');
  console.log('  QSTASH_CURRENT_SIGNING_KEY    (check Upstash Console → QStash → Signing Keys)');
  console.log('  QSTASH_NEXT_SIGNING_KEY       (check Upstash Console → QStash → Signing Keys)');
  console.log('  CRON_SECRET                   (keep for internal route-to-route auth)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
