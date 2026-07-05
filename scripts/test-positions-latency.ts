/**
 * Time the lightweight SUI /positions path against production RPC. We're
 * not importing the route (would drag in Next request handling); we
 * replicate the exact fetch pattern the route does.
 */

const ADDRESS = process.argv[2] || '0x880cfa491c497f5f3c8205ef43a9e1d4cd89169a20c708ab27676ec1fe7e8aac';
const RPC = 'https://fullnode.mainnet.sui.io:443';
const POOL_STATE = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';

async function rpcCall(method: string, params: unknown[]) {
  return fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then(r => r.json());
}

async function main() {
  const t0 = Date.now();

  const [poolStateRes, externalNavRes, balancesRes] = await Promise.all([
    rpcCall('sui_getObject', [POOL_STATE, { showContent: true }]),
    rpcCall('suix_getDynamicFieldObject', [POOL_STATE, { type: 'vector<u8>', value: Array.from(Buffer.from('external_nav_usdc')) }]),
    rpcCall('suix_getAllBalances', [ADDRESS]),
  ]);
  const parallelDone = Date.now();
  console.log(`3-way Promise.all RPC: ${parallelDone - t0}ms`);

  const fields = (poolStateRes as any).result?.data?.content?.fields;
  const membersTableId = fields?.members?.fields?.id?.id;
  const balanceValue = typeof fields?.balance === 'string'
    ? fields.balance
    : (fields?.balance?.fields?.value || fields?.balance?.value || '0');
  const externalNavValue = (externalNavRes as any).result?.data?.content?.fields?.value || '0';
  const totalSharesRaw = BigInt(fields?.total_shares || '0');

  const poolBalanceUsdc = Number(balanceValue) / 1e6;
  const externalNavUsdc = Number(externalNavValue) / 1e6;
  const totalNAVUsdc = poolBalanceUsdc + externalNavUsdc;
  const sharePrice = totalSharesRaw > 0n ? totalNAVUsdc / (Number(totalSharesRaw) / 1e6) : 1;

  console.log(`  poolBalance:   $${poolBalanceUsdc.toFixed(6)}`);
  console.log(`  externalNav:   $${externalNavUsdc.toFixed(6)}`);
  console.log(`  totalNAV:      $${totalNAVUsdc.toFixed(6)}`);
  console.log(`  totalShares:   ${(Number(totalSharesRaw) / 1e6).toFixed(6)}`);
  console.log(`  sharePrice:    $${sharePrice.toFixed(6)}`);

  if (membersTableId) {
    const t1 = Date.now();
    const memberRes = await rpcCall('suix_getDynamicFieldObject', [membersTableId, { type: 'address', value: ADDRESS }]);
    console.log(`Member lookup: ${Date.now() - t1}ms`);
    const mf = (memberRes as any).result?.data?.content?.fields?.value?.fields
      || (memberRes as any).result?.data?.content?.fields;
    const memberSharesRaw = BigInt(mf?.shares || '0');
    const shares = Number(memberSharesRaw) / 1e6;
    console.log(`  member shares: ${shares.toFixed(6)}  value: $${(shares * sharePrice).toFixed(6)}`);
  }

  const balances = ((balancesRes as any).result || []) as Array<{ coinType: string; totalBalance: string }>;
  console.log(`  wallet balances: ${balances.length} coin types`);

  console.log(`TOTAL: ${Date.now() - t0}ms`);
}

main().catch(err => { console.error(err); process.exit(1); });
