// Comprehensive pool P&L analysis from on-chain events
const PKG = '0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88';
const POOL = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
const RPC = 'https://fullnode.mainnet.sui.io';

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await r.json()).result;
}

async function pageEvents() {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const r = await rpc('suix_queryEvents', [
      { MoveModule: { package: PKG, module: 'community_pool_usdc' } },
      cursor,
      50,
      false, // ascending = oldest first
    ]);
    if (!r?.data?.length) break;
    all.push(...r.data);
    if (!r.hasNextPage) break;
    cursor = r.nextCursor;
  }
  return all;
}

const events = await pageEvents();
console.log(`Total events: ${events.length}`);

const buckets = {};
let totalDeposit = 0n, totalWithdraw = 0n, totalHedgePnl = 0n, hedgeProfit = 0n, hedgeLoss = 0n, totalFees = 0n;
let openCount = 0, closeCount = 0, profitCount = 0, lossCount = 0, zeroPnlCount = 0;
// Pair opens to closes by hedge_id so we can filter dust closes for a meaningful win-rate.
const openCollateralById = new Map();
let mProfitCount = 0, mLossCount = 0, mZeroCount = 0; // m = meaningful (collateral >= MIN_USDC_RAW)
const MIN_USDC_RAW = 100_000n; // $0.10 dust floor
let firstTs = Infinity, lastTs = 0;

for (const e of events) {
  const t = e.type.split('::').pop();
  buckets[t] = (buckets[t] || 0) + 1;
  const ts = Number(e.timestampMs || 0);
  firstTs = Math.min(firstTs, ts);
  lastTs = Math.max(lastTs, ts);
  const p = e.parsedJson || {};
  if (t === 'UsdcDeposited') totalDeposit += BigInt(p.amount || p.amount_usdc || 0);
  if (t === 'UsdcWithdrawn' || t === 'UsdcWithdrew') totalWithdraw += BigInt(p.amount || p.amount_usdc || p.net_amount || 0);
  if (t === 'UsdcHedgeOpened') {
    openCount++;
    if (Array.isArray(p.hedge_id)) openCollateralById.set(p.hedge_id.join(','), BigInt(p.collateral_usdc || 0));
  }
  if (t === 'UsdcHedgeClosed') {
    closeCount++;
    const pnl = BigInt(p.pnl_usdc || 0);
    const key = Array.isArray(p.hedge_id) ? p.hedge_id.join(',') : '';
    const coll = openCollateralById.get(key) ?? 0n;
    const meaningful = coll >= MIN_USDC_RAW;
    if (p.is_profit) {
      hedgeProfit += pnl; profitCount++; totalHedgePnl += pnl;
      if (meaningful) mProfitCount++;
    } else if (pnl > 0n) {
      hedgeLoss += pnl; lossCount++; totalHedgePnl -= pnl;
      if (meaningful) mLossCount++;
    } else {
      zeroPnlCount++;
      if (meaningful) mZeroCount++;
    }
  }
  if (t.includes('Fee')) totalFees += BigInt(p.amount || p.fee || p.fees_collected || 0);
}

console.log('\n--- Event types ---');
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

console.log('\n--- Cumulative cash flows (from events) ---');
console.log(`Deposited: $${(Number(totalDeposit) / 1e6).toFixed(6)}`);
console.log(`Withdrawn: $${(Number(totalWithdraw) / 1e6).toFixed(6)}`);
console.log(`Net deposits: $${(Number(totalDeposit - totalWithdraw) / 1e6).toFixed(6)}`);

console.log('\n--- Hedge results (raw, includes dust) ---');
console.log(`Opens: ${openCount}, Closes: ${closeCount}`);
console.log(`Profitable closes: ${profitCount} ($${(Number(hedgeProfit) / 1e6).toFixed(6)})`);
console.log(`Losing closes: ${lossCount} ($${(Number(hedgeLoss) / 1e6).toFixed(6)})`);
console.log(`Zero-PnL closes: ${zeroPnlCount}`);
console.log(`Net hedge PnL: $${(Number(totalHedgePnl) / 1e6).toFixed(6)}`);

console.log('\n--- Hedge results (meaningful only, collateral >= $0.10) ---');
const mTotal = mProfitCount + mLossCount + mZeroCount;
const mWinRate = mTotal > 0 ? (mProfitCount / mTotal * 100).toFixed(1) : 'n/a';
console.log(`Meaningful closes: ${mTotal}`);
console.log(`  Wins: ${mProfitCount}`);
console.log(`  Losses: ${mLossCount}`);
console.log(`  Flat: ${mZeroCount}`);
console.log(`Meaningful win rate: ${mWinRate}%`);
console.log(`Dust-only closes filtered out: ${closeCount - mTotal}`);

// Fetch current state for NAV
const obj = await rpc('sui_getObject', [POOL, { showContent: true }]);
const f = obj.data.content.fields;
const vault = BigInt(f.balance);
const shares = BigInt(f.total_shares);
const tdep = BigInt(f.total_deposited);
const twit = BigInt(f.total_withdrawn);
const mgmt = BigInt(f.accumulated_management_fees);
const perf = BigInt(f.accumulated_performance_fees);
const ath = Number(f.all_time_high_nav_per_share) / 1e6;
let activeColl = 0n;
for (const h of (f.hedge_state?.fields?.active_hedges || [])) activeColl += BigInt(h.fields.collateral_usdc);
const totalNav = vault + activeColl;

console.log('\n--- Current pool state ---');
console.log(`USDC vault: $${(Number(vault) / 1e6).toFixed(6)}`);
console.log(`Active hedge collateral: $${(Number(activeColl) / 1e6).toFixed(6)}`);
console.log(`Total NAV: $${(Number(totalNav) / 1e6).toFixed(6)}`);
console.log(`Total shares outstanding: ${(Number(shares) / 1e6).toFixed(6)}`);
console.log(`NAV per share: $${(Number(totalNav) / Number(shares)).toFixed(6)}`);
console.log(`All-time-high NAV/share: $${ath.toFixed(6)}`);
console.log(`Pool-tracked deposits: $${(Number(tdep) / 1e6).toFixed(6)}`);
console.log(`Pool-tracked withdrawals: $${(Number(twit) / 1e6).toFixed(6)}`);
console.log(`Accumulated mgmt fees: $${(Number(mgmt) / 1e6).toFixed(6)}`);
console.log(`Accumulated perf fees: $${(Number(perf) / 1e6).toFixed(6)}`);

console.log('\n--- PROFIT/LOSS ANALYSIS ---');
const netDeposits = tdep - twit;
const profit = totalNav - netDeposits;
const profitPct = Number(profit) / Number(netDeposits) * 100;
console.log(`Net deposits (on-chain): $${(Number(netDeposits) / 1e6).toFixed(6)}`);
console.log(`Current total NAV:       $${(Number(totalNav) / 1e6).toFixed(6)}`);
console.log(`Apparent P&L:            $${(Number(profit) / 1e6).toFixed(6)}  (${profitPct.toFixed(2)}%)`);
console.log(`From hedging activity:   $${(Number(totalHedgePnl) / 1e6).toFixed(6)}`);
console.log(`Unaccounted (deposits not via deposit fn?): $${(Number(profit - totalHedgePnl) / 1e6).toFixed(6)}`);

const span = (lastTs - firstTs) / 86400000;
console.log(`\nEvent timespan: ${span.toFixed(2)} days (${new Date(firstTs).toISOString().slice(0,10)} → ${new Date(lastTs).toISOString().slice(0,10)})`);
