/**
 * Post-Deploy Smoke Test
 *
 * Run this immediately after any Vercel deploy. Verifies the critical
 * user journeys still work end-to-end against the live URL. If any check
 * fails the operator should `vercel rollback` before capital is at risk.
 *
 * Read-only. No signing, no state changes. Idempotent.
 *
 * Usage:
 *   POST_DEPLOY_URL=https://www.zkvanguard.xyz bun run scripts/post-deploy-smoke-test.ts
 *   POST_DEPLOY_URL=... POST_DEPLOY_STRICT=1 bun run scripts/post-deploy-smoke-test.ts
 *
 * Exit codes:
 *   0 — all critical paths healthy
 *   1 — at least one CRITICAL check failed (roll back deploy)
 *   2 — at least one HIGH check failed (investigate before promoting)
 */

const URL = (process.env.POST_DEPLOY_URL || 'https://www.zkvanguard.xyz').replace(/\/$/, '');
const STRICT = (process.env.POST_DEPLOY_STRICT ?? '') === '1';
const TIMEOUT_MS = 10_000;

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
interface Check {
  name: string;
  severity: Sev;
  ok: boolean;
  detail: string;
  latencyMs?: number;
}
const checks: Check[] = [];

function record(name: string, severity: Sev, ok: boolean, detail: string, latencyMs?: number) {
  checks.push({ name, severity, ok, detail, latencyMs });
  const icon = ok ? '✅' : severity === 'CRITICAL' ? '💀' : '❌';
  console.log(`${icon} [${severity}] ${name}${latencyMs !== undefined ? ` (${latencyMs}ms)` : ''} — ${detail}`);
}

