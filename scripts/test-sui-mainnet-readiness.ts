/**
 * SUI Mainnet Readiness — Full Flow E2E Test
 * 
 * Tests: Deposit USDC → AI Allocation → Swap → Hedge → Withdraw USDC
 * Run: npx tsx scripts/test-sui-mainnet-readiness.ts
 */

// Derive wallet from env key, or fall back to Signer 1 for read-only checks
const WALLET = process.env.SUI_WALLET_ADDRESS || '0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93';
const NETWORK = 'testnet';

// ─── Test Infrastructure ───────────────────────────────────────

let API_BASE = '';
let passed = 0;
let failed = 0;
const results: { test: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }[] = [];

function pass(test: string, detail: string) {
  passed++;
  results.push({ test, status: 'PASS', detail });
  console.log(`  ✅ ${test}: ${detail}`);
}

function fail(test: string, detail: string) {
  failed++;
  results.push({ test, status: 'FAIL', detail });
  console.log(`  ❌ ${test}: ${detail}`);
}

function warn(test: string, detail: string) {
  results.push({ test, status: 'WARN', detail });
  console.log(`  ⚠️  ${test}: ${detail}`);
}

async function findServer(): Promise<string> {
  for (const port of [3099, 3003, 3002, 3000]) {
    try {
      const res = await fetch(`http://localhost:${port}/api/sui/community-pool?action=allocation&network=${NETWORK}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return `http://localhost:${port}`;
    } catch {}
  }
  throw new Error('No dev server running on ports 3099/3003/3002/3000');
}

async function api(path: string, options?: RequestInit) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const data = await res.json();
  return { status: res.status, data };
}

// ─── Tests ─────────────────────────────────────────────────────

async function testAdminWallet() {
  console.log('\n═══ TEST 1: Admin Wallet Configuration ═══');
  
  const { status, data } = await api(`/api/sui/community-pool?action=admin-wallet&network=${NETWORK}`);
  
  if (status !== 200) return fail('Admin endpoint', `HTTP ${status}`);
  if (!data.success) return fail('Admin endpoint', 'Response not successful');
  
  const w = data.data;
  if (w.configured) {
    pass('Admin key set', `SUI_POOL_ADMIN_KEY configured`);
  } else {
    fail('Admin key set', 'SUI_POOL_ADMIN_KEY not configured — swaps disabled');
  }
  
  if (w.address) {
    pass('Admin address', w.address);
  } else {
    fail('Admin address', 'Could not derive admin address');
  }
  
  if (w.hasGas) {
    pass('Admin gas', `${w.suiBalance} SUI available`);
  } else {
    fail('Admin gas', `Insufficient gas: ${w.suiBalance || '0'} SUI`);
  }
  
  if (w.swapsEnabled) {
    pass('Swaps enabled', 'Admin wallet configured with sufficient gas');
  } else {
    warn('Swaps disabled', 'Deposits will record to DB but swaps are deferred');
  }
  
  return w;
}

async function testContractInfo() {
  console.log('\n═══ TEST 2: Contract Configuration ═══');
  
  const { status, data } = await api(`/api/sui/community-pool?action=contract&network=${NETWORK}`);
  
  if (status !== 200) return fail('Contract endpoint', `HTTP ${status}`);
  
  const info = data.data;
  if (info?.packageId) {
    pass('Package ID', info.packageId.slice(0, 20) + '...');
  } else {
    fail('Package ID', 'No packageId configured');
  }
  
  if (info?.poolStateId) {
    pass('Pool state', info.poolStateId.slice(0, 20) + '...');
  } else {
    warn('Pool state', 'No poolStateId — using DB-backed mode');
  }
  
  if (info?.usdcCoinType) {
    pass('USDC coin type', info.usdcCoinType);
  } else {
    warn('USDC coin type', 'Not set — needed for USDC transfers');
  }
  
  return info;
}

