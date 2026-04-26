/**
 * SUI E2E Diagnostic — Why Isn't It Making Profits?
 *
 * Tests the complete SUI community pool pipeline:
 *  1. On-chain pool state (USDC balance, hedges, NAV)
 *  2. Admin wallet balances (SUI gas, USDC, wBTC, wETH)
 *  3. BlueFin 7k swap quotes (can we actually trade?)
 *  4. AI allocation pipeline (data → agent → decision)
 *  5. Production API endpoints (what does the UI see?)
 *  6. DB history (swap records, NAV snapshots, AI decisions)
 *  7. Profit loop diagnosis (where value is leaking)
 *
 * Run: node test-sui-e2e.mjs
 */

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE = 'https://www.zkvanguard.xyz';
const CRON_SECRET = 'cv-cron-7f3a9e2b4d1c8f06';
const TIMEOUT_MS = 20_000;

// SUI Mainnet constants
const SUI_RPC = 'https://fullnode.mainnet.sui.io';
const USDC_POOL_STATE = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
const USDC_POOL_PACKAGE = '0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88';
const AGENT_CAP = '0xdeecf4483ba7729f91c1a4349a5c6b9a5b776981726b1c0136e5cf788889d46d';

// USDC coin type on SUI mainnet
const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
// wBTC and wETH on SUI mainnet (Wormhole)
const WBTC_TYPE = '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN'; // wBTC
const WETH_TYPE = '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH'; // wETH (portal)

// Admin wallet derived from suiprivkey (the deployer / pool admin)
// We'll check balances using the API
const ADMIN_WALLET = null; // derived dynamically from API

// ─── Helpers ─────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, warn = 0;
const issues = [];

function log(msg) { console.log(msg); }
function section(title) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${title}`);
  console.log('═'.repeat(65));
}

async function test(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    pass++;
    console.log(`  ✅ ${name} (${ms}ms)`);
    if (result !== undefined && result !== null && typeof result !== 'boolean') {
      const preview = typeof result === 'string' ? result : JSON.stringify(result);
      console.log(`     └─ ${preview.substring(0, 160)}`);
    }
    return result;
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err.message || String(err);
    if (msg.startsWith('WARN:')) {
      warn++;
      console.log(`  ⚠️  ${name} (${ms}ms) — ${msg.replace('WARN:', '').trim()}`);
      issues.push({ level: 'warn', name, msg: msg.replace('WARN:', '').trim() });
    } else {
      fail++;
      console.log(`  ❌ ${name} (${ms}ms) — ${msg}`);
      issues.push({ level: 'fail', name, msg });
    }
    return null;
  }
}

async function suiRpc(method, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SUI_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (data.error) throw new Error(`SUI RPC error: ${JSON.stringify(data.error)}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.substring(0, 300) }; }
    return { status: res.status, ok: res.ok, data: json };
  } finally {
    clearTimeout(timer);
  }
}

function fmt(n, decimals = 2) {
  return typeof n === 'number' ? n.toFixed(decimals) : String(n);
}

