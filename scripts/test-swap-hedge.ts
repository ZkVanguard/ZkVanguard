/**
 * Test script for SUI Community Pool swap, share conversion, and hedging
 * Tests: swap-quote, allocation, share math, pool stats, auto-hedge
 */

const BASE_URL = 'http://localhost:3099';

async function findServer(): Promise<string> {
  for (const port of [3100, 3200, 3099, 3105, 3103, 3102, 3101, 3000]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/sui/community-pool?action=stats`, { signal: AbortSignal.timeout(5000) });
      if (r.status < 500) return `http://localhost:${port}`;
    } catch {}
  }
  throw new Error('No dev server found');
}

interface TestResult {
  name: string;
  pass: boolean;
  details: string;
  data?: unknown;
}

const results: TestResult[] = [];

function log(label: string, msg: string) {
  console.log(`[${label}] ${msg}`);
}

async function test(name: string, fn: () => Promise<{ pass: boolean; details: string; data?: unknown }>) {
  try {
    const result = await fn();
    results.push({ name, ...result });
    console.log(`${result.pass ? '✅' : '❌'} ${name}: ${result.details}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, pass: false, details: `ERROR: ${msg}` });
    console.log(`❌ ${name}: ERROR: ${msg}`);
  }
}

async function main() {
  const baseUrl = await findServer();
  log('SERVER', `Found at ${baseUrl}`);

  // ===== TEST 1: Pool Stats (share price, NAV, total shares) =====
  await test('Pool Stats & Share Price', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?network=testnet`);
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };
    
    const pool = d.data;
    const sharePrice = parseFloat(pool.sharePriceUsdc || pool.sharePriceUsd || pool.sharePrice || '0');
    const totalShares = parseFloat(pool.totalShares || '0');
    const totalNAV = parseFloat(pool.totalNAVUsdc || pool.totalNAV || '0');

    // Verify share price math: NAV / shares = price
    let priceCorrect = true;
    if (totalShares > 0) {
      const expectedPrice = totalNAV / totalShares;
      priceCorrect = Math.abs(expectedPrice - sharePrice) < 0.001;
    }

    return {
      pass: priceCorrect && sharePrice > 0,
      details: `NAV=$${totalNAV.toFixed(2)}, shares=${totalShares.toFixed(6)}, sharePrice=$${sharePrice.toFixed(6)}, priceCorrect=${priceCorrect}`,
      data: { totalNAV, totalShares, sharePrice, allocation: pool.allocation },
    };
  });

  // ===== TEST 2: Swap Quote (BTC) =====
  await test('Swap Quote BTC ($100)', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=swap-quote&asset=BTC&amount=100&network=testnet`, 
      { signal: AbortSignal.timeout(30000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };
    
    const q = d.data;
    return {
      pass: true,
      details: `${q.amountInUsdc} USDC → ${q.expectedAmountOut} BTC, impact=${q.priceImpact}, canSwap=${q.canSwapOnChain}, hedgeVia=${q.hedgeVia || 'none'}`,
      data: q,
    };
  });

  // ===== TEST 3: Swap Quote (ETH) =====
  await test('Swap Quote ETH ($100)', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=swap-quote&asset=ETH&amount=100&network=testnet`,
      { signal: AbortSignal.timeout(30000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };
    
    const q = d.data;
    return {
      pass: true,
      details: `${q.amountInUsdc} USDC → ${q.expectedAmountOut} ETH, canSwap=${q.canSwapOnChain}, hedgeVia=${q.hedgeVia || 'none'}`,
      data: q,
    };
  });

  // ===== TEST 4: Swap Quote (SUI) =====
  await test('Swap Quote SUI ($100)', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=swap-quote&asset=SUI&amount=100&network=testnet`,
      { signal: AbortSignal.timeout(30000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };
    
    const q = d.data;
    return {
      pass: true,
      details: `${q.amountInUsdc} USDC → ${q.expectedAmountOut} SUI, canSwap=${q.canSwapOnChain}, hedgeVia=${q.hedgeVia || 'none'}`,
      data: q,
    };
  });

  // ===== TEST 5: Swap Quote (CRO) =====
  await test('Swap Quote CRO ($100)', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=swap-quote&asset=CRO&amount=100&network=testnet`,
      { signal: AbortSignal.timeout(30000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };
    
    const q = d.data;
    return {
      pass: true,
      details: `${q.amountInUsdc} USDC → ${q.expectedAmountOut} CRO, canSwap=${q.canSwapOnChain}, hedgeVia=${q.hedgeVia || 'none'}`,
      data: q,
    };
  });

  // ===== TEST 6: AI Agent Allocation =====
  await test('AI Agent Allocation', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=allocation&network=testnet`,
      { signal: AbortSignal.timeout(30000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const alloc = d.data.allocation || d.data.allocations || d.data;
    const total = (alloc.BTC || 0) + (alloc.ETH || 0) + (alloc.SUI || 0) + (alloc.CRO || 0);
    const sumCorrect = Math.abs(total - 100) < 1;

    return {
      pass: sumCorrect,
      details: `BTC=${alloc.BTC}%, ETH=${alloc.ETH}%, SUI=${alloc.SUI}%, CRO=${alloc.CRO}%, total=${total}%`,
      data: d.data,
    };
  });

  // ===== TEST 7: Share Conversion Math =====
  await test('Share Conversion Accuracy', async () => {
    // Get pool stats
    const r = await fetch(`${baseUrl}/api/sui/community-pool?network=testnet`);
    const d = await r.json();
    if (!d.success) return { pass: false, details: 'Cannot read pool stats' };

    const pool = d.data;
    const sharePrice = parseFloat(pool.sharePriceUsdc || pool.sharePriceUsd || pool.sharePrice || '1.0');
    const totalShares = parseFloat(pool.totalShares || '0');
    const totalNAV = parseFloat(pool.totalNAVUsdc || pool.totalNAV || '0');

    // Test: $100 deposit should get ~100/sharePrice shares
    const depositUsdc = 100;
    const expectedShares = depositUsdc / sharePrice;
    
    // Check if route.ts hardcodes sharesToMint = amountUsdc (which is wrong if sharePrice != 1.0)
    const hardcoded = sharePrice !== 1.0; // If pool has active NAV, 1:1 is wrong
    const issues: string[] = [];

    if (sharePrice !== 1.0) {
      issues.push(`sharePrice=${sharePrice.toFixed(6)} (not 1.0) — 1:1 minting would dilute existing members`);
    }
    
    if (totalShares > 0 && totalNAV > 0) {
      const impliedPrice = totalNAV / totalShares;
      if (Math.abs(impliedPrice - 1.0) > 0.01) {
        issues.push(`Implied price from NAV/shares = $${impliedPrice.toFixed(6)} — 1:1 minting is WRONG`);
      }
    }

    return {
      pass: issues.length === 0,
      details: issues.length > 0 
        ? `ISSUES: ${issues.join('; ')}` 
        : `Share price = $${sharePrice.toFixed(6)}, $${depositUsdc} → ${expectedShares.toFixed(6)} shares (correct at 1:1)`,
      data: { sharePrice, totalShares, totalNAV, expectedShares },
    };
  });

  // ===== TEST 8: Admin Wallet (swap readiness) =====
  await test('Admin Wallet Status', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=admin-wallet&network=testnet`);
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const w = d.data;
    return {
      pass: w.configured,
      details: `configured=${w.configured}, address=${w.address?.slice(0,10)}..., SUI=${w.suiBalance}, hasGas=${w.hasGas}, swapsEnabled=${w.swapsEnabled}`,
      data: w,
    };
  });

  // ===== TEST 9: Auto-Hedge Config =====
  await test('Auto-Hedge Configuration', async () => {
    const r = await fetch(`${baseUrl}/api/community-pool/auto-hedge`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (!d.success && !d.enabled && !d.config) return { pass: false, details: `API error: ${JSON.stringify(d).slice(0,200)}` };

    return {
      pass: true,
      details: `enabled=${d.enabled}, riskThreshold=${d.config?.riskThreshold}, riskScore=${d.riskAssessment?.riskScore?.toFixed(2)}, volatility=${d.riskAssessment?.volatility?.toFixed(2)}`,
      data: { enabled: d.enabled, config: d.config, riskScore: d.riskAssessment?.riskScore, volatility: d.riskAssessment?.volatility },
    };
  });

  // ===== TEST 10: Contract Info (deployment IDs) =====
  await test('Contract Deployment Info', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=contract&network=testnet`,
      { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const c = d.data;
    const hasPackage = !!c.packageId || !!c.usdcPool?.packageId;
    const hasPoolState = !!c.poolStateId || !!c.usdcPool?.poolStateId;

    return {
      pass: hasPackage && hasPoolState,
      details: `package=${(c.packageId || c.usdcPool?.packageId || 'MISSING').slice(0,15)}..., poolState=${(c.poolStateId || c.usdcPool?.poolStateId || 'MISSING').slice(0,15)}...`,
      data: c,
    };
  });

  // ===== TEST 11: Cron Endpoint (simulated - check if accessible) =====
  await test('Cron Endpoint Accessible', async () => {
    // Cron requires CRON_SECRET - just check that the route exists and returns 401/403 without it
    const r = await fetch(`${baseUrl}/api/cron/community-pool`, { signal: AbortSignal.timeout(10000) });
    const status = r.status;
    // 401/403 = route exists but auth required (correct)
    // 405 = method not allowed (GET when it expects POST)
    // 200 = processed (unlikely without auth)
    return {
      pass: [401, 403, 405, 200].includes(status),
      details: `HTTP ${status} — ${status === 401 || status === 403 ? 'Auth required (correct)' : status === 200 ? 'Processed (check auth!)' : 'Route exists'}`,
    };
  });

  // ===== SUMMARY =====
  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${results.length} tests`);
  
  if (failed > 0) {
    console.log('\nFAILED TESTS:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.details}`);
    });
  }

  console.log('\n=== CRITICAL FINDINGS ===');
  // Check share price issue specifically
  const shareTest = results.find(r => r.name === 'Share Conversion Accuracy');
  if (shareTest && !shareTest.pass) {
    console.log('⚠️  SHARE PRICE BUG: Pool share price != 1.0 but record-deposit uses sharesToMint = amountUsdc (1:1)');
    console.log('   This means new depositors get shares at the wrong price, diluting/enriching existing members');
  }
  
  // Check hedging
  const swapTests = results.filter(r => r.name.startsWith('Swap Quote'));
  const hedgedAssets = swapTests.filter(r => r.data && (r.data as {hedgeVia?: string}).hedgeVia);
  const onChainSwaps = swapTests.filter(r => r.data && (r.data as {canSwapOnChain?: boolean}).canSwapOnChain);
  console.log(`Swap routing: ${onChainSwaps.length} on-chain, ${hedgedAssets.length} hedged via BlueFin/other`);
  
  const hedgeTest = results.find(r => r.name === 'Auto-Hedge Configuration');
  if (hedgeTest?.data) {
    const hd = hedgeTest.data as { enabled?: boolean; riskScore?: number };
    console.log(`Auto-hedge: enabled=${hd.enabled}, riskScore=${hd.riskScore}`);
  }

  console.log('\n=== TEST COMPLETE ===');
}

main().catch(console.error);
