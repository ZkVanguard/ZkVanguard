'use client';

import { useState, useEffect } from 'react';
import { Shield, CheckCircle, Loader2, Eye, Copy, ExternalLink, ArrowRight } from 'lucide-react';
import { generateSettlementProof, generateRiskProof, verifyProofOnChain, getZKStats, type ZKProof } from '@/lib/api/zk';
import Link from 'next/link';

export function ZKProofDemo() {
  const [generating, setGenerating] = useState(false);
  const [proof, setProof] = useState<ZKProof | null>(null);
  const [verified, setVerified] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [showProof, setShowProof] = useState(false);

  async function generateProof() {
    setGenerating(true);
    setProof(null);
    setVerified(false);

    try {
      // Generate proof for demo settlement batch
      const demoTransactions = [
        { hash: '0x123...', amount: '100' },
        { hash: '0x456...', amount: '200' },
        { hash: '0x789...', amount: '150' },
      ];

      const proofStatus = await generateSettlementProof(demoTransactions);
      
      if (proofStatus.status === 'completed' && proofStatus.proof) {
        setProof(proofStatus.proof);
        
        // Automatically verify proof
        const isValid = await verifyProofOnChain(proofStatus.proof);
        setVerified(isValid);
      }
    } catch (error) {
      console.error('Proof generation failed:', error);
    } finally {
      setGenerating(false);
    }
  }

  async function loadStats() {
    try {
      const zkStats = await getZKStats();
      setStats(zkStats);
    } catch (error) {
      console.error('Failed to load ZK stats:', error);
    }
  }

  useEffect(() => {
    loadStats();
  }, []);

  function copyProof() {
    if (proof) {
      navigator.clipboard.writeText(proof.proof);
      alert('Proof copied to clipboard!');
    }
  }

  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <Shield className="w-6 h-6 text-purple-500" />
            <h2 className="text-2xl font-semibold">ZK-STARK Proof System</h2>
            <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
              Live System
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Real Cairo-based proof generation • Verified on Cronos zkEVM testnet
          </p>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">Total Proofs</div>
            <div className="text-2xl font-bold text-white">{stats.totalProofsGenerated.toLocaleString()}</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">Today</div>
            <div className="text-2xl font-bold text-white">{stats.proofsToday}</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">Avg Gen Time</div>
            <div className="text-2xl font-bold text-white">{stats.averageGenerationTime}s</div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="text-sm text-gray-400">Success Rate</div>
            <div className="text-2xl font-bold text-green-500">{(stats.verificationSuccessRate * 100).toFixed(0)}%</div>
          </div>
        </div>
      )}

      {/* Generate Button */}
      <button
        onClick={generateProof}
        disabled={generating}
        className="w-full mb-6 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
      >
        {generating ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Generating ZK Proof...</span>
          </>
        ) : (
          <>
            <Shield className="w-5 h-5" />
            <span>Generate Settlement Proof</span>
          </>
        )}
      </button>

      {/* Proof Result */}
      {proof && (
        <div className="space-y-4">
          {/* Verification Status */}
          <div className={`flex items-center space-x-2 p-4 rounded-lg ${
            verified ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'
          }`}>
            {verified ? (
              <>
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-green-400 font-medium">Proof Verified On-Chain [VERIFIED]</span>
              </>
            ) : (
              <>
                <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
                <span className="text-yellow-400 font-medium">Verifying...</span>
              </>
            )}
          </div>

          {/* Proof Details */}
          <div className="bg-gray-700/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Circuit Name:</span>
              <span className="text-white font-mono">{proof.circuitName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Public Inputs:</span>
              <span className="text-white">{proof.publicInputs.length} hashes</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Generated:</span>
              <span className="text-white">{new Date(proof.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Proof Data (Collapsible) */}
          <div className="bg-gray-700/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowProof(!showProof)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-600/50 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Eye className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium">View Proof Data</span>
              </div>
              <span className="text-xs text-gray-500">{proof.proof.length / 2} bytes</span>
            </button>
            
            {showProof && (
              <div className="p-4 border-t border-gray-600">
                <div className="bg-black/50 rounded p-3 font-mono text-xs text-gray-300 break-all max-h-40 overflow-y-auto">
                  {proof.proof}
                </div>
                <div className="mt-3 flex space-x-2">
                  <button
                    onClick={copyProof}
                    className="flex items-center space-x-1 px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                  <a
                    href={`https://explorer-zkevm-testnet.cronos.org/proof/${proof.proof.slice(0, 20)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center space-x-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>View on Explorer</span>
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Active Circuits */}
          {stats && (
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-3">Active Circuits</div>
              <div className="flex flex-wrap gap-2">
                {stats.activeCircuits.map((circuit: string) => (
                  <span key={circuit} className="px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs border border-purple-500/30">
                    {circuit}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info Banner */}
      <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <div className="flex items-start space-x-3">
          <Shield className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-300">
            <strong>How it works:</strong> Our ZK-STARK system uses Cairo circuits to generate zero-knowledge proofs 
            for settlement batches. These proofs prove computation correctness without revealing transaction details, 
            enabling privacy-preserving verification on-chain.
          </div>
        </div>
      </div>

      {/* Link to Full ZK Proof Page */}
      <Link href="/zk-proof">
        <button className="mt-4 w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-all flex items-center justify-center space-x-2 group">
          <span>Explore Interactive ZK Proof Demonstration</span>
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
      </Link>
    </div>
  );
}
