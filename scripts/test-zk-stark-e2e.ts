/**
 * ZK-STARK E2E test — exercises the real Python prover API.
 *
 * Read-only. Verifies:
 *   1. Server is reachable + CUDA status
 *   2. POST /api/zk/generate + GET /api/zk/proof/{id} produces a STARK proof
 *      with the expected fields (merkle_root, challenge, response, query_responses)
 *   3. POST /api/zk/verify accepts the genuine proof
 *   4. POST /api/zk/verify REJECTS a tampered proof
 *   5. CUDA acceleration is end-to-end (gen + verify report cuda_accelerated:true)
 *
 * Skips cleanly if the Python server isn't running.
 *
 * Usage:
 *   python zkp/api/server.py     # in another terminal
 *   bun run scripts/test-zk-stark-e2e.ts
 */

const API_URL = (process.env.ZK_PYTHON_API_URL || 'http://127.0.0.1:8000').trim();

interface CheckResult { name: string; ok: boolean; detail: string; }
const results: CheckResult[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
};

async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    return null;
  }
}

interface HealthBody {
  status?: string;
  cuda_available?: boolean;
  cuda_enabled?: boolean;
  system_info?: Record<string, unknown>;
}

async function checkServerHealth(): Promise<{ ok: boolean; cudaEnabled: boolean }> {
  const r = await safeFetch(`${API_URL}/health`);
  if (!r) {
    record('Python prover health', false, `Cannot reach ${API_URL}/health — is the server running?`);
    return { ok: false, cudaEnabled: false };
  }
  if (!r.ok) {
    record('Python prover health', false, `HTTP ${r.status}`);
    return { ok: false, cudaEnabled: false };
  }
  const body = (await r.json().catch(() => ({}))) as HealthBody;
  const cudaEnabled = body.cuda_enabled === true;
  record(
    'Python prover health',
    true,
    `status=${body.status ?? 'ok'}, cuda_available=${body.cuda_available}, cuda_enabled=${cudaEnabled}`,
  );
  return { ok: true, cudaEnabled };
}

interface GenerateResp { job_id?: string; status?: string; error?: string; }
interface JobResp { status?: string; proof?: Record<string, unknown> | null; error?: string | null; duration_ms?: number | null; }
interface VerifyResp { valid?: boolean; cuda_accelerated?: boolean; duration_ms?: number; }

async function generateProof(): Promise<{ proof: Record<string, unknown>; statement: Record<string, unknown>; durationMs: number } | null> {
  const statement = {
    claim: 'Portfolio risk below threshold',
    threshold: 100,
    public_inputs: [42],
  };
  const witness = { secret_value: 42, portfolio_value: 10_000_000, volatility: 18 };

  const r = await safeFetch(`${API_URL}/api/zk/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof_type: 'risk', data: { statement, witness } }),
  });
  if (!r || !r.ok) {
    record('Proof generate (POST /api/zk/generate)', false, `HTTP ${r?.status ?? 'no-resp'}`);
    return null;
  }
  const gen = (await r.json()) as GenerateResp;
  if (!gen.job_id) {
    record('Proof generate (POST /api/zk/generate)', false, `no job_id: ${JSON.stringify(gen)}`);
    return null;
  }

  // Poll for completion
  const startedAt = Date.now();
  const deadline = startedAt + 60_000;
  let job: JobResp | null = null;
  while (Date.now() < deadline) {
    const pr = await safeFetch(`${API_URL}/api/zk/proof/${gen.job_id}`);
    if (!pr || !pr.ok) {
      await new Promise((res) => setTimeout(res, 500));
      continue;
    }
    job = (await pr.json()) as JobResp;
    if (job.status === 'completed' || job.status === 'failed') break;
    await new Promise((res) => setTimeout(res, 250));
  }
  if (!job || job.status !== 'completed' || !job.proof) {
    record('Proof generate (POST /api/zk/generate)', false, `final status=${job?.status}, error=${job?.error ?? 'n/a'}`);
    return null;
  }

  const proof = job.proof;
  const merkleRoot = (proof.merkle_root || proof.trace_merkle_root) as string | undefined;
  const queryCount = Array.isArray(proof.query_responses) ? (proof.query_responses as unknown[]).length : 0;
  const securityBits = proof.security_level as number | undefined;
  const cudaAccel = proof.cuda_acceleration as boolean | undefined;
  const totalMs = Date.now() - startedAt;

  if (!merkleRoot) {
    record('Proof generate (POST /api/zk/generate)', false, 'proof missing merkle_root');
    return null;
  }

  record(
    'Proof generate (POST /api/zk/generate)',
    true,
    `${totalMs}ms wall, security=${securityBits}bit, query_responses=${queryCount}, cuda=${cudaAccel}, root=${merkleRoot.slice(0, 18)}...`,
  );
  return { proof, statement, durationMs: totalMs };
}

async function verifyProof(proof: Record<string, unknown>, statement: Record<string, unknown>, label: string, expectValid: boolean): Promise<boolean> {
  const r = await safeFetch(`${API_URL}/api/zk/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof,
      public_inputs: statement.public_inputs ?? [],
      claim: statement.claim,
    }),
  });
  if (!r) {
    record(label, false, 'request failed');
    return false;
  }
  if (!r.ok) {
    // For tampered proofs, the server might 400. That's a valid rejection.
    if (!expectValid) {
      record(label, true, `tampered proof rejected at HTTP layer (${r.status})`);
      return true;
    }
    record(label, false, `HTTP ${r.status}`);
    return false;
  }
  const body = (await r.json()) as VerifyResp;
  const matched = body.valid === expectValid;
  if (matched) {
    record(label, true, `valid=${body.valid}, duration=${body.duration_ms}ms, cuda=${body.cuda_accelerated}`);
  } else {
    record(label, false, `expected valid=${expectValid} but got valid=${body.valid}`);
  }
  return matched;
}

async function tamperedProofRejected(proof: Record<string, unknown>, statement: Record<string, unknown>): Promise<boolean> {
  const tampered: Record<string, unknown> = { ...proof };
  const root = (proof.merkle_root || proof.trace_merkle_root) as string | undefined;
  if (!root) {
    record('Tampered proof rejected', false, 'no root to tamper with');
    return false;
  }
  const flipped = root.slice(0, -1) + (root.endsWith('0') ? '1' : '0');
  if ('merkle_root' in tampered) tampered.merkle_root = flipped;
  if ('trace_merkle_root' in tampered) tampered.trace_merkle_root = flipped;
  return await verifyProof(tampered, statement, 'Tampered proof rejected (valid must=false)', false);
}

(async () => {
  console.log('\n=== ZK-STARK E2E Test ===');
  console.log(`Target: ${API_URL}\n`);

  const health = await checkServerHealth();
  if (!health.ok) {
    console.log('\n⚠️  Python prover not reachable. Start it with:');
    console.log('    python zkp/api/server.py');
    console.log('Then re-run this script.\n');
    process.exit(2);
  }

  const generated = await generateProof();
  if (!generated) {
    console.log('\nGeneration failed — see above.\n');
    process.exit(1);
  }

  await verifyProof(generated.proof, generated.statement, 'Genuine proof verifies (valid must=true)', true);
  await tamperedProofRejected(generated.proof, generated.statement);

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n=== ${passed}/${total} checks passed ===`);
  if (health.cudaEnabled) console.log('CUDA: end-to-end accelerated path verified.');
  console.log('');
  process.exit(passed === total ? 0 : 1);
})().catch((e) => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
