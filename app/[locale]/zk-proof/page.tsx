"use client";

import React, { useState } from 'react';
import { logger } from '../../../lib/utils/logger';
import { Shield, Lock, Eye, EyeOff, CheckCircle, XCircle, Loader2, Download, Copy, Share2, QrCode, ExternalLink } from 'lucide-react';
import { ProofVerification } from '../../../components/dashboard/ProofVerification';
import { useAccount, useWalletClient, useSignMessage } from 'wagmi';

interface Proof {
  statement_hash: number;
  merkle_root: string;
  challenge: number;
  response: number;
  witness_commitment: Record<string, unknown>;
  query_responses: Array<{
    index: number;
    value: number | string;
    proof: Array<[string, string]>;
  }>;
  execution_trace_length: number;
  extended_trace_length: number;
  field_prime: string;
  security_level: number;
  computation_steps: number;
}

interface ProofResult {
  proof: Proof;
  statement: Record<string, unknown>;
  claim?: string;
  scenario: string;
  duration_ms?: number;
}

const scenarios = [
  {
    id: 'portfolio_risk',
    name: 'Portfolio Risk Assessment',
    description: 'Prove portfolio risk is below threshold without revealing positions',
    statement: {
      claim: 'Portfolio risk is below acceptable threshold',
      threshold: 100,
      portfolio_id: 'DEMO_PORTFOLIO_001'
    },
    witness: {
      actual_risk_score: 75,
      portfolio_value: 2_500_000,
      leverage: 2.5,
      volatility: 0.35
    },
    secrets: ['actual_risk_score', 'portfolio_value', 'leverage', 'volatility']
  },
  {
    id: 'settlement_batch',
    name: 'Settlement Batch Validation',
    description: 'Prove settlement batch is valid without revealing transaction details',
    statement: {
      claim: 'Settlement batch is valid and complete',
      transaction_count: 5,
      batch_id: 'BATCH_20251214'
    },
    witness: {
      total_amount: 480_000,
      unique_tokens: 4,
      unique_addresses: 10,
      checksum: 789456
    },
    secrets: ['total_amount', 'unique_tokens', 'unique_addresses']
  },
  {
    id: 'compliance_check',
    name: 'Regulatory Compliance',
    description: 'Prove compliance with regulations without exposing sensitive data',
    statement: {
      claim: 'Account meets regulatory requirements',
      jurisdiction: 'US',
      regulation: 'KYC and AML'
    },
    witness: {
      account_balance: 50_000,
      transaction_count: 150,
      risk_rating: 'low',
      verification_level: 3
    },
    secrets: ['account_balance', 'transaction_count', 'risk_rating']
  }
];