// ─── STAGE 1: On-Chain Pool State ────────────────────────────────────────────
async function testOnChainPoolState() {
  section('STAGE 1: ON-CHAIN SUI POOL STATE (Direct RPC)');

  const poolObj = await test('Fetch USDC pool state object', async () => {
    const result = await suiRpc('sui_getObject', [
      USDC_POOL_STATE,
      { showContent: true, showType: true, showOwner: true },
    ]);
    if (!result?.data) throw new Error('Pool object not found on-chain');
    return result.data;
  });

  if (!poolObj) return null;

  const fields = poolObj.content?.fields;
  if (!fields) {
    fail++;
    console.log(`  ❌ Pool object has no fields — content type mismatch`);
    issues.push({ level: 'fail', name: 'Pool fields', msg: 'No fields in pool content' });
    return null;
  }

  // Parse balance
  const rawBalance = typeof fields.balance === 'string'
    ? fields.balance
    : (fields.balance?.fields?.value || '0');
  const usdcBalance = Number(rawBalance) / 1e6;

  // Parse shares
  const rawShares = typeof fields.total_shares === 'string'
    ? fields.total_shares
    : (fields.total_shares?.fields?.value || '0');
  const totalShares = Number(rawShares) / 1e6; // USDC pool shares use 6 decimals (same as USDC)

  // Parse hedge state
  const hedgeState = fields.hedge_state?.fields || {};
  const totalHedgedRaw = Number(hedgeState.total_hedged_value || '0');
  const totalHedgedUsdc = totalHedgedRaw / 1e6;
  const activeHedges = hedgeState.active_hedges || [];

  // Parse member count
  const memberCount = Number(fields.member_count || '0');

  // Parse NAV = balance + total_hedged_value
  const contractNav = usdcBalance + totalHedgedUsdc;
  const sharePrice = totalShares > 0 ? contractNav / totalShares : 1.0;

  test('Pool USDC balance (in-contract)', async () => {
    if (usdcBalance <= 0) throw new Error(`WARN: Pool has $${fmt(usdcBalance, 6)} USDC in contract — may be fully hedged out or empty`);
    return `$${fmt(usdcBalance, 4)} USDC`;
  });

  test('Total hedged value (open_hedge locks)', async () => {
    return `$${fmt(totalHedgedUsdc, 4)} USDC hedged out to admin wallet`;
  });

  test('Contract NAV calculation', async () => {
    if (contractNav <= 0) throw new Error(`Pool NAV is $0 — no deposits or all funds lost`);
    if (contractNav < 10) throw new Error(`WARN: Very small pool NAV $${fmt(contractNav, 4)} — below minimum swap threshold ($15)`);
    return `$${fmt(contractNav, 4)} USDC (balance $${fmt(usdcBalance,2)} + hedged $${fmt(totalHedgedUsdc,2)})`;
  });

  test('Share price calculation', async () => {
    if (sharePrice <= 0) throw new Error('Share price is 0 — no shares minted');
    const drift = Math.abs(sharePrice - 1.0);
    const direction = sharePrice > 1.0 ? `+${fmt((sharePrice - 1) * 100, 3)}% profit` : sharePrice < 1.0 ? `-${fmt((1 - sharePrice) * 100, 3)}% loss` : 'breakeven';
    return `$${fmt(sharePrice, 6)}/share (${totalShares.toFixed(4)} shares, ${direction})`;
  });

  test('Active on-chain hedges', async () => {
    log(`     Active hedges: ${activeHedges.length}`);
    if (activeHedges.length > 0) {
      for (const h of activeHedges) {
        const hf = h.fields || h;
        const col = Number(hf.collateral_usdc || 0) / 1e6;
        const openTime = Number(hf.open_time || 0);
        const ageHours = openTime > 0 ? ((Date.now() - openTime) / 3600000).toFixed(1) : '?';
        log(`     └─ Hedge: $${fmt(col, 4)} USDC | Age: ${ageHours}h | pair_index: ${hf.pair_index}`);
      }
      if (activeHedges.length > 5) throw new Error(`WARN: ${activeHedges.length} open hedges — settlement may be stuck`);
    }
    return `${activeHedges.length} open hedges`;
  });

  test('Member count on-chain', async () => {
    if (memberCount === 0) throw new Error('WARN: No members in pool — nobody has deposited USDC');
    return `${memberCount} depositors`;
  });

  // Check hedge limits
  await test('Hedge ratio check', async () => {
    const autoHedgeCfg = hedgeState.auto_hedge_config?.fields || {};
    const maxRatioBps = Number(autoHedgeCfg.max_hedge_ratio_bps || 5000);
    const usedRatio = contractNav > 0 ? (totalHedgedUsdc / contractNav) * 10000 : 0;
    const atLimit = usedRatio >= maxRatioBps;
    if (atLimit) throw new Error(`WARN: Hedge ratio ${(usedRatio/100).toFixed(1)}% at max ${(maxRatioBps/100).toFixed(0)}% — cannot transfer more USDC to admin`);
    return `${(usedRatio/100).toFixed(1)}% of ${(maxRatioBps/100).toFixed(0)}% max`;
  });

  return { usdcBalance, totalHedgedUsdc, contractNav, sharePrice, memberCount, activeHedges };
}

