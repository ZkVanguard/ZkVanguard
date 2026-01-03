'use client';

import { useState } from 'react';
import { Clock, CheckCircle, XCircle, Loader2, ExternalLink, Wallet, Plus, Trash2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useProcessSettlement, useContractAddresses } from '../../lib/contracts/hooks';
import { parseEther } from 'viem';

interface Payment {
  recipient: string;
  amount: string;
  token: string;
}

export function SettlementsPanel({ address: _address }: { address: string }) {
  const { isConnected } = useAccount();
  const contractAddresses = useContractAddresses();
  const { processSettlement, isPending, isConfirming, isConfirmed, error, hash } = useProcessSettlement();
  
  const [showForm, setShowForm] = useState(false);
  const [portfolioId, setPortfolioId] = useState('0');
  const [payments, setPayments] = useState<Payment[]>([
    { recipient: '', amount: '', token: '0x0000000000000000000000000000000000000000' }
  ]);

  const addPayment = () => {
    setPayments([...payments, { recipient: '', amount: '', token: '0x0000000000000000000000000000000000000000' }]);
  };

  const removePayment = (index: number) => {
    setPayments(payments.filter((_, i) => i !== index));
  };

  const updatePayment = (index: number, field: keyof Payment, value: string) => {
    const updated = [...payments];
    updated[index][field] = value;
    setPayments(updated);
  };

  const handleProcessSettlement = () => {
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

  if (!isConnected) {
    return (
      <div className="glass p-6 rounded-xl border border-white/10">
        <div className="flex items-center space-x-2 mb-4">
          <Clock className="w-6 h-6 text-cyan-500" />
          <h2 className="text-2xl font-semibold">Payment Settlement</h2>
        </div>
        <div className="text-center py-12">
          <Wallet className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
          <p className="text-gray-400">
            Connect your wallet to process batch settlements on-chain
          </p>
        </div>
      </div>
    );
  }

  if (isConfirmed) {
    return (
      <div className="glass p-6 rounded-xl border border-green-500/30 bg-green-500/5">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle className="w-6 h-6 text-green-400" />
          <h3 className="text-xl font-bold text-green-400">Settlement Processed!</h3>
        </div>
        <p className="text-gray-300 mb-4">
          Your batch settlement has been successfully processed by the PaymentRouter contract.
        </p>
        <div className="flex gap-3">
          <a
            href={`https://explorer.cronos.org/testnet/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors"
          >
            View Transaction
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={() => {
              setShowForm(false);
              setPayments([{ recipient: '', amount: '', token: '0x0000000000000000000000000000000000000000' }]);
            }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
          >
            New Settlement
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
          <h3 className="text-xl font-bold text-red-400">Settlement Failed</h3>
        </div>
        <p className="text-gray-300 mb-4 text-sm">
          {error.message || 'Failed to process settlement'}
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
            <Clock className="w-6 h-6 text-cyan-500" />
            <h2 className="text-2xl font-semibold">Batch Settlement</h2>
            <span className="text-xs px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded-full border border-cyan-500/30">
              On-Chain
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Process multiple payments in a single transaction via PaymentRouter
          </p>
        </div>
      </div>

      {!showForm ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-900 p-4 rounded-lg border border-cyan-500/20">
              <h3 className="font-semibold text-cyan-400 mb-2">Contract Address</h3>
              <p className="text-xs font-mono text-gray-400 break-all">
                {contractAddresses.paymentRouter}
              </p>
            </div>
            <div className="bg-gray-900 p-4 rounded-lg border border-cyan-500/20">
              <h3 className="font-semibold text-cyan-400 mb-2">Settlement Type</h3>
              <p className="text-sm text-gray-300">Batch Payment Processing</p>
            </div>
          </div>

          <button
            onClick={() => setShowForm(true)}
            className="w-full px-6 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 rounded-lg font-bold text-white transition-all duration-300"
          >
            Create Batch Settlement
          </button>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-xs text-amber-400">
              ℹ️ Batch settlements allow you to process multiple payments in a single transaction, saving gas fees.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Portfolio ID
            </label>
            <input
              type="number"
              value={portfolioId}
              onChange={(e) => setPortfolioId(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-cyan-500 focus:outline-none"
              disabled={isPending || isConfirming}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-300">
                Payments ({payments.length})
              </label>
              <button
                onClick={addPayment}
                className="flex items-center gap-1 px-3 py-1 bg-cyan-600 hover:bg-cyan-700 rounded text-sm font-semibold transition-colors"
                disabled={isPending || isConfirming}
              >
                <Plus className="w-4 h-4" />
                Add Payment
              </button>
            </div>

            {payments.map((payment, index) => (
              <div key={index} className="bg-gray-900 p-4 rounded-lg border border-gray-700 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-cyan-400">Payment #{index + 1}</span>
                  {payments.length > 1 && (
                    <button
                      onClick={() => removePayment(index)}
                      className="text-red-400 hover:text-red-300"
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
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white focus:border-cyan-500 focus:outline-none"
                  disabled={isPending || isConfirming}
                />
                
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={payment.amount}
                    onChange={(e) => updatePayment(index, 'amount', e.target.value)}
                    placeholder="Amount (CRO)"
                    className="px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white focus:border-cyan-500 focus:outline-none"
                    disabled={isPending || isConfirming}
                  />
                  <input
                    type="text"
                    value={payment.token}
                    onChange={(e) => updatePayment(index, 'token', e.target.value)}
                    placeholder="Token Address"
                    className="px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white focus:border-cyan-500 focus:outline-none"
                    disabled={isPending || isConfirming}
                  />
                </div>
              </div>
            ))}
          </div>

          {isPending || isConfirming ? (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                <div>
                  <p className="font-semibold text-cyan-400">
                    {isPending ? 'Waiting for signature...' : 'Processing settlement...'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {isPending ? 'Please sign the transaction in your wallet' : 'PaymentRouter is processing your batch'}
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
                onClick={handleProcessSettlement}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 rounded-lg font-semibold transition-colors"
              >
                Process Settlement
              </button>
            </div>
          )}

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-xs text-amber-400">
              ⚠️ This will create a real transaction on Cronos Testnet. Gas cost: ~0.3-0.5 tCRO.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
