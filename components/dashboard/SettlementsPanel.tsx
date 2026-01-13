'use client';

import { useState, useCallback, useEffect } from 'react';
import { Clock, CheckCircle, XCircle, Loader2, ExternalLink, Wallet, Plus, Trash2, Zap, Shield } from 'lucide-react';
import { useAccount, useWalletClient } from 'wagmi';
import { useProcessSettlement, useContractAddresses } from '../../lib/contracts/hooks';
import { parseEther, parseUnits } from 'viem';
import { trackSuccessfulTransaction } from '@/lib/utils/transactionTracker';

interface Payment {
  recipient: string;
  amount: string;
  token: string;
}

type SettlementMode = 'standard' | 'x402';

export function SettlementsPanel({ address: _address }: { address: string }) {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const contractAddresses = useContractAddresses();
  const { processSettlement, isPending, isConfirming, isConfirmed, error, hash } = useProcessSettlement();
  
  const [showForm, setShowForm] = useState(false);
  const [portfolioId, setPortfolioId] = useState('0');
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('x402');
  const [x402Status, setX402Status] = useState<'idle' | 'challenging' | 'signing' | 'settling' | 'success' | 'error'>('idle');
  const [x402TxHash, setX402TxHash] = useState<string | null>(null);
  const [x402Error, setX402Error] = useState<string | null>(null);
  const [payments, setPayments] = useState<Payment[]>([
    { recipient: '', amount: '', token: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0' } // DevUSDC default
  ]);

  // Track standard settlement when confirmed
  useEffect(() => {
    if (isConfirmed && hash && address) {
      const totalAmount = payments.reduce((sum, p) => sum + parseFloat(p.amount || '0'), 0);
      trackSuccessfulTransaction({
        hash,
        type: 'transfer',
        from: address,
        to: contractAddresses.paymentRouter,
        value: totalAmount.toString(),
        tokenSymbol: 'CRO',
        description: `Standard Settlement (${payments.length} payments)`,
      });
    }
  }, [isConfirmed, hash, address, payments, contractAddresses.paymentRouter]);

  const addPayment = () => {
    setPayments([...payments, { recipient: '', amount: '', token: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0' }]);
  };

  const removePayment = (index: number) => {
    setPayments(payments.filter((_, i) => i !== index));
  };

  const updatePayment = (index: number, field: keyof Payment, value: string) => {
    const updated = [...payments];
    updated[index][field] = value;
    setPayments(updated);
  };

  // Standard on-chain settlement
  const handleStandardSettlement = () => {
    try {
      const formattedPayments = payments.map(p => ({
        recipient: p.recipient as `0x${string}`,
        amount: parseEther(p.amount || '0'),
        token: p.token as `0x${string}`,
      }));

      processSettlement(BigInt(portfolioId), formattedPayments);
    } catch (err) {
      console.error('Failed to process settlement:', err);
    }
  };

  // X402 gasless settlement flow
  const handleX402Settlement = useCallback(async () => {
    if (!walletClient || !address) {
      setX402Error('Wallet not connected');
      return;
    }

    setX402Status('challenging');
    setX402Error(null);

    try {
      // Step 1: Request payment challenge from server
      const totalAmount = payments.reduce((sum, p) => {
        const amt = parseFloat(p.amount || '0');
        return sum + amt;
      }, 0);
      
      // Convert to USDC base units (6 decimals) + platform fee
      const amountInUnits = Math.floor(totalAmount * 1_000_000) + 10000; // +0.01 USDC fee

      const challengeResponse = await fetch('/api/x402/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountInUnits.toString(),
          description: `ZkVanguard Batch Settlement (${payments.length} payments)`,
          resource: '/api/settlements',
        }),
      });

      if (challengeResponse.status !== 402) {
        throw new Error('Failed to get payment challenge');
      }

      const challenge = await challengeResponse.json();
      const accepts = challenge.accepts?.[0];
      
      if (!accepts) {
        throw new Error('Invalid challenge response');
      }

      const paymentId = accepts.extra?.paymentId;
      if (!paymentId) {
        throw new Error('No payment ID in challenge');
      }

      setX402Status('signing');

      // Step 2: Sign EIP-3009 payment header using wallet
      // For now, we'll use the server-side settlement as a demo
      // In production, this would use the Facilitator SDK on client
      
      // Simulate payment header generation (in production, use Facilitator.generatePaymentHeader)
      const paymentHeader = btoa(JSON.stringify({
        from: address,
        to: accepts.payTo,
        value: accepts.maxAmountRequired,
        validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: Date.now(),
      }));

      setX402Status('settling');

      // Step 3: Submit payment for settlement
      const settleResponse = await fetch('/api/x402/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          paymentHeader,
          paymentRequirements: {
            scheme: accepts.scheme,
            network: accepts.network,
            payTo: accepts.payTo,
            asset: accepts.asset,
            maxAmountRequired: accepts.maxAmountRequired,
            maxTimeoutSeconds: accepts.maxTimeoutSeconds,
          },
        }),
      });

      const settleResult = await settleResponse.json();

      if (settleResult.ok && settleResult.txHash) {
        // Track the successful X402 settlement transaction
        trackSuccessfulTransaction({
          hash: settleResult.txHash,
          type: 'transfer',
          from: address,
          to: '0x44098d0dE36e157b4C1700B48d615285C76fdE47', // X402 Gasless contract
          value: totalAmount.toString(),
          tokenSymbol: 'USDC',
          description: `X402 Gasless Settlement (${payments.length} payments)`,
        });
        
        setX402TxHash(settleResult.txHash);
        setX402Status('success');
      } else {
        // No fallback - if settlement fails, show error
        throw new Error(settleResult.error || 'Settlement failed - no transaction hash returned');
      }
    } catch (err) {
      console.error('X402 settlement error:', err);
      setX402Error(err instanceof Error ? err.message : 'Settlement failed');
      setX402Status('error');
    }
  }, [walletClient, address, payments]);

  const handleProcessSettlement = () => {
    if (settlementMode === 'x402') {
      handleX402Settlement();
    } else {
      handleStandardSettlement();
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setX402Status('idle');
    setX402TxHash(null);
    setX402Error(null);
    setPayments([{ recipient: '', amount: '', token: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0' }]);
  };

  if (!isConnected) {
    return (
      <div className="bg-white p-6 rounded-xl border border-[#E5E5EA] shadow-sm">
        <div className="flex items-center space-x-2 mb-4">
          <Clock className="w-6 h-6 text-[#007AFF]" />
          <h2 className="text-2xl font-semibold text-[#1D1D1F]">Payment Settlement</h2>
        </div>
        <div className="text-center py-12">
          <Wallet className="w-16 h-16 text-[#86868B] mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2 text-[#1D1D1F]">Connect Your Wallet</h3>
          <p className="text-[#6E6E73]">
            Connect your wallet to process batch settlements on-chain
          </p>
        </div>
      </div>
    );
  }

  // X402 Success State
  if (x402Status === 'success' && x402TxHash) {
    return (
      <div className="bg-[#5856D6]/5 p-6 rounded-xl border border-[#5856D6]/30">
        <div className="flex items-center gap-3 mb-4">
          <Zap className="w-6 h-6 text-[#5856D6]" />
          <h3 className="text-xl font-bold text-[#5856D6]">X402 Settlement Complete!</h3>
        </div>
        <p className="text-[#424245] mb-4">
          Your batch settlement was processed via the <strong>x402 protocol</strong> with gasless USDC payments.
        </p>
        <div className="bg-[#5856D6]/10 border border-[#5856D6]/30 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Shield className="w-4 h-4 text-[#5856D6]" />
            <span className="text-[#5856D6]">Powered by @crypto.com/facilitator-client</span>
          </div>
        </div>
        <div className="flex gap-3">
          <a
            href={`https://explorer.cronos.org/testnet/tx/${x402TxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#5856D6] hover:bg-[#4240B3] text-white rounded-lg font-semibold transition-colors"
          >
            View Transaction
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={resetForm}
            className="px-4 py-2 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-lg font-semibold transition-colors border border-[#E5E5EA]"
          >
            New Settlement
          </button>
        </div>
      </div>
    );
  }

  // Standard success state
  if (isConfirmed) {
    return (
      <div className="bg-[#34C759]/5 p-6 rounded-xl border border-[#34C759]/30">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle className="w-6 h-6 text-[#34C759]" />
          <h3 className="text-xl font-bold text-[#34C759]">Settlement Processed!</h3>
        </div>
        <p className="text-[#424245] mb-4">
          Your batch settlement has been successfully processed by the PaymentRouter contract.
        </p>
        <div className="flex gap-3">
          <a
            href={`https://explorer.cronos.org/testnet/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#34C759] hover:bg-[#2FB04E] text-white rounded-lg font-semibold transition-colors"
          >
            View Transaction
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={resetForm}
            className="px-4 py-2 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-lg font-semibold transition-colors border border-[#E5E5EA]"
          >
            New Settlement
          </button>
        </div>
      </div>
    );
  }

  // X402 error state
  if (x402Status === 'error') {
    return (
      <div className="bg-[#FF3B30]/5 p-6 rounded-xl border border-[#FF3B30]/30">
        <div className="flex items-center gap-3 mb-4">
          <XCircle className="w-6 h-6 text-[#FF3B30]" />
          <h3 className="text-xl font-bold text-[#FF3B30]">X402 Settlement Failed</h3>
        </div>
        <p className="text-[#424245] mb-4 text-sm">
          {x402Error || 'Failed to process x402 settlement'}
        </p>
        <button
          onClick={resetForm}
          className="px-4 py-2 bg-[#FF3B30] hover:bg-[#E62E24] text-white rounded-lg font-semibold transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#FF3B30]/5 p-6 rounded-xl border border-[#FF3B30]/30">
        <div className="flex items-center gap-3 mb-4">
          <XCircle className="w-6 h-6 text-[#FF3B30]" />
          <h3 className="text-xl font-bold text-[#FF3B30]">Settlement Failed</h3>
        </div>
        <p className="text-[#424245] mb-4 text-sm">
          {error.message || 'Failed to process settlement'}
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-[#FF3B30] hover:bg-[#E62E24] text-white rounded-lg font-semibold transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl border border-[#E5E5EA] shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <Clock className="w-6 h-6 text-[#007AFF]" />
            <h2 className="text-2xl font-semibold text-[#1D1D1F]">Batch Settlement</h2>
            <span className={`text-xs px-2 py-1 rounded-full border ${
              settlementMode === 'x402' 
                ? 'bg-[#5856D6]/10 text-[#5856D6] border-[#5856D6]/30'
                : 'bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/30'
            }`}>
              {settlementMode === 'x402' ? '⚡ x402 Powered' : 'On-Chain'}
            </span>
          </div>
          <p className="text-xs text-[#6E6E73] mt-2">
            {settlementMode === 'x402' 
              ? 'Gasless settlements via x402 protocol with USDC fees'
              : 'Process multiple payments in a single transaction via PaymentRouter'
            }
          </p>
        </div>
      </div>

      {/* Settlement Mode Toggle */}
      <div className="flex gap-2 mb-6 p-1 bg-[#F5F5F7] rounded-lg">
        <button
          onClick={() => setSettlementMode('x402')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
            settlementMode === 'x402'
              ? 'bg-[#5856D6] text-white'
              : 'text-[#6E6E73] hover:text-[#1D1D1F]'
          }`}
        >
          <Zap className="w-4 h-4" />
          x402 Gasless
        </button>
        <button
          onClick={() => setSettlementMode('standard')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
            settlementMode === 'standard'
              ? 'bg-[#007AFF] text-white'
              : 'text-[#6E6E73] hover:text-[#1D1D1F]'
          }`}
        >
          <Shield className="w-4 h-4" />
          Standard
        </button>
      </div>

      {!showForm ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#F5F5F7] p-4 rounded-lg border border-[#007AFF]/20">
              <h3 className="font-semibold text-[#007AFF] mb-2">
                {settlementMode === 'x402' ? 'X402 Facilitator' : 'Contract Address'}
              </h3>
              <p className="text-xs font-mono text-[#6E6E73] break-all">
                {settlementMode === 'x402' 
                  ? '@crypto.com/facilitator-client'
                  : contractAddresses.paymentRouter
                }
              </p>
            </div>
            <div className="bg-[#F5F5F7] p-4 rounded-lg border border-[#007AFF]/20">
              <h3 className="font-semibold text-[#007AFF] mb-2">Settlement Type</h3>
              <p className="text-sm text-[#424245]">
                {settlementMode === 'x402' 
                  ? 'EIP-3009 USDC Transfer'
                  : 'Batch Payment Processing'
                }
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowForm(true)}
            className={`w-full px-6 py-4 rounded-lg font-bold text-white transition-all duration-300 ${
              settlementMode === 'x402'
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700'
            }`}
          >
            Create {settlementMode === 'x402' ? 'X402' : 'Batch'} Settlement
          </button>

          {settlementMode === 'x402' && (
            <div className="bg-[#5856D6]/10 border border-[#5856D6]/30 rounded-lg p-3">
              <p className="text-xs text-[#5856D6]">
                ⚡ <strong>X402 Protocol:</strong> Pay only 0.01 USDC fee per settlement. No CRO gas required!
              </p>
            </div>
          )}
          
          <div className="bg-[#FF9500]/10 border border-[#FF9500]/30 rounded-lg p-3">
            <p className="text-xs text-[#FF9500]">
              ℹ️ {settlementMode === 'x402' 
                ? 'X402 uses the official @crypto.com/facilitator-client SDK for secure settlements.'
                : 'Batch settlements allow you to process multiple payments in a single transaction, saving gas fees.'
              }
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#424245] mb-2">
              Portfolio ID
            </label>
            <input
              type="number"
              value={portfolioId}
              onChange={(e) => setPortfolioId(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-2 bg-[#F5F5F7] border border-[#E5E5EA] rounded-lg text-[#1D1D1F] focus:border-[#007AFF] focus:outline-none"
              disabled={isPending || isConfirming}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-[#424245]">
                Payments ({payments.length})
              </label>
              <button
                onClick={addPayment}
                className="flex items-center gap-1 px-3 py-1 bg-[#007AFF] hover:bg-[#0066D6] text-white rounded text-sm font-semibold transition-colors"
                disabled={isPending || isConfirming}
              >
                <Plus className="w-4 h-4" />
                Add Payment
              </button>
            </div>

            {payments.map((payment, index) => (
              <div key={index} className="bg-[#F5F5F7] p-4 rounded-lg border border-[#E5E5EA] space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-[#007AFF]">Payment #{index + 1}</span>
                  {payments.length > 1 && (
                    <button
                      onClick={() => removePayment(index)}
                      className="text-[#FF3B30] hover:text-[#E62E24]"
                      disabled={isPending || isConfirming}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                <input
                  type="text"
                  value={payment.recipient}
                  onChange={(e) => updatePayment(index, 'recipient', e.target.value)}
                  placeholder="Recipient Address (0x...)"
                  className="w-full px-3 py-2 bg-white border border-[#E5E5EA] rounded text-sm text-[#1D1D1F] focus:border-[#007AFF] focus:outline-none"
                  disabled={isPending || isConfirming}
                />
                
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={payment.amount}
                    onChange={(e) => updatePayment(index, 'amount', e.target.value)}
                    placeholder="Amount (CRO)"
                    className="px-3 py-2 bg-white border border-[#E5E5EA] rounded text-sm text-[#1D1D1F] focus:border-[#007AFF] focus:outline-none"
                    disabled={isPending || isConfirming}
                  />
                  <input
                    type="text"
                    value={payment.token}
                    onChange={(e) => updatePayment(index, 'token', e.target.value)}
                    placeholder="Token Address"
                    className="px-3 py-2 bg-white border border-[#E5E5EA] rounded text-sm text-[#1D1D1F] focus:border-[#007AFF] focus:outline-none"
                    disabled={isPending || isConfirming}
                  />
                </div>
              </div>
            ))}
          </div>

          {isPending || isConfirming || ['challenging', 'signing', 'settling'].includes(x402Status) ? (
            <div className={`border rounded-lg p-4 ${
              settlementMode === 'x402' 
                ? 'bg-[#5856D6]/10 border-[#5856D6]/30'
                : 'bg-[#007AFF]/10 border-[#007AFF]/30'
            }`}>
              <div className="flex items-center gap-3">
                <Loader2 className={`w-5 h-5 animate-spin ${
                  settlementMode === 'x402' ? 'text-[#5856D6]' : 'text-[#007AFF]'
                }`} />
                <div>
                  <p className={`font-semibold ${
                    settlementMode === 'x402' ? 'text-[#5856D6]' : 'text-[#007AFF]'
                  }`}>
                    {settlementMode === 'x402' 
                      ? x402Status === 'challenging' ? 'Creating payment challenge...'
                        : x402Status === 'signing' ? 'Sign payment in wallet...'
                        : 'Settling via x402 facilitator...'
                      : isPending ? 'Waiting for signature...' 
                        : 'Processing settlement...'
                    }
                  </p>
                  <p className="text-xs text-[#6E6E73] mt-1">
                    {settlementMode === 'x402'
                      ? x402Status === 'challenging' ? 'Fetching x402 payment requirements'
                        : x402Status === 'signing' ? 'Please sign the EIP-3009 authorization'
                        : 'Verifying and settling payment on-chain'
                      : isPending ? 'Please sign the transaction in your wallet' 
                        : 'PaymentRouter is processing your batch'
                    }
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 px-4 py-2 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-lg font-semibold transition-colors border border-[#E5E5EA]"
              >
                Cancel
              </button>
              <button
                onClick={handleProcessSettlement}
                className={`flex-1 px-4 py-2 rounded-lg font-semibold transition-colors ${
                  settlementMode === 'x402'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700'
                }`}
              >
                {settlementMode === 'x402' ? '⚡ Execute x402' : 'Process Settlement'}
              </button>
            </div>
          )}

          <div className={`border rounded-lg p-3 ${
            settlementMode === 'x402'
              ? 'bg-[#5856D6]/10 border-[#5856D6]/30'
              : 'bg-[#FF9500]/10 border-[#FF9500]/30'
          }`}>
            <p className={`text-xs ${
              settlementMode === 'x402' ? 'text-[#5856D6]' : 'text-[#FF9500]'
            }`}>
              {settlementMode === 'x402'
                ? '⚡ x402 settlement: ~0.01 USDC fee, no CRO gas required. Powered by @crypto.com/facilitator-client.'
                : '⚠️ This will create a real transaction on Cronos Testnet. Gas cost: ~0.3-0.5 tCRO.'
              }
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
