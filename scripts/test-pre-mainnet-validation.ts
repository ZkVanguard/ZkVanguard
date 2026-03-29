/**
 * Pre-Mainnet Validation: Comprehensive dry-run of the entire hedge pipeline
 * 
 * Tests every step of deposit → swap/hedge flow WITHOUT executing real trades:
 * 1. Pool contract is live and readable
 * 2. AI allocation engine returns valid percentages
 * 3. Swap quotes resolve for all 4 assets
 * 4. Admin wallet is funded with gas
 * 5. BlueFin auth succeeds (wallet signature → JWT)
 * 6. BlueFin market data is accessible
 * 7. Order construction + signing works for each asset
 * 8. Account onboarding status
 * 9. Full dry-run deposit simulation
 * 
 * Run: npx tsx scripts/test-pre-mainnet-validation.ts
 */

const DEPOSIT_AMOUNT = 100; // $100 test deposit

interface StepResult {
  name: string;
  pass: boolean;
  details: string;
  data?: unknown;
  critical?: boolean; // If true, failure blocks mainnet
}

async function findServer(): Promise<string> {
  for (const port of [3100, 3099, 3200, 3105, 3103, 3000]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/sui/community-pool?action=stats`, {
        signal: AbortSignal.timeout(4000),
      });
      if (r.status < 500) return `http://localhost:${port}`;
    } catch { /* try next */ }
  }
  throw new Error('No dev server found');
}

const results: StepResult[] = [];

