#!/usr/bin/env npx tsx
/**
 * Verify the SUI_AUTO_HEDGE_DISABLE emergency stop on the deployed sui-community-pool cron.
 *
 * Procedure (operator runs steps 1-3 in Vercel, this script runs the GETs):
 *   1. Set SUI_AUTO_HEDGE_DISABLE=1 in Vercel production env. Redeploy.
 *   2. Wait for next deploy to go live (~1-2 min).
 *   3. Run this script with FLAG=disabled. It triggers the cron via GET with
 *      CRON_SECRET and confirms the response contains either:
 *        - `autoHedge: { triggered: false }` OR
 *        - log line "Auto-hedge disabled by SUI_AUTO_HEDGE_DISABLE=1" (response body)
 *   4. Unset SUI_AUTO_HEDGE_DISABLE in Vercel. Redeploy.
 *   5. Run this script with FLAG=enabled to confirm the cron resumes normal flow.
 *
 * The script does NOT modify Vercel env — that's an operator action.
 * It only inspects the live response.
 *
 * Usage:
 *   FLAG=disabled bun run scripts/verify-auto-hedge-killswitch.ts
 *   FLAG=enabled  bun run scripts/verify-auto-hedge-killswitch.ts
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

const PROD_URL = (process.env.PROD_URL || 'https://zkvanguard.vercel.app').replace(/\/$/, '');
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
const FLAG = (process.env.FLAG || 'disabled').toLowerCase();

async function main() {
  if (!CRON_SECRET) {
    console.error('CRON_SECRET not set in .env.local — required to trigger the cron');
    process.exit(1);
  }
  if (!['disabled', 'enabled'].includes(FLAG)) {
    console.error(`FLAG must be 'disabled' or 'enabled' — got ${FLAG}`);
    process.exit(1);
  }

  const url = `${PROD_URL}/api/cron/sui-community-pool`;
  console.log(`[verify-killswitch] FLAG=${FLAG}`);
  console.log(`[verify-killswitch] GET ${url}`);

  const start = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(70_000),
  });
  const duration = Date.now() - start;
  const body = await res.text();
  console.log(`[verify-killswitch] ${res.status} in ${duration}ms`);

  let json: any = null;
  try { json = JSON.parse(body); } catch {}

  // Look for the killswitch indicator in either structured response OR log-style body
  const bodyLower = body.toLowerCase();
  const triggered = json?.autoHedge?.triggered;
  const hasDisabledLine = bodyLower.includes('auto_hedge_disable') || bodyLower.includes('auto-hedge disabled');

  if (FLAG === 'disabled') {
    if (triggered === false || hasDisabledLine) {
      console.log('  ✓ Killswitch held: auto-hedge did NOT trigger');
      process.exit(0);
    }
    console.log('  ✗ FAILED: response did not show auto-hedge as disabled');
    console.log('    body preview:', body.slice(0, 800));
    process.exit(1);
  } else {
    if (triggered === true || (json && 'autoHedge' in json)) {
      console.log('  ✓ Normal flow: auto-hedge attempted (triggered=' + triggered + ')');
      process.exit(0);
    }
    if (triggered === false && !hasDisabledLine) {
      console.log('  ✓ Cron ran but auto-hedge not triggered (likely below MIN_NAV_USD floor or risk-gate)');
      console.log('    detail:', json?.error || 'no autoHedge block');
      process.exit(0);
    }
    console.log('  ⚠ Cron ran but state unclear');
    console.log('    body preview:', body.slice(0, 800));
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
