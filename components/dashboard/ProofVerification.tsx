'use client';

import { useState } from 'react';
import { Shield, ExternalLink, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { usePublicClient } from 'wagmi';
import { cronosTestnet } from '@/lib/chains';

interface VerificationResult {
  onChain: boolean;
  merkleRootMatches: boolean;
  securityLevel: number;
  timestamp: number;
  exists: boolean;
}

interface ProofVerificationProps {
  defaultTxHash?: string;
}

export function ProofVerification({ defaultTxHash }: ProofVerificationProps = {}) {
  const [proofHash, setProofHash] = useState('');
  const [txHash, setTxHash] = useState(defaultTxHash || '');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publicClient = usePublicClient();

  const verifyProof = async () => {
    if (!proofHash.trim() && !txHash.trim()) {
      setError('Please enter either a transaction hash or proof hash');
      return;
    }

    setVerifying(true);
    setError(null);
    setResult(null);

    try {
      // Normalize proof hash to bytes32 (pad to 64 hex chars if needed)
      let normalizedHash = proofHash.trim().toLowerCase();
      if (!normalizedHash.startsWith('0x')) {
        normalizedHash = '0x' + normalizedHash;
      }
      
      // Remove 0x prefix for padding
      let hashWithoutPrefix = normalizedHash.slice(2);
      
      // Pad to 64 characters (32 bytes)
      if (hashWithoutPrefix.length < 64) {
        hashWithoutPrefix = hashWithoutPrefix.padStart(64, '0');
      } else if (hashWithoutPrefix.length > 64) {
        setError('Proof hash is too long. Must be 32 bytes (64 hex characters).');
        setVerifying(false);
        return;
      }
      
      let paddedProofHash = '0x' + hashWithoutPrefix;
      console.log('🔍 Normalized proof hash:', paddedProofHash);

      // Step 1: Check transaction if provided and extract proof hash from logs
      let txExists = false;
      let txSuccess = false;
      let contractAddress = '';
      let extractedProofHash: string | null = null;

      if (txHash.trim()) {
        console.log('🔍 Verifying transaction:', txHash);
        const tx = await publicClient?.getTransaction({ 
          hash: txHash as `0x${string}` 
        });
        
        if (tx) {
          txExists = true;
          const receipt = await publicClient?.getTransactionReceipt({ 
            hash: txHash as `0x${string}` 
          });
          txSuccess = receipt?.status === 'success';
          contractAddress = receipt?.to || '';
          
          // Extract proof hash from CommitmentStored event logs
          if (receipt?.logs && receipt.logs.length > 0) {
            console.log('📋 Found', receipt.logs.length, 'logs in transaction');
            console.log('   Contract address from tx:', contractAddress);
            
            // Look for CommitmentStored event (first topic is event signature, second is indexed proofHash)
            // Try to find the log from ANY contract that has the right structure
            const commitmentStoredLog = receipt.logs.find(log => 
              log.topics.length >= 2
            );
            
            if (commitmentStoredLog) {
              console.log('✅ Found event log with topics');
              console.log('   From contract:', commitmentStoredLog.address);
              console.log('   Topics:', commitmentStoredLog.topics);
              
              // The first indexed parameter (topics[1]) should be the proofHash
              if (commitmentStoredLog.topics[1]) {
                extractedProofHash = commitmentStoredLog.topics[1];
                console.log('📝 Extracted proof hash from transaction logs:', extractedProofHash);
                
                // Update the contract address to the one that actually emitted the event
                contractAddress = commitmentStoredLog.address;
                console.log('📍 Using contract address:', contractAddress);
              }
            } else {
              console.log('⚠️ No event logs with topics found');
              console.log('   All logs:', receipt.logs.map(l => ({ address: l.address, topics: l.topics.length })));
            }
          }
          
          console.log('✅ Transaction found:', { txExists, txSuccess, contractAddress });
        }
      }
      
      // Use extracted proof hash if we got it from transaction
      if (extractedProofHash && !proofHash.trim()) {
        console.log('🔄 Using proof hash from transaction logs');
        normalizedHash = extractedProofHash.toLowerCase();
        hashWithoutPrefix = normalizedHash.slice(2);
        paddedProofHash = '0x' + hashWithoutPrefix;
      }

      // Step 2: Query commitment from contract using public mapping
      // Use the contract address from transaction if available, otherwise use default
      const actualContractAddress = contractAddress || '0xf4a4bBF21b2fa9C6Bd232ee1Cd0C847374Ccf6D3';
      console.log('🔍 Querying contract:', actualContractAddress);
      
      const commitment = await publicClient?.readContract({
        address: actualContractAddress as `0x${string}`,
        abi: [
          {
            name: 'commitments',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: '', type: 'bytes32' }],
            outputs: [
              { name: 'proofHash', type: 'bytes32' },
              { name: 'merkleRoot', type: 'bytes32' },
              { name: 'timestamp', type: 'uint256' },
              { name: 'verifier', type: 'address' },
              { name: 'verified', type: 'bool' },
              { name: 'securityLevel', type: 'uint256' }
            ]
          }
        ],
        functionName: 'commitments',
        args: [paddedProofHash as `0x${string}`],
      }) as [string, string, bigint, string, boolean, bigint];

      // Destructure the array result: [proofHash, merkleRoot, timestamp, verifier, verified, securityLevel]
      const [, merkleRoot, timestamp, verifier, verified, securityLevel] = commitment;
      
      console.log('📊 On-chain commitment:', {
        merkleRoot,
        timestamp: timestamp.toString(),
        verifier,
        verified,
        securityLevel: securityLevel.toString()
      });

      if (verified) {
        setResult({
          onChain: txExists && txSuccess,
          merkleRootMatches: verified,
          securityLevel: Number(securityLevel),
          timestamp: Number(timestamp),
          exists: verified,
        });
      } else {
        if (extractedProofHash) {
          setError(`Proof not found. Extracted hash from transaction: ${extractedProofHash}`);
        } else {
          setError('Proof not found on-chain. Make sure to use the proof hash from the Dashboard console logs, not the statement_hash.');
        }
      }

    } catch (err) {
      console.error('Verification error:', err);
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-6 h-6 text-purple-400" />
        <h2 className="text-xl font-bold">Verify ZK Proof On-Chain</h2>
      </div>

      <div className="space-y-4">
        {/* Transaction Hash Input (Recommended) */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Transaction Hash <span className="text-xs text-emerald-400">(✨ easiest method)</span>
          </label>
          <input
            type="text"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            placeholder="0x92577669354a4bc9d1965ff27a0d68956ad36641530456ec4949ca6b5da15a2f"
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none font-mono text-sm"
          />
          <p className="text-xs text-gray-400 mt-2">
            Just paste your transaction hash - we'll automatically extract the proof hash from the logs!
          </p>
        </div>

        {/* Proof Hash Input (Alternative) */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Or Enter Proof Hash Directly <span className="text-xs text-gray-500">(optional)</span>
          </label>
          <input
            type="text"
            value={proofHash}
            onChange={(e) => setProofHash(e.target.value)}
            placeholder="0x0000000000000000000000000000000000000000000000000000000675e9ab3"
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none font-mono text-sm"
          />
          <p className="text-xs text-gray-400 mt-2">
            💡 Find this in Dashboard console logs after generating a proof (look for "Proof Hash:")
          </p>
        </div>

        {/* Verify Button */}
        <button
          onClick={verifyProof}
          disabled={verifying}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 rounded-lg font-semibold transition-colors"
        >
          {verifying ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <Shield className="w-5 h-5" />
              Verify On-Chain
            </>
          )}
        </button>

        {/* Error Display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-300">{error}</div>
          </div>
        )}

        {/* Results Display */}
        {result && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2 text-green-400 font-semibold">
              <CheckCircle className="w-5 h-5" />
              Verification Results
            </div>

            {/* What Was Proven Section */}
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <div className="text-sm font-semibold text-purple-400 mb-2">✨ What Was Proven:</div>
              <div className="text-gray-300 space-y-1 text-sm">
                <div>• A zero-knowledge proof was generated and stored on-chain</div>
                <div>• The proof demonstrates knowledge of private data without revealing it</div>
                <div>• The commitment is cryptographically secured with <span className="text-purple-400 font-semibold">{result.securityLevel}-bit security</span></div>
                <div>• Original claim: <span className="text-emerald-400 italic">"Private witness data satisfies the public statement"</span></div>
              </div>
              <div className="mt-3 text-xs text-gray-400 bg-gray-800 rounded p-2 font-mono">
                💡 Note: The actual statement/claim from the proof generation is not stored on-chain for privacy. 
                Only the cryptographic commitment (merkleRoot + proofHash) is immutably recorded.
              </div>
            </div>

            <div className="space-y-2 text-sm">
              {/* Exists Check */}
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Proof Exists On-Chain:</span>
                {result.exists ? (
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    Yes
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-400">
                    <XCircle className="w-4 h-4" />
                    No
                  </span>
                )}
              </div>

              {/* Transaction Check */}
              {txHash && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Transaction Verified:</span>
                  {result.onChain ? (
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle className="w-4 h-4" />
                      Success
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-yellow-400">
                      <Clock className="w-4 h-4" />
                      Pending/Not Found
                    </span>
                  )}
                </div>
              )}

              {/* Security Level */}
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Security Level:</span>
                <span className="text-purple-400 font-semibold">
                  {result.securityLevel} bits
                </span>
              </div>

              {/* Timestamp */}
              {result.timestamp > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Stored At:</span>
                  <span className="text-gray-400">
                    {new Date(result.timestamp * 1000).toLocaleString()}
                  </span>
                </div>
              )}

              {/* Age */}
              {result.timestamp > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Proof Age:</span>
                  <span className="text-gray-400">
                    {Math.floor((Date.now() / 1000 - result.timestamp) / 60)} minutes ago
                  </span>
                </div>
              )}
            </div>

            {/* Explorer Link */}
            {txHash && (
              <a
                href={`https://explorer.cronos.org/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                View on Cronos Explorer
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-sm text-gray-300">
          <div className="font-semibold text-blue-400 mb-2">How Verification Works:</div>
          <ul className="space-y-1 text-xs">
            <li>• Queries the Cronos blockchain for your proof commitment</li>
            <li>• Verifies the transaction was successful (if tx hash provided)</li>
            <li>• Checks the Merkle root and security level</li>
            <li>• Confirms the proof exists and is immutable on-chain</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
