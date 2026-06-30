/**
 * ZK-STARK E2E test — mirrors `scripts/test-custody-attestor-e2e.ts` pattern.
 *
 * Read-only. Verifies the end-to-end path:
 *   1. Python prover server reachable (GET /health)
 *   2. POST /proof/generate returns a proof with the expected fields
 *   3. POST /proof/verify accepts that proof
 *   4. Tampered proof gets rejected
 *
 * Skips cleanly if the Python server isn't running so it's safe to invoke from
 * any environment (`bun run scripts/test-zk-stark-e2e.ts`).
 *
 * Usage:
 *   python start.py            # in another terminal — or: python zkp/api/server.py
 *   bun run scripts/test-zk-stark-e2e.ts
 */

const API_URL = (process.env.ZK_PYTHON_API_URL || 'http://127.0.0.1:8000').trim();

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name} — ${detail}`);
};

async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
}

async function checkServerHealth(): Promise<boolean> {
  const r = await safeFetch(`${API_URL}/health`);
  if (!r) {
    record('Python prover health', false, `Cannot reach ${API_URL}/health — is the server running?`);
    return false;
  }
  if (!r.ok) {
    record('Python prover health', false, `HTTP ${r.status}`);
    return false;
  }
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  record(
    'Python prover health',
    true,
    `${API_URL} reachable (status=${String(body.status ?? 'ok')}, cuda=${String(body.cuda_available ?? 'n/a')})`,
  );
  return true;
}

interface ProofResponse {
  proof?: Record<string, unknown>;
  verified?: boolean;
  error?: string;
  [k: string]: unknown;
}

async function generateProof(): Promise<{ proof: Record<string, unknown>; statement: Record<string, unknown> } | null> {
  const statement = {
    claim: 'Portfolio risk is below threshold',
    threshold: 100,
    public_data: {
      portfolioId: 'e2e-test-portfolio',
      timestamp: new Date().toISOString(),
    },
  };
  const witness = {
    secret_value: 42,
    volatility: 0.18,
    portfolio_value: 10_000_000,
  };

  const r = await safeFetch(`${API_URL}/proof/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof_type: 'risk', statement, witness }),
  });
  if (!r) {
    record('Proof generate (POST /proof/generate)', false, 'request failed');
    return null;
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    record('Proof generate (POST /proof/generate)', false, `HTTP ${r.status} — ${text.slice(0, 200)}`);
    return null;
  }
  const body = (await r.json()) as ProofResponse;
  if (!body.proof || typeof body.proof !== 'object') {
    record('Proof generate (POST /proof/generate)', false, `no proof object in response: ${JSON.stringify(body).slice(0, 200)}`);
    return null;
  }
  const proof = body.proof as Record<string, unknown>;
  const merkleRoot = (proof.merkle_root || proof.trace_merkle_root) as string | undefined;
  const queryCount = Array.isArray(proof.query_responses) ? (proof.query_responses as unknown[]).length : 0;
  const protocol = (proof.protocol as string) || 'unknown';

  if (!merkleRoot) {
    record('Proof generate (POST /proof/generate)', false, 'proof missing merkle_root / trace_merkle_root');
    return null;
  }

  record(
    'Proof generate (POST /proof/generate)',
    true,
    `protocol=${protocol}, merkle_root=${merkleRoot.slice(0, 18)}..., query_responses=${queryCount}`,
  );

  return { proof, statement };
}

async function verifyProof(proof: Record<string, unknown>, statement: Record<string, unknown>): Promise<boolean> {
  const r = await safeFetch(`${API_URL}/proof/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof, statement }),
  });
  if (!r) {
    record('Proof verify (POST /proof/verify)', false, 'request failed');
    return false;
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    record('Proof verify (POST /proof/verify)', false, `HTTP ${r.status} — ${text.slice(0, 200)}`);
    return false;
  }
  const body = (await r.json()) as ProofResponse;
  if (body.verified !== true) {
    record('Proof verify (POST /proof/verify)', false, `verified=${String(body.verified)}, error=${String(body.error || 'n/a')}`);
    return false;
  }
  record('Proof verify (POST /proof/verify)', true, 'genuine proof accepted');
  return true;
}

async function verifyTamperedProof(proof: Record<string, unknown>, statement: Record<string, unknown>): Promise<boolean> {
  // Flip the merkle root — verification must reject.
  const tampered = { ...proof };
  const root = (proof.merkle_root || proof.trace_merkle_root) as string | undefined;
  if (!root) {
    record('Proof verify — tampered', false, 'no root to tamper with');
    return false;
  }
  const flipped = root.slice(0, -2) + (root.endsWith('00') ? 'ff' : '00');
  if ('merkle_root' in tampered) tampered.merkle_root = flipped;
  if ('trace_merkle_root' in tampered) tampered.trace_merkle_root = flipped;

  const r = await safeFetch(`${API_URL}/proof/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof: tampered, statement }),
  });
  if (!r) {
    record('Proof verify — tampered', false, 'request failed');
    return false;
  }
  // Either HTTP error or verified=false is acceptable (both mean: rejected)
  if (!r.ok) {
    record('Proof verify — tampered', true, `tampered proof correctly rejected (HTTP ${r.status})`);
    return true;
  }
  const body = (await r.json()) as ProofResponse;
  if (body.verified === false) {
    record('Proof verify — tampered', true, 'tampered proof correctly rejected (verified=false)');
    return true;
  }
  record('Proof verify — tampered', false, `tampered proof accepted (security issue!): verified=${String(body.verified)}`);
  return false;
}

(async () => {
  console.log('\n=== ZK-STARK E2E Test ===');
  console.log(`Target: ${API_URL}\n`);

  const healthy = await checkServerHealth();
  if (!healthy) {
    console.log('\n⚠️  Python prover not reachable. Start it with:');
    console.log('    python start.py        # OR: python zkp/api/server.py');
    console.log('Then re-run this script.\n');
    process.exit(2);
  }

  const generated = await generateProof();
  if (!generated) {
    console.log('\nGeneration failed — see above. Aborting.\n');
    process.exit(1);
  }

  await verifyProof(generated.proof, generated.statement);
  await verifyTamperedProof(generated.proof, generated.statement);

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n=== ${passed}/${total} checks passed ===\n`);
  process.exit(passed === total ? 0 : 1);
})().catch((e) => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