async function checkEndpoint(
  name: string,
  severity: Sev,
  path: string,
  validate: (data: unknown, status: number) => { ok: boolean; detail: string },
  init: RequestInit = {},
) {
  const start = Date.now();
  try {
    const r = await fetch(`${URL}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const latency = Date.now() - start;
    let data: unknown = null;
    const contentType = r.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await r.json().catch(() => null);
    } else {
      data = await r.text().catch(() => '');
    }
    const v = validate(data, r.status);
    record(name, severity, v.ok, v.detail, latency);
  } catch (e) {
    const latency = Date.now() - start;
    record(name, severity, false, `Request failed: ${e instanceof Error ? e.message : String(e)}`, latency);
  }
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  POST-DEPLOY SMOKE TEST — ${URL.padEnd(30)} ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

  // ── CRITICAL: production health surface ────────────────────────────────
  await checkEndpoint('Production health endpoint', 'CRITICAL', '/api/health/production',
    (data, status) => {
      if (status >= 500) return { ok: false, detail: `HTTP ${status}` };
      const d = data as { status?: string };
      if (d.status !== 'healthy' && d.status !== 'degraded') return { ok: false, detail: `status=${d.status}` };
      return { ok: true, detail: `status=${d.status}` };
    });

  // ── CRITICAL: platform risk overview returns for anonymous users ───────
  await checkEndpoint('Platform risk overview reads OK', 'CRITICAL', '/api/platform/risk-overview',
    (data, status) => {
      if (status >= 500) return { ok: false, detail: `HTTP ${status}` };
      const d = data as { platform?: { tvlUsd?: number } };
      if (typeof d.platform?.tvlUsd !== 'number') return { ok: false, detail: 'missing platform.tvlUsd' };
      return { ok: true, detail: `TVL=$${d.platform.tvlUsd.toFixed(2)}` };
    });

  // ── HIGH: agent section is present + non-null cycle ────────────────────
  await checkEndpoint('Agent activity surfaced', 'HIGH', '/api/platform/risk-overview',
    (data) => {
      const d = data as { agents?: { cycle?: { ranAt: string | null }; directives?: unknown[] } };
      const cycleRanAt = d.agents?.cycle?.ranAt;
      const directives = d.agents?.directives ?? [];
      if (!cycleRanAt) return { ok: false, detail: 'agents.cycle.ranAt is null — LeadAgent cycle never ran (redeploy just happened + <30min old is OK on first check)' };
      return { ok: true, detail: `cycle ran ${new Date(cycleRanAt).toISOString()}, directives=${directives.length}` };
    });

  // ── HIGH: locale routing works — pool landing page renders ────────────
  await checkEndpoint('Locale root serves HTML', 'HIGH', '/en',
    (data, status) => {
      if (status >= 500) return { ok: false, detail: `HTTP ${status}` };
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      if (text.length < 100) return { ok: false, detail: `Response too short (${text.length} bytes)` };
      return { ok: true, detail: `${text.length} bytes` };
    });

  // ── HIGH: developer API surface is reachable ──────────────────────────
  await checkEndpoint('Developer surface page renders', 'HIGH', '/en/developers',
    (data, status) => {
      if (status >= 500) return { ok: false, detail: `HTTP ${status}` };
      return { ok: true, detail: 'OK' };
    });

  // ── HIGH: unified portfolio endpoint validates input ──────────────────
  await checkEndpoint('Unified portfolio API rejects malformed input', 'HIGH', '/api/portfolio/unified?wallet=invalid',
    (data, status) => {
      if (status === 200) return { ok: false, detail: 'Should reject invalid wallet address' };
      const d = data as { error?: string };
      if (typeof d.error !== 'string') return { ok: false, detail: 'Rejected but no error field' };
      return { ok: true, detail: `Rejected: ${d.error.slice(0, 60)}` };
    });

  // ── MEDIUM: custody attestations endpoint responds ────────────────────
  await checkEndpoint('Custody attestations API responds',  'MEDIUM',
    '/api/custody?action=list-attestations&wallet=0x' + '0'.repeat(64),
    (data, status) => {
      if (status >= 500) return { ok: false, detail: `HTTP ${status}` };
      const d = data as { deployed?: boolean; attestations?: unknown[] };
      // 'deployed: false' is expected if custody attestor not on mainnet — that's fine
      return { ok: true, detail: `deployed=${d.deployed}, attestations=${d.attestations?.length ?? 0}` };
    });

  // ── MEDIUM: portfolio unified for valid SUI wallet ────────────────────
  await checkEndpoint('Portfolio unified accepts valid SUI wallet', 'MEDIUM',
    '/api/portfolio/unified?wallet=0x' + '1'.repeat(64),
    (data, status) => {
      if (status >= 500) return { ok: false, detail: `HTTP ${status}` };
      const d = data as { wallet?: string; walletKind?: string };
      if (d.walletKind !== 'sui') return { ok: false, detail: `walletKind=${d.walletKind}` };
      return { ok: true, detail: `wallet detected as ${d.walletKind}` };
    });

  // ── MEDIUM: latency budget check ──────────────────────────────────────
  const critical = checks.filter((c) => c.severity === 'CRITICAL');
  const slowest = [...critical].sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0))[0];
  if (slowest && (slowest.latencyMs ?? 0) > 5_000) {
    record('P95 latency budget', 'MEDIUM', false,
      `Slowest critical path: ${slowest.name} at ${slowest.latencyMs}ms > 5000ms SLO`);
  } else if (slowest) {
    record('P95 latency budget', 'INFO', true, `Slowest critical: ${slowest.latencyMs ?? 0}ms`);
  }

  console.log('\n── SUMMARY ──');
  const failed = checks.filter((c) => !c.ok);
  const cFailed = failed.filter((c) => c.severity === 'CRITICAL');
  const hFailed = failed.filter((c) => c.severity === 'HIGH');
  const mFailed = failed.filter((c) => c.severity === 'MEDIUM');

  console.log(`  ${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
  if (cFailed.length) console.log(`  💀 ${cFailed.length} CRITICAL failure(s) — ROLL BACK NOW`);
  if (hFailed.length) console.log(`  ❌ ${hFailed.length} HIGH failure(s) — INVESTIGATE BEFORE PROMOTING`);
  if (mFailed.length) console.log(`  ⚠️  ${mFailed.length} MEDIUM issue(s) — non-blocking`);

  if (cFailed.length) process.exit(1);
  if (STRICT && hFailed.length) process.exit(2);
  if (hFailed.length) process.exit(2);
  process.exit(0);
}

main().catch((e) => {
  console.error('Smoke test threw:', e);
  process.exit(1);
});
