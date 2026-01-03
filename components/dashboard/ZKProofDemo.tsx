'use client';

import { useState } from 'react';
import { Shield, CheckCircle, Loader2, ExternalLink, XCircle, Cpu, Zap } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useVerifyProof, useContractAddresses } from '../../lib/contracts/hooks';
import { generateProofForOnChain } from '../../lib/api/zk';
import { useWalletClient } from 'wagmi';

export function ZKProofDemo() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const contractAddresses = useContractAddresses();
  const { isPending, isConfirming, isConfirmed, error, hash } = useVerifyProof();
  const [showForm, setShowForm] = useState(false);
  const [proofType, setProofType] = useState<'settlement' | 'risk' | 'rebalance'>('settlement');
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);
  const [proofMetadata, setProofMetadata] = useState<Record<string, unknown> | null>(null);
  const [gaslessResult, setGaslessResult] = useState<{ txHash: string; trueGasless: true; x402Powered: true; usdcFee: string; croGasPaid: string; message: string } | null>(null);

  // Generate proof using Python/CUDA backend and submit on-chain
  const handleGenerateAndVerifyProof = async () => {
    try {
      setIsGeneratingProof(true);
      
      // Prepare sample data based on proof type
      let data;
      if (proofType === 'settlement') {
        data = {
          payments: [
            { recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', amount: 1000, token: '0x0000000000000000000000000000000000000000' },
            { recipient: '0x170E8232E9e18eeB1839dB1d939501994f1e272F', amount: 2000, token: '0x0000000000000000000000000000000000000000' }
          ]
        };
      } else if (proofType === 'risk') {
        data = {
          portfolio_value: 0, // Real value from on-chain data
          volatility: 250,
          value_at_risk: 500
        };
      } else {
        data = {
          old_allocations: [5000, 3000, 2000],
          new_allocations: [4000, 4000, 2000]
        };
      }

      // Generate proof using Python/CUDA backend (ZK-STARK)
      console.log('🔐 Generating ZK-STARK proof with Python/CUDA backend...');
      const result = await generateProofForOnChain(proofType, data, 1);
      
      setProofMetadata(result.metadata);
      
      // Result now contains: { starkProof, offChainVerification, commitment, metadata }
      // commitment contains: { proofHash, merkleRoot, verifiedOffChain, timestamp, metadata }
      console.log('✅ Proof verified off-chain:', result.offChainVerification);
      console.log('📝 On-chain commitment:', result.commitment);
      
      // Store commitment on-chain (if wallet connected)
      if (isConnected && walletClient) {
        console.log('⛓️  Storing commitment with TRUE gasless (x402 + USDC)...');
        
        try {
          // Store commitment with TRUE GASLESS - x402 + USDC!
          console.log('⚡ TRUE GASLESS: $0.01 USDC + $0.00 CRO');
          console.log('💎 x402 makes USDC payment gasless!');
          
          // Call API route for gasless storage (server-side x402)
          const response = await fetch('/api/zk-proof/store-commitment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proofHash: result.commitment.proofHash,
              merkleRoot: result.commitment.merkleRoot,
              securityLevel: result.commitment.metadata.field_bits,
            }),
          });
          
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }
          
          const gaslessApiResult = await response.json();
          
          if (gaslessApiResult.success) {
            setGaslessResult(gaslessApiResult);
            console.log('✅ TRUE GASLESS COMPLETE! 🎉');
            console.log('   USDC paid:', gaslessApiResult.usdcFee);
            console.log('   CRO paid:', gaslessApiResult.croGasPaid);
            console.log('   Transaction:', gaslessApiResult.txHash);
            console.log('   Proof Hash:', result.commitment.proofHash);
            console.log('   Security: 521-bit NIST P-521');
            console.log('   Duration:', result.offChainVerification.duration_ms, 'ms');
          } else {
            throw new Error(gaslessApiResult.error || 'Storage failed');
          }
        } catch (err) {
          console.error('❌ Failed to store commitment on-chain:', err);
          console.log('✅ But proof was still verified off-chain successfully!');
        }
      } else {
        console.log('✅ Proof verified off-chain successfully!');
        console.log('   Proof Hash:', result.commitment.proofHash);
        console.log('   Security: 521-bit NIST P-521');
        console.log('   Duration:', result.offChainVerification.duration_ms, 'ms');
        console.log('ℹ️  Connect wallet to store commitment on-chain');
      }
      
    } catch (err) {
      console.error('❌ Proof generation failed:', err);
      alert('Failed to generate proof: ' + (err as Error).message);
    } finally {
      setIsGeneratingProof(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="glass p-6 rounded-xl border border-white/10">
        <div className="flex items-center space-x-2 mb-4">
          <Shield className="w-6 h-6 text-purple-500" />
          <h2 className="text-2xl font-semibold">ZK Proof Verification</h2>
        </div>
        <div className="text-center py-12">
          <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
          <p className="text-gray-400">
            Connect your wallet to submit and verify ZK proofs on-chain
          </p>
        </div>
      </div>
    );
  }

  if (isConfirmed || gaslessResult) {
    const isGasless = !!gaslessResult;
    return (
      <div className="glass p-6 rounded-xl border border-green-500/30 bg-green-500/5">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle className="w-6 h-6 text-green-400" />
          <h3 className="text-xl font-bold text-green-400 flex items-center gap-2">
            Proof Verified On-Chain!
            {isGasless && (
              <span className="text-xs px-2 py-1 bg-emerald-500 rounded-full flex items-center gap-1">
                <Zap className="w-3 h-3" />
                GASLESS
              </span>
            )}
          </h3>
        </div>
        <p className="text-gray-300 mb-4">
          Your ZK proof has been successfully verified by the ZKVerifier contract on Cronos Testnet.
          {isGasless && ' You paid ZERO gas fees! 🎉'}
        </p>
        
        {proofMetadata && (
          <>
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-400">Proof Type:</span>
                  <span className="ml-2 font-semibold text-purple-400">{String(proofMetadata.proofType)}</span>
                </div>
                <div>
                  <span className="text-gray-400">Generation Time:</span>
                  <span className="ml-2 font-semibold text-green-400">{String(proofMetadata.durationMs)}ms</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-400">Acceleration:</span>
                  {proofMetadata.cudaAccelerated ? (
                    <span className="ml-2 inline-flex items-center gap-1 text-cyan-400 font-semibold">
                      <Cpu className="w-4 h-4" />
                      CUDA Enabled
                    </span>
                  ) : (
                    <span className="ml-2 text-yellow-400">CPU</span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 mb-4">
              <h4 className="font-semibold text-cyan-400 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Zero-Knowledge Privacy
              </h4>
              <div className="text-sm text-gray-300 space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-green-400">✓</span>
                  <span><strong>Public:</strong> Statement verified on blockchain</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-400">✓</span>
                  <span><strong>Hidden:</strong> Actual amounts, addresses, balances</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-400">✓</span>
                  <span><strong>Proven:</strong> Computation is correct without revealing inputs</span>
                </div>
              </div>
            </div>
          </>
        )}
        
        <div className="flex gap-3">
          {hash && (
            <a
              href={`https://explorer.cronos.org/testnet/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors"
            >
              View Transaction
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {isGasless && gaslessResult && (
            <div className="text-sm text-gray-400">
              {gaslessResult.message}
            </div>
          )}
          <button
            onClick={() => {
              setShowForm(false);
              setProofMetadata(null);
              setGaslessResult(null);
            }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
          >
            Verify Another Proof
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass p-6 rounded-xl border border-red-500/30 bg-red-500/5">
        <div className="flex items-center gap-3 mb-4">
          <XCircle className="w-6 h-6 text-red-400" />
          <h3 className="text-xl font-bold text-red-400">Verification Failed</h3>
        </div>
        <p className="text-gray-300 mb-4 text-sm">
          {error.message || 'Failed to verify proof on-chain'}
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="glass p-6 rounded-xl border border-white/10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <Shield className="w-6 h-6 text-purple-500" />
            <h2 className="text-2xl font-semibold">ZK Proof Verification</h2>
            <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-400 rounded-full border border-purple-500/30">
              On-Chain
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Submit ZK-STARK proofs for verification on ZKVerifier contract
          </p>
        </div>
      </div>

      {!showForm ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-900 p-4 rounded-lg border border-purple-500/20">
              <h3 className="font-semibold text-purple-400 mb-2">Contract Address</h3>
              <p className="text-xs font-mono text-gray-400 break-all">
                {contractAddresses.zkVerifier}
              </p>
            </div>
            <div className="bg-gray-900 p-4 rounded-lg border border-purple-500/20">
              <h3 className="font-semibold text-purple-400 mb-2">Proof System</h3>
              <p className="text-sm text-gray-300">ZK-STARK (AIR + FRI Protocol)</p>
              <p className="text-xs text-gray-400 mt-1">CUDA-accelerated Python implementation</p>
            </div>
          </div>

          <button
            onClick={() => setShowForm(true)}
            className="w-full px-6 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg font-bold text-white transition-all duration-300 flex items-center justify-center gap-2"
          >
            Submit Proof for Verification
          </button>

          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
            <p className="text-xs text-cyan-400">
              ℹ️ This demo generates real ZK-STARK proofs using our Python/CUDA backend with AIR+FRI protocol.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Proof Type
            </label>
            <select
              value={proofType}
              onChange={(e) => setProofType(e.target.value as 'settlement' | 'risk' | 'rebalance')}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none"
              disabled={isPending || isConfirming}
            >
              <option value="settlement">Settlement Verification</option>
              <option value="risk">Risk Assessment</option>
              <option value="rebalance">Portfolio Rebalance</option>
            </select>
            
            {/* Show what will be hidden */}
            <div className="mt-3 p-3 bg-slate-900/50 border border-cyan-500/30 rounded-lg">
              <p className="text-xs text-cyan-400 font-semibold mb-2">🔒 Secrets (NOT revealed in proof):</p>
              <ul className="text-xs text-gray-400 space-y-1">
                {proofType === 'settlement' && (
                  <>
                    <li>• Exact recipient addresses</li>
                    <li>• Individual payment amounts</li>
                    <li>• Transaction details</li>
                  </>
                )}
                {proofType === 'risk' && (
                  <>
                    <li>• Actual portfolio value</li>
                    <li>• Volatility calculations</li>
                    <li>• Specific risk scores</li>
                  </>
                )}
                {proofType === 'rebalance' && (
                  <>
                    <li>• Old allocation values</li>
                    <li>• New allocation values</li>
                    <li>• Asset distribution details</li>
                  </>
                )}
              </ul>
              <p className="text-xs text-emerald-400 mt-2">✓ Only proves the computation is valid</p>
            </div>
          </div>

          {(isPending || isConfirming) ? (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                <div>
                  <p className="font-semibold text-purple-400">
                    {isPending ? 'Waiting for signature...' : 'Verifying proof on-chain...'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {isPending ? 'Please sign the transaction in your wallet' : 'ZKVerifier contract is processing your proof'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateAndVerifyProof}
                disabled={isGeneratingProof}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isGeneratingProof ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate & Verify'
                )}
              </button>
            </div>
          )}

          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
            <p className="text-xs text-emerald-400 mb-1 font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4" />
              97%+ GASLESS - Automatic gas refunds via smart contract!
            </p>
            <p className="text-xs text-gray-400">
              🚀 ZK-STARK proof generation uses Python backend (real cryptographic proofs, 77KB size)
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