async function testAllocation() {
  console.log('\n═══ TEST 3: AI Allocation Engine ═══');
  
  const { status, data } = await api(`/api/sui/community-pool?action=allocation&network=${NETWORK}`);
  
  if (status !== 200) return fail('Allocation endpoint', `HTTP ${status}`);
  if (!data.success) return fail('Allocation endpoint', 'Response not successful');
  
  const alloc = data.data?.allocation || data.data;
  const total = (alloc.BTC || 0) + (alloc.ETH || 0) + (alloc.SUI || 0) + (alloc.CRO || 0);
  
  if (total === 100) {
    pass('Allocation sum', `BTC:${alloc.BTC}% ETH:${alloc.ETH}% SUI:${alloc.SUI}% CRO:${alloc.CRO}%`);
  } else {
    fail('Allocation sum', `Sum = ${total}%, expected 100%`);
  }
  
  // Check if allocation is hardcoded (30/30/25/15) vs dynamic
  if (alloc.BTC === 30 && alloc.ETH === 30 && alloc.SUI === 25 && alloc.CRO === 15) {
    warn('Static allocation', 'Using hardcoded 30/30/25/15 — SuiPoolAgent not wired in');
  } else {
    pass('Dynamic allocation', 'AI-driven allocation detected');
  }
  
  return alloc;
}

async function testSwapQuotes() {
  console.log('\n═══ TEST 4: Cetus DEX Swap Quotes ═══');
  
  const assets = ['BTC', 'ETH', 'SUI', 'CRO'];
  const swappable: string[] = [];
  const hedged: string[] = [];
  const simulated: string[] = [];
  
  for (const asset of assets) {
    try {
      const { status, data } = await api(
        `/api/sui/community-pool?action=swap-quote&asset=${asset}&amount=100&network=${NETWORK}`
      );
      
      if (status !== 200) {
        fail(`Quote ${asset}`, `HTTP ${status}`);
        continue;
      }
      
      const q = data.data;
      if (q.canSwapOnChain) {
        pass(`Quote ${asset}`, `On-chain route: ${q.route} — out: ${q.expectedAmountOut}`);
        swappable.push(asset);
      } else if (q.hedgeVia === 'bluefin' && q.expectedAmountOut && q.expectedAmountOut !== '0') {
        pass(`Quote ${asset}`, `Hedged via BlueFin perps: ${q.route}`);
        hedged.push(asset);
      } else if (q.expectedAmountOut && q.expectedAmountOut !== '0') {
        if (q.isSimulated) {
          warn(`Quote ${asset}`, `Simulated (price-based): ${q.route}`);
          simulated.push(asset);
        } else {
          pass(`Quote ${asset}`, `Price-tracked: ${q.route}`);
          hedged.push(asset);
        }
      } else {
        fail(`Quote ${asset}`, `No route found: ${q.route}`);
      }
    } catch (e) {
      fail(`Quote ${asset}`, `Error: ${e instanceof Error ? e.message : e}`);
    }
  }
  
  console.log(`  📊 Summary: ${swappable.length} on-chain, ${hedged.length} hedged, ${simulated.length} simulated, ${4 - swappable.length - hedged.length - simulated.length} failed`);
  return { swappable, hedged, simulated };
}

async function testInitialPosition() {
  console.log('\n═══ TEST 5: Initial Position Check ═══');
  
  const { status, data } = await api(
    `/api/sui/community-pool?action=user-position&wallet=${WALLET}&network=${NETWORK}`
  );
  
  if (status !== 200) return fail('Position endpoint', `HTTP ${status}`);
  
  const pos = data.data;
  pass('Position query', `Shares: ${pos.shares}, Value: $${pos.valueUsdc || pos.shares}, Member: ${pos.isMember}`);
  
  return pos;
}

