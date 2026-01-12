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
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-black/5 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-[#007AFF] rounded-[12px] flex items-center justify-center">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-[17px] font-semibold text-[#1d1d1f]">Settlements</h3>
        </div>
        <div className="text-center py-8 bg-[#f5f5f7] rounded-[14px]">
          <div className="w-12 h-12 bg-[#007AFF]/10 rounded-[14px] flex items-center justify-center mx-auto mb-3">
            <Wallet className="w-6 h-6 text-[#007AFF]" />
          </div>
          <p className="text-[14px] font-medium text-[#1d1d1f] mb-1">Connect Wallet</p>
          <p className="text-[12px] text-[#86868b]">Process batch settlements on-chain</p>
        </div>
      </div>
    );
  }

  if (isConfirmed) {
    return (
      <div className="bg-white rounded-[16px] sm:rounded-[20px] shadow-sm border border-[#34C759]/20 overflow-hidden">
        <div className="p-4 sm:p-6 bg-gradient-to-br from-[#34C759]/5 to-transparent">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#34C759] rounded-[12px] flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-[#34C759]">Settlement Processed</h3>
              <p className="text-[12px] text-[#86868b]">Successfully completed</p>
            </div>
          </div>
          <p className="text-[13px] text-[#1d1d1f] mb-4">
            Your batch settlement has been successfully processed by the PaymentRouter contract.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={`https://explorer.cronos.org/testnet/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#34C759] text-white text-[13px] font-semibold rounded-[10px] active:scale-[0.98] transition-transform"
            >
              View Transaction
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              onClick={() => {
                setShowForm(false);
                setPayments([{ recipient: '', amount: '', token: '0x0000000000000000000000000000000000000000' }]);
              }}
              className="flex-1 px-4 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] text-[13px] font-semibold rounded-[10px] active:bg-[#e8e8ed] transition-colors"
            >
              New Settlement
            </button>
          </div>
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
              <h3 className="text-[17px] font-semibold text-[#FF3B30]">Settlement Failed</h3>
              <p className="text-[12px] text-[#86868b]">Could not process</p>
            </div>
          </div>
          <p className="text-[13px] text-[#1d1d1f] mb-4">
            {error.message || 'Failed to process settlement'}
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
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-black/5">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-[#007AFF] rounded-[10px] sm:rounded-[12px] flex items-center justify-center">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">Settlements</h3>
              <span className="px-1.5 py-0.5 bg-[#007AFF]/10 text-[#007AFF] text-[10px] font-bold rounded-full">
                On-Chain
              </span>
            </div>
            <p className="text-[11px] sm:text-[12px] text-[#86868b]">Process multiple payments in a single transaction via PaymentRouter</p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-6">
        {!showForm ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="bg-[#f5f5f7] p-3 rounded-[12px] border border-black/5">
                <h4 className="text-[12px] font-semibold text-[#007AFF] mb-1">Contract Address</h4>
                <p className="text-[10px] font-mono text-[#86868b] break-all">
                  {contractAddresses.paymentRouter}
                </p>
              </div>
              <div className="bg-[#f5f5f7] p-3 rounded-[12px] border border-black/5">
                <h4 className="text-[12px] font-semibold text-[#007AFF] mb-1">Settlement Type</h4>
                <p className="text-[12px] text-[#1d1d1f] font-medium">Batch Payment Processing</p>
              </div>
            </div>

            <button
              onClick={() => setShowForm(true)}
              className="w-full px-6 py-3 bg-gradient-to-r from-[#007AFF] to-[#5AC8FA] text-white text-[14px] font-semibold rounded-[12px] active:scale-[0.98] transition-transform"
            >
              Create Batch Settlement
            </button>

            <div className="bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[12px] p-3">
              <p className="text-[11px] text-[#FF9500]">
                ℹ️ Batch settlements allow you to process multiple payments in a single transaction, saving gas fees.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                Portfolio ID
              </label>
              <input
                type="number"
                value={portfolioId}
                onChange={(e) => setPortfolioId(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-2.5 bg-[#f5f5f7] border border-black/10 rounded-[10px] text-[13px] text-[#1d1d1f] font-medium focus:border-[#007AFF] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                disabled={isPending || isConfirming}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-semibold text-[#1d1d1f]">
                  Payments ({payments.length})
                </label>
                <button
                  onClick={addPayment}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#007AFF] text-white text-[12px] font-semibold rounded-[8px] active:scale-[0.95] transition-transform"
                  disabled={isPending || isConfirming}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>

              {payments.map((payment, index) => (
                <div key={index} className="bg-[#f5f5f7] p-3 rounded-[12px] border border-black/5 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-semibold text-[#007AFF]">Payment #{index + 1}</span>
                    {payments.length > 1 && (
                      <button
                        onClick={() => removePayment(index)}
                        className="w-6 h-6 flex items-center justify-center bg-[#FF3B30]/10 rounded-[8px] active:bg-[#FF3B30]/20 transition-colors"
                        disabled={isPending || isConfirming}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-[#FF3B30]" />
                      </button>
                    )}
                  </div>
                  
                  <input
                    type="text"
                    value={payment.recipient}
                    onChange={(e) => updatePayment(index, 'recipient', e.target.value)}
                    placeholder="Recipient Address (0x...)"
                    className="w-full px-3 py-2 bg-white border border-black/10 rounded-[8px] text-[12px] text-[#1d1d1f] placeholder:text-[#86868b] focus:border-[#007AFF] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                    disabled={isPending || isConfirming}
                  />
                  
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={payment.amount}
                      onChange={(e) => updatePayment(index, 'amount', e.target.value)}
                      placeholder="Amount (CRO)"
                      className="px-3 py-2 bg-white border border-black/10 rounded-[8px] text-[12px] text-[#1d1d1f] placeholder:text-[#86868b] focus:border-[#007AFF] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                      disabled={isPending || isConfirming}
                    />
                    <input
                      type="text"
                      value={payment.token}
                      onChange={(e) => updatePayment(index, 'token', e.target.value)}
                      placeholder="Token Address"
                      className="px-3 py-2 bg-white border border-black/10 rounded-[8px] text-[12px] text-[#1d1d1f] placeholder:text-[#86868b] focus:border-[#007AFF] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20"
                      disabled={isPending || isConfirming}
                    />
                  </div>
                </div>
              ))}
            </div>

            {isPending || isConfirming ? (
              <div className="bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px] p-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                  <div>
                    <p className="text-[13px] font-semibold text-[#007AFF]">
                      {isPending ? 'Waiting for signature...' : 'Processing settlement...'}
                    </p>
                    <p className="text-[11px] text-[#86868b] mt-0.5">
                      {isPending ? 'Please sign in your wallet' : 'PaymentRouter is processing'}
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
                  onClick={handleProcessSettlement}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#007AFF] to-[#5AC8FA] text-white text-[13px] font-semibold rounded-[10px] active:scale-[0.98] transition-transform"
                >
                  Process Settlement
                </button>
              </div>
            )}

            <div className="bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[12px] p-3">
              <p className="text-[11px] text-[#FF9500]">
                ⚠️ This will create a real transaction on Cronos Testnet. Gas cost: ~0.3-0.5 tCRO.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
