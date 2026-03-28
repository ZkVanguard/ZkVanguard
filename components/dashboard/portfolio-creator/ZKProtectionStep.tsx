'use client';

import { useState } from 'react';
import { Shield, Lock, EyeOff, Eye, Loader2, CheckCircle, FileSignature } from 'lucide-react';
import { motion } from 'framer-motion';
import { logger } from '../../../lib/utils/logger';
import { InfoTooltip } from './InfoTooltip';

export function ZKProtectionStep({ 
  strategyPrivate, 
  setStrategyPrivate, 
  zkProofGenerated,
  onGenerateProof,
  onNext, 
  onBack 
}: {
  strategyPrivate: boolean;
  setStrategyPrivate: (value: boolean) => void;
  zkProofGenerated: boolean;
  onGenerateProof: () => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateProof = async () => {
    setIsGenerating(true);
    try {
      await onGenerateProof();
    } catch (error) {
      logger.error('Failed to generate proof', error instanceof Error ? error : undefined, { component: 'ZKProtectionStep' });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] flex items-center gap-2">
          <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-[#34C759]" />
          Privacy & ZK Protection
        </h3>
        <InfoTooltip content={[
          "Protect your trading strategy using Zero-Knowledge proofs while maintaining on-chain verifiability",
          "",
          "🔒 What gets protected:",
          "• Entry and exit price points",
          "• Risk management rules",
          "• Custom parameters",
          "",
          "✅ What stays public:",
          "• Portfolio performance",
          "• Asset allocations",
          "• Transaction history",
          "",
          "💡 Benefits: Prevents front-running and strategy copying while maintaining transparency"
        ]} />
      </div>

      <div className="bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[14px] p-4">
        <div className="flex items-start gap-3">
          <FileSignature className="w-4 h-4 sm:w-5 sm:h-5 text-[#007AFF] flex-shrink-0 mt-0.5" />
          <div className="text-[13px] sm:text-[14px]">
            <p className="font-semibold text-[#007AFF] mb-1">Signature Required</p>
            <p className="text-[#424245] font-medium">All portfolio operations require wallet signature for on-chain verification. Your strategy will be cryptographically signed and stored on Cronos zkEVM.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[16px] p-5 sm:p-6 border border-black/5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#34C759]/10 rounded-[12px] flex items-center justify-center flex-shrink-0">
            <Lock className="w-5 h-5 sm:w-6 sm:h-6 text-[#34C759]" />
          </div>
          <div>
            <h4 className="font-semibold text-[15px] sm:text-[16px] text-[#1d1d1f] mb-2">Zero-Knowledge Strategy Protection</h4>
            <p className="text-[12px] sm:text-[13px] text-[#4a4a4a] leading-relaxed">
              Your AI fund management strategy can be cryptographically protected using ZK-STARK proofs. 
              This ensures your entry points, exit rules, and risk parameters remain private while still 
              being verifiable on-chain.
            </p>
          </div>
        </div>

        <div className="mt-5 sm:mt-6 space-y-4">
          <label className="flex items-center justify-between p-4 rounded-[14px] border-2 border-black/10 hover:border-[#34C759] cursor-pointer transition-colors">
            <div className="flex items-center gap-3">
              {strategyPrivate ? (
                <EyeOff className="w-5 h-5 text-[#34C759]" />
              ) : (
                <Eye className="w-5 h-5 text-[#86868b]" />
              )}
              <div className="flex items-center gap-2">
                <div>
                  <div className="font-semibold text-[14px] sm:text-[15px] text-[#1d1d1f]">
                    {strategyPrivate ? 'Private Strategy (Recommended)' : 'Public Strategy'}
                  </div>
                  <div className="text-[11px] sm:text-[12px] text-[#666666] mt-1">
                    {strategyPrivate 
                      ? 'Strategy details hidden with ZK-STARK proofs + signature' 
                      : 'Strategy parameters visible on-chain (still requires signature)'}
                  </div>
                </div>
                <InfoTooltip content={[
                  strategyPrivate 
                    ? "🔒 Private Mode: Your trading strategy is encrypted using ZK-STARK proofs"
                    : "👁️ Public Mode: Anyone can see your strategy parameters",
                  "",
                  strategyPrivate 
                    ? "• Entry/exit rules: Hidden"
                    : "• Entry/exit rules: Visible",
                  strategyPrivate 
                    ? "• Risk parameters: Encrypted"
                    : "• Risk parameters: Public",
                  strategyPrivate 
                    ? "• Custom logic: Protected"
                    : "• Custom logic: Open",
                  "",
                  "💡 " + (strategyPrivate 
                    ? "Recommended for professional traders to prevent strategy copying"
                    : "Useful for transparent community-managed funds")
                ]} />
              </div>
            </div>
            <input
              type="checkbox"
              checked={strategyPrivate}
              onChange={(e) => setStrategyPrivate(e.target.checked)}
              className="w-5 h-5 rounded-[6px] border-black/20 text-[#34C759] focus:ring-[#34C759]/50 accent-[#34C759]"
            />
          </label>

          {strategyPrivate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="bg-[#34C759]/5 border border-[#34C759]/20 rounded-[14px] p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-[#34C759]" />
                <span className="text-[13px] sm:text-[14px] font-semibold text-[#34C759]">ZK-STARK Protection + Signature</span>
              </div>
              
              {!zkProofGenerated ? (
                <button
                  onClick={handleGenerateProof}
                  disabled={isGenerating}
                  className="w-full px-4 py-3 bg-[#34C759] hover:bg-[#2DB550] active:scale-[0.98] disabled:bg-[#86868b] disabled:cursor-not-allowed rounded-[10px] text-[13px] sm:text-[14px] font-semibold text-white transition-all flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating Proof & Awaiting Signature...
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4" />
                      Generate ZK Proof & Sign
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[#34C759] text-[13px] sm:text-[14px]">
                    <CheckCircle className="w-4 h-4" />
                    <span>ZK Proof Generated &bull; 521-bit Security</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#34C759] text-[13px] sm:text-[14px]">
                    <CheckCircle className="w-4 h-4" />
                    <span>Strategy Signed &bull; Verified On-Chain</span>
                  </div>
                </div>
              )}

              <div className="mt-3 text-[10px] sm:text-[11px] space-y-1 font-medium">
                <div className="text-[#424245]">&bull; Entry/exit points encrypted</div>
                <div className="text-[#424245]">&bull; Risk parameters hidden</div>
                <div className="text-[#424245]">&bull; Verifiable without revealing strategy</div>
                <div className="text-[#424245]">&bull; Cryptographically signed by wallet</div>
                <div className="text-[#424245]">&bull; Stored on Cronos zkEVM with gasless tx (x402)</div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 px-6 py-3 sm:py-3.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-[#1d1d1f] transition-all"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={strategyPrivate && !zkProofGenerated}
          className="flex-1 px-6 py-3 sm:py-3.5 bg-[#34C759] hover:bg-[#2DB550] active:scale-[0.98] disabled:bg-[#86868b] disabled:cursor-not-allowed rounded-[12px] font-semibold text-[15px] text-white transition-all"
        >
          Review & Create
        </button>
      </div>
    </div>
  );
}