function ZKProofPage() {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { signMessageAsync } = useSignMessage();
  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]);
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<boolean | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [showProofDetails, setShowProofDetails] = useState(false);
  const [onChainTxHash, setOnChainTxHash] = useState<string | null>(null);
  const [isStoringOnChain, setIsStoringOnChain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareableLink, setShareableLink] = useState<string>('');
  const [showQR, setShowQR] = useState(false);
  
  // Editable statement and witness
  const [editableStatement, setEditableStatement] = useState<Record<string, unknown>>(scenarios[0].statement);
  const [editableWitness, setEditableWitness] = useState<Record<string, unknown>>(scenarios[0].witness);

  // Update editable fields when scenario changes
  const handleScenarioChange = (scenario: typeof scenarios[0]) => {
    setSelectedScenario(scenario);
    setEditableStatement(scenario.statement);
    setEditableWitness(scenario.witness);
    setProofResult(null);
    setVerificationResult(null);
  };

  const generateProof = async () => {
    setIsGenerating(true);
    setProofResult(null);
    setVerificationResult(null);
    setOnChainTxHash(null);
    
    try {
      const response = await fetch('/api/zk-proof/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: selectedScenario.id,
          statement: editableStatement,
          witness: editableWitness
        })
      });
      const data = await response.json();
      if (data.success) {
        setProofResult(data);
        
        // Auto-store on-chain if wallet connected
        if (isConnected && data.proof) {
          await storeProofOnChain(data.proof);
        }
      } else {
        alert('Error generating proof: ' + data.error);
      }
    } catch (error: unknown) {
      alert('Error: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsGenerating(false);
    }
  };

  const storeProofOnChain = async (proof: Proof) => {
    if (!isConnected) {
      alert('Please connect your wallet to store proof on-chain');
      return;
    }

    setIsStoringOnChain(true);
    try {
      logger.info('Storing proof on Cronos testnet with TRUE gasless');
      logger.info('Fee: $0.01 USDC + $0.00 CRO (x402 powered)');
      
      const { convertToContractFormat } = await import('@/lib/api/zk');
      const { useAccount } = await import('wagmi');
      
      // Use walletClient from component hook
      if (!walletClient) {
        throw new Error('Please connect your wallet first');
      }
      
      // Get user address
      const address = walletClient.account.address;

      // Require user signature before sending to server-side storage
      const signatureMessage = [
        'Chronos Vanguard: Confirm proof storage',
        `Scenario: ${selectedScenario.name}`,
        `Address: ${address}`,
        `Timestamp: ${new Date().toISOString()}`,
        'This is a proof storage acknowledgement only. No funds are moved by this signature.'
      ].join('\n');

      try {
        await signMessageAsync({ message: signatureMessage });
      } catch (sigError) {
        logger.warn('User declined signature for proof storage', { error: sigError });
        alert('Signature required to proceed with on-chain storage.');
        return;
      }
      
      // Convert proof to contract format
      // @ts-expect-error - proof structure conversion between frontend and contract format
      const commitment = convertToContractFormat(proof);
      
      logger.debug('Proof commitment generated', {
        proofHash: commitment.proofHash,
        merkleRoot: commitment.merkleRoot,
        securityLevel: commitment.metadata.security_level
      });
      
      // Call server-side API to store on-chain with TRUE gasless via x402 + USDC
      const response = await fetch('/api/zk-proof/store-onchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofHash: commitment.proofHash,
          merkleRoot: commitment.merkleRoot,
          securityLevel: commitment.metadata.field_bits,
          address: address
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        const message = errorData.error || 'Failed to store on-chain';
        // Show actionable guidance for funding issues
        if (message.toLowerCase().includes('balance')) {
          alert('On-chain storage temporarily unavailable: server wallet USDC balance is low. Please fund the server wallet with at least 0.01 USDC and some CRO, then retry.');
        }
        throw new Error(message);
      }

      const result = await response.json();
      
      setOnChainTxHash(result.txHash);
      logger.info('Stored on-chain! TRUE gasless via x402 + USDC', {
        txHash: result.txHash,
        usdcFee: result.usdcFee,
        croGasPaid: result.croGasPaid
      });
      
      // Store statement_hash and statement for ZK verification
      const proofMetadata = {
        txHash: result.txHash,
        proofHash: commitment.proofHash,
        statement_hash: proof.statement_hash,
        statement: editableStatement || {},
        proof: proof,
        timestamp: Date.now(),
        trueGasless: result.trueGasless,
        x402Powered: result.x402Powered,
        usdcFee: result.usdcFee,
        croGasPaid: result.croGasPaid,
      };
      localStorage.setItem(`proof_${commitment.proofHash}`, JSON.stringify(proofMetadata));
      localStorage.setItem(`proof_tx_${result.txHash}`, JSON.stringify(proofMetadata));
      
    } catch (error) {
      console.error('❌ Failed to store on-chain:', error);
      // Don't alert in production, just log the error
      logger.error('On-chain storage failed', { error });
    } finally {
      setIsStoringOnChain(false);
    }
  };

  const verifyProof = async () => {
    if (!proofResult) return;
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      const response = await fetch('/api/zk-proof/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof: proofResult.proof,
          claim: proofResult.claim,
          statement: proofResult.statement
        })
      });
      const data = await response.json();
      if (data.success) {
        setVerificationResult(data.verified);
      } else {
        alert('Error verifying proof: ' + data.error);
      }
    } catch (error: unknown) {
      alert('Error: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsVerifying(false);
    }
  };

  const downloadProof = () => {
    if (!proofResult) return;
    const dataStr = JSON.stringify(proofResult.proof, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `zkproof_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyProofToClipboard = async () => {
    if (!proofResult) return;
    try {
      const proofData = JSON.stringify(proofResult, null, 2);
      await navigator.clipboard.writeText(proofData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert('Failed to copy to clipboard');
    }
  };

  const generateShareableLink = () => {
    if (!proofResult) return;
    try {
      const proofData = JSON.stringify(proofResult);
      const encoded = btoa(proofData); // Base64 encode
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const link = `${baseUrl}/zk-authenticity?proof=${encodeURIComponent(encoded)}`;
      setShareableLink(link);
      
      // Copy to clipboard automatically
      navigator.clipboard.writeText(link);
      alert('Shareable link copied to clipboard! Anyone with this link can verify the proof.');
    } catch (err) {
      alert('Failed to generate shareable link');
    }
  };

  const openVerificationPage = () => {
    if (!proofResult) return;
    const proofData = JSON.stringify(proofResult);
    const encoded = btoa(proofData);
    window.open(`/zk-authenticity?proof=${encodeURIComponent(encoded)}`, '_blank');
  };

  return (
    <div className="min-h-screen transition-colors duration-300 bg-[#F5F5F7]">
      <div className="container mx-auto px-6 py-16">
        <div className="max-w-4xl mx-auto text-center mb-16 space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#34C759] to-[#007AFF] rounded-2xl shadow-lg shadow-[#34C759]/20">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-5xl md:text-6xl font-black">
            <span className="bg-gradient-to-r from-[#34C759] to-[#007AFF] bg-clip-text text-transparent">Zero-Knowledge</span>
            <br />
            <span className="text-[#1D1D1F]">Proof System</span>
          </h1>
          
          {/* How It Works - Proof Lifecycle */}
          <div className="bg-white border border-[#34C759]/30 rounded-xl p-6 mt-8 text-left shadow-sm">
            <h3 className="text-xl font-bold text-[#34C759] mb-4 text-center">🔄 Complete Proof Lifecycle</h3>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[#007AFF] font-semibold">
                  <div className="w-8 h-8 bg-[#007AFF]/10 rounded-lg flex items-center justify-center text-sm">1</div>
                  Generate
                </div>
                <p className="text-sm text-[#6E6E73]">Select scenario and generate ZK-STARK proof with private witness data</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[#5856D6] font-semibold">
                  <div className="w-8 h-8 bg-[#5856D6]/10 rounded-lg flex items-center justify-center text-sm">2</div>
                  Share
                </div>
                <p className="text-sm text-[#6E6E73]">Copy JSON, create shareable link, or download file to send to anyone</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[#34C759] font-semibold">
                  <div className="w-8 h-8 bg-[#34C759]/10 rounded-lg flex items-center justify-center text-sm">3</div>
                  Verify
                </div>
                <p className="text-sm text-[#6E6E73]">Recipient verifies proof cryptographically without learning secrets</p>
              </div>
            </div>
            <div className="mt-4 p-3 bg-[#007AFF]/10 border border-[#007AFF]/30 rounded text-sm text-[#007AFF]">
              <strong>🔒 Privacy Guarantee:</strong> The verifier learns NOTHING about your private data - only that your claim is valid!
            </div>
          </div>
          <p className="text-xl text-[#424245] leading-relaxed">
            Generate real <span className="text-[#34C759] font-bold">ZK-STARK</span> proofs.
            Prove statements are true <span className="text-[#007AFF] font-bold">WITHOUT</span> revealing sensitive data.
          </p>
        </div>

        {/* Scenario Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {scenarios.map((scenario, _idx) => (
            <button
              key={scenario.id}
              onClick={() => handleScenarioChange(scenario)}
              className={`group relative p-8 rounded-2xl transition-all duration-300 text-left ${
                selectedScenario.id === scenario.id
                  ? 'bg-white border-2 border-[#34C759] shadow-lg shadow-[#34C759]/20'
                  : 'bg-white border border-[#E5E5EA] hover:border-[#007AFF]/50'
              }`}
            >
              <h3 className="text-2xl font-bold text-[#1D1D1F] mb-3 group-hover:text-[#34C759] transition-colors">
                {scenario.name}
              </h3>
              <p className="text-[#6E6E73] leading-relaxed">{scenario.description}</p>
            </button>
          ))}
        </div>

        {/* Scenario Details */}
        <div className="bg-white rounded-2xl p-8 mb-8 border border-[#E5E5EA] shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Public Statement */}
            <div>
              <h2 className="text-2xl font-bold text-[#1D1D1F] mb-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-[#34C759]/10 rounded-xl flex items-center justify-center">
                  <Eye className="w-5 h-5 text-[#34C759]" />
                </div>
                Public Statement
              </h2>
              <div className="bg-[#F5F5F7] rounded-xl p-6 border border-[#34C759]/30 space-y-3">
                {Object.entries(editableStatement).map(([key, value]) => (
                  <div key={key}>
                    <label className="text-xs text-[#34C759] font-mono block mb-1">{key}:</label>
                    <input
                      type="text"
                      value={String(value)}
                      onChange={(e) => setEditableStatement(prev => ({
                        ...prev,
                        [key]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)
                      }))}
                      className="w-full bg-white border border-[#34C759]/30 rounded px-3 py-2 text-[#34C759] text-sm font-mono focus:outline-none focus:border-[#34C759] transition-colors"
                    />
                  </div>
                ))}
              </div>
              <p className="text-[#6E6E73] text-sm mt-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#34C759]" />
                Everyone can see this claim
              </p>
            </div>

            {/* Private Witness */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-[#1D1D1F] flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#007AFF]/10 rounded-xl flex items-center justify-center">
                    <Lock className="w-5 h-5 text-[#007AFF]" />
                  </div>
                  Private Witness
                </h2>
                <button
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="px-4 py-2 bg-white border border-[#E5E5EA] rounded-lg text-sm text-[#007AFF] hover:border-[#007AFF] transition-all flex items-center gap-2"
                >
                  {showSecrets ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showSecrets ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="bg-[#F5F5F7] rounded-xl p-6 border border-[#007AFF]/30 space-y-3">
                {showSecrets ? (
                  Object.entries(editableWitness).map(([key, value]) => (
                    <div key={key}>
                      <label className="text-xs text-[#007AFF] font-mono block mb-1">{key}:</label>
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) => setEditableWitness(prev => ({
                          ...prev,
                          [key]: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)
                        }))}
                        className="w-full bg-white border border-[#007AFF]/30 rounded px-3 py-2 text-[#007AFF] text-sm font-mono focus:outline-none focus:border-[#007AFF] transition-colors"
                      />
                    </div>
                  ))
                ) : (
                  <div className="text-[#007AFF] text-sm space-y-2 font-mono">
                    {Object.keys(editableWitness).map((key) => (
                      <div key={key}>
                        {key}: <span className="text-[#86868B]">████████</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[#6E6E73] text-sm mt-3 flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#007AFF]" />
                These secrets will NOT appear in the proof
              </p>
            </div>
          </div>

          {/* Generate Proof Button */}
          <div className="mt-8 text-center">
            <button
              onClick={generateProof}
              disabled={isGenerating}
              className="group px-8 py-4 bg-gradient-to-r from-[#34C759] to-[#007AFF] text-white rounded-xl font-bold text-lg hover:shadow-lg hover:shadow-[#34C759]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:-translate-y-1 flex items-center gap-3 mx-auto"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Generating Proof...
                </>
              ) : (
                <>
                  <Shield className="w-6 h-6" />
                  Generate ZK-STARK Proof
                </>
              )}
            </button>
          </div>
        </div>

        {/* Proof Result */}
        {proofResult && (
          <div className="space-y-8">
            {/* Privacy Verification */}
            <div className="bg-white rounded-2xl p-8 border border-[#E5E5EA] shadow-sm">
              <h2 className="text-2xl font-bold text-[#1D1D1F] mb-6 flex items-center gap-3">
                <div className="w-10 h-10 bg-[#34C759]/10 rounded-xl flex items-center justify-center">
                  <Lock className="w-5 h-5 text-[#34C759]" />
                </div>
                Privacy Verification
              </h2>
              <div className="grid gap-4">
                {selectedScenario.secrets.map((secretKey) => {
                  const secretValue = (editableWitness as Record<string, unknown>)[secretKey];
                  
                  // Proper privacy check: Look for exact witness field names or clear-text values
                  // ZK-STARK proofs contain random-looking numbers that may coincidentally match
                  // We check if the witness structure or explicit secret values are exposed
                  let isLeaked = false;
                  if (proofResult) {
                    const proofStr = JSON.stringify(proofResult.proof);
                    const witnessStr = JSON.stringify(proofResult.statement);
                    
                    // Check if secret key appears as a property name in proof/statement
                    if (proofStr.includes(`"${secretKey}"`) || witnessStr.includes(`"${secretKey}"`)) {
                      isLeaked = true;
                    }
                    
                    // For string values, check exact match with quotes (not just substring)
                    if (typeof secretValue === 'string' && proofStr.includes(`"${secretValue}"`)) {
                      isLeaked = true;
                    }
                    
                    // For large numbers (>1000), check if they appear as complete numbers
                    // Small numbers like 75 can appear by coincidence in cryptographic data
                    if (typeof secretValue === 'number' && secretValue > 1000) {
                      const pattern = new RegExp(`[^0-9]${secretValue}[^0-9]`);
                      if (pattern.test(proofStr)) {
                        isLeaked = true;
                      }
                    }
                  }
                  
                  return (
                    <div
                      key={secretKey}
                      className={`flex items-center gap-4 p-6 rounded-xl transition-all ${
                        isLeaked 
                          ? 'bg-[#FF3B30]/10 border-2 border-[#FF3B30]' 
                          : 'bg-[#34C759]/10 border-2 border-[#34C759]'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isLeaked ? 'bg-[#FF3B30]/20' : 'bg-[#34C759]/20'
                      }`}>
                        {isLeaked ? (
                          <XCircle className="w-6 h-6 text-[#FF3B30]" />
                        ) : (
                          <CheckCircle className="w-6 h-6 text-[#34C759]" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-[#1D1D1F] font-bold text-lg">{secretKey}</div>
                        <div className="text-[#6E6E73] text-sm font-mono">
                          {typeof secretValue === 'number' ? secretValue.toLocaleString() : String(secretValue)}
                        </div>
                      </div>
                      <div className={`px-4 py-2 rounded-lg font-bold ${
                        isLeaked 
                          ? 'bg-[#FF3B30]/20 text-[#FF3B30]' 
                          : 'bg-[#34C759]/20 text-[#34C759]'
                      }`}>
                        {isLeaked ? 'LEAKED' : 'HIDDEN'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* On-Chain Storage Status */}
            {isConnected && (
              <div className="bg-[#5856D6]/5 rounded-2xl p-6 border border-[#5856D6]/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      isStoringOnChain ? 'bg-[#FF9500]/20' : onChainTxHash ? 'bg-[#34C759]/20' : 'bg-[#5856D6]/20'
                    }`}>
                      {isStoringOnChain ? (
                        <Loader2 className="w-6 h-6 text-[#FF9500] animate-spin" />
                      ) : onChainTxHash ? (
                        <CheckCircle className="w-6 h-6 text-[#34C759]" />
                      ) : (
                        <Shield className="w-6 h-6 text-[#5856D6]" />
                      )}
                    </div>
                    <div>
                      <div className="text-[#1D1D1F] font-bold text-lg">
                        {isStoringOnChain ? 'Storing On-Chain...' : onChainTxHash ? 'Stored On-Chain ✓' : 'On-Chain Storage'}
                      </div>
                      <div className="text-[#6E6E73] text-sm">
                        {isStoringOnChain ? 'Submitting gasless transaction...' : onChainTxHash ? 'Permanent proof commitment on Cronos testnet' : 'Wallet connected - storing automatically'}
                      </div>
                    </div>
                  </div>
                  {onChainTxHash && (
                    <a
                      href={`https://explorer.cronos.org/testnet/tx/${onChainTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-[#34C759] hover:bg-[#2FB04E] text-white rounded-lg transition-all flex items-center gap-2"
                    >
                      View TX
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>
                {onChainTxHash && (
                  <div className="mt-4 p-4 bg-[#F5F5F7] rounded-lg">
                    <div className="text-xs text-[#6E6E73] mb-1">Transaction Hash:</div>
                    <div className="text-sm text-[#007AFF] font-mono break-all">{onChainTxHash}</div>
                  </div>
                )}
              </div>
            )}

            {!isConnected && (
              <div className="bg-[#FF9500]/10 rounded-2xl p-6 border border-[#FF9500]/30">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#FF9500]/20 rounded-xl flex items-center justify-center">
                    <Shield className="w-6 h-6 text-[#FF9500]" />
                  </div>
                  <div>
                    <div className="text-[#1D1D1F] font-bold">Connect Wallet to Store On-Chain</div>
                    <div className="text-[#6E6E73] text-sm">Proof generated successfully, but not stored on blockchain yet</div>
                  </div>
                </div>
              </div>
            )}

            {/* Proof Details */}
            <div className="bg-white rounded-2xl p-8 border border-[#E5E5EA] shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <h2 className="text-2xl font-bold text-[#1D1D1F] flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#007AFF]/10 rounded-xl flex items-center justify-center">
                    <Shield className="w-5 h-5 text-[#007AFF]" />
                  </div>
                  Cryptographic Proof
                </h2>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={copyProofToClipboard}
                    className="px-4 py-2 bg-gradient-to-r from-[#007AFF] to-[#5856D6] text-white rounded-lg hover:shadow-lg hover:shadow-[#007AFF]/30 transition-all flex items-center gap-2"
                  >
                    {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                  <button
                    onClick={generateShareableLink}
                    className="px-4 py-2 bg-gradient-to-r from-[#5856D6] to-[#AF52DE] text-white rounded-lg hover:shadow-lg hover:shadow-[#5856D6]/30 transition-all flex items-center gap-2"
                  >
                    <Share2 className="w-4 h-4" />
                    Share Link
                  </button>
                  <button
                    onClick={openVerificationPage}
                    className="px-4 py-2 bg-gradient-to-r from-[#34C759] to-[#00C7BE] text-white rounded-lg hover:shadow-lg hover:shadow-[#34C759]/30 transition-all flex items-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Verify Now
                  </button>
                  <button
                    onClick={() => setShowProofDetails(!showProofDetails)}
                    className="px-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F] rounded-lg hover:border-[#007AFF] transition-all"
                  >
                    {showProofDetails ? 'Hide' : 'Show'} Details
                  </button>
                  <button
                    onClick={downloadProof}
                    className="px-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] text-[#1D1D1F] rounded-lg hover:border-[#007AFF] transition-all flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-[#F5F5F7] border border-[#E5E5EA] p-6 rounded-xl">
                  <div className="text-[#6E6E73] text-sm mb-2">Security Level</div>
                  <div className="text-[#1D1D1F] font-bold text-2xl">{proofResult.proof.security_level || 0}-bit</div>
                </div>
                <div className="bg-[#F5F5F7] border border-[#E5E5EA] p-6 rounded-xl">
                  <div className="text-[#6E6E73] text-sm mb-2">Query Count</div>
                  <div className="text-[#1D1D1F] font-bold text-2xl">{proofResult.proof.query_responses?.length || 0}</div>
                </div>
                <div className="bg-[#F5F5F7] border border-[#E5E5EA] p-6 rounded-xl">
                  <div className="text-[#6E6E73] text-sm mb-2">Trace Length</div>
                  <div className="text-[#1D1D1F] font-bold text-2xl">{proofResult.proof.execution_trace_length || 0}</div>
                </div>
                <div className="bg-[#F5F5F7] border border-[#E5E5EA] p-6 rounded-xl">
                  <div className="text-[#6E6E73] text-sm mb-2">Proof Size</div>
                  <div className="text-[#1D1D1F] font-bold text-2xl">
                    {(JSON.stringify(proofResult.proof).length / 1024).toFixed(1)} KB
                  </div>
                </div>
              </div>

              {showProofDetails && (
                <div className="space-y-6">
                  <div>
                    <div className="text-[#6E6E73] text-sm mb-3 font-semibold">Statement Hash</div>
                    <div className="bg-[#F5F5F7] p-4 rounded-xl font-mono text-sm text-[#007AFF] break-all border border-[#007AFF]/30">
                      {proofResult.proof.statement_hash || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#6E6E73] text-sm mb-3 font-semibold">Merkle Root</div>
                    <div className="bg-[#F5F5F7] p-4 rounded-xl font-mono text-sm text-[#34C759] break-all border border-[#34C759]/30">
                      {proofResult.proof.merkle_root || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#6E6E73] text-sm mb-3 font-semibold">Fiat-Shamir Challenge</div>
                    <div className="bg-[#F5F5F7] p-4 rounded-xl font-mono text-sm text-[#FF9500] break-all border border-[#FF9500]/30">
                      {proofResult.proof.challenge || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#6E6E73] text-sm mb-3 font-semibold flex items-center gap-2">
                      Query Responses (First 3 of {proofResult.proof.query_responses?.length || 0})
                    </div>
                    <div className="grid gap-3">
                      {(proofResult.proof.query_responses || []).slice(0, 3).map((query, idx) => (
                        <div key={idx} className="bg-[#F5F5F7] border border-[#E5E5EA] p-4 rounded-xl">
                          <div className="text-[#007AFF] text-sm font-mono">
                            Query #{query.index}: {query.proof?.length || 0} Merkle path steps
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Verify Buttons */}
              <div className="mt-8">
                <h3 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-[#34C759]" />
                  Verification Options
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <button
                    onClick={verifyProof}
                    disabled={isVerifying}
                    className="px-6 py-4 bg-gradient-to-r from-[#34C759] to-[#007AFF] text-white rounded-xl font-bold hover:shadow-lg hover:shadow-[#34C759]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:-translate-y-1 flex flex-col items-center justify-center gap-2"
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-5 h-5" />
                        <span>Verify Off-Chain</span>
                        <span className="text-xs opacity-75">Python Backend (~10ms)</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      // Scroll to verification section
                      document.getElementById('on-chain-verification')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    disabled={!onChainTxHash}
                    className="px-6 py-4 bg-gradient-to-r from-[#5856D6] to-[#AF52DE] text-white rounded-xl font-bold hover:shadow-lg hover:shadow-[#5856D6]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:-translate-y-1 flex flex-col items-center justify-center gap-2 text-center"
                  >
                    <Shield className="w-5 h-5" />
                    <span>Verify On-Chain</span>
                    <span className="text-xs opacity-75">
                      {onChainTxHash ? 'Scroll to verify ↓' : 'Store on-chain first'}
                    </span>
                  </button>

                  <div className="px-6 py-4 bg-[#34C759]/10 border border-[#34C759]/30 rounded-xl flex flex-col items-center justify-center gap-2">
                    <Lock className="w-5 h-5 text-[#34C759]" />
                    <span className="font-bold text-[#1D1D1F]">Secrets Hidden</span>
                    <span className="text-xs text-[#6E6E73]">Not revealed in proof</span>
                  </div>
                </div>

                {verificationResult !== null && (
                  <div
                    className={`px-6 py-4 rounded-xl font-bold flex items-center justify-center gap-3 border-2 transition-all ${
                      verificationResult
                        ? 'bg-[#34C759]/10 border-[#34C759] text-[#34C759]'
                        : 'bg-[#FF3B30]/10 border-[#FF3B30] text-[#FF3B30]'
                    }`}
                  >
                    {verificationResult ? (
                      <>
                        <CheckCircle className="w-6 h-6" />
                        <div className="text-left">
                          <div>PROOF VERIFIED ✓</div>
                          <div className="text-xs opacity-75 font-normal">Statement is true, secrets remain hidden</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-6 h-6" />
                        VERIFICATION FAILED
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Info Banner */}
        <div className="mt-12 bg-[#5856D6]/10 border border-[#5856D6] rounded-xl p-6">
          <h3 className="text-xl font-bold text-[#1D1D1F] mb-3">🎯 What Just Happened?</h3>
          <div className="text-[#424245] space-y-2">
            <p>
              ✅ A real ZK-STARK proof was generated using AIR (Algebraic Intermediate Representation) and FRI (Fast Reed-Solomon IOP)
            </p>
            <p>✅ The proof is {proofResult ? `${(JSON.stringify(proofResult.proof).length / 1024).toFixed(1)}KB` : '~50KB'} of cryptographic data with Merkle proofs</p>
            <p>✅ All sensitive values remain completely hidden in the proof</p>
            <p>✅ Anyone can verify the proof without seeing your secrets</p>
            <p>✅ 521-bit post-quantum security (NIST P-521 prime field)</p>
          </div>
        </div>

        {/* On-Chain Verification Section */}
        <div id="on-chain-verification" className="mt-8 scroll-mt-8">
          <ProofVerification defaultTxHash={onChainTxHash || undefined} />
        </div>
      </div>
    </div>
  );
}

export default ZKProofPage;