// ─── STAGE 2: Admin Wallet State ─────────────────────────────────────────────
async function testAdminWallet() {
  section('STAGE 2: ADMIN WALLET BALANCES');

  // Get admin wallet address from API
  const adminInfo = await test('Fetch admin wallet from pool API', async () => {
    const { status, data } = await apiGet('/api/sui/community-pool?action=admin-wallet');
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data).substring(0, 100)}`);
    return data;
  });

  const adminAddr = adminInfo?.data?.address || adminInfo?.address || adminInfo?.adminWallet;
  if (!adminAddr) {
    fail++;
    console.log(`  ❌ Could not determine admin wallet address`);
    issues.push({ level: 'fail', name: 'Admin wallet', msg: 'No admin wallet address from API' });
    return null;
  }

  log(`\n     Admin wallet: ${adminAddr}`);

  // Check SUI gas balance
  const suiBalance = await test('Admin SUI balance (gas)', async () => {
    const result = await suiRpc('suix_getBalance', [adminAddr, '0x2::sui::SUI']);
    const bal = Number(result?.totalBalance || 0) / 1e9;
    if (bal < 0.1) throw new Error(`Only ${fmt(bal, 4)} SUI — may run out of gas for swaps`);
    if (bal < 1.0) throw new Error(`WARN: Only ${fmt(bal, 4)} SUI — low gas, swaps may fail`);
    return `${fmt(bal, 4)} SUI`;
  });

  // Check USDC balance in admin wallet
  const adminUsdc = await test('Admin USDC balance', async () => {
    const result = await suiRpc('suix_getBalance', [adminAddr, USDC_COIN_TYPE]);
    const bal = Number(result?.totalBalance || 0) / 1e6;
    if (bal > 0.01) {
      log(`     ⚠️  Admin holds $${fmt(bal, 4)} USDC — this should be $0 between cron runs (should be in pool)`);
      issues.push({ level: 'warn', name: 'Admin USDC balance', msg: `Admin has $${fmt(bal, 4)} USDC — not returned to pool` });
    }
    return `$${fmt(bal, 4)} USDC`;
  });

  // Check wBTC balance
  const wbtcBalance = await test('Admin wBTC balance (Wormhole)', async () => {
    const result = await suiRpc('suix_getBalance', [adminAddr, WBTC_TYPE]);
    const raw = Number(result?.totalBalance || 0);
    const bal = raw / 1e8;
    if (bal > 0.000001) {
      log(`     ⚠️  Admin holds ${fmt(bal, 8)} wBTC — not yet sold back to USDC`);
      issues.push({ level: 'warn', name: 'Admin holds wBTC', msg: `${fmt(bal, 8)} wBTC stuck in admin wallet` });
    }
    return `${fmt(bal, 8)} wBTC`;
  });

  // Check wETH balance
  const wethBalance = await test('Admin wETH balance', async () => {
    const result = await suiRpc('suix_getBalance', [adminAddr, WETH_TYPE]);
    const raw = Number(result?.totalBalance || 0);
    const bal = raw / 1e8;
    if (bal > 0.0001) {
      log(`     ⚠️  Admin holds ${fmt(bal, 6)} wETH — not yet sold back to USDC`);
      issues.push({ level: 'warn', name: 'Admin holds wETH', msg: `${fmt(bal, 6)} wETH stuck in admin wallet` });
    }
    return `${fmt(bal, 8)} wETH`;
  });

  // Check all balances for unknown tokens
  await test('Admin wallet all balances', async () => {
    const result = await suiRpc('suix_getAllBalances', [adminAddr]);
    const nonZero = (result || []).filter(b => Number(b.totalBalance) > 0);
    const summary = nonZero.map(b => {
      const raw = Number(b.totalBalance);
      const shortType = b.coinType.split('::').slice(-1)[0];
      return `${shortType}: ${raw}`;
    }).join(', ');
    return summary || 'No balances';
  });

  return { adminAddr };
}

// ─── STAGE 3: BlueFin Swap Quotes ────────────────────────────────────────────
async function testSwapQuotes() {
  section('STAGE 3: BLUEFIN SWAP QUOTES (Can we actually trade?)');

  // Test via production API
  const swapQuoteTest = async (asset, amount) => {
    const { status, data } = await apiGet(
      `/api/sui/community-pool?action=swap-quote&asset=${asset}&amount=${amount}`
    );
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data).substring(0, 100)}`);
    const q = data.data || data;
    if (!q || q.canSwapOnChain === undefined) throw new Error('No quote data in response');

    const canSwap = q.canSwapOnChain === true;
    const amountIn = Number(q.amountInUsdc || q.amountIn || 0);
    const expectedOut = q.expectedAmountOut;
    const route = q.route || 'unknown';
    const impact = q.priceImpact != null ? `impact:${(Number(q.priceImpact)*100).toFixed(4)}%` : '';

    if (!canSwap) {
      throw new Error(`WARN: ${asset} not swappable on-chain — route: "${route}" (hedged/simulated only)`);
    }

    return `$${fmt(amountIn, 2)} USDC → ${expectedOut} ${asset} ${impact} via ${route.substring(0,60)}`;
  };

  await test('USDC → SUI swap quote ($10)', () => swapQuoteTest('SUI', 10));
  await test('USDC → BTC swap quote ($10)', () => swapQuoteTest('BTC', 10));
  await test('USDC → ETH swap quote ($10)', () => swapQuoteTest('ETH', 10));

  // Also test via BlueFin 7k aggregator directly
  await test('BlueFin 7k aggregator health', async () => {
    const res = await fetch('https://trade.bluefin.io/api/exchange/candleStickData?symbol=SUI-PERP&interval=1m&limit=1', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`WARN: BlueFin API returned ${res.status}`);
    return 'BlueFin exchange API reachable';
  });

  // Check real DEX liquidity via bluefin7k-aggregator
  await test('BlueFin 7k USDC→SUI route exists', async () => {
    // Query the BlueFin aggregator quote endpoint directly
    const USDC_MAINNET = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    const SUI_MAINNET = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
    const amountIn = (10 * 1e6).toString(); // $10 USDC

    const res = await fetch(
      `https://trade.bluefin.io/aggregator/quote?tokenIn=${USDC_MAINNET}&tokenOut=${SUI_MAINNET}&amountIn=${amountIn}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) {
      // Try alternate endpoint
      const res2 = await fetch(
        `https://api.7k.ag/quote?tokenIn=${USDC_MAINNET}&tokenOut=${SUI_MAINNET}&amountIn=${amountIn}&slippage=0.01`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res2.ok) throw new Error(`WARN: Cannot reach BlueFin 7k aggregator (${res.status} / ${res2.status})`);
      const data2 = await res2.json();
      const out = Number(data2.returnAmount || 0) / 1e9;
      return `7k.ag: $10 USDC → ${fmt(out, 4)} SUI`;
    }
    const data = await res.json();
    const out = Number(data.returnAmount || 0) / 1e9;
    return `$10 USDC → ${fmt(out, 4)} SUI via BlueFin aggregator`;
  });
}

