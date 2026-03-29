/**
 * Test: Community Pool hedge management on deposit
 * Verifies USDC deposits are properly routed to on-chain swaps + BlueFin hedges
 */

async function findServer(): Promise<string> {
  for (const port of [3100, 3099, 3200, 3105, 3103, 3102, 3101, 3000]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/sui/community-pool?action=stats`, { signal: AbortSignal.timeout(4000) });
      if (r.status < 500) return `http://localhost:${port}`;
    } catch {}
  }
  throw new Error('No dev server found on any port');
}

const results: { name: string; pass: boolean; details: string; data?: unknown }[] = [];

async function test(name: string, fn: () => Promise<{ pass: boolean; details: string; data?: unknown }>) {
  try {
    const t0 = Date.now();
    const result = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ...result });
    console.log(`${result.pass ? '✅' : '❌'} ${name} (${ms}ms): ${result.details}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, pass: false, details: `ERROR: ${msg}` });
    console.log(`❌ ${name}: ERROR: ${msg}`);
  }
}

async function main() {
  const baseUrl = await findServer();
  console.log(`\n🔗 Server: ${baseUrl}\n`);

  // ──────────────────────────────────────────────
  // TEST 1: Pool Stats — is the pool alive?
  // ──────────────────────────────────────────────
  let poolNAV = 0;
  let sharePrice = 0;
  await test('1. Pool Stats', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?network=testnet`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const p = d.data;
    sharePrice = parseFloat(p.sharePriceUsdc || p.sharePriceUsd || p.sharePrice || '0');
    poolNAV = parseFloat(p.totalNAVUsdc || p.totalNAV || '0');
    const totalShares = parseFloat(p.totalShares || '0');

    return {
      pass: sharePrice > 0,
      details: `NAV=$${poolNAV.toFixed(2)}, shares=${totalShares.toFixed(4)}, price=$${sharePrice.toFixed(6)}`,
      data: p,
    };
  });

  // ──────────────────────────────────────────────
  // TEST 2: AI Allocation — what does the AI want?
  // ──────────────────────────────────────────────
  let aiAlloc: Record<string, number> = { BTC: 30, ETH: 30, SUI: 25, CRO: 15 };
  await test('2. AI Allocation', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=allocation&network=testnet`, { signal: AbortSignal.timeout(30000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const raw = d.data.allocation || d.data.allocations || d.data;
    aiAlloc = { BTC: raw.BTC || 0, ETH: raw.ETH || 0, SUI: raw.SUI || 0, CRO: raw.CRO || 0 };
    const total = aiAlloc.BTC + aiAlloc.ETH + aiAlloc.SUI + aiAlloc.CRO;

    return {
      pass: Math.abs(total - 100) < 1,
      details: `BTC=${aiAlloc.BTC}% ETH=${aiAlloc.ETH}% SUI=${aiAlloc.SUI}% CRO=${aiAlloc.CRO}% (sum=${total}%)`,
      data: { allocation: aiAlloc, source: d.data.source || 'unknown' },
    };
  });

  // ──────────────────────────────────────────────
  // TEST 3: Swap Quotes — which route for each asset?
  // ──────────────────────────────────────────────
  const quoteResults: Record<string, { canSwap: boolean; hedgeVia?: string; output: string; route: string }> = {};
  for (const asset of ['BTC', 'ETH', 'SUI', 'CRO'] as const) {
    await test(`3. Quote ${asset} ($50)`, async () => {
      const r = await fetch(
        `${baseUrl}/api/sui/community-pool?action=swap-quote&asset=${asset}&amount=50&network=testnet`,
        { signal: AbortSignal.timeout(30000) },
      );
      const d = await r.json();
      if (!d.success) return { pass: false, details: `API error: ${d.error}` };

      const q = d.data;
      quoteResults[asset] = {
        canSwap: q.canSwapOnChain,
        hedgeVia: q.hedgeVia,
        output: q.expectedAmountOut,
        route: q.route || 'unknown',
      };

      const method = q.canSwapOnChain ? 'ON-CHAIN (Cetus)' : q.hedgeVia ? `HEDGE (${q.hedgeVia})` : 'NO ROUTE';
      return {
        pass: q.canSwapOnChain || !!q.hedgeVia,
        details: `${method} — $50 USDC → ${q.expectedAmountOut} ${asset}, impact=${q.priceImpact || 'n/a'}`,
        data: q,
      };
    });
  }

  // ──────────────────────────────────────────────
  // TEST 4: Admin Wallet — can swaps execute?
  // ──────────────────────────────────────────────
  await test('4. Admin Wallet', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=admin-wallet&network=testnet`, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const w = d.data;
    return {
      pass: w.configured && w.hasGas,
      details: `addr=${(w.address || '').slice(0, 12)}..., SUI=${w.suiBalance}, gas=${w.hasGas}, swaps=${w.swapsEnabled}`,
      data: w,
    };
  });

  // ──────────────────────────────────────────────
  // TEST 5: Execute Deposit Swaps — real hedge test
  // This actually executes on-chain + BlueFin hedges
  // ──────────────────────────────────────────────
  await test('5. Execute Deposit Swaps ($10 test)', async () => {
    // Use a small $10 deposit spread across AI allocations
    const testAmount = 10; // $10 USDC 
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=execute-deposit-swaps&network=testnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountUsdc: testAmount,
        allocations: aiAlloc,
      }),
      signal: AbortSignal.timeout(120000), // 2 min timeout for on-chain execution
    });

    const d = await r.json();
    if (!d.success && r.status >= 500) {
      return { pass: false, details: `Server error ${r.status}: ${d.error || JSON.stringify(d).slice(0, 200)}` };
    }

    // Even partial success is informative
    const data = d.data || d;
    const executed = data.executed || 0;
    const failed = data.failed || 0;
    const swapResults = data.results || [];

    const breakdown = swapResults.map((sr: { asset: string; success: boolean; txDigest?: string; amountIn?: string; amountOut?: string; error?: string }) => {
      if (sr.success) {
        return `  ✓ ${sr.asset}: ${sr.amountIn} USDC → ${sr.amountOut} (tx: ${(sr.txDigest || 'hedge').slice(0, 15)}...)`;
      } else {
        return `  ✗ ${sr.asset}: ${sr.error || 'unknown error'}`;
      }
    }).join('\n');

    console.log(`\n  Deposit swap breakdown:\n${breakdown}\n`);

    return {
      pass: executed > 0,
      details: `${executed} executed, ${failed} failed out of ${swapResults.length} swaps`,
      data,
    };
  });

  // ──────────────────────────────────────────────
  // TEST 6: Auto-Hedge Status
  // ──────────────────────────────────────────────
  await test('6. Auto-Hedge Status', async () => {
    const r = await fetch(`${baseUrl}/api/community-pool/auto-hedge`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();

    const risk = d.riskAssessment || {};
    return {
      pass: d.enabled !== undefined,
      details: `enabled=${d.enabled}, riskScore=${risk.riskScore?.toFixed(2) || 'n/a'}, volatility=${risk.volatility?.toFixed(2) || 'n/a'}`,
      data: { enabled: d.enabled, riskScore: risk.riskScore, volatility: risk.volatility, stats: d.stats },
    };
  });

  // ──────────────────────────────────────────────
  // TEST 7: Contract Info (USDC pool deployment)
  // ──────────────────────────────────────────────
  await test('7. Contract Info', async () => {
    const r = await fetch(`${baseUrl}/api/sui/community-pool?action=contract&network=testnet`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const c = d.data;
    const pkg = c.packageId || c.usdcPool?.packageId || 'MISSING';
    const pool = c.poolStateId || c.usdcPool?.poolStateId || 'MISSING';
    const adminCap = c.adminCapId || c.usdcPool?.adminCapId || 'MISSING';

    return {
      pass: pkg !== 'MISSING' && pool !== 'MISSING',
      details: `pkg=${pkg.slice(0, 15)}..., pool=${pool.slice(0, 15)}..., adminCap=${adminCap.slice(0, 15)}...`,
      data: c,
    };
  });

  // ──────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${results.length} tests\n`);

  // Hedge routing summary
  console.log('═══ HEDGE ROUTING SUMMARY ═══');
  for (const [asset, info] of Object.entries(quoteResults)) {
    const label = info.canSwap ? '🔗 ON-CHAIN (Cetus DEX)' : info.hedgeVia ? `🛡️ HEDGED (${info.hedgeVia})` : '⛔ NO ROUTE';
    console.log(`  ${asset}: ${label}`);
  }
  
  const onChainCount = Object.values(quoteResults).filter(q => q.canSwap).length;
  const hedgedCount = Object.values(quoteResults).filter(q => q.hedgeVia && !q.canSwap).length;
  console.log(`\n  Total: ${onChainCount} on-chain, ${hedgedCount} hedged, ${4 - onChainCount - hedgedCount} no-route`);

  if (failed > 0) {
    console.log('\n═══ FAILED TESTS ═══');
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.name}: ${r.details}`));
  }

  console.log('\n═══ TEST COMPLETE ═══');
}

main().catch(console.error);
