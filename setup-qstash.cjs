/**
 * QStash Schedule Setup Script
 * 
 * Creates QStash schedules for the master cron orchestrator.
 * The master cron chains all sub-crons internally, so only ONE QStash schedule is needed.
 * 
 * Usage:
 *   1. Set QSTASH_TOKEN in .env.local (get from console.upstash.com → QStash)
 *   2. Run: node setup-qstash.cjs
 *   3. Also add QSTASH_TOKEN to Vercel: npx vercel env add QSTASH_TOKEN
 * 
 * QStash Free Tier: 500 messages/day
 * Master cron every 5 min = 288 messages/day (well within limits)
 */
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

function getEnv(key) {
  const match = envContent.match(new RegExp(`${key}=["']?([^"'\\r\\n]+)["']?`));
  return match ? match[1].trim() : process.env[key];
}

const QSTASH_TOKEN = getEnv('QSTASH_TOKEN');
const QSTASH_URL = getEnv('QSTASH_URL') || 'https://qstash.upstash.io';
if (!QSTASH_TOKEN) {
  console.error('❌ QSTASH_TOKEN not found in .env.local');
  console.error('   Get it from: https://console.upstash.com → QStash → REST API → QSTASH_TOKEN');
  console.error('   Add to .env.local: QSTASH_TOKEN=your_token_here');
  process.exit(1);
}

const BASE_URL = 'https://www.zkvanguard.xyz';
const CRON_SECRET = getEnv('CRON_SECRET') || '';

// Schedules to create
// On Hobby plan, master cron can timeout (60s limit, 9 sub-tasks × 25s each)
// So we schedule the critical crons individually via QStash at appropriate intervals
// QStash free tier: 500 messages/day
const SCHEDULES = [
  {
    name: 'SUI Community Pool (AI + Swaps + Hedges)',
    destination: `${BASE_URL}/api/cron/sui-community-pool`,
    cron: '*/30 * * * *',  // every 30 minutes
    retries: 2,
    // 48 messages/day
  },
  {
    name: 'Pool NAV Monitor (Drawdown Alerts)',
    destination: `${BASE_URL}/api/cron/pool-nav-monitor`,
    cron: '*/15 * * * *',  // every 15 minutes
    retries: 1,
    // 96 messages/day
  },
  {
    name: 'Hedge Monitor (Stop-loss/Take-profit)',
    destination: `${BASE_URL}/api/cron/hedge-monitor`,
    cron: '*/15 * * * *',  // every 15 minutes
    retries: 1,
    // 96 messages/day
  },
  {
    name: 'Liquidation Guard',
    destination: `${BASE_URL}/api/cron/liquidation-guard`,
    cron: '*/10 * * * *',  // every 10 minutes
    retries: 1,
    // 144 messages/day
  },
  // Total: ~384 messages/day (under 500 free tier limit)
  // Master cron still available as manual fallback: /api/cron/master
];

async function listExistingSchedules() {
  const res = await fetch(`${QSTASH_URL}/v2/schedules`, {
    headers: { Authorization: `Bearer ${QSTASH_TOKEN}` },
  });
  if (!res.ok) {
    console.error(`Failed to list schedules: ${res.status} ${await res.text()}`);
    return [];
  }
  return res.json();
}

async function deleteSchedule(scheduleId) {
  const res = await fetch(`${QSTASH_URL}/v2/schedules/${scheduleId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${QSTASH_TOKEN}` },
  });
  return res.ok;
}

async function createSchedule(schedule) {
  const res = await fetch(`${QSTASH_URL}/v2/schedules/${schedule.destination}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      'Content-Type': 'application/json',
      'Upstash-Cron': schedule.cron,
      'Upstash-Retries': String(schedule.retries || 3),
      'Upstash-Forward-Authorization': `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create schedule: ${res.status} ${text}`);
  }

  return res.json();
}

async function main() {
  console.log('🔧 QStash Schedule Setup');
  console.log('========================\n');

  // 1. List existing schedules
  console.log('📋 Checking existing schedules...');
  const existing = await listExistingSchedules();
  
  if (existing.length > 0) {
    console.log(`  Found ${existing.length} existing schedule(s):`);
    for (const s of existing) {
      console.log(`    - ${s.scheduleId}: ${s.destination} (${s.cron})`);
    }
    
    // Remove old schedules targeting our endpoints
    for (const s of existing) {
      if (s.destination && s.destination.includes('zkvanguard')) {
        console.log(`  🗑️  Removing old schedule: ${s.scheduleId}`);
        await deleteSchedule(s.scheduleId);
      }
    }
    console.log();
  } else {
    console.log('  No existing schedules found.\n');
  }

  // 2. Create new schedules
  console.log('📅 Creating QStash schedules...\n');

  for (const schedule of SCHEDULES) {
    try {
      console.log(`  Creating: ${schedule.name}`);
      console.log(`    URL:  ${schedule.destination}`);
      console.log(`    Cron: ${schedule.cron}`);
      
      const result = await createSchedule(schedule);
      console.log(`    ✅ Created! Schedule ID: ${result.scheduleId}\n`);
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}\n`);
    }
  }

  // 3. Verify
  console.log('📋 Verifying final schedules...');
  const final = await listExistingSchedules();
  console.log(`  Total active schedules: ${final.length}`);
  for (const s of final) {
    console.log(`    ✅ ${s.scheduleId}: ${s.destination} → ${s.cron}`);
  }

  console.log('\n========================');
  console.log('✅ QStash setup complete!');
  console.log('\nMessage budget: ~384/day (4 schedules at varying intervals)');
  console.log('Free tier limit: 500/day — you have ~116 messages headroom');
  console.log('\nSchedule summary:');
  console.log('  SUI Pool AI+Swaps+Hedges: every 30 min (48/day)');
  console.log('  NAV Monitor:              every 15 min (96/day)');
  console.log('  Hedge Monitor:            every 15 min (96/day)');
  console.log('  Liquidation Guard:        every 10 min (144/day)');
  console.log('\nReminder: Also add QSTASH_TOKEN to Vercel:');
  console.log('  npx vercel env add QSTASH_TOKEN');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