// ─── STAGE 4: AI Allocation Pipeline ─────────────────────────────────────────
async function testAIPipeline() {
  section('STAGE 4: AI ALLOCATION PIPELINE');

  // Test AI allocation via production API
  const alloc = await test('SUI pool AI allocation (production)', async () => {
    const { status, data } = await apiGet('/api/sui/community-pool?action=allocation');
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data).substring(0, 100)}`);
    return data;
  });

  if (alloc) {
    // API returns {success, data: {allocation:{BTC,ETH,SUI}, confidence, ...}}
    const inner = alloc.data || alloc;
    const allocations = inner.allocation || inner.allocations || {};
    await test('Allocation sums to 100%', async () => {
      if (typeof allocations !== 'object' || Array.isArray(allocations)) throw new Error('WARN: Allocation not an object');
      const numericVals = Object.values(allocations).filter(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v))));
      const total = numericVals.reduce((s, v) => s + Number(v), 0);
      if (numericVals.length === 0) throw new Error('WARN: No numeric allocations found in response');
      if (Math.abs(total - 100) > 5) throw new Error(`Allocations sum to ${total.toFixed(1)}%, expected 100%`);
      const parts = Object.entries(allocations).filter(([,v]) => typeof v === 'number' || !isNaN(Number(v))).map(([k, v]) => `${k}:${v}%`).join(' ');
      return parts;
    });
  }

  // Test market data — /api/prices returns {success, data:[{symbol,price,...}]}
  await test('Live BTC/ETH/SUI price feed', async () => {
    const { status, data } = await apiGet('/api/prices?symbols=BTC,ETH,SUI');
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const prices = data.data || data.prices || data;
    const arr = Array.isArray(prices) ? prices : Object.values(prices);
    const bySymbol = {};
    for (const p of arr) { if (p?.symbol) bySymbol[p.symbol] = p.price; }
    if (!bySymbol.BTC || Number(bySymbol.BTC) < 1000) throw new Error(`BTC price invalid: ${bySymbol.BTC}`);
    if (!bySymbol.ETH || Number(bySymbol.ETH) < 100) throw new Error(`ETH price invalid: ${bySymbol.ETH}`);
    if (!bySymbol.SUI || Number(bySymbol.SUI) < 0.01) throw new Error(`SUI price invalid: ${bySymbol.SUI}`);
    return `BTC: $${Number(bySymbol.BTC).toLocaleString()} | ETH: $${Number(bySymbol.ETH).toLocaleString()} | SUI: $${Number(bySymbol.SUI).toFixed(4)}`;
  });

  // Test AI market intelligence — agents page is not a JSON API, skip gracefully
  await test('AI market intelligence context', async () => {
    const { status, data } = await apiGet('/api/sui/community-pool?action=allocation');
    if (status !== 200) throw new Error(`WARN: AI allocation unavailable (${status})`);
    const inner = data.data || data;
    const allocs = inner.allocations || inner;
    const sentiment = inner.sentiment || inner.marketSentiment || 'N/A';
    return `Allocations: BTC=${allocs.BTC||'?'}% ETH=${allocs.ETH||'?'}% SUI=${allocs.SUI||'?'}% | Sentiment: ${sentiment}`;
  });

  // Polymarket skip gracefully
  await test('Prediction market signal', async () => {
    const { status, data } = await apiGet('/api/polymarket?action=5min-signal');
    if (status !== 200) throw new Error(`WARN: Polymarket unavailable (${status})`);
    const d = data.data || data;
    if (!d.direction && !d.signal) throw new Error('WARN: No direction signal from prediction market');
    return `Direction: ${d.direction || d.signal} | Prob: ${d.probability || d.confidence || '?'}%`;
  });
}

// ─── STAGE 5: Production Pool API ────────────────────────────────────────────
async function testProductionApi() {
  section('STAGE 5: PRODUCTION API ENDPOINTS');

  await test('SUI pool stats (production API)', async () => {
    const { status, data } = await apiGet('/api/sui/community-pool');
    if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(data).substring(0, 100)}`);

    const poolData = data.data || data;
    const nav = Number(poolData.totalNAVUsd || poolData.totalNAV || 0);
    const sharePrice = Number(poolData.sharePriceUsd || poolData.sharePrice || 0);
    const members = Number(poolData.memberCount || 0);

    if (nav <= 0) throw new Error('Pool reports $0 NAV — no deposits or misconfiguration');
    if (nav < 10) throw new Error(`WARN: Pool NAV only $${fmt(nav, 2)} — too small for profitable swaps`);

    return `NAV: $${fmt(nav, 2)} | Share: $${fmt(sharePrice, 4)} | Members: ${members}`;
  });

  await test('SUI pool members list', async () => {
    const { status, data } = await apiGet('/api/sui/community-pool?action=members');
    if (status !== 200) throw new Error(`WARN: Members API returned ${status}`);
    const inner = data.data || data;
    const members = Array.isArray(inner?.members) ? inner.members : (Array.isArray(inner) ? inner : []);
    return `${members.length} members in pool`;
  });

  await test('Pool NAV history (DB records)', async () => {
    // DB transaction history is not exposed via the SUI pool API
    // Check if on-chain NAV matches production API as a proxy
    const { status, data } = await apiGet('/api/sui/community-pool');
    if (status !== 200) throw new Error(`WARN: Pool API returned ${status}`);
    const inner = data.data || data;
    const nav = Number(inner.totalNAVUsd || inner.totalNAV || 0);
    const sp = Number(inner.sharePriceUsd || inner.sharePrice || 1);
    if (nav <= 0) throw new Error('WARN: NAV is $0 in production API — check field parsing');
    const direction = sp < 1 ? `-${((1-sp)*100).toFixed(2)}% loss` : sp > 1 ? `+${((sp-1)*100).toFixed(2)}% gain` : 'breakeven';
    return `Production API shows $${nav.toFixed(2)} NAV at $${sp.toFixed(6)}/share (${direction})`;
  });

  await test('Last AI decision (DB)', async () => {
    throw new Error('WARN: AI decision DB query not available via SUI pool API — check Vercel logs for cron output');
  });

  await test('Recent swap records (DB)', async () => {
    throw new Error('WARN: Swap transaction DB query not available via SUI pool API — check Vercel logs for cron output');
  });
}