async function step(
  name: string,
  critical: boolean,
  fn: () => Promise<{ pass: boolean; details: string; data?: unknown }>,
) {
  try {
    const t0 = Date.now();
    const r = await fn();
    const ms = Date.now() - t0;
    results.push({ name, pass: r.pass, details: r.details, data: r.data, critical });
    console.log(`${r.pass ? '✅' : '❌'} ${name} (${ms}ms)`);
    console.log(`   ${r.details}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, pass: false, details: `ERROR: ${msg}`, critical });
    console.log(`❌ ${name}: ERROR: ${msg}`);
  }
}

async function main() {
  const base = await findServer();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PRE-MAINNET VALIDATION — ${new Date().toISOString()}`);
  console.log(`  Server: ${base}`);
  console.log(`  Deposit Amount: $${DEPOSIT_AMOUNT}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ─── 1. Pool Contract ───
  let sharePrice = 0;
  await step('1. Pool Contract Live', true, async () => {
    const r = await fetch(`${base}/api/sui/community-pool?network=testnet`, {
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const p = d.data;
    sharePrice = parseFloat(p.sharePriceUsdc || p.sharePriceUsd || p.sharePrice || '0');
    const nav = parseFloat(p.totalNAVUsdc || p.totalNAV || '0');
    const shares = parseFloat(p.totalShares || '0');

    return {
      pass: sharePrice > 0 && nav >= 0,
      details: `NAV=$${nav.toFixed(2)}, shares=${shares.toFixed(4)}, sharePrice=$${sharePrice.toFixed(6)}`,
      data: p,
    };
  });

  // ─── 2. Contract Deployment Info ───
  await step('2. Contract Deployment', true, async () => {
    const r = await fetch(`${base}/api/sui/community-pool?action=contract&network=testnet`, {
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const c = d.data;
    const pkg = c.packageId || c.usdcPool?.packageId || 'MISSING';
    const pool = c.poolStateId || c.usdcPool?.poolStateId || 'MISSING';

    return {
      pass: pkg !== 'MISSING' && pool !== 'MISSING',
      details: `package=${pkg.slice(0, 20)}..., pool=${pool.slice(0, 20)}...`,
      data: c,
    };
  });

  // ─── 3. AI Allocation ───
  let aiAlloc: Record<string, number> = { BTC: 30, ETH: 30, SUI: 25, CRO: 15 };
  await step('3. AI Allocation Engine', true, async () => {
    const r = await fetch(`${base}/api/sui/community-pool?action=allocation&network=testnet`, {
      signal: AbortSignal.timeout(30000),
    });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const raw = d.data.allocation || d.data.allocations || d.data;
    aiAlloc = { BTC: raw.BTC || 0, ETH: raw.ETH || 0, SUI: raw.SUI || 0, CRO: raw.CRO || 0 };
    const total = Object.values(aiAlloc).reduce((a, b) => a + b, 0);
    const source = d.data.source || 'unknown';

    return {
      pass: Math.abs(total - 100) < 2,
      details: `BTC=${aiAlloc.BTC}% ETH=${aiAlloc.ETH}% SUI=${aiAlloc.SUI}% CRO=${aiAlloc.CRO}% (sum=${total}%, source=${source})`,
      data: { allocation: aiAlloc, source },
    };
  });

  // ─── 4. Admin Wallet ───
  await step('4. Admin Wallet Gas', true, async () => {
    const r = await fetch(`${base}/api/sui/community-pool?action=admin-wallet&network=testnet`, {
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error}` };

    const w = d.data;
    return {
      pass: w.configured && w.hasGas,
      details: `address=${(w.address || '').slice(0, 16)}..., SUI=${w.suiBalance}, hasGas=${w.hasGas}`,
      data: w,
    };
  });

  // ─── 5. Swap Quotes per Asset ───
  for (const asset of ['BTC', 'ETH', 'SUI', 'CRO'] as const) {
    const usdcForAsset = Math.round(DEPOSIT_AMOUNT * (aiAlloc[asset] || 0) / 100);
    if (usdcForAsset < 1) continue;

    await step(`5. Quote ${asset} ($${usdcForAsset})`, true, async () => {
      const r = await fetch(
        `${base}/api/sui/community-pool?action=swap-quote&asset=${asset}&amount=${usdcForAsset}&network=testnet`,
        { signal: AbortSignal.timeout(30000) },
      );
      const d = await r.json();
      if (!d.success) return { pass: false, details: `API error: ${d.error}` };

      const q = d.data;
      const route = q.canSwapOnChain ? 'ON-CHAIN (Cetus DEX)' : q.hedgeVia ? `HEDGE (${q.hedgeVia})` : 'NO ROUTE';
      const hasRoute = q.canSwapOnChain || !!q.hedgeVia;
      const output = q.expectedAmountOut || '0';

      return {
        pass: hasRoute,
        details: `${route} — $${usdcForAsset} USDC → ${output} ${asset}, simulated=${q.isSimulated || false}`,
        data: q,
      };
    });
  }

  // ─── 6. Full Dry-Run Deposit ───
  await step('6. Dry-Run Deposit (full pipeline)', true, async () => {
    const r = await fetch(`${base}/api/sui/community-pool?action=dry-run-deposit-swaps&network=testnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsdc: DEPOSIT_AMOUNT, allocations: aiAlloc }),
      signal: AbortSignal.timeout(120000),
    });
    const d = await r.json();
    if (!d.success) return { pass: false, details: `API error: ${d.error || JSON.stringify(d).slice(0, 200)}` };

    const data = d.data;
    const walletOk = data.wallet?.configured && data.wallet?.hasGas;
    const planSwaps = data.plan?.swaps?.length || 0;
    const execution = data.execution || {};
    const hedgeValidation = data.hedgeValidation || [];

    // Print detailed hedge validation
    if (hedgeValidation.length > 0) {
      console.log(`\n   Hedge Validation Details:`);
      for (const hv of hedgeValidation) {
        console.log(`   ┌─ ${hv.asset}`);
        for (const st of hv.steps || []) {
          console.log(`   │  ${st.passed ? '✓' : '✗'} ${st.step}: ${st.detail}`);
        }
        if (hv.order) {
          console.log(`   │  📋 Order: ${hv.order.notionalValueUsd ? `$${(hv.order.notionalValueUsd as number).toFixed(2)}` : 'n/a'} → ${hv.order.wouldSubmitTo || 'n/a'}`);
        }
        console.log(`   └─`);
      }
    }

    // Print swap results
    const swapResults = execution.results || [];
    if (swapResults.length > 0) {
      console.log(`\n   Swap Results:`);
      for (const sr of swapResults) {
        const icon = sr.success ? '✓' : '✗';
        console.log(`   ${icon} ${sr.asset}: ${sr.error || 'OK'}`);
      }
    }

    // Check for critical blockers
    const accountSteps = hedgeValidation.flatMap((hv: { steps?: Array<{ step: string; passed: boolean }> }) =>
      (hv.steps || []).filter((s: { step: string }) => s.step === 'account')
    );
    const allOnboarded = accountSteps.length > 0 && accountSteps.every((s: { passed: boolean }) => s.passed);
    const allAuthOk = hedgeValidation.every((hv: { steps?: Array<{ step: string; passed: boolean }> }) =>
      (hv.steps || []).find((s: { step: string }) => s.step === 'auth')?.passed
    );
    const allMarketsOk = hedgeValidation.every((hv: { steps?: Array<{ step: string; passed: boolean }> }) =>
      (hv.steps || []).find((s: { step: string }) => s.step === 'market-data')?.passed
    );
    const allSignaturesOk = hedgeValidation.every((hv: { steps?: Array<{ step: string; passed: boolean }> }) =>
      (hv.steps || []).find((s: { step: string }) => s.step === 'signature')?.passed
    );

    const summary = [
      `wallet=${walletOk ? 'OK' : 'FAIL'}`,
      `plan=${planSwaps} swaps`,
      `auth=${allAuthOk ? 'OK' : 'FAIL'}`,
      `onboarded=${allOnboarded ? 'YES' : 'NO'}`,
      `markets=${allMarketsOk ? 'OK' : 'FAIL'}`,
      `signatures=${allSignaturesOk ? 'OK' : 'FAIL'}`,
    ].join(', ');

    // Pipeline is "ready" if everything works except possibly onboarding
    const pipelineReady = walletOk && allAuthOk && allMarketsOk && allSignaturesOk;

    return {
      pass: pipelineReady,
      details: summary + (pipelineReady && !allOnboarded ? ' ← ONLY MISSING: BlueFin onboarding' : ''),
      data,
    };
  });

  // ─── 7. Auto-Hedge Config ───
  await step('7. Auto-Hedge Config', false, async () => {
    const r = await fetch(`${base}/api/community-pool/auto-hedge`, {
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    const risk = d.riskAssessment || {};

    return {
      pass: d.enabled !== undefined,
      details: `enabled=${d.enabled}, riskScore=${risk.riskScore?.toFixed(2) || 'n/a'}, volatility=${risk.volatility?.toFixed(2) || 'n/a'}`,
    };
  });

  // ─── SUMMARY ───
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS SUMMARY`);
  console.log(`${'═'.repeat(60)}`);

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const criticalFails = results.filter(r => !r.pass && r.critical);

  console.log(`\n  Total: ${passed} passed, ${failed} failed (${results.length} tests)`);

  if (criticalFails.length > 0) {
    console.log(`\n  ⛔ CRITICAL BLOCKERS (${criticalFails.length}):`);
    for (const f of criticalFails) {
      console.log(`     ${f.name}: ${f.details}`);
    }
  }

  // Mainnet readiness assessment
  const hasAuth = results.some(r => r.details.includes('auth=OK'));
  const hasMarkets = results.some(r => r.details.includes('markets=OK'));
  const hasSigs = results.some(r => r.details.includes('signatures=OK'));
  const hasOnboarding = results.some(r => r.details.includes('onboarded=YES'));

  console.log(`\n  MAINNET CHECKLIST:`);
  console.log(`  ${hasAuth ? '✅' : '❌'} BlueFin authentication (wallet → JWT)`);
  console.log(`  ${hasMarkets ? '✅' : '❌'} Market data (prices, funding rates)`);
  console.log(`  ${hasSigs ? '✅' : '❌'} Order signing (Ed25519 signature)`);
  console.log(`  ${hasOnboarding ? '✅' : '⬜'} BlueFin account onboarded`);

  if (hasAuth && hasMarkets && hasSigs && !hasOnboarding) {
    console.log(`\n  📋 STATUS: Pipeline VERIFIED — only onboarding remains`);
    console.log(`     The entire flow from deposit → quote → order construction → signing works.`);
    console.log(`     To complete: visit https://trade.bluefin.io/pro, connect wallet, register.`);
    console.log(`     Then re-run this test to confirm onboarding=YES.`);
  } else if (hasAuth && hasMarkets && hasSigs && hasOnboarding) {
    console.log(`\n  🟢 MAINNET READY — all checks passed`);
  } else {
    console.log(`\n  🔴 NOT READY — fix critical failures above`);
  }

  console.log(`\n${'═'.repeat(60)}\n`);

  // Write results to file for programmatic consumption
  const fs = await import('fs');
  fs.writeFileSync(
    'pre-mainnet-results.json',
    JSON.stringify({ timestamp: new Date().toISOString(), results, passed, failed }, null, 2),
  );
  console.log(`Results written to pre-mainnet-results.json`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
