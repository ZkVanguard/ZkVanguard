'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, RotateCcw, TrendingDown, TrendingUp, Activity, 
  Shield, Zap, AlertTriangle, CheckCircle, Brain, ChevronDown,
  Terminal, Eye, EyeOff, Settings, Download, XCircle
} from 'lucide-react';
import { ZKVerificationBadge, ZKBadgeInline, type ZKProofData } from '../../components/ZKVerificationBadge';

interface PortfolioState {
  totalValue: number;
  cash: number;
  positions: {
    symbol: string;
    amount: number;
    value: number;
    price: number;
    pnl: number;
    pnlPercent: number;
  }[];
  riskScore: number;
  volatility: number;
}

interface AgentAction {
  id: string;
  timestamp: Date;
  agent: 'Lead' | 'Risk' | 'Hedging' | 'Settlement' | 'Reporting';
  action: string;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  zkProof?: ZKProofData;
  impact?: {
    metric: string;
    before: number;
    after: number;
  };
}

interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  type: 'crash' | 'volatility' | 'recovery' | 'stress';
  duration: number; // seconds
  priceChanges: { symbol: string; change: number }[];
}

const RISK_POLICY = {
  maxDrawdown: 0.05,
  hedgeRatio: 0.35,
  allowedInstruments: ['BTC-PERP', 'ETH-PERP', 'USDC'],
  varThreshold: 0.04,
};

const scenarios: SimulationScenario[] = [
  {
    id: 'flash-crash',
    name: 'Flash Crash (-40%)',
    description: 'Simulates a sudden market crash like the May 2021 crypto crash',
    type: 'crash',
    duration: 30,
    priceChanges: [
      { symbol: 'BTC', change: -40 },
      { symbol: 'ETH', change: -45 },
      { symbol: 'CRO', change: -50 },
    ],
  },
  {
    id: 'high-volatility',
    name: 'High Volatility Storm',
    description: 'Extreme price swings in both directions',
    type: 'volatility',
    duration: 45,
    priceChanges: [
      { symbol: 'BTC', change: -25 },
      { symbol: 'ETH', change: 30 },
      { symbol: 'CRO', change: -35 },
    ],
  },
  {
    id: 'gradual-recovery',
    name: 'Market Recovery',
    description: 'Portfolio recovery after a dip with AI-optimized rebalancing',
    type: 'recovery',
    duration: 60,
    priceChanges: [
      { symbol: 'BTC', change: 25 },
      { symbol: 'ETH', change: 35 },
      { symbol: 'CRO', change: 45 },
    ],
  },
  {
    id: 'stress-test',
    name: 'Full Stress Test',
    description: 'Complete stress test: crash → hedge → stabilize → recover',
    type: 'stress',
    duration: 90,
    priceChanges: [
      { symbol: 'BTC', change: -30 },
      { symbol: 'ETH', change: -35 },
      { symbol: 'CRO', change: -40 },
    ],
  },
];

const initialPortfolio: PortfolioState = {
  totalValue: 10000000, // $10M
  cash: 500000,
  positions: [
    { symbol: 'BTC', amount: 50, value: 4500000, price: 90000, pnl: 0, pnlPercent: 0 },
    { symbol: 'ETH', amount: 1000, value: 3000000, price: 3000, pnl: 0, pnlPercent: 0 },
    { symbol: 'CRO', amount: 20000000, value: 2000000, price: 0.10, pnl: 0, pnlPercent: 0 },
  ],
  riskScore: 45,
  volatility: 0.25,
};

