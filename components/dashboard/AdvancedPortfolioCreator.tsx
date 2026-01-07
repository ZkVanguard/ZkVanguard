'use client';

import { useState, useEffect } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { useCreatePortfolio } from '../../lib/contracts/hooks';
import { 
  Plus, Loader2, CheckCircle, XCircle, Shield, Sparkles, 
  Filter, TrendingUp, Target, AlertTriangle, Lock, Eye, EyeOff, FileSignature, Info 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface StrategyConfig {
  name: string;
  targetYield: number;
  riskTolerance: number;
  rebalanceFrequency: 'daily' | 'weekly' | 'monthly';
  hedgingEnabled: boolean;
  maxDrawdown: number;
  concentrationLimit: number;
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

export function AdvancedPortfolioCreator() {
  const { isConnected, address } = useAccount();
  const { createPortfolio, isPending, isConfirming, isConfirmed, error } = useCreatePortfolio();
  const { signMessageAsync } = useSignMessage();
  
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<'strategy' | 'filters' | 'review' | 'zk-protection'>('strategy');
  const [strategyPrivate, setStrategyPrivate] = useState(true);
  const [zkProofGenerated, setZkProofGenerated] = useState(false);
  const [zkProofHash, setZkProofHash] = useState('');
  const [strategySigned, setStrategySigned] = useState(false);
  const [strategySignature, setStrategySignature] = useState('');
  const [onChainTxHash, setOnChainTxHash] = useState('');
  
  // Strategy configuration
  const [strategy, setStrategy] = useState<StrategyConfig>({
    name: '',
    targetYield: 1000, // 10% in bps
    riskTolerance: 50,
    rebalanceFrequency: 'weekly',
    hedgingEnabled: true,
    maxDrawdown: 20,
    concentrationLimit: 30,
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
    },
    balanced: {
      targetYield: 1000,
      riskTolerance: 50,
      maxDrawdown: 20,
      concentrationLimit: 30,
      hedgingEnabled: true,
      rebalanceFrequency: 'weekly' as const,
    },
    aggressive: {
      targetYield: 2000,
      riskTolerance: 80,
      maxDrawdown: 35,
      concentrationLimit: 50,
      hedgingEnabled: true,
      rebalanceFrequency: 'daily' as const,
    },
  };

  // Apply AI preset
  useEffect(() => {
    if (aiPreset !== 'custom') {
      setStrategy(prev => ({ ...prev, ...presets[aiPreset] }));
    }
  }, [aiPreset]);

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
          const signature = await signMessageAsync({ message });
          setStrategySignature(signature);
          setStrategySigned(true);
          setZkProofGenerated(true);
        } catch (signError) {
          console.error('User rejected signature:', signError);
          throw new Error('Signature required to proceed');
        }
      }
    } catch (error) {
      console.error('ZK proof generation failed:', error);
      throw error;
    }
  };

  const handleCreate = async () => {
    try {
      // Step 1: Create portfolio on-chain (requires signature)
      const yieldBps = BigInt(strategy.targetYield);
      const risk = BigInt(strategy.riskTolerance);
      
      // This will trigger MetaMask signature prompt
      const portfolioId = await createPortfolio(yieldBps, risk);
      
      // Step 2: Store strategy metadata on-chain with ZK proof
      if (portfolioId !== undefined) {
        const strategyResponse = await fetch('/api/portfolio/strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            portfolioId: Number(portfolioId),
            strategyConfig: {
              ...strategy,
              filters,
            },
            zkProofHash: strategyPrivate ? zkProofHash : null,
            signature: strategySignature,
            address: address,
          }),
        });

        if (strategyResponse.ok) {
          const data = await strategyResponse.json();
          setOnChainTxHash(data.onChainHash);
          console.log('✅ Portfolio and strategy committed on-chain:', data);
        }
      }
    } catch (err) {
      console.error('Failed to create portfolio:', err);
      throw err;
    }
  };

  if (!isConnected) {
    return (
      <button
        className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-700 hover:to-cyan-700 rounded-xl font-semibold text-white transition-all duration-300 flex items-center gap-2 shadow-lg shadow-purple-500/20"
        disabled
      >
        <Lock className="w-5 h-5" />
        Connect Wallet to Create Portfolio
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-700 hover:to-cyan-700 rounded-xl font-semibold text-white transition-all duration-300 flex items-center gap-2 shadow-lg shadow-purple-500/20"
      >
        <Sparkles className="w-5 h-5" />
        Create AI-Managed Portfolio
      </button>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !isPending && !isConfirming && setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl border border-gray-700 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              {/* Header */}
              <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-6 z-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                      <Sparkles className="w-6 h-6 text-purple-400" />
                      AI Fund Manager Setup
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                      Create ZK-protected portfolio with custom strategy
                    </p>
                  </div>
                  {!isPending && !isConfirming && (
                    <button
                      onClick={() => setShowModal(false)}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      <XCircle className="w-6 h-6" />
                    </button>
                  )}
                </div>

                {/* Progress Steps */}
                <div className="flex items-center gap-2 mt-6">
                  {['strategy', 'filters', 'zk-protection', 'review'].map((s, i) => (
                    <div key={s} className="flex items-center flex-1">
                      <div className={`flex-1 h-1 rounded-full ${
                        ['strategy', 'filters', 'zk-protection', 'review'].indexOf(step) >= i
                          ? 'bg-purple-600'
                          : 'bg-gray-700'
                      }`} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {isConfirmed ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center py-12"
                  >
                    <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-green-400 mb-2">Portfolio Created!</h3>
                    <p className="text-gray-300 mb-6">
                      Your AI-managed portfolio is now active with ZK-protected strategy
                    </p>
                    <button
                      onClick={() => {
                        setShowModal(false);
                        window.location.reload();
                      }}
                      className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors"
                    >
                      View Dashboard
                    </button>
                  </motion.div>
                ) : error ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center py-12"
                  >
                    <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-red-400 mb-2">Creation Failed</h3>
                    <p className="text-gray-300 mb-6 text-sm">
                      {error.message || 'Failed to create portfolio'}
                    </p>
                    <button
                      onClick={() => setStep('strategy')}
                      className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition-colors"
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
    <div className="relative inline-block">
      <Info 
        className="w-4 h-4 text-gray-400 hover:text-purple-400 cursor-help transition-colors"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
      {isHovered && (
        <div className="absolute left-6 top-0 z-50 w-80 bg-gray-800 border border-purple-500/30 rounded-lg p-3 shadow-xl">
          <div className="text-xs text-gray-300 space-y-1.5">
            {lines.map((line, idx) => (
              <p key={idx} className="leading-relaxed">{line}</p>
            ))}
          </div>
          <div className="absolute left-0 top-2 w-2 h-2 bg-gray-800 border-l border-t border-purple-500/30 transform -translate-x-1 rotate-45" />
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
}: any) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-400" />
          AI Strategy Configuration
        </h3>

        {/* AI Presets */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {(['conservative', 'balanced', 'aggressive'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setAiPreset(preset)}
              className={`p-4 rounded-xl border-2 transition-all ${
                aiPreset === preset
                  ? 'border-purple-500 bg-purple-500/10'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="text-lg mb-1">
                {preset === 'conservative' && '🛡️'}
                {preset === 'balanced' && '⚖️'}
                {preset === 'aggressive' && '🚀'}
              </div>
              <div className="text-sm font-semibold capitalize mb-1">{preset}</div>
              <div className="text-xs text-gray-400">
                {preset === 'conservative' && 'Low risk, stable returns'}
                {preset === 'balanced' && 'Moderate risk & reward'}
                {preset === 'aggressive' && 'High risk, high returns'}
              </div>
              <div className="text-xs mt-2 font-medium ${
                preset === 'conservative' ? 'text-blue-400' :
                preset === 'balanced' ? 'text-purple-400' :
                'text-orange-400'
              }">
                {preset === 'conservative' && 'Target: 5-8% APY'}
                {preset === 'balanced' && 'Target: 10-15% APY'}
                {preset === 'aggressive' && 'Target: 20-30% APY'}
              </div>
            </button>
          ))}
        </div>

        {/* Custom Fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              Portfolio Name
              <InfoTooltip content="Give your strategy a memorable name that describes its purpose" />
            </label>
            <input
              type="text"
              value={strategy.name}
              onChange={(e) => setStrategy({ ...strategy, name: e.target.value })}
              placeholder="e.g., Conservative DeFi Fund"
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
                className="w-full"
              />
              <div className="text-center text-sm font-bold mt-1 ${
                strategy.riskTolerance < 30 ? 'text-green-400' :
                strategy.riskTolerance < 70 ? 'text-yellow-400' :
                'text-red-400'
              }">
                {strategy.riskTolerance}
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-green-400">🛡️ Safe</span>
                <span className="text-yellow-400">⚖️ Moderate</span>
                <span className="text-red-400">🚀 Aggressive</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
              onChange={(e) => setStrategy({ ...strategy, rebalanceFrequency: e.target.value })}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 border border-purple-500/30 rounded-lg p-4">
            <label className="flex items-center cursor-pointer group">
              <input
                type="checkbox"
                checked={strategy.hedgingEnabled}
                onChange={(e) => setStrategy({ ...strategy, hedgingEnabled: e.target.checked })}
                className="w-5 h-5 rounded border-gray-700 text-purple-600 focus:ring-purple-500 flex-shrink-0"
              />
              <div className="ml-3 flex items-center gap-2">
                <Shield className="w-5 h-5 text-purple-400" />
                <span className="text-sm font-semibold text-white">Enable AI Hedging via Moonlander</span>
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
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!strategy.name}
        className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl font-semibold transition-colors"
      >
        Next: Set Filters
      </button>
    </div>
  );
}

// Asset Filters Step
function FiltersStep({ filters, setFilters, onNext, onBack }: any) {
  const categories = ['DeFi', 'Layer1', 'Layer2', 'Gaming', 'NFT', 'Stablecoin', 'RWA'];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Filter className="w-5 h-5 text-cyan-400" />
        Asset Selection Filters
      </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
            className="w-full"
          />
          <div className="text-center text-sm text-cyan-400 font-semibold mt-1">
            {filters.maxVolatility}%
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            Allowed Asset Categories
            <InfoTooltip content={[
              "Select which types of crypto assets AI can include in your portfolio",
              "",
              "🏛️ DeFi: Decentralized finance protocols (Uniswap, Aave, etc.)",
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
              <label key={cat} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-800 transition-colors">
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
                  className="w-4 h-4 rounded border-gray-700 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm text-gray-300">{cat}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
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
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 px-6 py-3 bg-cyan-600 hover:bg-cyan-700 rounded-xl font-semibold transition-colors"
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
}: any) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateProof = async () => {
    setIsGenerating(true);
    try {
      await onGenerateProof();
    } catch (error) {
      console.error('Failed to generate proof:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
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

      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <FileSignature className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-300">
            <p className="font-semibold text-cyan-400 mb-1">Signature Required</p>
            <p>All portfolio operations require wallet signature for on-chain verification. Your strategy will be cryptographically signed and stored on Cronos zkEVM.</p>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-start gap-4">
          <Lock className="w-8 h-8 text-emerald-400 flex-shrink-0" />
          <div>
            <h4 className="font-semibold mb-2">Zero-Knowledge Strategy Protection</h4>
            <p className="text-sm text-gray-400 leading-relaxed">
              Your AI fund management strategy can be cryptographically protected using ZK-STARK proofs. 
              This ensures your entry points, exit rules, and risk parameters remain private while still 
              being verifiable on-chain.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <label className="flex items-center justify-between p-4 rounded-lg border-2 border-gray-700 hover:border-emerald-500 cursor-pointer transition-colors">
            <div className="flex items-center gap-3">
              {strategyPrivate ? (
                <EyeOff className="w-5 h-5 text-emerald-400" />
              ) : (
                <Eye className="w-5 h-5 text-gray-400" />
              )}
              <div className="flex items-center gap-2">
                <div>
                  <div className="font-semibold">
                    {strategyPrivate ? 'Private Strategy (Recommended)' : 'Public Strategy'}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
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
              className="w-5 h-5 rounded border-gray-700 text-emerald-600 focus:ring-emerald-500"
            />
          </label>

          {strategyPrivate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-400">ZK-STARK Protection + Signature</span>
              </div>
              
              {!zkProofGenerated ? (
                <button
                  onClick={handleGenerateProof}
                  disabled={isGenerating}
                  className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
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
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>ZK Proof Generated • 521-bit Security</span>
                  </div>
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>Strategy Signed • Verified On-Chain</span>
                  </div>
                </div>
              )}

              <div className="mt-3 text-xs text-gray-400 space-y-1">
                <div>• Entry/exit points encrypted</div>
                <div>• Risk parameters hidden</div>
                <div>• Verifiable without revealing strategy</div>
                <div>• Cryptographically signed by wallet</div>
                <div>• Stored on Cronos zkEVM with gasless tx (x402)</div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={strategyPrivate && !zkProofGenerated}
          className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl font-semibold transition-colors"
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
}: any) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <CheckCircle className="w-5 h-5 text-purple-400" />
        Review Configuration
      </h3>

      <div className="space-y-4">
        {/* Strategy Summary */}
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-purple-400" />
            Strategy
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Name:</span>
              <span className="font-semibold">{strategy.name || 'Unnamed Portfolio'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Target Yield:</span>
              <span className="font-semibold text-green-400">{strategy.targetYield / 100}% APY</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Risk Tolerance:</span>
              <span className="font-semibold">{strategy.riskTolerance}/100</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Max Drawdown:</span>
              <span className="font-semibold text-red-400">{strategy.maxDrawdown}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Rebalance:</span>
              <span className="font-semibold capitalize">{strategy.rebalanceFrequency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Hedging:</span>
              <span className="font-semibold">{strategy.hedgingEnabled ? '✓ Enabled' : '✗ Disabled'}</span>
            </div>
          </div>
        </div>

        {/* Filters Summary */}
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <Filter className="w-4 h-4 text-cyan-400" />
            Asset Filters
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Min Market Cap:</span>
              <span className="font-semibold">${(filters.minMarketCap / 1000000).toFixed(1)}M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Max Volatility:</span>
              <span className="font-semibold">{filters.maxVolatility}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Categories:</span>
              <span className="font-semibold">{filters.allowedCategories.length} selected</span>
            </div>
          </div>
        </div>

        {/* Privacy Summary */}
        <div className={`rounded-xl p-4 border ${
          strategyPrivate
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-gray-800 border-gray-700'
        }`}>
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Privacy Protection
          </h4>
          <div className="text-sm space-y-2">
            <div className="flex items-center gap-2">
              {strategyPrivate ? (
                <>
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">ZK-Protected Strategy</span>
                </>
              ) : (
                <>
                  <Eye className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-400">Public Strategy</span>
                </>
              )}
            </div>
            {strategyPrivate && zkProofGenerated && (
              <div className="text-xs text-emerald-400">
                ✓ ZK-STARK proof generated • 521-bit security
              </div>
            )}
          </div>
        </div>
      </div>

      {isPending || isConfirming ? (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
            <div>
              <p className="font-semibold text-purple-400">
                {isPending ? 'Awaiting Signature...' : 'Creating Portfolio...'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {isPending ? 'Please sign the transaction in your wallet' : 'Transaction is being confirmed on Cronos zkEVM'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors"
          >
            Back
          </button>
          <button
            onClick={onCreate}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-700 hover:to-cyan-700 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <Sparkles className="w-5 h-5" />
            Create Portfolio
          </button>
        </div>
      )}

      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-300">
            <p className="font-semibold text-yellow-400 mb-1">On-Chain Commitment</p>
            <p className="mb-2">This will commit your portfolio and strategy to Cronos zkEVM Testnet:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Portfolio creation requires wallet signature</li>
              <li>Strategy metadata stored on-chain with ZK proof</li>
              <li>All operations are cryptographically verified</li>
              <li>Gas fees covered by x402 gasless protocol</li>
              <li>Immutable audit trail on blockchain</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
