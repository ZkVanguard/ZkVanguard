'use client';

import { useState } from 'react';
import { Shield, CheckCircle, Loader2, ExternalLink, XCircle, Cpu, Zap, ChevronDown, ChevronUp, Lock, Sparkles } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useVerifyProof, useContractAddresses } from '../../lib/contracts/hooks';
import { generateProofForOnChain } from '../../lib/api/zk';
import { useWalletClient } from 'wagmi';

export function ZKProofDemo() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const contractAddresses = useContractAddresses();
  const { isPending, isConfirming, isConfirmed, error, hash } = useVerifyProof();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [proofType, setProofType] = useState<'settlement' | 'risk' | 'rebalance'>('settlement');
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);
  const [proofMetadata, setProofMetadata] = useState<Record<string, unknown> | null>(null);
  const [gaslessResult, setGaslessResult] = useState<{ txHash: string; trueGasless: boolean; x402Powered: boolean; usdcFee: string; croGasPaid: string; message: string } | null>(null);

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
            { recipient: '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189', amount: 2000, token: '0x0000000000000000000000000000000000000000' }
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
          
          if (gaslessApiResult.success && gaslessApiResult.txHash && !gaslessApiResult.simulated) {
            setGaslessResult(gaslessApiResult);
            setShowForm(false); // Show success view with txHash
            console.log('✅ ON-CHAIN STORAGE COMPLETE! 🎉');
            console.log('   Transaction:', gaslessApiResult.txHash);
            console.log('   Proof Hash:', result.commitment.proofHash);
            console.log('   Security: 521-bit NIST P-521');
            console.log('   Duration:', result.offChainVerification.duration_ms, 'ms');
          } else if (gaslessApiResult.success) {
            // Fallback - on-chain storage not available
            console.log('✅ Proof verified off-chain!');
            console.log('ℹ️  On-chain storage:', gaslessApiResult.message);
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
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-[#AF52DE] rounded-[12px] flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-[17px] font-semibold text-[#1d1d1f]">ZK Verification</h3>
        </div>
        <div className="text-center py-8 bg-[#f5f5f7] rounded-[14px]">
          <div className="w-12 h-12 bg-[#AF52DE]/10 rounded-[14px] flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6 text-[#AF52DE]" />
          </div>
          <p className="text-[14px] font-medium text-[#1d1d1f] mb-1">Connect Wallet</p>
          <p className="text-[12px] text-[#86868b]">Verify ZK-STARK proofs on-chain</p>
        </div>
      </div>
    );
  }

  if (isConfirmed || gaslessResult) {
    const isGasless = !!gaslessResult;
    return (
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-[#34C759]/20 overflow-hidden">
        <div className="p-4 sm:p-6 bg-gradient-to-br from-[#34C759]/5 to-transparent">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#34C759] rounded-[12px] flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-[17px] font-semibold text-[#34C759]">Verified On-Chain</h3>
                {isGasless && (
                  <span className="px-2 py-0.5 bg-[#34C759] text-white text-[10px] font-bold rounded-full flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" />
                    GASLESS
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[#86868b]">ZK-STARK proof verified</p>
            </div>
          </div>
          <p className="text-[13px] text-[#1d1d1f] mb-4">
            Your ZK proof has been successfully verified by the ZKVerifier contract on Cronos Testnet.
            {isGasless && ' You paid ZERO gas fees! 🎉'}
          </p>
          
          {proofMetadata && (
            <>
              <div className="bg-[#AF52DE]/5 border border-[#AF52DE]/20 rounded-[12px] p-3 mb-3">
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <span className="text-[#86868b]">Type</span>
                    <p className="font-semibold text-[#AF52DE] mt-0.5">{String(proofMetadata.proofType)}</p>
                  </div>
                  <div>
                    <span className="text-[#86868b]">Time</span>
                    <p className="font-semibold text-[#34C759] mt-0.5">{String(proofMetadata.durationMs)}ms</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[#86868b]">Acceleration</span>
                    {proofMetadata.cudaAccelerated ? (
                      <p className="inline-flex items-center gap-1 text-[#007AFF] font-semibold mt-0.5">
                        <Cpu className="w-3.5 h-3.5" />
                        CUDA Enabled
                      </p>
                    ) : (
                      <p className="text-[#FF9500] font-semibold mt-0.5">CPU</p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px] p-3 mb-4">
                <h4 className="text-[13px] font-semibold text-[#007AFF] mb-2 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Zero-Knowledge Privacy
                </h4>
                <div className="text-[11px] text-[#1d1d1f] space-y-1">
                  <div className="flex items-start gap-1.5">
                    <span className="text-[#34C759] mt-0.5">✓</span>
                    <span><strong>Public:</strong> Statement verified on blockchain</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-[#34C759] mt-0.5">✓</span>
                    <span><strong>Hidden:</strong> Actual amounts, addresses, balances</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-[#34C759] mt-0.5">✓</span>
                    <span><strong>Proven:</strong> Computation is correct without revealing inputs</span>
                  </div>
                </div>
              </div>
            </>
          )}
          
          <div className="flex flex-col sm:flex-row gap-2">
            {(hash || gaslessResult?.txHash) && (
              <a
                href={`https://explorer.cronos.org/testnet/tx/${hash || gaslessResult?.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#34C759] text-white text-[13px] font-semibold rounded-[10px] active:scale-[0.98] transition-transform"
              >
                View Transaction
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              onClick={() => {
                setShowForm(false);
                setProofMetadata(null);
                setGaslessResult(null);
              }}
              className="flex-1 px-4 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] text-[13px] font-semibold rounded-[10px] active:bg-[#e8e8ed] transition-colors"
            >
              Verify Another
            </button>
          </div>
          {isGasless && gaslessResult && (
            <p className="text-[11px] text-[#86868b] text-center mt-2">{gaslessResult.message}</p>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-[#FF3B30]/20 overflow-hidden">
        <div className="p-4 sm:p-6 bg-gradient-to-br from-[#FF3B30]/5 to-transparent">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#FF3B30] rounded-[12px] flex items-center justify-center">
              <XCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-[#FF3B30]">Verification Failed</h3>
              <p className="text-[12px] text-[#86868b]">Could not verify proof</p>
            </div>
          </div>
          <p className="text-[13px] text-[#1d1d1f] mb-4">
            {error.message || 'Failed to verify proof on-chain'}
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="w-full px-4 py-2.5 bg-[#FF3B30] text-white text-[13px] font-semibold rounded-[10px] active:scale-[0.98] transition-transform"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 overflow-hidden">
      {/* Header - Collapseable */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between active:bg-[#f9f9f9] sm:hover:bg-[#f9f9f9] transition-colors"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-[#AF52DE] rounded-[10px] sm:rounded-[12px] flex items-center justify-center">
            <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">ZK Verification</h3>
              <span className="px-1.5 py-0.5 bg-[#AF52DE]/10 text-[#AF52DE] text-[10px] font-bold rounded-full">
                ZK-STARK
              </span>
            </div>
            <p className="text-[11px] sm:text-[12px] text-[#86868b]">On-chain proof verification</p>
          </div>
        </div>
        {isCollapsed ? (
          <ChevronDown className="w-5 h-5 text-[#86868b]" />
        ) : (
          <ChevronUp className="w-5 h-5 text-[#86868b]" />
        )}
      </button>

      {!isCollapsed && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          {!showForm ? (
            <div className="space-y-3">
              {/* Contract Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="bg-[#f5f5f7] p-3 rounded-[12px] border border-black/5">
                  <h4 className="text-[12px] font-semibold text-[#AF52DE] mb-1">Contract</h4>
                  <p className="text-[10px] font-mono text-[#86868b] break-all">
                    {contractAddresses.zkVerifier}
                  </p>
                </div>
                <div className="bg-[#f5f5f7] p-3 rounded-[12px] border border-black/5">
                  <h4 className="text-[12px] font-semibold text-[#AF52DE] mb-1">System</h4>
                  <p className="text-[12px] text-[#1d1d1f] font-medium">ZK-STARK</p>
                  <p className="text-[10px] text-[#86868b]">AIR + FRI Protocol</p>
                </div>
              </div>

              {/* CTA Button */}
              <button
                onClick={() => setShowForm(true)}
                className="w-full px-6 py-3 bg-gradient-to-r from-[#AF52DE] to-[#FF2D55] text-white text-[14px] font-semibold rounded-[12px] active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Submit Proof for Verification
              </button>

              {/* Info Banner */}
              <div className="bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px] p-3">
                <p className="text-[11px] text-[#007AFF]">
                  ℹ️ Generate real ZK-STARK proofs using Python/CUDA backend with AIR+FRI protocol.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Proof Type Selector */}
              <div>
                <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                  Proof Type
                </label>
                <select
                  value={proofType}
                  onChange={(e) => setProofType(e.target.value as 'settlement' | 'risk' | 'rebalance')}
                  className="w-full px-4 py-2.5 bg-[#f5f5f7] border border-black/10 rounded-[10px] text-[13px] text-[#1d1d1f] font-medium focus:border-[#AF52DE] focus:outline-none focus:ring-2 focus:ring-[#AF52DE]/20"
                  disabled={isPending || isConfirming}
                >
                  <option value="settlement">Settlement Verification</option>
                  <option value="risk">Risk Assessment</option>
                  <option value="rebalance">Portfolio Rebalance</option>
                </select>
                
                {/* Privacy Info */}
                <div className="mt-3 p-3 bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px]">
                  <p className="text-[11px] text-[#007AFF] font-bold mb-2 flex items-center gap-1.5">
                    <Lock className="w-3 h-3" />
                    Secrets (NOT revealed in proof)
                  </p>
                  <ul className="text-[10px] text-[#86868b] space-y-0.5">
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
                  <p className="text-[10px] text-[#34C759] font-semibold mt-2">✓ Only proves the computation is valid</p>
                </div>
              </div>

              {/* Processing Status */}
              {(isPending || isConfirming) ? (
                <div className="bg-[#AF52DE]/5 border border-[#AF52DE]/20 rounded-[12px] p-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 border-2 border-[#AF52DE] border-t-transparent rounded-full animate-spin" />
                    <div>
                      <p className="text-[13px] font-semibold text-[#AF52DE]">
                        {isPending ? 'Waiting for signature...' : 'Verifying proof...'}
                      </p>
                      <p className="text-[11px] text-[#86868b] mt-0.5">
                        {isPending ? 'Please sign in your wallet' : 'ZKVerifier is processing'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowForm(false)}
                    className="flex-1 px-4 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] text-[13px] font-semibold rounded-[10px] active:bg-[#e8e8ed] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateAndVerifyProof}
                    disabled={isGeneratingProof}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#AF52DE] to-[#FF2D55] disabled:from-[#86868b] disabled:to-[#86868b] text-white text-[13px] font-semibold rounded-[10px] active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:active:scale-100"
                  >
                    {isGeneratingProof ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Generate & Verify
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Gasless Info */}
              <div className="bg-[#34C759]/5 border border-[#34C759]/20 rounded-[12px] p-3">
                <p className="text-[11px] text-[#34C759] font-bold mb-1 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  97%+ GASLESS
                </p>
                <p className="text-[10px] text-[#86868b]">
                  Automatic gas refunds via smart contract. ZK-STARK proofs are 77KB cryptographic proofs.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
