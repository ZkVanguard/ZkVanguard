'use client';

import { useState } from 'react';
import { X, Shield, TrendingDown, TrendingUp, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { trackSuccessfulTransaction } from '@/lib/utils/transactionTracker';

interface ManualHedgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableAssets?: string[];
}

export function ManualHedgeModal({ isOpen, onClose, availableAssets = ['BTC', 'ETH', 'CRO'] }: ManualHedgeModalProps) {
  const [hedgeType, setHedgeType] = useState<'SHORT' | 'LONG'>('SHORT');
  const [asset, setAsset] = useState('BTC');
  const [size, setSize] = useState('0.01');
  const [leverage, setLeverage] = useState(2);
  const [entryPrice, setEntryPrice] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);

    // Validation
    if (!asset || !size || !entryPrice || !targetPrice || !stopLoss) {
      setError('Please fill in all required fields');
      return;
    }

    const sizeNum = parseFloat(size);
    const entryNum = parseFloat(entryPrice);
    const targetNum = parseFloat(targetPrice);
    const stopNum = parseFloat(stopLoss);

    if (sizeNum <= 0 || entryNum <= 0 || targetNum <= 0 || stopNum <= 0) {
      setError('All values must be greater than 0');
      return;
    }

    // Validate target/stop loss logic
    if (hedgeType === 'SHORT') {
      if (targetNum >= entryNum) {
        setError('For SHORT: Target price must be below entry price');
        return;
      }
      if (stopNum <= entryNum) {
        setError('For SHORT: Stop loss must be above entry price');
        return;
      }
    } else {
      if (targetNum <= entryNum) {
        setError('For LONG: Target price must be above entry price');
        return;
      }
      if (stopNum >= entryNum) {
        setError('For LONG: Stop loss must be below entry price');
        return;
      }
    }

    setCreating(true);

    try {
      // Create hedge data matching existing format
      const batchId = `manual-hedge-${Date.now()}`;
      const capitalUsed = sizeNum * entryNum / leverage;
      
      const hedgeData = {
        batchId,
        type: 'hedge',
        timestamp: Date.now(),
        status: 'active',
        managerSignature: 'manual-user-created',
        hedgeDetails: {
          type: hedgeType,
          asset: `${asset}-PERP`,
          size: sizeNum,
          leverage,
          entryPrice: entryNum,
          targetPrice: targetNum,
          stopLoss: stopNum,
          capitalUsed,
          reason: reason || `Manual ${hedgeType} hedge on ${asset}`,
        },
      };

      // Save to localStorage
      const settlements = localStorage.getItem('settlement_history');
      const settlementData = settlements ? JSON.parse(settlements) : {};
      settlementData[batchId] = hedgeData;
      localStorage.setItem('settlement_history', JSON.stringify(settlementData));

      // Track the hedge creation as a transaction
      trackSuccessfulTransaction({
        hash: batchId,
        type: 'hedge',
        from: 'manual',
        to: asset,
        value: capitalUsed.toFixed(2),
        tokenSymbol: 'USDC',
        description: `${hedgeType} ${asset} hedge at $${entryNum.toFixed(2)}`,
      });

      // Trigger event to refresh UI
      window.dispatchEvent(new Event('hedgeAdded'));

      // Success!
      setTimeout(() => {
        setCreating(false);
        onClose();
        // Reset form
        setSize('0.01');
        setEntryPrice('');
        setTargetPrice('');
        setStopLoss('');
        setReason('');
      }, 500);
    } catch (err) {
      console.error('Failed to create hedge:', err);
      setError('Failed to create hedge. Please try again.');
      setCreating(false);
    }
  };

  const calculatePnL = () => {
    if (!size || !entryPrice || !targetPrice) return null;
    const sizeNum = parseFloat(size);
    const entryNum = parseFloat(entryPrice);
    const targetNum = parseFloat(targetPrice);
    
    if (hedgeType === 'SHORT') {
      return ((entryNum - targetNum) * sizeNum * leverage).toFixed(2);
    } else {
      return ((targetNum - entryNum) * sizeNum * leverage).toFixed(2);
    }
  };

  const potentialPnL = calculatePnL();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-black/5 px-6 py-4 flex items-center justify-between rounded-t-[24px]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#007AFF] rounded-[12px] flex items-center justify-center">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-[17px] font-semibold text-[#1d1d1f]">Create Manual Hedge</h2>
                    <p className="text-[13px] text-[#86868b]">Protect your portfolio position</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-[#f5f5f7] rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-[#86868b]" />
                </button>
              </div>

              {/* Form */}
              <div className="p-6 space-y-5">
                {/* Error Message */}
                {error && (
                  <div className="flex items-start gap-2 p-3 bg-[#FF3B30]/10 border border-[#FF3B30]/20 rounded-[12px]">
                    <AlertCircle className="w-4 h-4 text-[#FF3B30] mt-0.5 flex-shrink-0" />
                    <p className="text-[13px] text-[#FF3B30] font-medium">{error}</p>
                  </div>
                )}

                {/* Hedge Type */}
                <div>
                  <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                    Hedge Type <span className="text-[#FF3B30]">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setHedgeType('SHORT')}
                      className={`p-3 rounded-[12px] border-2 transition-all ${
                        hedgeType === 'SHORT'
                          ? 'border-[#FF3B30] bg-[#FF3B30]/10'
                          : 'border-[#e8e8ed] hover:border-[#FF3B30]/30'
                      }`}
                    >
                      <TrendingDown className={`w-5 h-5 mx-auto mb-1 ${hedgeType === 'SHORT' ? 'text-[#FF3B30]' : 'text-[#86868b]'}`} />
                      <div className={`text-[15px] font-semibold ${hedgeType === 'SHORT' ? 'text-[#FF3B30]' : 'text-[#1d1d1f]'}`}>SHORT</div>
                      <div className="text-[11px] text-[#86868b]">Profit from price drop</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHedgeType('LONG')}
                      className={`p-3 rounded-[12px] border-2 transition-all ${
                        hedgeType === 'LONG'
                          ? 'border-[#34C759] bg-[#34C759]/10'
                          : 'border-[#e8e8ed] hover:border-[#34C759]/30'
                      }`}
                    >
                      <TrendingUp className={`w-5 h-5 mx-auto mb-1 ${hedgeType === 'LONG' ? 'text-[#34C759]' : 'text-[#86868b]'}`} />
                      <div className={`text-[15px] font-semibold ${hedgeType === 'LONG' ? 'text-[#34C759]' : 'text-[#1d1d1f]'}`}>LONG</div>
                      <div className="text-[11px] text-[#86868b]">Profit from price rise</div>
                    </button>
                  </div>
                </div>

                {/* Asset Selection */}
                <div>
                  <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                    Asset <span className="text-[#FF3B30]">*</span>
                  </label>
                  <select
                    value={asset}
                    onChange={(e) => setAsset(e.target.value)}
                    className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] bg-white text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                  >
                    {availableAssets.map((a) => (
                      <option key={a} value={a}>{a}-PERP</option>
                    ))}
                  </select>
                </div>

                {/* Size and Leverage */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Size <span className="text-[#FF3B30]">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                      placeholder="0.01"
                      className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Leverage: {leverage}x
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={leverage}
                      onChange={(e) => setLeverage(parseInt(e.target.value))}
                      className="w-full mt-3"
                    />
                  </div>
                </div>

                {/* Prices */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Entry Price (USD) <span className="text-[#FF3B30]">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={entryPrice}
                      onChange={(e) => setEntryPrice(e.target.value)}
                      placeholder={asset === 'BTC' ? '95000' : asset === 'ETH' ? '3500' : '0.10'}
                      className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Target Price (USD) <span className="text-[#FF3B30]">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      placeholder={hedgeType === 'SHORT' ? 'Lower than entry' : 'Higher than entry'}
                      className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Stop Loss (USD) <span className="text-[#FF3B30]">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                      placeholder={hedgeType === 'SHORT' ? 'Higher than entry' : 'Lower than entry'}
                      className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                    />
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                    Reason (Optional)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why are you creating this hedge?"
                    rows={3}
                    className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b] resize-none"
                  />
                </div>

                {/* Potential P&L Preview */}
                {potentialPnL && (
                  <div className="p-4 bg-[#f5f5f7] rounded-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[#86868b]">Potential P&L at Target:</span>
                      <span className={`text-[17px] font-bold ${parseFloat(potentialPnL) >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                        {parseFloat(potentialPnL) >= 0 ? '+' : ''}{potentialPnL} USDC
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-white border-t border-black/5 px-6 py-4 flex gap-3">
                <button
                  onClick={onClose}
                  disabled={creating}
                  className="flex-1 px-4 py-3 bg-[#f5f5f7] text-[#1d1d1f] rounded-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 px-4 py-3 bg-[#007AFF] text-white rounded-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      Create Hedge
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
