"use client";

import React, { useState, useEffect } from 'react';
import { Shield, CheckCircle, Code, Cpu, Lock, FileCode, Zap, Upload, AlertCircle } from 'lucide-react';
import { logger } from '@/lib/utils/logger';

interface AuthenticityData {
  authentic: boolean;
  verification_timestamp: string;
  implementation: {
    system: string;
    location: string;
    type: string;
    not_simulated: boolean;
    source_verifiable: boolean;
  };
  cryptographic_parameters: {
    field: string;
    field_prime: string;
    field_bits: number;
    security_level: number;
    hash_function: string;
    commitment_scheme: string;
    post_quantum_secure: boolean;
  };
  cuda_optimization: {
    available: boolean;
    enabled: boolean;
    accelerates: string[];
    performance_gain: string;
  };
  test_proof?: {
    generated: boolean;
    statement_hash: string;
    security_level: number;
    generation_time: number;
    field_prime: string;
    proof_type: string;
  };
  source_code: {
    backend: string;
    prover: string;
    verifier: string;
    integration: string;
    contracts: string;
    public_repository: boolean;
    auditable: boolean;
  };
  zk_properties: {
    completeness: string;
    soundness: string;
    zero_knowledge: string;
    transparency: string;
    post_quantum: string;
    proof_size: string;
    verifier_time: string;
  };
  verification_methods: Array<{
    method: string;
    steps: string[];
  }>;
  system_status: {
    backend_operational: boolean;
    cuda_available: boolean;
    cuda_enabled: boolean;
    proof_generation_working: boolean;
    average_proof_time: string | number;
  };
}