async function testDeposit(amount: number) {
  console.log(`\n═══ TEST 6: USDC Deposit ($${amount}) ═══`);
  
  const txDigest = `test-mainnet-readiness-${Date.now()}`;
  
  const { status, data } = await api(
    `/api/sui/community-pool?action=record-deposit&network=${NETWORK}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: WALLET,
        amountUsdc: amount,
        allocations: { BTC: 30, ETH: 30, SUI: 25, CRO: 15 },
        txDigest,
      }),
    }
  );
  
  if (status === 503) {
    // With our fix, this should now be 200 with deferred swaps
    fail('Deposit', `503 — Admin wallet not configured (should now degrade gracefully)`);
    return null;
  }
  
  if (status !== 200) {
    fail('Deposit', `HTTP ${status}: ${JSON.stringify(data)}`);
    return null;
  }
  
  if (!data.success) {
    fail('Deposit', `Failed: ${data.error}`);
    return null;
  }
  
  const d = data.data;
  pass('Deposit recorded', `Minted ${d.sharesMinted} shares, total: ${d.totalShares}`);
  
  if (d.swaps) {
    if (d.swaps.executed > 0) {
      pass('Swaps executed', `${d.swaps.executed} on-chain swaps`);
      for (const r of (d.swaps.results || [])) {
        if (r.success && r.txDigest) {
          pass(`Swap ${r.asset}`, `tx: ${r.txDigest}`);
        } else if (r.success) {
          warn(`Swap ${r.asset}`, `Success (simulated/hedged)`);
        } else {
          warn(`Swap ${r.asset}`, `Failed: ${r.error}`);
        }
      }
    } else {
      warn('Swaps deferred', 'No on-chain swaps executed — admin wallet not ready or no liquidity');
    }
  } else {
    warn('No swap data', 'Deposit recorded but no swap info returned');
  }
  
  // Check BlueFin hedges
  if (d.hedges && d.hedges.length > 0) {
    for (const h of d.hedges) {
      if (h.success) {
        pass(`Hedge ${h.asset}`, `Hedged via ${h.method}${h.hedgeId ? ` (${h.hedgeId})` : ''}`);
      } else {
        warn(`Hedge ${h.asset}`, `${h.method} hedge attempted: ${h.error || 'unknown error'}`);
      }
    }
  }
  
  return d;
}

async function testPostDepositPosition(expectedMinShares: number) {
  console.log('\n═══ TEST 7: Post-Deposit Position Verification ═══');
  
  const { data } = await api(
    `/api/sui/community-pool?action=user-position&wallet=${WALLET}&network=${NETWORK}`
  );
  
  const pos = data.data;
  if (pos.shares >= expectedMinShares) {
    pass('Shares updated', `${pos.shares} shares (expected >= ${expectedMinShares})`);
  } else {
    fail('Shares not updated', `${pos.shares} shares (expected >= ${expectedMinShares})`);
  }
  
  if (pos.isMember) {
    pass('Member status', 'User is a pool member');
  } else {
    fail('Member status', 'User should be a member after deposit');
  }
  
  return pos;
}

async function testHedging() {
  console.log('\n═══ TEST 8: AI Hedging Capability ═══');
  
  // Check if hedging endpoint exists for SUI
  try {
    const { status, data } = await api(
      `/api/agents/hedging/onchain?walletAddress=${WALLET}&stats=true`
    );
    
    if (status === 200 && data.success) {
      if (data.message?.includes('SUI')) {
        pass('SUI guard', 'Hedging endpoint correctly handles SUI addresses');
      } else {
        pass('Hedging query', `Total hedges: ${data.summary?.totalHedges || 0}`);
      }
    } else {
      warn('Hedging query', `HTTP ${status} — ${data.error || 'unknown error'}`);
    }
  } catch (e) {
    fail('Hedging endpoint', `Error: ${e instanceof Error ? e.message : e}`);
  }
  
  // Check SUI-specific hedging via community pool
  try {
    const { data } = await api(`/api/sui/community-pool?action=contract&network=${NETWORK}`);
    const info = data.data;
    
    if (info?.hedgeExecutorStateId) {
      pass('Hedge executor', `Active: ${info.hedgeExecutorStateId}`);
    } else {
      warn('Hedge executor', 'No hedge executor configured');
    }
    
    if (info?.bluefinConfigured) {
      pass('BlueFin integration', 'BlueFin perpetual hedging configured');
    } else {
      warn('BlueFin integration', 'BlueFin not configured — hedging will use mock mode');
    }
  } catch {
    warn('Hedge executor check', 'Could not check hedge executor state');
  }
  
  // Check BlueFin configuration
  const bluefinKey = process.env.BLUEFIN_PRIVATE_KEY;
  if (bluefinKey) {
    pass('BlueFin config', 'BLUEFIN_PRIVATE_KEY set — perpetual hedging enabled');
    
    // Also check if BlueFin can initialize
    try {
      const { status: bfStatus, data: bfData } = await api(
        `/api/sui/community-pool?action=swap-quote&asset=CRO&amount=100&network=${NETWORK}`
      );
      if (bfStatus === 200 && bfData.data?.hedgeVia === 'bluefin' && !bfData.data?.isSimulated) {
        pass('BlueFin active', 'CRO quotes routed through BlueFin (not simulated)');
      } else if (bfStatus === 200 && bfData.data?.hedgeVia === 'bluefin') {
        pass('BlueFin route', 'CRO hedged via BlueFin perps');
      } else {
        warn('BlueFin route', 'CRO quote not using BlueFin hedge path');
      }
    } catch {
      warn('BlueFin check', 'Could not verify BlueFin routing');
    }
  } else {
    warn('BlueFin config', 'BLUEFIN_PRIVATE_KEY not set — perpetual hedging in mock mode');
  }
}

async function testWithdraw(shares: number) {
  console.log(`\n═══ TEST 9: USDC Withdrawal (${shares} shares) ═══`);
  
  const { status, data } = await api(
    `/api/sui/community-pool?action=record-withdraw&network=${NETWORK}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: WALLET,
        sharesToBurn: shares,
        allocations: { BTC: 30, ETH: 30, SUI: 25, CRO: 15 },
      }),
    }
  );
  
  if (status !== 200) {
    fail('Withdrawal', `HTTP ${status}: ${JSON.stringify(data)}`);
    return null;
  }
  
  if (!data.success) {
    fail('Withdrawal', `Failed: ${data.error}`);
    return null;
  }
  
  const w = data.data;
  pass('Withdrawal recorded', `Burned ${w.sharesBurned} shares, remaining: ${w.remainingShares}`);
  
  if (w.estimatedUsdcReturn !== undefined) {
    pass('USDC return', `~$${w.estimatedUsdcReturn} USDC estimated`);
  }
  
  if (w.swaps) {
    for (const r of (w.swaps.results || [])) {
      if (r.success && r.txDigest) {
        pass(`Reverse swap ${r.asset}`, `tx: ${r.txDigest}`);
      } else if (r.success) {
        warn(`Reverse swap ${r.asset}`, 'Success (simulated/hedged)');
      }
    }
  }
  
  return w;
}