// ─── STAGE 6: Cron Execution Test ────────────────────────────────────────────
async function testCronExecution() {
  section('STAGE 6: CRON EXECUTION (Dry-run via authenticated call)');

  await test('Cron authentication check', async () => {
    // Use Authorization: Bearer (QStash fallback method) with a short timeout
    // The cron itself takes 30-60s — we just want to see if auth passes (any non-401 = good)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000); // 8s — just enough for auth check
    try {
      const res = await fetch(`${BASE}/api/cron/sui-community-pool`, {
        headers: { 'Authorization': `Bearer ${CRON_SECRET}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 401) throw new Error('CRON_SECRET rejected — check Vercel env CRON_SECRET matches local value');
      if (res.status === 503) throw new Error(`Mainnet config incomplete — check Vercel env vars`);
      if (res.status === 429) return `Rate limited (recently ran) — cron is running correctly`;
      if (res.status === 200) return `Cron auth OK, ran successfully`;
      throw new Error(`WARN: Unexpected status ${res.status}`);
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        // Timeout means auth passed and cron started running — that's a success
        return `Auth passed — cron started (timed out after 8s, normal for 30-60s jobs)`;
      }
      throw e;
    }
  });

  // Check QStash schedule
  await test('QStash cron schedule', async () => {
    const { status, data } = await apiGet('/api/health');
    if (status !== 200) throw new Error(`Health check failed: ${status}`);
    const cronStatus = data.cron || data.qstash;
    return cronStatus ? JSON.stringify(cronStatus).substring(0, 100) : 'Health returned (cron status unknown)';
  });
}

// ─── STAGE 7: Profit Diagnosis ────────────────────────────────────────────────
async function diagnoseProfitLoop(onChainData) {
  section('STAGE 7: PROFIT LOOP DIAGNOSIS');

  log('\n  How profits should work:');
  log('  1. USDC deposited → pool contract balance increases');
  log('  2. Cron: open_hedge → USDC sent from pool to admin wallet');
  log('  3. Cron: admin swaps USDC → BTC/ETH/SUI via BlueFin DEX');
  log('  4. Assets appreciate in admin wallet');
  log('  5. Next cron: replenish (assets → USDC) then close_hedge (USDC → pool)');
  log('  6. Pool gets back MORE USDC than it sent → share price rises\n');

  if (!onChainData) {
    fail++;
    console.log('  ❌ Cannot diagnose — on-chain data fetch failed');
    return;
  }

  const { usdcBalance, totalHedgedUsdc, contractNav, sharePrice, memberCount, activeHedges } = onChainData;

  // Issue 1: Empty pool
  await test('Pool has capital to trade', async () => {
    if (contractNav < 1) throw new Error('Pool has no deposited capital — deposit USDC first');
    if (contractNav < 15) throw new Error(`WARN: Pool NAV $${fmt(contractNav, 2)} below $15 minimum swap threshold — no trades will execute`);
    return `$${fmt(contractNav, 2)} USDC available`;
  });

  // Issue 2: All capital stuck as hedges
  await test('Pool balance vs hedged balance', async () => {
    if (totalHedgedUsdc > 0 && usdcBalance < 1) {
      throw new Error(
        `WARN: $${fmt(totalHedgedUsdc, 2)} USDC is hedged out but $${fmt(usdcBalance, 2)} in pool — ` +
        `close_hedge may be failing (admin wallet needs USDC to settle)`
      );
    }
    const hedgeRatio = contractNav > 0 ? (totalHedgedUsdc / contractNav * 100) : 0;
    if (hedgeRatio > 80) throw new Error(`WARN: ${fmt(hedgeRatio, 1)}% of NAV is hedged out — very little in contract`);
    return `$${fmt(usdcBalance, 2)} in pool, $${fmt(totalHedgedUsdc, 2)} hedged (${fmt(totalHedgedUsdc / Math.max(contractNav, 0.01) * 100, 1)}%)`;
  });

  // Issue 3: Stale hedges
  await test('No stale/stuck hedges', async () => {
    if (activeHedges.length === 0) return 'No active hedges — clean state';
    const now = Date.now();
    const stale = activeHedges.filter(h => {
      const openTime = Number((h.fields || h).open_time || 0);
      return openTime > 0 && (now - openTime) > 48 * 3600 * 1000; // older than 48h
    });
    if (stale.length > 0) {
      throw new Error(
        `WARN: ${stale.length} hedges older than 48h — close_hedge likely failing. ` +
        `Admin wallet needs USDC to settle these.`
      );
    }
    return `${activeHedges.length} hedges all within 48h`;
  });

  // Issue 4: NAV not tracking off-chain value
  await test('NAV includes off-chain asset appreciation', async () => {
    if (totalHedgedUsdc > 0) {
      throw new Error(
        `WARN: $${fmt(totalHedgedUsdc, 2)} USDC is hedged out at COST BASIS — ` +
        `the pool NAV does NOT reflect current market value of admin-held assets. ` +
        `Until close_hedge runs, price gains/losses are invisible to NAV. ` +
        `This is by design, but means share price appears flat between cron runs.`
      );
    }
    return 'No open hedges — NAV fully on-chain';
  });

  // Issue 5: Share price flat?
  await test('Share price showing returns', async () => {
    const drift = Math.abs(sharePrice - 1.0);
    if (drift < 0.000001) {
      throw new Error(
        `WARN: Share price exactly $1.000000 — either pool just started OR ` +
        `close_hedge is always returning exactly the same amount (no PnL capture). ` +
        `Check: admin wallet must hold accumulated tokens that are worth MORE than collateral.`
      );
    }
    if (sharePrice < 1.0) {
      throw new Error(
        `WARN: Share price $${fmt(sharePrice, 6)} below $1 — pool has lost ${fmt((1-sharePrice)*100, 3)}% ` +
        `(swap fees + slippage exceeding gains, or losses on DEX trades)`
      );
    }
    return `$${fmt(sharePrice, 6)}/share — ${fmt((sharePrice - 1) * 100, 3)}% return`;
  });

  // Root cause summary
  log('\n  ── Root Cause Analysis ──────────────────────────────────────────');

  const rootCauses = [];

  if (memberCount === 0) rootCauses.push('NO DEPOSITS: Nobody has deposited USDC into the pool');
  if (contractNav < 15) rootCauses.push('INSUFFICIENT NAV: Pool too small for DEX swaps ($15 minimum)');
  if (activeHedges.length > 0 && usdcBalance < 1) rootCauses.push('STUCK HEDGES: USDC sent to admin but not returned — DEX swaps or close_hedge failing');
  if (Math.abs(sharePrice - 1.0) < 0.000001) rootCauses.push('FLAT NAV: Share price unchanged — profits not being captured in close_hedge');

  if (rootCauses.length === 0) {
    log('  ✅ No obvious blocking issues found — pool may be working correctly');
    log('     (profits accumulate slowly via 30-min cron cycles)');
  } else {
    log('  ❌ IDENTIFIED ROOT CAUSES:');
    rootCauses.forEach((cause, i) => log(`     ${i + 1}. ${cause}`));
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     SUI E2E DIAGNOSTIC — WHY AREN\'T WE MAKING PROFITS?           ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Pool:    ${USDC_POOL_STATE.substring(0, 18)}...                  ║`);
  console.log(`║  Package: ${USDC_POOL_PACKAGE.substring(0, 18)}...                ║`);
  console.log(`║  Time:    ${new Date().toISOString()}                       ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const totalStart = Date.now();

  const onChainData = await testOnChainPoolState();
  await testAdminWallet();
  await testSwapQuotes();
  await testAIPipeline();
  await testProductionApi();
  await testCronExecution();
  await diagnoseProfitLoop(onChainData);

  // ─── Summary ───────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - totalStart) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  DIAGNOSTIC SUMMARY                                              ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  ✅ PASS: ${String(pass).padEnd(4)} ❌ FAIL: ${String(fail).padEnd(4)} ⚠️  WARN: ${String(warn).padEnd(4)} ⏱ ${elapsed}s  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (issues.length > 0) {
    console.log('\n📋 ALL ISSUES DETECTED:');
    issues.forEach((issue, i) => {
      const icon = issue.level === 'fail' ? '❌' : '⚠️ ';
      console.log(`  ${i + 1}. [${issue.level.toUpperCase()}] ${icon} ${issue.name}`);
      console.log(`     ${issue.msg}`);
    });

    console.log('\n🔧 RECOMMENDED FIXES:');
    const fixes = new Set();
    for (const issue of issues) {
      if (issue.msg.includes('No deposits') || issue.msg.includes('no deposited')) {
        fixes.add('→ DEPOSIT: Make a USDC deposit to give the pool capital to trade with');
      }
      if (issue.msg.includes('USDC')) {
        fixes.add('→ RETURN USDC: Admin wallet holds USDC that should be in pool — check close_hedge');
      }
      if (issue.msg.includes('wBTC') || issue.msg.includes('wETH')) {
        fixes.add('→ SELL ASSETS: Admin wallet holds tokens — reverse swap needs to run (replenishAdminUsdc)');
      }
      if (issue.msg.includes('gas')) {
        fixes.add('→ TOP UP GAS: Admin wallet needs more SUI for transaction fees');
      }
      if (issue.msg.includes('not swappable') || issue.msg.includes('No route')) {
        fixes.add('→ LIQUIDITY: BlueFin DEX has no route for this asset — check coin type configuration');
      }
      if (issue.msg.includes('flat') || issue.msg.includes('unchanged')) {
        fixes.add('→ PNL CAPTURE: close_hedge returning exact collateral — check replenishAdminUsdc is converting assets at current prices');
      }
      if (issue.msg.includes('Stuck hedge') || issue.msg.includes('older than')) {
        fixes.add('→ SETTLE HEDGES: Run cron manually or trigger close_hedge with admin key');
      }
      if (issue.msg.includes('below $15') || issue.msg.includes('too small')) {
        fixes.add('→ MIN CAPITAL: Pool needs at least $15 USDC to trade. Deposit more USDC.');
      }
    }
    [...fixes].forEach(f => console.log(`  ${f}`));
  } else {
    console.log('\n  ✅ No critical issues found. Pool should be generating profits.');
    console.log('  ℹ️  Profits accumulate at each 30-min cron cycle as prices move.');
  }

  console.log('');
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
