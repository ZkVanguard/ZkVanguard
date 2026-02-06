'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, CheckCircle, XCircle, FileSignature, Loader2 } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import { logger } from '@/lib/utils/logger';

export interface ActionPreview {
  title: string;
  description: string;
  type: 'rebalance' | 'hedge' | 'strategy' | 'settlement';
  details: {
    label: string;
    value: string;
    highlight?: boolean;
  }[];
  risks?: string[];
  expectedOutcome: string;
}

interface ActionApprovalModalProps {
  isOpen: boolean;
  action: ActionPreview;
  onApprove: (signature: string) => Promise<void>;
  onReject: () => void;
  isExecuting?: boolean;
}

export function ActionApprovalModal({
  isOpen,
  action,
  onApprove,
  onReject,
  isExecuting = false,
}: ActionApprovalModalProps) {
  const { signMessageAsync } = useSignMessage();
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setIsSigning(true);
    setError(null);

    try {
      // Create detailed message for signature
      const signatureMessage = `Chronos Vanguard - Manager Approval\n\n` +
        `Action: ${action.title}\n` +
        `Type: ${action.type.toUpperCase()}\n` +
        `Description: ${action.description}\n\n` +
        `Details:\n${action.details.map(d => `• ${d.label}: ${d.value}`).join('\n')}\n\n` +
        `Expected Outcome: ${action.expectedOutcome}\n\n` +
        `Timestamp: ${new Date().toISOString()}\n` +
        `Nonce: ${Date.now()}`;

      // Request manager signature
      const signature = await signMessageAsync({
        message: signatureMessage,
      });

      // Execute action with signature proof
      await onApprove(signature);
    } catch (err: unknown) {
      logger.error('Signature or execution failed', err instanceof Error ? err : undefined, { component: 'ActionApprovalModal' });
      if (err instanceof Error && err.message?.includes('User rejected')) {
        setError('Signature rejected. Action cancelled.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to execute action');
      }
    } finally {
      setIsSigning(false);
    }
  };

  const getIconForType = () => {
    switch (action.type) {
      case 'rebalance':
        return '⚖️';
      case 'hedge':
        return '🛡️';
      case 'strategy':
        return '🎯';
      case 'settlement':
        return '💰';
      default:
        return '📊';
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isSigning && !isExecuting) {
            onReject();
          }
        }}
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          className="bg-[#f5f5f7] rounded-2xl border border-purple-500/30 max-w-2xl w-full shadow-2xl shadow-purple-500/20"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-900/50 to-cyan-900/50 p-6 rounded-t-2xl border-b border-purple-500/30">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="text-4xl">{getIconForType()}</div>
                <div>
                  <h2 className="text-2xl font-bold text-[#1d1d1f] flex items-center gap-2">
                    Manager Approval Required
                    <Shield className="w-6 h-6 text-[#AF52DE]" />
                  </h2>
                  <p className="text-sm text-[#1d1d1f] mt-1">
                    Review and sign to authorize this action
                  </p>
                </div>
              </div>
              {!isSigning && !isExecuting && (
                <button
                  onClick={onReject}
                  className="text-[#86868b] hover:text-[#1d1d1f] transition-colors"
                  title="Reject"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Action Overview */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-[#1d1d1f] flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-[#007AFF]" />
                Action Details
              </h3>
              <div className="bg-white/50 rounded-lg p-4 border border-[#e8e8ed]">
                <p className="text-xl font-semibold text-[#1d1d1f] mb-2">{action.title}</p>
                <p className="text-[#1d1d1f] text-sm">{action.description}</p>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2">
              {action.details.map((detail, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    detail.highlight
                      ? 'bg-purple-500/10 border border-purple-500/30'
                      : 'bg-white/30'
                  }`}
                >
                  <span className="text-[#86868b] text-sm">{detail.label}</span>
                  <span
                    className={`font-semibold ${
                      detail.highlight ? 'text-[#AF52DE]' : 'text-[#1d1d1f]'
                    }`}
                  >
                    {detail.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Risks */}
            {action.risks && action.risks.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-yellow-500 font-semibold text-sm">Risk Considerations:</p>
                    <ul className="text-[#1d1d1f] text-sm space-y-1">
                      {action.risks.map((risk, index) => (
                        <li key={index}>• {risk}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Expected Outcome */}
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-500 font-semibold text-sm mb-1">Expected Outcome:</p>
                  <p className="text-[#1d1d1f] text-sm">{action.expectedOutcome}</p>
                </div>
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[#FF3B30] text-sm">{error}</p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-4">
              <button
                onClick={onReject}
                disabled={isSigning || isExecuting}
                className="flex-1 px-6 py-3 bg-[#F5F5F7] border border-[#E5E5EA] hover:bg-[#E5E5EA] disabled:opacity-50 rounded-lg font-semibold text-[#1d1d1f] transition-colors flex items-center justify-center gap-2"
              >
                <XCircle className="w-5 h-5" />
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={isSigning || isExecuting}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-[#5856D6] to-[#007AFF] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-white transition-all shadow-lg shadow-[#5856D6]/20 flex items-center justify-center gap-2"
              >
                {isSigning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Waiting for Signature...
                  </>
                ) : isExecuting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Shield className="w-5 h-5" />
                    Approve & Sign
                  </>
                )}
              </button>
            </div>

            {/* Info Footer */}
            <div className="bg-white/30 rounded-lg p-3 border border-[#e8e8ed]/50">
              <p className="text-xs text-[#86868b] text-center">
                🔐 Your signature proves authorization. No action will be executed without your approval.
                {action.type === 'settlement' && ' This transaction will be gasless via x402 protocol.'}
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
