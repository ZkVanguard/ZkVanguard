'use client';

import { useState, useEffect } from 'react';
import { Shield, CheckCircle, Loader2, Lock, Eye, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ZKProofData {
  proofHash: string;
  merkleRoot: string;
  timestamp: number;
  verified: boolean;
  protocol: string;
  securityLevel: number;
  generationTime?: number;
  txHash?: string;
}

interface ZKVerificationBadgeProps {
  proof?: ZKProofData;
  isGenerating?: boolean;
  isVerifying?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showDetails?: boolean;
  onVerify?: () => void;
  className?: string;
}

export function ZKVerificationBadge({
  proof,
  isGenerating = false,
  isVerifying = false,
  size = 'md',
  showDetails = false,
  onVerify,
  className = '',
}: ZKVerificationBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  if (isGenerating) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} bg-purple-500/20 text-purple-400 rounded-full border border-purple-500/30 ${className}`}
      >
        <Loader2 className={`${iconSizes[size]} animate-spin`} />
        <span>Generating ZK Proof...</span>
      </motion.div>
    );
  }

  if (isVerifying) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} bg-cyan-500/20 text-cyan-400 rounded-full border border-cyan-500/30 ${className}`}
      >
        <Loader2 className={`${iconSizes[size]} animate-spin`} />
        <span>Verifying On-Chain...</span>
      </motion.div>
    );
  }

  if (!proof) {
    return (
      <button
        onClick={onVerify}
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} bg-gray-500/20 text-gray-400 rounded-full border border-gray-500/30 hover:bg-gray-500/30 transition-colors ${className}`}
      >
        <Shield className={iconSizes[size]} />
        <span>No ZK Proof</span>
      </button>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <motion.button
        onClick={() => showDetails && setExpanded(!expanded)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={`inline-flex items-center gap-1.5 ${sizeClasses[size]} ${
          proof.verified
            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
        } rounded-full border transition-all cursor-pointer hover:shadow-lg hover:shadow-emerald-500/10`}
      >
        {proof.verified ? (
          <>
            <CheckCircle className={iconSizes[size]} />
            <span>ZK Verified</span>
            <Lock className={`${iconSizes[size]} opacity-60`} />
          </>
        ) : (
          <>
            <Shield className={iconSizes[size]} />
            <span>Pending Verification</span>
          </>
        )}
      </motion.button>

      <AnimatePresence>
        {expanded && showDetails && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute top-full mt-2 left-0 z-50 w-72 bg-gray-900 rounded-xl border border-emerald-500/30 shadow-xl shadow-emerald-500/10 p-4"
          >
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-700">
              <Shield className="w-5 h-5 text-emerald-400" />
              <span className="font-semibold text-white">ZK-STARK Proof</span>
              <span className="ml-auto text-xs text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded">
                {proof.protocol}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Proof Hash:</span>
                <span className="font-mono text-emerald-400 text-xs">
                  {proof.proofHash.slice(0, 8)}...{proof.proofHash.slice(-6)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Merkle Root:</span>
                <span className="font-mono text-cyan-400 text-xs">
                  {proof.merkleRoot.slice(0, 8)}...{proof.merkleRoot.slice(-6)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Security:</span>
                <span className="text-purple-400">{proof.securityLevel}-bit</span>
              </div>
              {proof.generationTime && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Generation:</span>
                  <span className="text-blue-400">{proof.generationTime}ms</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">Timestamp:</span>
                <span className="text-gray-300">
                  {new Date(proof.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {proof.txHash && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">On-Chain:</span>
                  <a
                    href={`https://explorer.cronos.org/testnet/tx/${proof.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 text-xs font-mono flex items-center gap-1"
                  >
                    {proof.txHash.slice(0, 8)}...
                    <Zap className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-700">
              <div className="flex items-start gap-2 text-xs text-gray-400">
                <Eye className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>
                  Zero-knowledge proof verifies computation without revealing sensitive portfolio data
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Compact inline badge for agent activity items
 */
export function ZKBadgeInline({ verified, size = 'sm' }: { verified: boolean; size?: 'sm' | 'md' }) {
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-1'
      } ${
        verified
          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
          : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
      } rounded border`}
    >
      {verified ? <CheckCircle className={iconSize} /> : <Shield className={iconSize} />}
      <span>{verified ? 'ZK' : '...'}</span>
    </span>
  );
}