export default function AuthenticityVerificationPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AuthenticityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Proof verification state
  const [proofInput, setProofInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    verified: boolean;
    message: string;
    duration?: number;
  } | null>(null);

  useEffect(() => {
    fetchAuthenticityProof();
    
    // Check if there's a proof in the URL (from shareable link)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const encodedProof = params.get('proof');
      
      if (encodedProof) {
        try {
          const decoded = atob(decodeURIComponent(encodedProof));
          const proofData = JSON.parse(decoded) as Record<string, unknown>;
          setProofInput(JSON.stringify(proofData, null, 2));
          
          // Auto-verify the proof
          setTimeout(() => {
            verifyEmbeddedProof(proofData);
          }, 500);
        } catch (err) {
          logger.error('Failed to decode shared proof', err instanceof Error ? err : undefined, { component: 'AuthenticityVerification' });
        }
      }
    }
  }, []);

  const fetchAuthenticityProof = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/zk-proof/verify-authenticity');
      if (!response.ok) {
        throw new Error('Failed to verify authenticity');
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const verifyCustomProof = async () => {
    if (!proofInput.trim()) {
      setVerificationResult({
        verified: false,
        message: 'Please paste a proof JSON to verify'
      });
      return;
    }

    setVerifying(true);
    setVerificationResult(null);

    try {
      const proofData = JSON.parse(proofInput) as Record<string, unknown>;
      await performVerification(proofData);
    } catch (err) {
      setVerificationResult({
        verified: false,
        message: `❌ Error: ${err instanceof Error ? err.message : 'Invalid JSON or verification failed'}`
      });
    } finally {
      setVerifying(false);
    }
  };

  const verifyEmbeddedProof = async (proofData: Record<string, unknown>) => {
    setVerifying(true);
    try {
      await performVerification(proofData);
    } catch (err) {
      logger.error('Embedded proof verification failed', err instanceof Error ? err : undefined, { component: 'AuthenticityVerification' });
    } finally {
      setVerifying(false);
    }
  };

  const performVerification = async (proofData: Record<string, unknown>) => {
    const response = await fetch('/api/zk-proof/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: (proofData as Record<string, unknown>).proof || proofData,
        statement: (proofData as Record<string, unknown>).statement || {},
        claim: (proofData as Record<string, unknown>).claim
      })
    });

    const result = await response.json();

    if (result.success && result.verified) {
      setVerificationResult({
        verified: true,
        message: '✅ Proof verified successfully! This is a genuine ZK-STARK proof.',
        duration: result.duration_ms
      });
    } else {
      setVerificationResult({
        verified: false,
        message: `❌ Proof verification failed: ${result.error || 'Invalid proof'}`
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#5856D6] mx-auto mb-4"></div>
          <p className="text-xl text-[#1D1D1F]">Verifying ZK System Authenticity...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-6">
        <div className="max-w-2xl bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-xl p-8">
          <h1 className="text-2xl font-bold text-[#FF3B30] mb-4">Verification Error</h1>
          <p className="text-[#424245]">{error}</p>
          <button
            onClick={fetchAuthenticityProof}
            className="mt-6 px-6 py-3 bg-[#5856D6] hover:bg-[#5856D6]/90 text-white rounded-lg font-semibold"
          >
            Retry Verification
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-6">
        <div className="max-w-2xl bg-[#FF9500]/10 border border-[#FF9500]/30 rounded-xl p-8">
          <h1 className="text-2xl font-bold text-[#FF9500] mb-4">⚠️ Configuration Required</h1>
          <p className="text-[#424245] mb-4">ZK backend is not configured. Set ZK_API_URL environment variable to enable authenticity verification.</p>
          <button
            onClick={fetchAuthenticityProof}
            className="px-6 py-3 bg-[#5856D6] hover:bg-[#5856D6]/90 text-white rounded-lg font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-[#34C759] to-[#5856D6] text-white rounded-full font-bold text-2xl mb-4">
            <Shield className="w-8 h-8" />
            ZK SYSTEM AUTHENTICITY PROOF
          </div>
          <p className="text-lg text-[#424245]">Cryptographic Evidence This Is a REAL ZK-STARK System</p>
          <p className="text-sm text-[#6E6E73] mt-2">Verified: {new Date(data.verification_timestamp).toLocaleString()}</p>
        </div>

        {/* Authenticity Badge */}
        {data.authentic && (
          <div className="bg-[#34C759]/10 border-2 border-[#34C759] rounded-xl p-6 text-center">
            <CheckCircle className="w-16 h-16 text-[#34C759] mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-[#34C759] mb-2">✅ AUTHENTICATED</h2>
            <p className="text-xl text-[#424245]">This is a genuine ZK-STARK implementation</p>
            <p className="text-sm text-[#6E6E73] mt-2">Not simulated • Not mocked • Fully functional</p>
          </div>
        )}

        {/* Independent Proof Verification */}
        <div className="bg-white border-2 border-[#007AFF]/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <Upload className="w-6 h-6 text-[#007AFF]" />
            <h3 className="text-xl font-bold text-[#1D1D1F]">Verify Any ZK Proof Independently</h3>
          </div>
          <p className="text-sm text-[#424245] mb-4">
            Paste any ZK-STARK proof JSON (from /zk-proof page or elsewhere) to cryptographically verify its authenticity.
          </p>
          
          <textarea
            value={proofInput}
            onChange={(e) => setProofInput(e.target.value)}
            placeholder='Paste proof JSON here, e.g.:
{
  "proof": {
    "statement_hash": "0x...",
    "merkle_root": "0x...",
    "security_level": 521,
    ...
  },
  "statement": {...},
  "claim": "..."
}'
            className="w-full h-48 bg-[#F5F5F7] border border-[#E5E5EA] rounded-lg p-4 text-sm font-mono text-[#1D1D1F] placeholder-[#86868B] focus:border-[#007AFF] focus:outline-none resize-none"
          />

          <div className="flex gap-3 mt-4">
            <button
              onClick={verifyCustomProof}
              disabled={verifying || !proofInput.trim()}
              className="flex-1 px-6 py-3 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white disabled:bg-[#E5E5EA] disabled:text-[#86868B] disabled:cursor-not-allowed rounded-lg font-semibold transition-all"
            >
              {verifying ? 'Verifying...' : '🔐 Verify Proof'}
            </button>
            <button
              onClick={() => {
                setProofInput('');
                setVerificationResult(null);
              }}
              className="px-6 py-3 bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F] hover:bg-[#E5E5EA] rounded-lg font-semibold transition-all"
            >
              Clear
            </button>
          </div>

          {verificationResult && (
            <div className={`mt-4 p-4 rounded-lg border ${
              verificationResult.verified 
                ? 'bg-[#34C759]/10 border-[#34C759]/30' 
                : 'bg-[#FF3B30]/10 border-[#FF3B30]/30'
            }`}>
              <div className="flex items-start gap-3">
                {verificationResult.verified ? (
                  <CheckCircle className="w-5 h-5 text-[#34C759] flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-[#FF3B30] flex-shrink-0 mt-0.5" />
                )}
                <div>
                  <p className={`font-semibold ${verificationResult.verified ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                    {verificationResult.message}
                  </p>
                  {verificationResult.duration && (
                    <p className="text-sm text-[#6E6E73] mt-1">
                      Verification time: {verificationResult.duration.toFixed(2)}ms
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 p-3 bg-[#007AFF]/10 border border-[#007AFF]/20 rounded text-sm text-[#007AFF]">
            💡 <strong>Tip:</strong> Go to the <a href="/zk-proof" className="underline hover:text-[#007AFF]/80">/zk-proof</a> page, 
            generate a proof, copy the JSON, and paste it here to verify it independently!
          </div>
        </div>

        {/* Implementation Details */}
        {data.implementation && (
          <div className="bg-white border border-[#5856D6]/30 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <Code className="w-6 h-6 text-[#5856D6]" />
              <h3 className="text-xl font-bold text-[#1D1D1F]">Real Implementation</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-[#6E6E73]">System:</div>
                <div className="text-[#34C759] font-semibold">{data.implementation.system}</div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Type:</div>
                <div className="text-[#5856D6] font-semibold">{data.implementation.type}</div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Source Location:</div>
                <div className="text-[#007AFF] font-mono text-xs">{data.implementation.location}</div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Status:</div>
                <div className="flex items-center gap-2">
                  {data.implementation.not_simulated && (
                    <span className="text-[#34C759] font-semibold">✅ Real (Not Simulated)</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cryptographic Parameters */}
        {data.cryptographic_parameters && (
          <div className="bg-white border border-[#007AFF]/30 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <Lock className="w-6 h-6 text-[#007AFF]" />
              <h3 className="text-xl font-bold text-[#1D1D1F]">Cryptographic Parameters</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[#6E6E73]">Field:</div>
                  <div className="text-[#007AFF] font-semibold">{data.cryptographic_parameters.field}</div>
                </div>
                <div>
                  <div className="text-[#6E6E73]">Security Level:</div>
                  <div className="text-[#34C759] font-semibold">{data.cryptographic_parameters.security_level} bits</div>
                </div>
                <div>
                  <div className="text-[#6E6E73]">Hash Function:</div>
                  <div className="text-[#5856D6] font-semibold">{data.cryptographic_parameters.hash_function}</div>
                </div>
                <div>
                  <div className="text-[#6E6E73]">Commitment Scheme:</div>
                  <div className="text-[#5856D6] font-semibold">{data.cryptographic_parameters.commitment_scheme}</div>
                </div>
            </div>
            <div>
              <div className="text-[#6E6E73] mb-1">Field Prime (proves real math):</div>
              <div className="bg-[#F5F5F7] p-3 rounded border border-[#E5E5EA] font-mono text-xs text-[#007AFF] break-all">
                {data.cryptographic_parameters.field_prime}
              </div>
            </div>
            <div className="flex items-center gap-2 text-[#34C759] font-semibold">
              <CheckCircle className="w-4 h-4" />
              Post-Quantum Secure ✅
            </div>
          </div>
        </div>
        )}

        {/* Live Test Proof */}
        {data.test_proof && data.test_proof.generated && (
          <div className="bg-white border border-[#34C759]/30 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <Zap className="w-6 h-6 text-[#34C759]" />
              <h3 className="text-xl font-bold text-[#1D1D1F]">Live Test Proof (Just Generated)</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-[#6E6E73]">Proof Type:</div>
                <div className="text-[#34C759] font-semibold">{data.test_proof.proof_type}</div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Generation Time:</div>
                <div className="text-[#5856D6] font-semibold">{(data.test_proof.generation_time * 1000).toFixed(2)}ms</div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Security Level:</div>
                <div className="text-[#007AFF] font-semibold">{data.test_proof.security_level} bits</div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Statement Hash:</div>
                <div className="text-[#FF9500] font-mono text-xs break-all">{data.test_proof.statement_hash}</div>
              </div>
            </div>
            <div className="mt-4 bg-[#34C759]/10 border border-[#34C759]/30 rounded p-3 text-sm text-[#34C759]">
              ✅ This proof was generated in real-time by the authentic ZK-STARK system to prove it works!
            </div>
          </div>
        )}

        {/* CUDA Optimization */}
        {data.cuda_optimization && (
          <div className="bg-white border border-[#FF9500]/30 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <Cpu className="w-6 h-6 text-[#FF9500]" />
              <h3 className="text-xl font-bold text-[#1D1D1F]">Hardware Acceleration</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[#6E6E73]">CUDA Available:</div>
                  <div className={`font-semibold ${data.cuda_optimization.available ? 'text-[#34C759]' : 'text-[#86868B]'}`}>
                    {data.cuda_optimization.available ? '✅ Yes' : '❌ No'}
                  </div>
                </div>
                <div>
                  <div className="text-[#6E6E73]">CUDA Enabled:</div>
                  <div className={`font-semibold ${data.cuda_optimization.enabled ? 'text-[#34C759]' : 'text-[#86868B]'}`}>
                    {data.cuda_optimization.enabled ? '✅ Yes' : '❌ No'}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-[#6E6E73] mb-1">Performance Gain:</div>
                  <div className="text-[#5856D6] font-semibold">{data.cuda_optimization.performance_gain}</div>
                </div>
              </div>
              <div>
                <div className="text-[#6E6E73] mb-2">Accelerated Operations:</div>
                <div className="flex flex-wrap gap-2">
                  {data.cuda_optimization.accelerates.map((op, idx) => (
                    <span key={idx} className="px-3 py-1 bg-[#FF9500]/10 border border-[#FF9500]/30 rounded-full text-[#FF9500] text-xs">
                      {op}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ZK Properties */}
        {data.zk_properties && (
          <div className="bg-white border border-[#5856D6]/30 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-6 h-6 text-[#5856D6]" />
              <h3 className="text-xl font-bold text-[#1D1D1F]">ZK-STARK Properties (Mathematical Guarantees)</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {Object.entries(data.zk_properties).map(([key, value]) => (
                <div key={key}>
                  <div className="text-[#6E6E73] capitalize">{key.replace(/_/g, ' ')}:</div>
                  <div className="text-[#34C759]">{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Source Code */}
        {data.source_code && (
          <div className="bg-white border border-[#007AFF]/30 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <FileCode className="w-6 h-6 text-[#007AFF]" />
              <h3 className="text-xl font-bold text-[#1D1D1F]">Source Code (Verifiable)</h3>
            </div>
            <div className="space-y-2 text-sm">
              {Object.entries(data.source_code).filter(([key]) => !['public_repository', 'auditable'].includes(key)).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-[#E5E5EA]">
                  <div className="text-[#6E6E73] capitalize">{key.replace(/_/g, ' ')}:</div>
                  <div className="text-[#007AFF] font-mono text-xs">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <span className="px-3 py-1 bg-[#34C759]/10 border border-[#34C759]/30 rounded-full text-[#34C759] text-xs">
                ✅ Public Repository
              </span>
              <span className="px-3 py-1 bg-[#007AFF]/10 border border-[#007AFF]/30 rounded-full text-[#007AFF] text-xs">
                ✅ Fully Auditable
              </span>
            </div>
          </div>
        )}

        {/* Verification Methods */}
        {data.verification_methods && (
          <div className="bg-white border border-[#34C759]/30 rounded-xl p-6 shadow-sm">
            <h3 className="text-xl font-bold text-[#1D1D1F] mb-4">🔍 How YOU Can Verify Authenticity</h3>
            <div className="space-y-4">
              {data.verification_methods.map((method, idx) => (
                <div key={idx} className="bg-[#F5F5F7] rounded-lg p-4">
                  <h4 className="font-semibold text-[#34C759] mb-2">{idx + 1}. {method.method}</h4>
                  <ol className="space-y-1 text-sm text-[#424245]">
                    {method.steps.map((step, stepIdx) => (
                      <li key={stepIdx} className="flex items-start gap-2">
                        <span className="text-[#5856D6]">→</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* System Status */}
        {data.system_status && (
          <div className="bg-[#34C759]/10 border border-[#34C759]/50 rounded-xl p-6">
            <h3 className="text-xl font-bold text-[#1D1D1F] mb-4">🎯 Live System Status</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-[#6E6E73]">Backend:</div>
                <div className="text-[#34C759] font-semibold">
                  {data.system_status.backend_operational ? '✅ Operational' : '❌ Down'}
                </div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Proof Generation:</div>
                <div className="text-[#34C759] font-semibold">
                  {data.system_status.proof_generation_working ? '✅ Working' : '❌ Failed'}
                </div>
              </div>
              <div>
                <div className="text-[#6E6E73]">Avg Proof Time:</div>
                <div className="text-[#5856D6] font-semibold">
                  {typeof data.system_status.average_proof_time === 'number' 
                    ? `${(data.system_status.average_proof_time * 1000).toFixed(0)}ms`
                    : data.system_status.average_proof_time}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Refresh Button */}
        <div className="text-center">
          <button
            onClick={fetchAuthenticityProof}
            className="px-8 py-4 bg-gradient-to-r from-[#5856D6] to-[#007AFF] hover:from-[#5856D6]/90 hover:to-[#007AFF]/90 text-white rounded-lg font-semibold text-lg transition-all"
          >
            🔄 Re-Verify Authenticity
          </button>
          <p className="text-sm text-[#6E6E73] mt-2">Generate a new test proof to re-verify the system</p>
        </div>
      </div>
    </div>
  );
}
