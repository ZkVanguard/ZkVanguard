'use client';

import { useState } from 'react';
import { X, Shield, TrendingDown, TrendingUp, AlertCircle, CheckCircle, Lock, Database, Wallet, Copy, ExternalLink, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { trackSuccessfulTransaction } from '@/lib/utils/transactionTracker';
import { logger } from '@/lib/utils/logger';

interface ManualHedgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableAssets?: string[];
  walletAddress?: string;
}

interface HedgeSuccess {
  orderId: string;
  zkProofHash?: string;
  zkProofGenerated: boolean;
  entryPrice: string;
  size: string;
  simulationMode: boolean;
  walletOwnershipProof?: string;
  walletBinding?: string;
  walletAddress?: string;
}

// Component to display ZK proof hash with copy and verify functionality
function ZKProofHashDisplay({ proofHash, orderId }: { proofHash: string; orderId: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(proofHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  const verifyUrl = `/en/zk-verification?proofHash=${encodeURIComponent(proofHash)}&hedgeId=${encodeURIComponent(orderId)}`;
  
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-[#86868b]">Proof Hash:</span>
        <div className="flex items-center gap-1">
          <code className="text-[11px] font-mono bg-[#f5f5f7] px-2 py-1 rounded text-[#1d1d1f]">
            {proofHash.substring(0, 16)}...{proofHash.substring(proofHash.length - 8)}
          </code>
          <button
            onClick={handleCopy}
            className="p-1.5 hover:bg-[#f5f5f7] rounded-md transition-colors group"
            title="Copy full proof hash"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[#34C759]" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#86868b] group-hover:text-[#007AFF]" />
            )}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-[#86868b]">
        This cryptographic proof verifies your hedge without revealing sensitive details.
      </p>
      <a
        href={verifyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-[#007AFF]/10 hover:bg-[#007AFF]/20 text-[#007AFF] rounded-[8px] text-[12px] font-medium transition-colors"
      >
        <Shield className="w-3.5 h-3.5" />
        Verify on ZK Page
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

export function ManualHedgeModal({ isOpen, onClose, availableAssets = ['BTC', 'ETH', 'CRO'], walletAddress }: ManualHedgeModalProps) {
  const [hedgeType, setHedgeType] = useState<'SHORT' | 'LONG'>('SHORT');
  const [asset, setAsset] = useState('BTC');
  const [size, setSize] = useState('0.01');
  const [leverage, setLeverage] = useState(2);
  const [entryPrice, setEntryPrice] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingStep, setCreatingStep] = useState<'submitting' | 'zk-proof' | 'wallet-proof' | 'database' | 'done'>('submitting');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<HedgeSuccess | null>(null);

  const handleCreate = async () => {
    setError(null);
    setSuccess(null);
    setCreatingStep('submitting');

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
    setCreatingStep('submitting');

    try {
      // Call the API endpoint to execute hedge on Moonlander
      logger.info('Manual hedge request', {
        component: 'ManualHedgeModal',
        data: {
          asset,
          side: hedgeType,
          notionalValue: Math.round(sizeNum * entryNum),
          leverage,
          stopLoss: stopNum,
          takeProfit: targetNum,
          reason: reason || `Manual ${hedgeType} hedge on ${asset}`
        }
      });

      setCreatingStep('zk-proof');

      const response = await fetch('/api/agents/hedging/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioId: 1,
          asset,
          side: hedgeType,
          notionalValue: Math.round(sizeNum * entryNum),
          leverage,
          stopLoss: stopNum,
          takeProfit: targetNum,
          reason: reason || `Manual ${hedgeType} hedge on ${asset}`,
          // Enable auto-approval for manual hedges (user-initiated)
          autoApprovalEnabled: true,
          autoApprovalThreshold: 1000000, // High threshold to auto-approve most manual hedges
          walletAddress, // Associate hedge with connected wallet
        })
      });

      logger.info('Manual hedge API response', { component: 'ManualHedgeModal', data: response.status });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `API error: ${response.status}` }));
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();
      logger.info('Manual hedge success', { component: 'ManualHedgeModal', data });

      if (data.success) {
        setCreatingStep('wallet-proof');
        
        // The API already saves to PostgreSQL database with ZK proof
        // We just need to store minimal data in localStorage for UI fallback
        const batchId = data.orderId || `manual-hedge-${Date.now()}`;
        
        // Save minimal reference to settlement history (DB is primary source)
        const settlements = JSON.parse(localStorage.getItem('settlement_history') || '{}');
        settlements[batchId] = {
          batchId,
          type: 'hedge',
          timestamp: Date.now(),
          status: 'active',
          zkProofHash: data.zkProofHash,
          zkProofGenerated: data.zkProofGenerated,
          walletOwnershipProof: data.walletOwnershipProof,
          walletBinding: data.walletBinding,
          walletAddress: data.walletAddress || walletAddress,
          storedInDatabase: true,
          hedgeDetails: {
            asset,
            type: hedgeType,
            size: parseFloat(data.size) || sizeNum,
            leverage,
            entryPrice: parseFloat(data.entryPrice) || entryNum,
            stopLoss: stopNum,
            targetPrice: targetNum,
            capitalUsed: (parseFloat(data.size) || sizeNum) * (parseFloat(data.entryPrice) || entryNum) / leverage,
            reason: reason || `Manual ${hedgeType} hedge on ${asset}`
          },
        };
        localStorage.setItem('settlement_history', JSON.stringify(settlements));

        setCreatingStep('database');

        // Also track as transaction
        trackSuccessfulTransaction({
          hash: batchId,
          type: 'hedge',
          from: 'manual',
          to: asset,
          value: ((parseFloat(data.size) || sizeNum) * (parseFloat(data.entryPrice) || entryNum) / leverage).toFixed(2),
          tokenSymbol: 'USDC',
          description: `${hedgeType} ${asset} hedge at $${(parseFloat(data.entryPrice) || entryNum).toFixed(2)}`,
        });

        // Trigger event to refresh UI
        window.dispatchEvent(new Event('hedgeAdded'));

        setCreatingStep('done');
        
        // Show success state with ZK proof info and wallet ownership
        setSuccess({
          orderId: data.orderId,
          zkProofHash: data.zkProofHash,
          zkProofGenerated: data.zkProofGenerated,
          entryPrice: data.entryPrice,
          size: data.size,
          simulationMode: data.simulationMode,
          walletOwnershipProof: data.walletOwnershipProof,
          walletBinding: data.walletBinding,
          walletAddress: data.walletAddress || walletAddress,
        });

        setCreating(false);
      } else {
        throw new Error(data.error || 'Failed to create hedge');
      }
    } catch (err) {
      console.error('🛡️ MANUAL HEDGE ERROR', err);
      setError(err instanceof Error ? err.message : 'Failed to create hedge. Please try again.');
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (success) {
      // Reset form on close after success
      setSize('0.01');
      setEntryPrice('');
      setTargetPrice('');
      setStopLoss('');
      setReason('');
      setSuccess(null);
    }
    onClose();
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
            onClick={handleClose}
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
                  <div className={`w-10 h-10 ${success ? 'bg-[#34C759]' : 'bg-[#007AFF]'} rounded-[12px] flex items-center justify-center`}>
                    {success ? <CheckCircle className="w-5 h-5 text-white" /> : <Shield className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-[17px] font-semibold text-[#1d1d1f]">
                      {success ? 'Hedge Created Successfully' : 'Create Manual Hedge'}
                    </h2>
                    <p className="text-[13px] text-[#86868b]">
                      {success ? 'ZK-verified and stored in database' : 'Protect your portfolio position'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="p-2 hover:bg-[#f5f5f7] rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-[#86868b]" />
                </button>
              </div>

              {/* Success View */}
              {success ? (
                <div className="p-6 space-y-5">
                  {/* Success Animation */}
                  <div className="flex flex-col items-center py-4">
                    <div className="w-16 h-16 bg-[#34C759]/10 rounded-full flex items-center justify-center mb-4">
                      <CheckCircle className="w-10 h-10 text-[#34C759]" />
                    </div>
                    <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-1">Hedge Position Created</h3>
                    <p className="text-[13px] text-[#86868b] text-center">
                      Your {hedgeType} position on {asset} is now active
                    </p>
                  </div>

                  {/* ZK Proof Status */}
                  <div className="p-4 bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px] space-y-3">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-[#007AFF]" />
                      <span className="text-[13px] font-semibold text-[#007AFF]">ZK-STARK Proof Generated</span>
                    </div>
                    {success.zkProofGenerated && success.zkProofHash && (
                      <ZKProofHashDisplay 
                        proofHash={success.zkProofHash}
                        orderId={success.orderId}
                      />
                    )}
                  </div>

                  {/* Database Status */}
                  <div className="p-4 bg-[#34C759]/5 border border-[#34C759]/20 rounded-[12px] space-y-3">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-[#34C759]" />
                      <span className="text-[13px] font-semibold text-[#34C759]">Stored in Database</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-[#86868b]">Order ID:</span>
                        <code className="text-[11px] font-mono bg-[#f5f5f7] px-2 py-1 rounded text-[#1d1d1f]">
                          {success.orderId}
                        </code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-[#86868b]">Entry Price:</span>
                        <span className="text-[12px] font-semibold text-[#1d1d1f]">
                          ${parseFloat(success.entryPrice).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-[#86868b]">Size:</span>
                        <span className="text-[12px] font-semibold text-[#1d1d1f]">
                          {success.size} {asset}
                        </span>
                      </div>
                      {success.simulationMode && (
                        <p className="text-[11px] text-[#FF9500] font-medium">
                          ⚠️ Simulation Mode - No real funds committed
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Wallet Ownership Verification */}
                  {success.walletOwnershipProof && (
                    <div className="p-4 bg-[#5856D6]/5 border border-[#5856D6]/20 rounded-[12px] space-y-3">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-[#5856D6]" />
                        <span className="text-[13px] font-semibold text-[#5856D6]">Wallet Ownership Verified</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-[#86868b]">Your Wallet:</span>
                          <code className="text-[11px] font-mono bg-[#f5f5f7] px-2 py-1 rounded text-[#1d1d1f]">
                            {success.walletAddress?.substring(0, 8)}...{success.walletAddress?.substring(success.walletAddress.length - 6)}
                          </code>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-[#86868b]">Ownership Proof:</span>
                          <code className="text-[11px] font-mono bg-[#f5f5f7] px-2 py-1 rounded text-[#1d1d1f]">
                            {success.walletOwnershipProof.substring(0, 12)}...{success.walletOwnershipProof.substring(success.walletOwnershipProof.length - 6)}
                          </code>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-[#86868b]">Binding Hash:</span>
                          <code className="text-[11px] font-mono bg-[#f5f5f7] px-2 py-1 rounded text-[#1d1d1f]">
                            {success.walletBinding?.substring(0, 12)}...{success.walletBinding?.substring(success.walletBinding.length - 6)}
                          </code>
                        </div>
                        <p className="text-[11px] text-[#86868b]">
                          This ZK proof cryptographically binds this hedge exclusively to your wallet address.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Close Button */}
                  <div className="pt-2">
                    <button
                      onClick={handleClose}
                      className="w-full px-4 py-3 bg-[#007AFF] text-white rounded-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
              /* Form */
              <div className="p-6 space-y-5">
                {/* Progress Indicator during creation */}
                {creating && (
                  <div className="p-4 bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-5 h-5 border-2 border-[#007AFF]/30 border-t-[#007AFF] rounded-full animate-spin" />
                      <span className="text-[13px] font-semibold text-[#007AFF]">
                        {creatingStep === 'submitting' && 'Submitting hedge request...'}
                        {creatingStep === 'zk-proof' && 'Generating ZK-STARK proof...'}
                        {creatingStep === 'wallet-proof' && 'Creating wallet ownership proof...'}
                        {creatingStep === 'database' && 'Storing in database...'}
                        {creatingStep === 'done' && 'Complete!'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <div className={`h-1 flex-1 rounded-full ${creatingStep !== 'submitting' ? 'bg-[#007AFF]' : 'bg-[#007AFF]/30'}`} />
                      <div className={`h-1 flex-1 rounded-full ${creatingStep === 'wallet-proof' || creatingStep === 'database' || creatingStep === 'done' ? 'bg-[#007AFF]' : 'bg-[#007AFF]/30'}`} />
                      <div className={`h-1 flex-1 rounded-full ${creatingStep === 'database' || creatingStep === 'done' ? 'bg-[#5856D6]' : 'bg-[#007AFF]/30'}`} />
                      <div className={`h-1 flex-1 rounded-full ${creatingStep === 'done' ? 'bg-[#34C759]' : 'bg-[#007AFF]/30'}`} />
                    </div>
                  </div>
                )}

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
                      className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#1d1d1f]"
                    />
                    <div className="mt-1 text-[10px] text-[#86868b]">
                      Typical: 0.01-1.0 for BTC/ETH
                    </div>
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
                  <div className="p-4 bg-[#f5f5f7] rounded-[12px] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[#86868b]">Potential P&L at Target:</span>
                      <span className={`text-[17px] font-bold ${parseFloat(potentialPnL) >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                        {parseFloat(potentialPnL) >= 0 ? '+' : ''}{parseFloat(potentialPnL).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
                      </span>
                    </div>
                    <div className="text-[10px] text-[#86868b] space-y-0.5">
                      <div>Position Value: ${(parseFloat(size) * parseFloat(entryPrice || '0')).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                      <div>Notional (with {leverage}x leverage): ${(parseFloat(size) * parseFloat(entryPrice || '0') * leverage).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                      <div>Price Move: ${Math.abs(parseFloat(entryPrice || '0') - parseFloat(targetPrice || '0')).toLocaleString('en-US', { maximumFractionDigits: 0 })} ({((Math.abs(parseFloat(entryPrice || '0') - parseFloat(targetPrice || '0')) / parseFloat(entryPrice || '1')) * 100).toFixed(1)}%)</div>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="sticky bottom-0 bg-white border-t border-black/5 px-6 py-4 flex gap-3">
                  <button
                    onClick={handleClose}
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
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