async function testFinalPosition() {
  console.log('\n═══ TEST 10: Final Position After Withdrawal ═══');
  
  const { data } = await api(
    `/api/sui/community-pool?action=user-position&wallet=${WALLET}&network=${NETWORK}`
  );
  
  const pos = data.data;
  pass('Final position', `Shares: ${pos.shares}, Value: $${pos.valueUsdc || pos.shares}`);
  
  return pos;
}

async function testPoolSummary() {
  console.log('\n═══ TEST 11: Pool Summary (Overall Health) ═══');
  
  try {
    const { status, data } = await api(`/api/sui/community-pool?network=${NETWORK}`);
    
    if (status !== 200) {
      fail('Pool summary', `HTTP ${status}`);
      return;
    }
    
    if (data.success) {
      pass('Pool summary', `TVL: $${data.data?.totalValueUSD || 'N/A'}, Members: ${data.data?.memberCount || 'N/A'}`);
    } else {
      warn('Pool summary', data.error || 'Unknown error');
    }
  } catch (e) {
    warn('Pool summary', `Error: ${e instanceof Error ? e.message : e}`);
  }
}

async function testCrossChainGuard() {
  console.log('\n═══ TEST 12: Cross-Chain Guards ═══');
  
  // SUI address should NOT crash EVM community-pool endpoint
  try {
    const { status, data } = await api(
      `/api/community-pool?user=${WALLET}&chain=sepolia&network=testnet`
    );
    if (status === 200) {
      pass('EVM pool guard', `SUI address handled gracefully — user.isMember: ${data.user?.isMember ?? false}`);
    } else if (status === 400) {
      pass('EVM pool guard', 'SUI chain correctly rejected from EVM endpoint');
    } else {
      fail('EVM pool guard', `Unexpected HTTP ${status}`);
    }
  } catch (e) {
    fail('EVM pool guard', `Error: ${e instanceof Error ? e.message : e}`);
  }
  
  // SUI address should NOT crash hedging endpoint
  try {
    const { status, data } = await api(
      `/api/agents/hedging/onchain?address=${WALLET}&stats=true`
    );
    if (status === 200 && data.success) {
      pass('Hedging guard', 'SUI address handled — no 500 error');
    } else {
      fail('Hedging guard', `HTTP ${status}: ${data.error}`);
    }
  } catch (e) {
    fail('Hedging guard', `Error: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SUI MAINNET READINESS — Full Flow E2E Test                 ║');
  console.log('║  Flow: Deposit → AI Allocation → Swap → Hedge → Withdraw   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Network: ${NETWORK}`);
  console.log(`  Wallet:  ${WALLET.slice(0, 10)}...${WALLET.slice(-8)}`);
  
  API_BASE = await findServer();
  console.log(`  Server:  ${API_BASE}`);
  
  // Phase 1: Infrastructure checks
  const adminWallet = await testAdminWallet();
  await testContractInfo();
  
  // Phase 2: AI & DEX readiness
  const allocation = await testAllocation();
  const swapCapability = await testSwapQuotes();
  
  // Phase 3: Full deposit → withdraw flow
  const initialPos = await testInitialPosition();
  const initialShares = initialPos?.shares || 0;
  
  const depositAmount = 25; // $25 USDC test
  const depositResult = await testDeposit(depositAmount);
  
  if (depositResult) {
    await testPostDepositPosition(initialShares + depositAmount);
  }
  
  // Phase 4: Hedging
  await testHedging();
  
  // Phase 5: Withdrawal
  const withdrawShares = 10;
  await testWithdraw(withdrawShares);
  await testFinalPosition();
  
  // Phase 6: Cross-chain safety
  await testCrossChainGuard();
  
  // Phase 7: Overall pool health
  await testPoolSummary();
  
  // ─── Results Summary ───
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  RESULTS SUMMARY                                            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  
  const warns = results.filter(r => r.status === 'WARN').length;
  console.log(`║  ✅ Passed:  ${String(passed).padEnd(4)} ${' '.repeat(45)}║`);
  console.log(`║  ❌ Failed:  ${String(failed).padEnd(4)} ${' '.repeat(45)}║`);
  console.log(`║  ⚠️  Warnings: ${String(warns).padEnd(4)} ${' '.repeat(43)}║`);
  
  console.log('╠══════════════════════════════════════════════════════════════╣');
  
  // Mainnet readiness verdict
  const criticalFails = results.filter(r => r.status === 'FAIL');
  const isCritical = criticalFails.some(f => 
    f.test.includes('Admin key') || 
    f.test.includes('Admin gas') ||
    f.test.includes('Package ID') ||
    f.test.includes('Deposit') ||
    f.test.includes('Withdrawal')
  );
  
  if (failed === 0) {
    console.log('║  VERDICT: ✅ MAINNET READY                                  ║');
  } else if (isCritical) {
    console.log('║  VERDICT: ❌ NOT MAINNET READY (critical failures)           ║');
  } else {
    console.log('║  VERDICT: ⚠️  PARTIALLY READY (non-critical failures)        ║');
  }
  
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (criticalFails.length > 0) {
    console.log('\n🚨 Critical Failures:');
    for (const f of criticalFails) {
      console.log(`   - ${f.test}: ${f.detail}`);
    }
  }
  
  const warnings = results.filter(r => r.status === 'WARN');
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings (should fix before mainnet):');
    for (const w of warnings) {
      console.log(`   - ${w.test}: ${w.detail}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
