/**
 * One-time cleanup script: close bugged legacy hedges in DB.
 * These were created before the collateral conversion fix and have wrong amounts.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env vars from .env.local 
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { closeOnChainHedge } from '../lib/db/hedges';

const BUGGED_HEDGE_IDS = [
  '0xd33a27de5ef3aa9b7d05dc22fa7fb091a1b2ebbee0d2112be8e6304ea35f610e', // SHORT CRO 391,696 USDC (should've been ~3,133)
  '0x11f96afc312a2e38b91bb2e021db8d6fe94173cf567d799b5dd2cdd16a23616d', // SHORT ETH 23.32 USDC (should've been ~15,000)
  '0x25152515827e544b672bd6c7a951f1c15b61947a15cf9e83bd59250d1dbaa52b', // SHORT BTC 0.75 USDC (should've been ~10,000)
];

async function main() {
  console.log('Closing', BUGGED_HEDGE_IDS.length, 'bugged legacy hedges...');
  
  for (const hedgeId of BUGGED_HEDGE_IDS) {
    try {
      await closeOnChainHedge(hedgeId, 0);
      console.log('✅ Closed:', hedgeId.slice(0, 18) + '...');
    } catch (err) {
      console.error('❌ Failed:', hedgeId.slice(0, 18), err);
    }
  }
  
  console.log('Done. The resync mechanism will keep DB fresh going forward.');
  process.exit(0);
}

main();
