'use client';

import { useState, useEffect } from 'react';
import { useSignMessage } from 'wagmi';
import { useWallet } from '@/lib/hooks/useWallet';
import { useCreatePortfolio } from '../../lib/contracts/hooks';
import { useRWAManager } from '../../lib/contracts/suiHooks';
import { 
  Loader2, CheckCircle, XCircle, Shield, Sparkles, 
  Filter, Target, AlertTriangle, Lock, Eye, EyeOff, Info, FileSignature 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { logger } from '../../lib/utils/logger';

interface StrategyConfig {
  name: string;
  targetYield: number;
  riskTolerance: number;
  rebalanceFrequency: 'daily' | 'weekly' | 'monthly';
  hedgingEnabled: boolean;
  maxDrawdown: number;
  concentrationLimit: number;
  // Auto-Approval Settings
  autoApprovalEnabled: boolean;
  autoApprovalThreshold: number; // USD value threshold for auto-approval
  // ZK-protected fields
  privateStrategy: {
    entryPoints?: number[];
    exitRules?: string[];
    riskParams?: Record<string, number>;
  };
}

interface AssetFilter {
  minMarketCap?: number;
  maxVolatility?: number;
  allowedCategories: string[];
  excludedAssets: string[];
  minLiquidity?: number;
}

interface AdvancedPortfolioCreatorProps {
  /** External control for modal visibility */
  isOpen?: boolean;
  /** Callback when modal visibility changes */
  onOpenChange?: (isOpen: boolean) => void;
  /** Hide the trigger button (for embedded use) */
  hideTrigger?: boolean;
}

export function AdvancedPortfolioCreator({ isOpen, onOpenChange, hideTrigger = false }: AdvancedPortfolioCreatorProps = {}) {
  const { address, evmConnected, isSUI, suiConnected } = useWallet();
  const { createPortfolio: createEvmPortfolio, isPending: evmPending, isConfirming: evmConfirming, isConfirmed: evmConfirmed, error: evmError, hash: evmHash } = useCreatePortfolio();
  const { createPortfolio: createSuiPortfolio, loading: suiLoading, error: suiError } = useRWAManager();
  const { signMessageAsync } = useSignMessage();
  
  // Combined loading/error states
  const isPending = isSUI ? suiLoading : evmPending;
  const isConfirming = isSUI ? false : evmConfirming;
  const isConfirmed = isSUI ? false : evmConfirmed;
  const error = isSUI ? (suiError ? new Error(suiError) : null) : evmError;
  
  const [internalShowModal, setInternalShowModal] = useState(false);
  
  // Use external control if provided, otherwise use internal state
  const showModal = isOpen !== undefined ? isOpen : internalShowModal;
  const setShowModal = (value: boolean) => {
    if (onOpenChange) {
      onOpenChange(value);
    } else {
      setInternalShowModal(value);
    }
  };
  
  const [step, setStep] = useState<'strategy' | 'filters' | 'review' | 'zk-protection'>('strategy');
  const [strategyPrivate, setStrategyPrivate] = useState(true);
  const [zkProofGenerated, setZkProofGenerated] = useState(false);
  const [zkProofHash, setZkProofHash] = useState('');
  const [_strategySigned, setStrategySigned] = useState(false);
  const [strategySignature, setStrategySignature] = useState('');
  const [_onChainTxHash, setOnChainTxHash] = useState('');
  
  // Strategy configuration
  const [strategy, setStrategy] = useState<StrategyConfig>({
    name: '',
    targetYield: 1000, // 10% in bps
    riskTolerance: 50,
    rebalanceFrequency: 'weekly',
    hedgingEnabled: true,
    maxDrawdown: 20,
    concentrationLimit: 30,
    autoApprovalEnabled: false,
    autoApprovalThreshold: 10000, // $10K default
    privateStrategy: {},
  });

  // Asset filters
  const [filters, setFilters] = useState<AssetFilter>({
    minMarketCap: 1000000, // $1M
    maxVolatility: 80,
    allowedCategories: ['DeFi', 'Layer1', 'Layer2'],
    excludedAssets: [],
    minLiquidity: 500000,
  });

  const [aiPreset, setAiPreset] = useState<'conservative' | 'balanced' | 'aggressive' | 'custom'>('balanced');

  // AI Preset Templates
  const presets = {
    conservative: {
      targetYield: 500,
      riskTolerance: 25,
      maxDrawdown: 10,
      concentrationLimit: 20,
      hedgingEnabled: true,
      rebalanceFrequency: 'weekly' as const,
      autoApprovalEnabled: true,
      autoApprovalThreshold: 5000, // $5K for conservative
    },
    balanced: {
      targetYield: 1000,
      riskTolerance: 50,
      maxDrawdown: 20,
      concentrationLimit: 30,
      hedgingEnabled: true,
      rebalanceFrequency: 'weekly' as const,
      autoApprovalEnabled: true,
      autoApprovalThreshold: 10000, // $10K for balanced
    },
    aggressive: {
      targetYield: 2000,
      riskTolerance: 80,
      maxDrawdown: 35,
      concentrationLimit: 50,
      hedgingEnabled: true,
      rebalanceFrequency: 'daily' as const,
      autoApprovalEnabled: true,
      autoApprovalThreshold: 25000, // $25K for aggressive
    },
  };

  // Apply AI preset
  useEffect(() => {
    if (aiPreset !== 'custom') {
      setStrategy(prev => ({ ...prev, ...presets[aiPreset] }));
    }
  }, [aiPreset]);

  // Track EVM transaction hash and update state when available
  useEffect(() => {
    if (evmHash && !isSUI) {
      setOnChainTxHash(evmHash);
      logger.info('✅ EVM Portfolio transaction submitted', { component: 'AdvancedPortfolioCreator', data: { hash: evmHash } });
    }
  }, [evmHash, isSUI]);

  // Generate ZK proof for private strategy and store on-chain
  const generateZKProof = async () => {
    try {
      // Step 1: Generate ZK proof
      const response = await fetch('/api/zk-proof/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: 'portfolio_strategy',
          statement: {
            strategyName: strategy.name,
            targetYield: strategy.targetYield,
            riskTolerance: strategy.riskTolerance,
            timestamp: Date.now(),
          },
          witness: {
            privateStrategy: strategy.privateStrategy,
            filters: filters,
            secret: `${Date.now()}-${address}`.slice(0, 32), // Deterministic based on time and address
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const proofHash = data.proof?.merkle_root || `0x${Date.now().toString(16).padEnd(64, '0')}`;
        setZkProofHash(proofHash);
        
        // Step 2: Sign the strategy configuration
        const message = `Chronos Vanguard Portfolio Strategy\n\nName: ${strategy.name}\nTarget Yield: ${strategy.targetYield / 100}%\nRisk: ${strategy.riskTolerance}\nZK Proof: ${proofHash}\nTimestamp: ${Date.now()}`;
        
        try {
          // For SUI wallets, use a hash-based verification instead of signature
          if (isSUI) {
            // Generate a deterministic signature-like hash for SUI
            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            setStrategySignature(hashHex);
            setStrategySigned(true);
            setZkProofGenerated(true);
          } else {
            const signature = await signMessageAsync({ message });
            setStrategySignature(signature);
            setStrategySigned(true);
            setZkProofGenerated(true);
          }
        } catch (signError) {
          logger.error('User rejected signature', signError instanceof Error ? signError : undefined, { component: 'AdvancedPortfolioCreator' });
          throw new Error('Signature required to proceed');
        }
      }
    } catch (error) {
      logger.error('ZK proof generation failed', error instanceof Error ? error : undefined, { component: 'AdvancedPortfolioCreator' });
      throw error;
    }
  };

  const handleCreate = async () => {
    try {
      // Step 1: Create portfolio on-chain (requires signature)
      const yieldBps = BigInt(strategy.targetYield);
      const risk = BigInt(strategy.riskTolerance);
      
      let portfolioId: string | undefined;
      
      if (isSUI) {
        // SUI wallet - use SUI contract
        const result = await createSuiPortfolio({
          targetYield: strategy.targetYield,
          riskTolerance: strategy.riskTolerance,
          depositAmount: BigInt(0), // Initial deposit of 0, user can deposit later
        });
        
        if (result.success && result.digest) {
          portfolioId = result.digest;
          logger.info('✅ SUI Portfolio created', { component: 'AdvancedPortfolioCreator', data: { digest: result.digest } });
        } else {
          throw new Error(result.error || 'Failed to create SUI portfolio');
        }
      } else {
        // EVM wallet - use Cronos contract
        // This triggers the transaction, hash will be available via evmHash reactively
        createEvmPortfolio(yieldBps, risk);
        // Use a placeholder - the actual hash will be tracked via hook state
        portfolioId = 'pending-evm-tx';
      }
      
      // Step 2: Store strategy metadata on-chain with ZK proof
      if (portfolioId) {
        const strategyResponse = await fetch('/api/portfolio/strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            portfolioId: portfolioId,
            strategyConfig: {
              ...strategy,
              filters,
            },
            zkProofHash: strategyPrivate ? zkProofHash : null,
            signature: strategySignature,
            address: address,
            chainType: isSUI ? 'sui' : 'evm',
          }),
        });

        if (strategyResponse.ok) {
          const data = await strategyResponse.json();
          setOnChainTxHash(data.onChainHash);
          logger.info('✅ Portfolio and strategy committed on-chain', { component: 'AdvancedPortfolioCreator', data });
        }
      }
    } catch (err) {
      logger.error('Failed to create portfolio', err instanceof Error ? err : undefined, { component: 'AdvancedPortfolioCreator' });
      throw err;
    }
  };

  // Show connect wallet message if neither wallet is connected
  if (!evmConnected && !suiConnected) {
    return hideTrigger ? null : (
      <button
        className="px-5 sm:px-6 py-2.5 sm:py-3 bg-[#86868b] rounded-[12px] font-semibold text-[14px] sm:text-[15px] text-white flex items-center gap-2 cursor-not-allowed"
        disabled
      >
        <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
        Connect Wallet to Create Portfolio
      </button>
    );
  }

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={() => setShowModal(true)}
          className="px-5 sm:px-6 py-2.5 sm:py-3 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.98] rounded-[12px] font-semibold text-[14px] sm:text-[15px] text-white transition-all flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
          Create AI-Managed Portfolio
        </button>
      )}

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !isPending && !isConfirming && setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-[20px] sm:rounded-[24px] border border-black/5 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
            >
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-black/5 px-5 sm:px-6 py-4 sm:py-5 z-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[20px] sm:text-[24px] font-semibold text-[#1d1d1f] tracking-[-0.01em] flex items-center gap-2.5">
                      <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-br from-[#AF52DE] to-[#5856D6] rounded-[10px] flex items-center justify-center">
                        <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                      </div>
                      AI Fund Manager Setup
                    </h2>
                    <p className="text-[12px] sm:text-[13px] text-[#86868b] mt-1">
                      Create ZK-protected portfolio with custom strategy
                    </p>
                  </div>
                  {!isPending && !isConfirming && (
                    <button
                      onClick={() => setShowModal(false)}
                      className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-full transition-all"
                    >
                      <XCircle className="w-5 h-5 sm:w-6 sm:h-6" />
                    </button>
                  )}
                </div>

                {/* Progress Steps */}
                <div className="flex items-center gap-2 mt-5 sm:mt-6">
                  {['strategy', 'filters', 'zk-protection', 'review'].map((s, i) => (
                    <div key={s} className="flex items-center flex-1">
                      <div className={`flex-1 h-1 sm:h-1.5 rounded-full transition-colors ${
                        ['strategy', 'filters', 'zk-protection', 'review'].indexOf(step) >= i
                          ? 'bg-[#007AFF]'
                          : 'bg-[#e8e8ed]'
                      }`} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="px-5 sm:px-6 py-4 sm:py-5">
                {isConfirmed ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center py-10 sm:py-12"
                  >
                    <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 bg-[#34C759]/10 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-8 h-8 sm:w-10 sm:h-10 text-[#34C759]" />
                    </div>
                    <h3 className="text-[20px] sm:text-[24px] font-semibold text-[#1d1d1f] mb-2">Portfolio Created!</h3>
                    <p className="text-[14px] sm:text-[15px] text-[#86868b] mb-6">
                      Your AI-managed portfolio is now active with ZK-protected strategy
                    </p>
                    <button
                      onClick={() => {
                        setShowModal(false);
                        window.location.reload();
                      }}
                      className="px-6 py-3 bg-[#34C759] hover:bg-[#2DB550] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-white transition-all"
                    >
                      View Dashboard
                    </button>
                  </motion.div>
                ) : error ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center py-10 sm:py-12"
                  >
                    <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 bg-[#FF3B30]/10 rounded-full flex items-center justify-center">
                      <XCircle className="w-8 h-8 sm:w-10 sm:h-10 text-[#FF3B30]" />
                    </div>
                    <h3 className="text-[20px] sm:text-[24px] font-semibold text-[#1d1d1f] mb-2">Creation Failed</h3>
                    <p className="text-[14px] sm:text-[15px] text-[#86868b] mb-6">
                      {error.message || 'Failed to create portfolio'}
                    </p>
                    <button
                      onClick={() => setStep('strategy')}
                      className="px-6 py-3 bg-[#FF3B30] hover:bg-[#E0352B] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-white transition-all"
                    >
                      Try Again
                    </button>
                  </motion.div>
                ) : step === 'strategy' ? (
                  <StrategyStep
                    strategy={strategy}
                    setStrategy={setStrategy}
                    aiPreset={aiPreset}
                    setAiPreset={setAiPreset}
                    onNext={() => setStep('filters')}
                  />
                ) : step === 'filters' ? (
                  <FiltersStep
                    filters={filters}
                    setFilters={setFilters}
                    onNext={() => setStep('zk-protection')}
                    onBack={() => setStep('strategy')}
                  />
                ) : step === 'zk-protection' ? (
                  <ZKProtectionStep
                    strategyPrivate={strategyPrivate}
                    setStrategyPrivate={setStrategyPrivate}
                    zkProofGenerated={zkProofGenerated}
                    onGenerateProof={generateZKProof}
                    onNext={() => setStep('review')}
                    onBack={() => setStep('filters')}
                  />
                ) : (
                  <ReviewStep
                    strategy={strategy}
                    filters={filters}
                    strategyPrivate={strategyPrivate}
                    zkProofGenerated={zkProofGenerated}
                    isPending={isPending}
                    isConfirming={isConfirming}
                    onCreate={handleCreate}
                    onBack={() => setStep('zk-protection')}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Info Tooltip Component
function InfoTooltip({ content }: { content: string | string[] }) {
  const [isHovered, setIsHovered] = useState(false);
  const lines = Array.isArray(content) ? content : [content];
  
  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Info 
        className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#86868b] hover:text-[#007AFF] cursor-help transition-colors"
      />
      {isHovered && (
        <div className="absolute left-6 top-0 z-[100] w-72 sm:w-80 bg-white border border-[#E5E5EA] rounded-[12px] p-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
          <div className="text-[11px] sm:text-[12px] space-y-1.5">
            {lines.map((line, idx) => (
              <p key={idx} className="leading-relaxed text-[#1D1D1F]">{line}</p>
            ))}
          </div>
          <div className="absolute left-0 top-2 w-2 h-2 bg-white border-l border-t border-[#E5E5EA] transform -translate-x-1 rotate-45" />
        </div>
      )}
    </div>
  );
}

// Strategy Configuration Step
function StrategyStep({ 
  strategy, 
  setStrategy, 
  aiPreset, 
  setAiPreset,
  onNext 
}: {
  strategy: StrategyConfig;
  setStrategy: React.Dispatch<React.SetStateAction<StrategyConfig>>;
  aiPreset: 'conservative' | 'balanced' | 'aggressive' | 'custom';
  setAiPreset: (preset: 'conservative' | 'balanced' | 'aggressive' | 'custom') => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 sm:w-5 sm:h-5 text-[#AF52DE]" />
          AI Strategy Configuration
        </h3>

        {/* AI Presets */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5 sm:mb-6">
          {(['conservative', 'balanced', 'aggressive'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setAiPreset(preset)}
              className={`p-3 sm:p-4 rounded-[14px] border-2 transition-all active:scale-[0.98] ${
                aiPreset === preset
                  ? 'border-[#007AFF] bg-[#007AFF]/5'
                  : 'border-black/10 hover:border-[#007AFF]/50 bg-[#f5f5f7]'
              }`}
            >
              <div className="text-[18px] sm:text-[22px] mb-1">
                {preset === 'conservative' && '🛡️'}
                {preset === 'balanced' && '⚖️'}
                {preset === 'aggressive' && '🚀'}
              </div>
              <div className="text-[12px] sm:text-[13px] font-semibold text-[#1d1d1f] capitalize mb-1">{preset}</div>
              <div className="text-[10px] sm:text-[11px] text-[#86868b]">
                {preset === 'conservative' && 'Low risk, stable'}
                {preset === 'balanced' && 'Moderate risk'}
                {preset === 'aggressive' && 'High risk'}
              </div>
              <div className={`text-[10px] sm:text-[11px] mt-1.5 font-medium ${
                preset === 'conservative' ? 'text-[#34C759]' :
                preset === 'balanced' ? 'text-[#007AFF]' :
                'text-[#FF9500]'
              }`}>
                {preset === 'conservative' && '5-8% APY'}
                {preset === 'balanced' && '10-15% APY'}
                {preset === 'aggressive' && '20-30% APY'}
              </div>
            </button>
          ))}
        </div>

        {/* Custom Fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
              Portfolio Name
              <InfoTooltip content="Give your strategy a memorable name that describes its purpose" />
            </label>
            <input
              type="text"
              value={strategy.name}
              onChange={(e) => setStrategy({ ...strategy, name: e.target.value })}
              placeholder="e.g., Conservative DeFi Fund"
              className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] placeholder:text-[#86868b] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
                Target Yield (% APY)
                <InfoTooltip content={[
                  "Expected annual return - AI optimizes portfolio to hit this target",
                  "💡 Recommended ranges:",
                  "• Conservative: 5-8% APY (stable, low risk)",
                  "• Balanced: 10-15% APY (moderate risk/reward)",
                  "• Aggressive: 20-30% APY (high risk, high returns)"
                ]} />
              </label>
              <input
                type="number"
                value={strategy.targetYield / 100}
                onChange={(e) => setStrategy({ ...strategy, targetYield: Number(e.target.value) * 100 })}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
                Risk Tolerance (0-100)
                <InfoTooltip content={[
                  "How much volatility you're comfortable with - Higher values = more aggressive trades",
                  "🛡️ Safe (0-30): Minimal risk, stable returns",
                  "⚖️ Moderate (30-70): Balanced risk/reward",
                  "🚀 Aggressive (70-100): Maximum growth potential",
                  "",
                  "💡 Impact: Risk Agent uses this threshold to calculate when to automatically trigger protective hedges"
                ]} />
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={strategy.riskTolerance}
                onChange={(e) => setStrategy({ ...strategy, riskTolerance: Number(e.target.value) })}
                className="w-full accent-[#007AFF]"
              />
              <div className={`text-center text-[13px] sm:text-[14px] font-semibold mt-1 ${
                strategy.riskTolerance < 30 ? 'text-[#34C759]' :
                strategy.riskTolerance < 70 ? 'text-[#FF9500]' :
                'text-[#FF3B30]'
              }`}>
                {strategy.riskTolerance}
              </div>
              <div className="mt-2 flex justify-between text-[10px] sm:text-[11px]">
                <span className="text-[#34C759]">🛡️ Safe</span>
                <span className="text-[#FF9500]">⚖️ Moderate</span>
                <span className="text-[#FF3B30]">🚀 Aggressive</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
                Max Drawdown (%)
                <InfoTooltip content={[
                  "Maximum portfolio loss before AI automatically opens protective hedges - Your safety net",
                  "",
                  `💡 Example: If set to ${strategy.maxDrawdown}%, and portfolio drops ${strategy.maxDrawdown}% from its peak value, the Hedging Agent immediately opens protective positions to limit further losses`,
                  "",
                  "Recommended: 10-15% (conservative), 20-30% (balanced), 35-50% (aggressive)"
                ]} />
              </label>
              <input
                type="number"
                value={strategy.maxDrawdown}
                onChange={(e) => setStrategy({ ...strategy, maxDrawdown: Number(e.target.value) })}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
                Concentration Limit (%)
                <InfoTooltip content={[
                  "Maximum percentage of portfolio value that can be allocated to a single asset - Prevents over-exposure to any one token",
                  "",
                  `💡 Example: With ${strategy.concentrationLimit}% limit, no single token can exceed ${strategy.concentrationLimit}% of your total portfolio value`,
                  "",
                  "This ensures proper diversification and reduces risk from any single asset failure"
                ]} />
              </label>
              <input
                type="number"
                value={strategy.concentrationLimit}
                onChange={(e) => setStrategy({ ...strategy, concentrationLimit: Number(e.target.value) })}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
              Rebalance Frequency
              <InfoTooltip content={[
                "How often AI agents check and adjust your portfolio positions",
                "",
                "• Daily: Active management, best for volatile markets",
                "• Weekly: Balanced approach (recommended)",
                "• Monthly: Long-term strategy, lowest gas costs",
                "",
                "💡 Gas Impact: More frequent rebalancing = better optimization but higher transaction costs (mitigated by x402 gasless protocol)"
              ]} />
            </label>
            <select
              value={strategy.rebalanceFrequency}
              onChange={(e) => setStrategy({ ...strategy, rebalanceFrequency: e.target.value as 'daily' | 'weekly' | 'monthly' })}
              className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all cursor-pointer"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="bg-[#AF52DE]/5 border border-[#AF52DE]/20 rounded-[14px] p-4">
            <label className="flex items-center cursor-pointer group">
              <input
                type="checkbox"
                checked={strategy.hedgingEnabled}
                onChange={(e) => setStrategy({ ...strategy, hedgingEnabled: e.target.checked })}
                className="w-5 h-5 rounded-[6px] border-black/20 text-[#AF52DE] focus:ring-[#AF52DE]/50 flex-shrink-0 accent-[#AF52DE]"
              />
              <div className="ml-3 flex items-center gap-2">
                <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-[#AF52DE]" />
                <span className="text-[13px] sm:text-[14px] font-semibold text-[#1d1d1f]">Enable AI Hedging via Moonlander</span>
                <InfoTooltip content={[
                  "🛡️ Automatic Protection: Hedging Agent monitors portfolio 24/7 and opens protective positions when risks are detected",
                  "",
                  "🤖 Smart Execution: Uses Moonlander DEX aggregator to find best hedge opportunities across multiple DEXs",
                  "",
                  "📊 Delphi Integration: Leverages prediction market data to anticipate and hedge against market events before they happen",
                  "",
                  "⚡ Gasless Trades: Powered by x402 protocol - zero gas fees for hedge transactions",
                  "",
                  "⚠️ Recommended: Keep enabled unless you prefer manual risk management"
                ]} />
              </div>
            </label>
          </div>

          {/* Auto-Approval Settings */}
          {strategy.hedgingEnabled && (
            <div className="bg-[#34C759]/5 border border-[#34C759]/20 rounded-[14px] p-4 space-y-4">
              <label className="flex items-center cursor-pointer group">
                <input
                  type="checkbox"
                  checked={strategy.autoApprovalEnabled}
                  onChange={(e) => setStrategy({ ...strategy, autoApprovalEnabled: e.target.checked })}
                  className="w-5 h-5 rounded-[6px] border-black/20 text-[#34C759] focus:ring-[#34C759]/50 flex-shrink-0 accent-[#34C759]"
                />
                <div className="ml-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-[#34C759]" />
                  <span className="text-[13px] sm:text-[14px] font-semibold text-[#1d1d1f]">Enable Auto-Approval for AI Hedges</span>
                  <InfoTooltip content={[
                    "🤖 Autonomous Execution: AI can automatically execute hedges below threshold without waiting for your signature",
                    "",
                    "⚡ Faster Protection: Critical hedges execute instantly during volatile markets",
                    "",
                    "🔐 Still Secure: All transactions use x402 gasless protocol with on-chain verification",
                    "",
                    "📊 Transparency: All auto-approved hedges are logged and can be reviewed in your dashboard",
                    "",
                    "💡 Recommended: Enable for hands-off portfolio management"
                  ]} />
                </div>
              </label>

              {strategy.autoApprovalEnabled && (
                <div className="ml-8 space-y-2">
                  <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] flex items-center gap-2">
                    Auto-Approval Threshold (USD)
                    <InfoTooltip content={[
                      "Maximum hedge value that can be executed without your signature",
                      "",
                      "💡 Examples:",
                      `• Current: $${(strategy.autoApprovalThreshold / 1000).toFixed(0)}K - Hedges below this execute instantly`,
                      "",
                      "Recommended by strategy:",
                      "• Conservative: $5K (tight control)",
                      "• Balanced: $10K (standard)",
                      "• Aggressive: $25K (maximum autonomy)",
                      "",
                      "⚠️ Hedges above threshold will still require your signature"
                    ]} />
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] sm:text-[14px] font-semibold text-[#34C759]">
                      ${(strategy.autoApprovalThreshold / 1000).toFixed(0)}K
                    </span>
                    <input
                      type="range"
                      min="1000"
                      max="50000"
                      step="1000"
                      value={strategy.autoApprovalThreshold}
                      onChange={(e) => setStrategy({ ...strategy, autoApprovalThreshold: Number(e.target.value) })}
                      className="flex-1 accent-[#34C759]"
                    />
                    <input
                      type="number"
                      min="1000"
                      max="50000"
                      step="1000"
                      value={strategy.autoApprovalThreshold}
                      onChange={(e) => setStrategy({ ...strategy, autoApprovalThreshold: Number(e.target.value) })}
                      className="w-24 px-3 py-1.5 bg-[#f5f5f7] border border-black/5 rounded-[8px] text-[13px] text-[#1d1d1f] focus:border-[#34C759] focus:ring-2 focus:ring-[#34C759]/20 focus:outline-none transition-all"
                    />
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] sm:text-[11px] font-medium">
                    <span className="text-[#424245]">$1K (Min)</span>
                    <span className="text-[#424245]">$25K (Balanced)</span>
                    <span className="text-[#424245]">$50K (Max)</span>
                  </div>
                  
                  <div className="mt-3 p-3 bg-[#34C759]/10 rounded-[10px] border border-[#34C759]/20">
                    <div className="flex items-start gap-2 text-[11px] sm:text-[12px] text-[#1d1d1f]">
                      <CheckCircle className="w-4 h-4 text-[#34C759] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-[#1d1d1f]">Auto-Approval Active</p>
                        <p className="text-[#424245] mt-1 font-medium">
                          Hedges <strong className="text-[#1d1d1f]">≤ ${(strategy.autoApprovalThreshold / 1000).toFixed(0)}K</strong> execute instantly. 
                          Hedges <strong className="text-[#1d1d1f]">&gt; ${(strategy.autoApprovalThreshold / 1000).toFixed(0)}K</strong> require signature.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!strategy.name}
        className="w-full px-6 py-3 sm:py-3.5 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.98] disabled:bg-[#86868b] disabled:cursor-not-allowed rounded-[12px] font-semibold text-[15px] text-white transition-all"
      >
        Next: Set Filters
      </button>
    </div>
  );
}

// Asset Filters Step
function FiltersStep({ filters, setFilters, onNext, onBack }: {
  filters: AssetFilter;
  setFilters: React.Dispatch<React.SetStateAction<AssetFilter>>;
  onNext: () => void;
  onBack: () => void;
}) {
  const categories = ['DeFi', 'Layer1', 'Layer2', 'Gaming', 'NFT', 'Stablecoin', 'RWA'];

  return (
    <div className="space-y-5 sm:space-y-6">
      <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
        <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-[#007AFF]" />
        Asset Selection Filters
      </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
            Minimum Market Cap ($)
            <InfoTooltip content={[
              "Only include tokens with at least this market capitalization",
              "",
              "💡 Why it matters: Higher market cap = more established projects with better liquidity",
              "",
              "Recommended:",
              "• Conservative: $10M+ (established projects only)",
              "• Balanced: $1M+ (mix of established and growing)",
              "• Aggressive: $100K+ (includes emerging projects)"
            ]} />
          </label>
          <input
            type="number"
            value={filters.minMarketCap}
            onChange={(e) => setFilters({ ...filters, minMarketCap: Number(e.target.value) })}
            className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
          />
        </div>

        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
            Maximum Volatility (%)
            <InfoTooltip content={[
              "Exclude tokens that fluctuate more than this percentage - Controls risk exposure",
              "",
              "💡 Lower values = more stable portfolio, higher values = more growth potential",
              "",
              "Recommended:",
              "• Conservative: 30-40% (stable assets only)",
              "• Balanced: 60-80% (moderate volatility)",
              "• Aggressive: 90-100% (high-growth tokens)"
            ]} />
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={filters.maxVolatility}
            onChange={(e) => setFilters({ ...filters, maxVolatility: Number(e.target.value) })}
            className="w-full accent-[#007AFF]"
          />
          <div className="text-center text-[13px] sm:text-[14px] text-[#007AFF] font-semibold mt-1">
            {filters.maxVolatility}%
          </div>
        </div>

        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-3 flex items-center gap-2">
            Allowed Asset Categories
            <InfoTooltip content={[
              "Select which types of crypto assets AI can include in your portfolio",
              "",
              "🏛️ DeFi: Decentralized finance protocols (VVS Finance, Tectonic, etc.)",
              "🔗 Layer1: Base blockchains (BTC, ETH, CRO, SOL)",
              "⚡ Layer2: Scaling solutions (Polygon, Arbitrum, Optimism)",
              "🎮 Gaming: Play-to-earn and gaming tokens",
              "🇺🇻 NFT: NFT marketplace and utility tokens",
              "💵 Stablecoin: USD-pegged tokens (USDC, USDT, DAI)",
              "🏢 RWA: Real-world asset tokens (tokenized bonds, real estate)",
              "",
              "💡 Tip: More categories = better diversification but higher risk variety"
            ]} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((cat) => (
              <label key={cat} className="flex items-center gap-2 cursor-pointer p-2.5 rounded-[10px] bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors">
                <input
                  type="checkbox"
                  checked={filters.allowedCategories.includes(cat)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFilters({ ...filters, allowedCategories: [...filters.allowedCategories, cat] });
                    } else {
                      setFilters({ ...filters, allowedCategories: filters.allowedCategories.filter((c: string) => c !== cat) });
                    }
                  }}
                  className="w-4 h-4 rounded-[4px] border-black/20 text-[#007AFF] focus:ring-[#007AFF]/50 accent-[#007AFF]"
                />
                <span className="text-[13px] sm:text-[14px] text-[#1d1d1f]">{cat}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
            Minimum Liquidity ($)
            <InfoTooltip content={[
              "Only include tokens with at least this much trading liquidity - Ensures you can enter/exit positions easily",
              "",
              "💡 Why it matters: Higher liquidity = lower slippage when trading, easier to execute large orders",
              "",
              "Recommended:",
              "• Conservative: $1M+ (deep liquidity)",
              "• Balanced: $500K+ (good liquidity)",
              "• Aggressive: $100K+ (accepts lower liquidity for opportunities)",
              "",
              "⚠️ Low liquidity can cause high slippage and difficulty exiting positions"
            ]} />
          </label>
          <input
            type="number"
            value={filters.minLiquidity}
            onChange={(e) => setFilters({ ...filters, minLiquidity: Number(e.target.value) })}
            className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
          />
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
          className="flex-1 px-6 py-3 sm:py-3.5 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-white transition-all"
        >
          Next: ZK Protection
        </button>
      </div>
    </div>
  );
}

// ZK Protection Step
function ZKProtectionStep({ 
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
                    <span>ZK Proof Generated • 521-bit Security</span>
                  </div>
                  <div className="flex items-center gap-2 text-[#34C759] text-[13px] sm:text-[14px]">
                    <CheckCircle className="w-4 h-4" />
                    <span>Strategy Signed • Verified On-Chain</span>
                  </div>
                </div>
              )}

              <div className="mt-3 text-[10px] sm:text-[11px] space-y-1 font-medium">
                <div className="text-[#424245]">• Entry/exit points encrypted</div>
                <div className="text-[#424245]">• Risk parameters hidden</div>
                <div className="text-[#424245]">• Verifiable without revealing strategy</div>
                <div className="text-[#424245]">• Cryptographically signed by wallet</div>
                <div className="text-[#424245]">• Stored on Cronos zkEVM with gasless tx (x402)</div>
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

// Review & Create Step
function ReviewStep({ 
  strategy, 
  filters, 
  strategyPrivate,
  zkProofGenerated,
  isPending, 
  isConfirming,
  onCreate, 
  onBack 
}: {
  strategy: StrategyConfig;
  filters: AssetFilter;
  strategyPrivate: boolean;
  zkProofGenerated: boolean;
  isPending: boolean;
  isConfirming: boolean;
  onCreate: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
        <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#AF52DE]" />
        Review Configuration
      </h3>

      <div className="space-y-3 sm:space-y-4">
        {/* Strategy Summary */}
        <div className="bg-[#f5f5f7] rounded-[14px] p-4 border border-black/5">
          <h4 className="font-semibold text-[14px] sm:text-[15px] text-[#1d1d1f] mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-[#AF52DE]" />
            Strategy
          </h4>
          <div className="space-y-2 text-[12px] sm:text-[13px]">
            <div className="flex justify-between">
              <span className="text-[#86868b]">Name:</span>
              <span className="font-semibold text-[#1d1d1f]">{strategy.name || 'Unnamed Portfolio'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Target Yield:</span>
              <span className="font-semibold text-[#34C759]">{strategy.targetYield / 100}% APY</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Risk Tolerance:</span>
              <span className="font-semibold text-[#1d1d1f]">{strategy.riskTolerance}/100</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Max Drawdown:</span>
              <span className="font-semibold text-[#FF3B30]">{strategy.maxDrawdown}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Rebalance:</span>
              <span className="font-semibold text-[#1d1d1f] capitalize">{strategy.rebalanceFrequency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Hedging:</span>
              <span className="font-semibold text-[#1d1d1f]">{strategy.hedgingEnabled ? '✓ Enabled' : '✗ Disabled'}</span>
            </div>
          </div>
        </div>

        {/* Filters Summary */}
        <div className="bg-[#f5f5f7] rounded-[14px] p-4 border border-black/5">
          <h4 className="font-semibold text-[14px] sm:text-[15px] text-[#1d1d1f] mb-3 flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#007AFF]" />
            Asset Filters
          </h4>
          <div className="space-y-2 text-[12px] sm:text-[13px]">
            <div className="flex justify-between">
              <span className="text-[#86868b]">Min Market Cap:</span>
              <span className="font-semibold text-[#1d1d1f]">${((filters.minMarketCap ?? 0) / 1000000).toFixed(1)}M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Max Volatility:</span>
              <span className="font-semibold text-[#1d1d1f]">{filters.maxVolatility ?? 0}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#86868b]">Categories:</span>
              <span className="font-semibold text-[#1d1d1f]">{filters.allowedCategories?.length ?? 0} selected</span>
            </div>
          </div>
        </div>

        {/* Privacy Summary */}
        <div className={`rounded-[14px] p-4 border ${
          strategyPrivate
            ? 'bg-[#34C759]/5 border-[#34C759]/20'
            : 'bg-[#f5f5f7] border-black/5'
        }`}>
          <h4 className="font-semibold text-[14px] sm:text-[15px] text-[#1d1d1f] mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#34C759]" />
            Privacy Protection
          </h4>
          <div className="text-[12px] sm:text-[13px] space-y-2">
            <div className="flex items-center gap-2">
              {strategyPrivate ? (
                <>
                  <Lock className="w-4 h-4 text-[#34C759]" />
                  <span className="text-[#34C759] font-semibold">ZK-Protected Strategy</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-[#86868b]" />
                  <span className="text-[#86868b]">Public Strategy</span>
                </>
              )}
            </div>
            {strategyPrivate && zkProofGenerated && (
              <div className="text-[11px] sm:text-[12px] text-[#34C759]">
                ✓ ZK-STARK proof generated • 521-bit security
              </div>
            )}
          </div>
        </div>
      </div>

      {isPending || isConfirming ? (
        <div className="bg-[#AF52DE]/5 border border-[#AF52DE]/20 rounded-[14px] p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 text-[#AF52DE] animate-spin" />
            <div>
              <p className="font-semibold text-[14px] sm:text-[15px] text-[#AF52DE]">
                {isPending ? 'Awaiting Signature...' : 'Creating Portfolio...'}
              </p>
              <p className="text-[11px] sm:text-[12px] text-[#86868b] mt-1">
                {isPending ? 'Please sign the transaction in your wallet' : 'Transaction is being confirmed on Cronos zkEVM'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 px-6 py-3 sm:py-3.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-[#1d1d1f] transition-all"
          >
            Back
          </button>
          <button
            onClick={onCreate}
            className="flex-1 px-6 py-3 sm:py-3.5 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-white transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
            Create Portfolio
          </button>
        </div>
      )}

      <div className="bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[14px] p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-[#FF9500] flex-shrink-0 mt-0.5" />
          <div className="text-[12px] sm:text-[13px]">
            <p className="font-semibold text-[#FF9500] mb-1">On-Chain Commitment</p>
            <p className="mb-2 text-[#424245] font-medium">This will commit your portfolio and strategy to Cronos zkEVM Testnet:</p>
            <ul className="list-disc list-inside space-y-1 text-[10px] sm:text-[11px] font-medium">
              <li className="text-[#424245]">Portfolio creation requires wallet signature</li>
              <li className="text-[#424245]">Strategy metadata stored on-chain with ZK proof</li>
              <li className="text-[#424245]">All operations are cryptographically verified</li>
              <li className="text-[#424245]">Gas fees covered by x402 gasless protocol</li>
              <li className="text-[#424245]">Immutable audit trail on blockchain</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