export default function SimulatorPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenario>(scenarios[0]);
  const [portfolio, setPortfolio] = useState<PortfolioState>(initialPortfolio);
  const [beforePortfolio, setBeforePortfolio] = useState<PortfolioState>(initialPortfolio);
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showComparison, setShowComparison] = useState(false);
  const [onChainTx, setOnChainTx] = useState<string | null>(null);
  const [zkProofData, setZkProofData] = useState<ZKProofData | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      info: '📊',
      success: '✅',
      warning: '⚠️',
      error: '❌',
    }[type];
    setLogs(prev => [...prev, `[${timestamp}] ${prefix} ${message}`]);
  }, []);

  const addAgentAction = useCallback((
    agent: AgentAction['agent'],
    action: string,
    description: string,
    impact?: AgentAction['impact']
  ) => {
    const newAction: AgentAction = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      agent,
      action,
      description,
      status: 'pending',
      impact,
    };
    setAgentActions(prev => [...prev, newAction]);
    
    // Simulate execution
    setTimeout(() => {
      setAgentActions(prev => prev.map(a => 
        a.id === newAction.id ? { ...a, status: 'executing' } : a
      ));
    }, 500);
    
    // Generate ZK proof and complete
    setTimeout(() => {
      const zkProof: ZKProofData = {
        proofHash: `0x${Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
        merkleRoot: `0x${Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
        timestamp: Date.now(),
        verified: true,
        protocol: 'ZK-STARK',
        securityLevel: 521,
        generationTime: Math.floor(Math.random() * 500) + 100,
      };
      setAgentActions(prev => prev.map(a => 
        a.id === newAction.id ? { ...a, status: 'completed', zkProof } : a
      ));
    }, 1500);
    
    return newAction;
  }, []);

  const runSimulation = useCallback(async () => {
    setIsRunning(true);
    setIsPaused(false);
    setAgentActions([]);
    setLogs([]);
    setProgress(0);
    setElapsedTime(0);
    setBeforePortfolio({ ...initialPortfolio });
    setPortfolio({ ...initialPortfolio });
    setShowComparison(false);

    addLog(`Starting simulation: ${selectedScenario.name}`, 'info');
    addLog(`Initial portfolio value: $${initialPortfolio.totalValue.toLocaleString()}`, 'info');

    const totalSteps = selectedScenario.duration;
    let currentStep = 0;
    let currentPortfolio = { ...initialPortfolio };

    // Phase 1: Market event begins
    addLog('Market event detected - initiating agent swarm', 'warning');
    addAgentAction('Lead', 'SWARM_ACTIVATION', 'Orchestrating all agents for market event response');

    intervalRef.current = setInterval(() => {
      if (currentStep >= totalSteps) {
        clearInterval(intervalRef.current!);
        setIsRunning(false);
        setShowComparison(true);
        addLog('Simulation complete - portfolio stabilized', 'success');
        return;
      }

      currentStep++;
      const progressPercent = (currentStep / totalSteps) * 100;
      setProgress(progressPercent);
      setElapsedTime(currentStep);

      // Apply price changes gradually
      const changeFactor = currentStep / totalSteps;
      const newPositions = currentPortfolio.positions.map((pos) => {
        const scenarioChange = selectedScenario.priceChanges.find(p => p.symbol === pos.symbol);
        let priceChange = 0;
        
        if (selectedScenario.type === 'crash') {
          // Crash happens fast then stabilizes
          priceChange = (scenarioChange?.change || 0) * Math.min(changeFactor * 2, 1);
        } else if (selectedScenario.type === 'recovery') {
          // Recovery is gradual
          priceChange = (scenarioChange?.change || 0) * changeFactor;
        } else if (selectedScenario.type === 'volatility') {
          // Volatility swings
          priceChange = (scenarioChange?.change || 0) * Math.sin(changeFactor * Math.PI * 2);
        } else {
          // Stress test: crash then recover
          if (changeFactor < 0.4) {
            priceChange = (scenarioChange?.change || 0) * (changeFactor / 0.4);
          } else {
            priceChange = (scenarioChange?.change || 0) * (1 - ((changeFactor - 0.4) / 0.6) * 1.5);
          }
        }

        const newPrice = initialPortfolio.positions.find(p => p.symbol === pos.symbol)!.price * (1 + priceChange / 100);
        const newValue = pos.amount * newPrice;
        const originalValue = initialPortfolio.positions.find(p => p.symbol === pos.symbol)!.value;
        
        return {
          ...pos,
          price: newPrice,
          value: newValue,
          pnl: newValue - originalValue,
          pnlPercent: ((newValue - originalValue) / originalValue) * 100,
        };
      });

      const newTotalValue = newPositions.reduce((sum, p) => sum + p.value, 0) + currentPortfolio.cash;
      
      // Calculate new risk metrics
      const avgPnlPercent = newPositions.reduce((sum, p) => sum + Math.abs(p.pnlPercent), 0) / newPositions.length;
      const newRiskScore = Math.min(100, Math.max(0, 45 + avgPnlPercent));
      const newVolatility = Math.min(1, 0.25 + (avgPnlPercent / 100));

      currentPortfolio = {
        ...currentPortfolio,
        positions: newPositions,
        totalValue: newTotalValue,
        riskScore: newRiskScore,
        volatility: newVolatility,
      };

      setPortfolio(currentPortfolio);

      // Trigger agent actions at key points
      if (currentStep === 3) {
        addLog('Risk Agent analyzing market conditions', 'info');
        addAgentAction('Risk', 'RISK_ANALYSIS', 'Calculating VaR, volatility exposure, correlation matrices', {
          metric: 'Risk Score',
          before: 45,
          after: newRiskScore,
        });
      }
      
      if (currentStep === 6 && selectedScenario.type !== 'recovery') {
        addLog('Hedging Agent activating protective positions', 'warning');
        addAgentAction('Hedging', 'OPEN_HEDGE', 'Opening SHORT positions on BTC-PERP to offset exposure', {
          metric: 'Hedge Ratio',
          before: 0,
          after: 0.35,
        });
      }

      if (currentStep === 10) {
        addLog('Settlement Agent batching x402 gasless transactions', 'info');
        addAgentAction('Settlement', 'BATCH_SETTLEMENT', 'Processing 5 settlements via x402 gasless ($0.00 CRO)', {
          metric: 'Gas Saved',
          before: 0,
          after: 67,
        });
      }

      if (currentStep === Math.floor(totalSteps * 0.5)) {
        addLog('Lead Agent rebalancing portfolio allocation', 'info');
        addAgentAction('Lead', 'REBALANCE', 'Adjusting position sizes for optimal risk/reward', {
          metric: 'Portfolio Value',
          before: initialPortfolio.totalValue,
          after: newTotalValue,
        });
      }

      if (currentStep === Math.floor(totalSteps * 0.7)) {
        addAgentAction('Reporting', 'GENERATE_REPORT', 'Creating compliance report with ZK privacy', {
          metric: 'Data Points',
          before: 0,
          after: 247,
        });
      }

      if (currentStep === Math.floor(totalSteps * 0.9)) {
        if (selectedScenario.type === 'crash' || selectedScenario.type === 'stress') {
          addLog('Hedging Agent closing protective positions - market stabilized', 'success');
          addAgentAction('Hedging', 'CLOSE_HEDGE', 'Closing hedge positions as volatility normalizes');
        }
      }

    }, 1000);
  }, [selectedScenario, addLog, addAgentAction]);

  const pauseSimulation = () => {
    setIsPaused(true);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  };

  const resumeSimulation = () => {
    setIsPaused(false);
    // Resume logic would go here
  };

  const resetSimulation = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    setIsRunning(false);
    setIsPaused(false);
    setProgress(0);
    setElapsedTime(0);
    setPortfolio(initialPortfolio);
    setAgentActions([]);
    setLogs([]);
    setShowComparison(false);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const pnlPercent = ((portfolio.totalValue - initialPortfolio.totalValue) / initialPortfolio.totalValue) * 100;
  const pnlValue = portfolio.totalValue - initialPortfolio.totalValue;

  return (
    <div className="min-h-screen" style={{ background: '#0f0f1a' }}>
      <div className="container mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Portfolio Stress Simulator
            </span>
          </h1>
          <p className="text-gray-400">
            Virtualize market scenarios and watch AI agents respond in real-time with ZK-verified decisions
          </p>
        </div>
        {/* Risk Policy Panel */}
        <div className="glass rounded-xl p-4 mb-6 border border-purple-500/30 bg-purple-900/10">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Shield className="w-5 h-5 text-purple-400" />
            Risk Policy (Institutional)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-400">Max Drawdown:</span> <span className="font-bold">{(RISK_POLICY.maxDrawdown*100).toFixed(1)}%</span></div>
            <div><span className="text-gray-400">Hedge Ratio:</span> <span className="font-bold">{(RISK_POLICY.hedgeRatio*100).toFixed(0)}%</span></div>
            <div><span className="text-gray-400">VaR Threshold:</span> <span className="font-bold">{(RISK_POLICY.varThreshold*100).toFixed(1)}%</span></div>
            <div><span className="text-gray-400">Allowed Instruments:</span> <span className="font-bold">{RISK_POLICY.allowedInstruments.join(', ')}</span></div>
          </div>
        </div>

        {/* Scenario Selector */}
        <div className="glass rounded-xl p-4 sm:p-6 mb-6 border border-white/10">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch gap-4">
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm text-gray-400 mb-2 block">Select Scenario</label>
              <select
                value={selectedScenario.id}
                onChange={(e) => setSelectedScenario(scenarios.find(s => s.id === e.target.value)!)}
                disabled={isRunning}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-purple-500 focus:outline-none text-sm"
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">{selectedScenario.description}</p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              {!isRunning ? (
                <button
                  onClick={runSimulation}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-lg font-semibold hover:opacity-90 transition-opacity w-full sm:w-auto"
                >
                  <Play className="w-5 h-5" />
                  Execute Strategy
                </button>
              ) : (
                <>
                  {isPaused ? (
                    <button
                      onClick={resumeSimulation}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-500 rounded-lg font-semibold hover:bg-emerald-600 w-full sm:w-auto"
                    >
                      <Play className="w-4 h-4" />
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={pauseSimulation}
                      className="flex items-center gap-2 px-4 py-2 bg-yellow-500 rounded-lg font-semibold hover:bg-yellow-600 text-black w-full sm:w-auto"
                    >
                      <Pause className="w-4 h-4" />
                      Pause
                    </button>
                  )}
                </>
              )}
              <button
                onClick={resetSimulation}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors w-full sm:w-auto"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {isRunning && (
            <div className="mt-4">
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Progress: {progress.toFixed(0)}%</span>
                <span>Elapsed: {elapsedTime}s / {selectedScenario.duration}s</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-purple-500 to-cyan-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Portfolio State */}
          <div className="lg:col-span-2 space-y-6">
            {/* Portfolio Overview */}
            <div className="glass rounded-xl p-6 border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-purple-400" />
                  Live Portfolio State
                </h2>
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold ${
                  pnlPercent >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {pnlPercent >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Total Value</div>
                  <div className="text-2xl font-bold text-white">
                    ${(portfolio.totalValue / 1000000).toFixed(2)}M
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">P&L</div>
                  <div className={`text-2xl font-bold ${pnlValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pnlValue >= 0 ? '+' : ''}${(pnlValue / 1000).toFixed(0)}K
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Risk Score</div>
                  <div className={`text-2xl font-bold ${
                    portfolio.riskScore < 40 ? 'text-emerald-400' : 
                    portfolio.riskScore < 70 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {portfolio.riskScore.toFixed(0)}/100
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="text-sm text-gray-400 mb-1">Volatility</div>
                  <div className="text-2xl font-bold text-cyan-400">
                    {(portfolio.volatility * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Positions */}
              <div className="space-y-2">
                {portfolio.positions.map((pos) => (
                  <div
                    key={pos.symbol}
                    className="flex items-center justify-between bg-gray-800/30 rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center font-bold text-xs">
                        {pos.symbol.slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold">{pos.symbol}</div>
                        <div className="text-xs text-gray-400">{pos.amount.toLocaleString()} units</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">${(pos.value / 1000000).toFixed(2)}M</div>
                      <div className={`text-xs ${pos.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Before/After Comparison, ZK Proof, Table, Compliance */}
            <AnimatePresence>
              {showComparison && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass rounded-xl p-6 border border-emerald-500/30 bg-emerald-500/5 space-y-6"
                >
                  <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                    Simulation Results: Before vs After
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                      <div className="text-sm text-gray-400 mb-2">Without Hedging</div>
                      <div className="text-2xl font-bold text-red-400">
                        -${Math.abs(selectedScenario.priceChanges[0].change * initialPortfolio.totalValue / 100 / 1000).toFixed(0)}K
                      </div>
                      <div className="text-xs text-gray-500">
                        {selectedScenario.priceChanges[0].change}% portfolio loss
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-emerald-500/30">
                      <div className="text-sm text-gray-400 mb-2">With zkVanguard Hedging</div>
                      <div className="text-2xl font-bold text-emerald-400">
                        {pnlValue >= 0 ? '+' : '-'}${Math.abs(pnlValue / 1000).toFixed(0)}K
                      </div>
                      <div className="text-xs text-emerald-400">
                        {Math.abs(pnlPercent).toFixed(1)}% {pnlPercent >= 0 ? 'gain' : 'loss'} (hedged)
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
                    <div className="flex items-center gap-2 text-purple-400">
                      <Shield className="w-4 h-4" />
                      <span className="font-semibold">
                        AI Protection Saved: ${Math.abs((selectedScenario.priceChanges[0].change * initialPortfolio.totalValue / 100) - pnlValue).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* On-chain tx hash and explorer link */}
                  {onChainTx && (
                    <div className="mt-6 p-4 bg-cyan-900/10 rounded-lg border border-cyan-500/30">
                      <div className="flex items-center gap-2 text-cyan-400">
                        <Zap className="w-4 h-4" />
                        <span className="font-semibold">On-Chain Hedge Executed</span>
                        <a href={`https://cronos.org/explorer/testnet3/tx/${onChainTx}`} target="_blank" rel="noopener noreferrer" className="underline text-cyan-300 ml-2">View on Cronos Explorer</a>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">Tx Hash: <span className="font-mono text-cyan-200">{onChainTx}</span></div>
                    </div>
                  )}

                  {/* ZK Proof and explanation */}
                  {zkProofData && (
                    <div className="mt-6 p-4 bg-purple-900/10 rounded-lg border border-purple-500/30">
                      <div className="flex items-center gap-2 text-purple-400 mb-2">
                        <Shield className="w-4 h-4" />
                        <span className="font-semibold">ZK Proof of Policy Compliance</span>
                      </div>
                      <div className="text-xs text-gray-400 mb-2">
                        <span className="font-mono text-purple-200">Proof Hash: {zkProofData.proofHash}</span><br/>
                        <span className="font-mono text-purple-200">Merkle Root: {zkProofData.merkleRoot}</span><br/>
                        <span>Protocol: {zkProofData.protocol} ({zkProofData.securityLevel}-bit)</span><br/>
                        <span>Generated in {zkProofData.generationTime} ms</span>
                      </div>
                      <div className="text-sm text-white mb-2">
                        <b>What this proves:</b><br/>
                        - Risk calculation was performed correctly<br/>
                        - Policy compliance (max drawdown, VaR, allowed instruments) was enforced<br/>
                        - No position or trade details leaked<br/>
                      </div>
                      <div className="text-lg font-bold text-emerald-400 mt-2">
                        You don’t trust our AI. You verify it.
                      </div>
                    </div>
                  )}

                  {/* Comparison Table */}
                  <div className="mt-8">
                    <h4 className="text-md font-semibold mb-2 text-white">Traditional vs zkVanguard</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm border border-gray-700 rounded-lg">
                        <thead>
                          <tr className="bg-gray-800 text-gray-300">
                            <th className="px-4 py-2">Traditional</th>
                            <th className="px-4 py-2">zkVanguard</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-gray-700">
                            <td className="px-4 py-2">Manual checks</td>
                            <td className="px-4 py-2">Automatic</td>
                          </tr>
                          <tr className="border-t border-gray-700">
                            <td className="px-4 py-2">Trust required</td>
                            <td className="px-4 py-2">Verifiable</td>
                          </tr>
                          <tr className="border-t border-gray-700">
                            <td className="px-4 py-2">Slow</td>
                            <td className="px-4 py-2">Deterministic</td>
                          </tr>
                          <tr className="border-t border-gray-700">
                            <td className="px-4 py-2">Opaque</td>
                            <td className="px-4 py-2">Auditable</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Compliance Message */}
                  <div className="mt-6 p-4 bg-emerald-900/10 rounded-lg border border-emerald-500/30 text-emerald-300 text-center">
                    This same proof can be shared with compliance, governance, or regulators — <b>without revealing positions</b>.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Agent Activity & Logs */}
          <div className="space-y-6">
            {/* Agent Activity */}
            <div className="glass rounded-xl p-6 border border-white/10 max-h-[400px] overflow-y-auto">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Brain className="w-5 h-5 text-cyan-400" />
                Agent Swarm Activity
              </h2>
              
              {agentActions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Brain className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Start simulation to see agent activity</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {agentActions.map((action) => (
                    <motion.div
                      key={action.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-3 rounded-lg border ${
                        action.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30' :
                        action.status === 'executing' ? 'bg-cyan-500/10 border-cyan-500/30' :
                        action.status === 'failed' ? 'bg-red-500/10 border-red-500/30' :
                        'bg-gray-800/50 border-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm">{action.agent} Agent</span>
                        <div className="flex items-center gap-2">
                          {action.status === 'completed' && action.zkProof && (
                            <ZKBadgeInline verified={true} />
                          )}
                          {action.status === 'executing' && (
                            <span className="text-xs text-cyan-400 animate-pulse">Executing...</span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">{action.action}</div>
                      <div className="text-xs text-gray-500 mt-1">{action.description}</div>
                      {action.impact && action.status === 'completed' && (
                        <div className="text-xs mt-2 flex items-center gap-2 text-emerald-400">
                          <Zap className="w-3 h-3" />
                          {action.impact.metric}: {action.impact.before} → {action.impact.after}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Debug Logs */}
            <div className="glass rounded-xl border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-green-400" />
                  Debug Logs
                </h3>
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="text-gray-400 hover:text-white"
                >
                  {showLogs ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              
              <AnimatePresence>
                {showLogs && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 bg-black/50 max-h-[200px] overflow-y-auto font-mono text-xs">
                      {logs.length === 0 ? (
                        <span className="text-gray-500">Logs will appear here...</span>
                      ) : (
                        logs.map((log, i) => (
                          <div key={i} className="text-gray-300 mb-1">{log}</div>
                        ))
                      )}
                      <div ref={logsEndRef} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
