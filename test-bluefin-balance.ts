/** Inspect full BlueFin account balance (not just freeCollateral). */
import 'dotenv/config';
import { BluefinService } from './lib/services/sui/BluefinService';
async function main() {
  const key = (process.env.BLUEFIN_PRIVATE_KEY || '').trim();
  const bf = BluefinService.getInstance();
  if (!bf.isInitialized()) await bf.initialize(key, 'mainnet');
  // Try the proper exchange endpoint that shows total wallet balance
  const acct: any = await (bf as any).apiRequest(
    'GET', `/api/v1/account?accountAddress=${bf.getAddress()}`, undefined, 'exchange'
  );
  console.log('=== /api/v1/account ===');
  console.log(JSON.stringify(acct, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
