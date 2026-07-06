'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';
import { Navbar } from '@/components/Navbar';
import { Shield, Cpu, Lock, CheckCircle2, ArrowRight, ExternalLink } from 'lucide-react';

// Single focused ZK page. Replaces the three separate /zk-authenticity, /zk-proof,
// and /zk-verification pages that grew independently and drifted apart. Structure:
//   1. Hero — what STARK-attested vault means in one paragraph.
//   2. Live prover health — is the Python STARK backend up right now.
//   3. Explainer — how the STARK works, honest about field choice and soundness.
//   4. Verify widget — paste a proof hash, we tell you if it's on-chain.
//   5. Deep-dive links — the old pages moved to sub-routes for anyone who wants detail.

interface ProverHealth {
  status: 'healthy' | 'unhealthy' | 'unavailable';
  cuda_available?: boolean;
  cuda_enabled?: boolean;
  backend?: string;
  error?: string;
}

export default function ZkPage() {
  const [health, setHealth] = useState<ProverHealth | null>(null);
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyResult, setVerifyResult] = useState<null | { found: boolean; detail?: string }>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  useEffect(() => {
    fetch('/api/zk-proof/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unavailable' }));
  }, []);

  const verify = async () => {
    const q = verifyInput.trim();
    if (!q) return;
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const r = await fetch(`/api/zk-proof/lookup?hash=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const data = await r.json();
      if (r.ok && data?.found) {
        setVerifyResult({ found: true, detail: data.detail || `Verified on-chain at ${data.timestamp ?? 'unknown time'}` });
      } else {
        setVerifyResult({ found: false, detail: data?.error || 'Proof not found on-chain. Check the hash and try again.' });
      }
    } catch (e) {
      setVerifyResult({ found: false, detail: e instanceof Error ? e.message : 'Verification failed' });
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 pt-32 pb-24">
        {/* Hero */}
        <div className="text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#007AFF]/10 rounded-full text-sm font-medium mb-6 text-[#007AFF]">
            <Shield className="w-4 h-4" />
            <span>ZK-STARK · Post-Quantum · No Trusted Setup</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-[#1D1D1F] mb-6 tracking-tight">
            Every vault decision, <br className="hidden md:block" />
            <span className="text-[#007AFF]">cryptographically attested.</span>
          </h1>
          <p className="text-xl text-[#424245] max-w-2xl mx-auto leading-relaxed">
            When our AI agents commit to a hedge, allocation, or rebalance, the decision is proven correct with a
            zero-knowledge STARK — no trusted setup, post-quantum secure by construction, verifiable by anyone.
          </p>
        </div>

        {/* Prover health card */}
        <div className="rounded-2xl border border-[#E5E5E7] bg-gradient-to-br from-white to-[#F5F5F7] p-8 mb-16">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm text-[#86868B] mb-1">Prover backend</div>
              <div className="text-2xl font-semibold text-[#1D1D1F]">
                {health ? (
                  health.status === 'healthy' ? 'Online' :
                  health.status === 'unhealthy' ? 'Degraded' : 'Offline'
                ) : 'Checking…'}
              </div>
            </div>
            <div className={`w-3 h-3 rounded-full ${
              health?.status === 'healthy' ? 'bg-green-500' :
              health?.status === 'unhealthy' ? 'bg-orange-500' :
              health?.status === 'unavailable' ? 'bg-red-500' : 'bg-gray-300'
            }`} />
          </div>
          {health && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-[#86868B]">CUDA</div>
                <div className="text-[#1D1D1F] font-medium flex items-center gap-2">
                  {health.cuda_enabled ? (
                    <>
                      <Cpu className="w-4 h-4 text-green-600" /> Accelerated
                    </>
                  ) : health.cuda_available ? (
                    'Available'
                  ) : (
                    'CPU only'
                  )}
                </div>
              </div>
              <div>
                <div className="text-[#86868B]">Endpoint</div>
                <div className="text-[#1D1D1F] font-medium truncate">{health.backend || '—'}</div>
              </div>
            </div>
          )}
        </div>

        {/* Explainer */}
        <section className="mb-20">
          <h2 className="text-3xl font-bold text-[#1D1D1F] mb-8">How it works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl border border-[#E5E5E7] p-6">
              <div className="w-10 h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center mb-4">
                <Lock className="w-5 h-5 text-[#007AFF]" />
              </div>
              <h3 className="font-semibold text-[#1D1D1F] mb-2">Trace the computation</h3>
              <p className="text-[#424245] text-sm leading-relaxed">
                Each agent decision (allocation percentages, hedge sizing, risk score) is compiled into an execution
                trace — a matrix of intermediate states the prover walks through.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E5E7] p-6">
              <div className="w-10 h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5 text-[#007AFF]" />
              </div>
              <h3 className="font-semibold text-[#1D1D1F] mb-2">Commit + prove</h3>
              <p className="text-[#424245] text-sm leading-relaxed">
                AIR constraints on the trace are extended and folded through FRI (Fast Reed-Solomon IOP).
                Merkle-committed with SHA-256. Fiat-Shamir non-interactivity.
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E5E5E7] p-6">
              <div className="w-10 h-10 rounded-lg bg-[#007AFF]/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-5 h-5 text-[#007AFF]" />
              </div>
              <h3 className="font-semibold text-[#1D1D1F] mb-2">Verify anywhere</h3>
              <p className="text-[#424245] text-sm leading-relaxed">
                Proofs are 10–50 KB. Verification is 50–200 ms off-chain and constant-time — no interaction with the
                prover, no trust in the AI, no revealing the underlying data.
              </p>
            </div>
          </div>
        </section>

        {/* Honest security block */}
        <section className="mb-20">
          <div className="rounded-2xl bg-[#F5F5F7] p-8">
            <h2 className="text-2xl font-bold text-[#1D1D1F] mb-6">Security parameters</h2>
            <dl className="grid md:grid-cols-2 gap-x-8 gap-y-4 text-[15px]">
              <div>
                <dt className="text-[#86868B]">Field</dt>
                <dd className="text-[#1D1D1F] font-medium">Goldilocks-64 (default) · NIST P-521 prime available</dd>
              </div>
              <div>
                <dt className="text-[#86868B]">Commitments</dt>
                <dd className="text-[#1D1D1F] font-medium">SHA-256 Merkle trees · Fiat-Shamir non-interactive</dd>
              </div>
              <div>
                <dt className="text-[#86868B]">Soundness</dt>
                <dd className="text-[#1D1D1F] font-medium">~180 bits effective (FRI queries + grinding)</dd>
              </div>
              <div>
                <dt className="text-[#86868B]">Trusted setup</dt>
                <dd className="text-[#1D1D1F] font-medium">None — hash-based commitments only</dd>
              </div>
              <div>
                <dt className="text-[#86868B]">Post-quantum</dt>
                <dd className="text-[#1D1D1F] font-medium">Yes — no discrete-log or factoring assumption</dd>
              </div>
              <div>
                <dt className="text-[#86868B]">Acceleration</dt>
                <dd className="text-[#1D1D1F] font-medium">CUDA (CuPy / Numba) with CPU fallback</dd>
              </div>
            </dl>
            <p className="text-sm text-[#86868B] mt-6 leading-relaxed">
              Post-quantum security comes from the hash-based commitment structure, not field size. Effective
              soundness of ~180 bits from FRI queries + grinding is well above post-quantum requirements.
            </p>
          </div>
        </section>

        {/* Verify widget */}
        <section className="mb-20">
          <h2 className="text-3xl font-bold text-[#1D1D1F] mb-6">Verify a proof</h2>
          <p className="text-[#424245] mb-6">
            Paste a proof hash (0x…) or transaction digest from the vault's activity log. We&apos;ll check whether it&apos;s
            recorded on-chain and return its details.
          </p>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={verifyInput}
              onChange={(e) => setVerifyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verify()}
              placeholder="0x…"
              className="flex-1 h-12 px-4 rounded-xl border border-[#E5E5E7] focus:border-[#007AFF] focus:outline-none text-[#1D1D1F] font-mono text-sm"
            />
            <button
              onClick={verify}
              disabled={verifyLoading || !verifyInput.trim()}
              className="h-12 px-6 rounded-xl bg-[#007AFF] text-white font-medium hover:bg-[#0056B3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifyLoading ? 'Checking…' : 'Verify'}
            </button>
          </div>
          {verifyResult && (
            <div className={`mt-4 p-4 rounded-xl ${verifyResult.found ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              <div className="flex items-start gap-3">
                {verifyResult.found ? (
                  <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                ) : (
                  <ExternalLink className="w-5 h-5 mt-0.5 flex-shrink-0 opacity-70" />
                )}
                <div className="text-sm leading-relaxed">{verifyResult.detail}</div>
              </div>
            </div>
          )}
        </section>

        {/* Deep dive */}
        <section className="border-t border-[#E5E5E7] pt-12">
          <h2 className="text-2xl font-bold text-[#1D1D1F] mb-6">Go deeper</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <Link
              href="/zk/authenticity"
              className="group p-6 rounded-xl border border-[#E5E5E7] hover:border-[#007AFF] transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-[#1D1D1F]">Implementation authenticity</span>
                <ArrowRight className="w-4 h-4 text-[#86868B] group-hover:text-[#007AFF]" />
              </div>
              <p className="text-sm text-[#424245]">
                Prove the STARK isn&apos;t simulated — CUDA specs, field parameters, source-verifiable.
              </p>
            </Link>
            <Link
              href="/zk/proof"
              className="group p-6 rounded-xl border border-[#E5E5E7] hover:border-[#007AFF] transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-[#1D1D1F]">Generate your own</span>
                <ArrowRight className="w-4 h-4 text-[#86868B] group-hover:text-[#007AFF]" />
              </div>
              <p className="text-sm text-[#424245]">
                Interactive prover UI — trace, commit, prove, verify. Wallet-signed statements.
              </p>
            </Link>
            <Link
              href="/zk/verification"
              className="group p-6 rounded-xl border border-[#E5E5E7] hover:border-[#007AFF] transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-[#1D1D1F]">Hedge attestations</span>
                <ArrowRight className="w-4 h-4 text-[#86868B] group-hover:text-[#007AFF]" />
              </div>
              <p className="text-sm text-[#424245]">
                Look up ZK-attested hedges by hedge ID or wallet address.
              </p>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
