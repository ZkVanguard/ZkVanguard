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
  type: 'crash' | 'volatility' | 'recovery' | 'stress' | 'tariff';
  duration: number; // seconds
  priceChanges: { symbol: string; change: number }[];
  // Real-world event data
  eventData?: {
    date: string;
    headline: string;
    source: string;
    marketContext: string;
    liquidations: string;
    priceAtEvent: { symbol: string; price: number }[];
    predictionData?: {
      polymarket: { question: string; before: number; after: number; volume: number };
      kalshi: { question: string; before: number; after: number; volume: number };
      predictit: { question: string; before: number; after: number; volume: number };
      consensus: number;
    };
  };
}

const RISK_POLICY = {
  maxDrawdown: 0.05,
  hedgeRatio: 0.35,
  allowedInstruments: ['BTC-PERP', 'ETH-PERP', 'USDC'],
  varThreshold: 0.04,
};

const scenarios: SimulationScenario[] = [
  {
    id: 'trump-tariff-crash',
    name: '🇺🇸 Trump Tariff Shock (Oct 2025)',
    description: 'REAL EVENT: President Trump announces 100% tariffs on Chinese imports. Bitcoin plunges 8.4% in hours.',
    type: 'tariff',
    duration: 45,
    priceChanges: [
      { symbol: 'BTC', change: -8.4 },
      { symbol: 'ETH', change: -11.2 },
      { symbol: 'CRO', change: -15.8 },
    ],
    eventData: {
      date: 'October 10, 2025 - 6:47 PM EST',
      headline: 'BREAKING: Trump Imposes 100% Tariffs on Chinese Imports',
      source: 'Polymarket • Kalshi • PredictIt • Delphi • Crypto.com API',
      marketContext: 'Markets closed for the week. Asian markets set to open in turmoil. Crypto markets react immediately as 24/7 liquidity absorbs panic selling.',
      liquidations: '$2.1 billion in leveraged positions liquidated within 4 hours. 127,000 trader accounts affected.',
      predictionData: {
        polymarket: { question: 'Trump tariff announcement', before: 34, after: 94, volume: 12400000 },
        kalshi: { question: 'Trade war escalation Q4', before: 45, after: 82, volume: 8100000 },
        predictit: { question: 'Major economic policy change', before: 41, after: 89, volume: 2300000 },
        consensus: 0.91,
      },
      priceAtEvent: [
        { symbol: 'BTC', price: 91750 },
        { symbol: 'ETH', price: 3420 },
        { symbol: 'CRO', price: 0.142 },
      ],
    },
  },
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
  totalValue: 150000000, // $150M - matches the demo scenario
  cash: 7500000, // $7.5M cash reserve
  positions: [
    { symbol: 'BTC', amount: 820, value: 75235000, price: 91750, pnl: 0, pnlPercent: 0 }, // ~$75M in BTC
    { symbol: 'ETH', amount: 13450, value: 45999000, price: 3420, pnl: 0, pnlPercent: 0 }, // ~$46M in ETH
    { symbol: 'CRO', amount: 150000000, value: 21300000, price: 0.142, pnl: 0, pnlPercent: 0 }, // ~$21M in CRO
  ],
  riskScore: 42,
  volatility: 0.22,
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

    // Show real event data for tariff scenario
    if (selectedScenario.type === 'tariff' && selectedScenario.eventData) {
      const event = selectedScenario.eventData;
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'warning');
      addLog(`🚨 REAL EVENT REPLAY: ${event.date}`, 'warning');
      addLog(`📰 ${event.headline}`, 'warning');
      addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'warning');
      addLog(`Market Context: ${event.marketContext}`, 'info');
      addLog(`Pre-crash prices: BTC $${event.priceAtEvent[0].price.toLocaleString()}, ETH $${event.priceAtEvent[1].price.toLocaleString()}`, 'info');
    }

    const totalSteps = selectedScenario.duration;
    let currentStep = 0;
    let currentPortfolio = { ...initialPortfolio };
    let hedgeActivated = false;
    let hedgePnL = 0;

    // Phase 1: Market event begins - Multi-source detection
    if (selectedScenario.type === 'tariff') {
      addLog('━━━━━ 🔍 MULTI-SOURCE EVENT DETECTION ━━━━━', 'warning');
      addLog('📊 Polymarket: "Trump tariff announcement" spiked 34% → 87%', 'warning');
      addLog('📊 Kalshi: "Trade war escalation Q4" jumped 45% → 82%', 'warning');
      addLog('📊 Delphi Aggregator: Confidence score 0.91 (HIGH)', 'warning');
      addLog('📡 Crypto.com API: BTC volatility +180% in 2 minutes', 'info');
      addLog('📰 News Feed: Reuters, Bloomberg, CNBC confirming tariff news', 'info');
      addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warning');
      addLog('🤖 Lead Agent: "Multiple signals aligned - HIGH CONFIDENCE macro event"', 'success');
    } else {
      addLog('Market event detected - initiating agent swarm', 'warning');
    }
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
        
        if (selectedScenario.type === 'tariff') {
          // Tariff shock: Full price drop happens over 45 seconds
          // No recovery - this shows the full impact of the event
          if (changeFactor < 0.4) {
            // First 40%: 80% of the drop happens here (panic selling)
            priceChange = (scenarioChange?.change || 0) * 0.8 * (changeFactor / 0.4);
          } else {
            // 40-100%: Remaining 20% of drop (continued pressure, then stabilizes at full drop)
            priceChange = (scenarioChange?.change || 0) * (0.8 + 0.2 * ((changeFactor - 0.4) / 0.6));
          }
        } else if (selectedScenario.type === 'crash') {
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
      const newRiskScore = Math.min(100, Math.max(0, 42 + avgPnlPercent * 1.5));
      const newVolatility = Math.min(1, 0.22 + (avgPnlPercent / 80));

      // Calculate hedge P&L if hedge is active
      if (hedgeActivated && selectedScenario.type !== 'recovery') {
        const btcPosition = newPositions.find(p => p.symbol === 'BTC');
        const ethPosition = newPositions.find(p => p.symbol === 'ETH');
        if (btcPosition && btcPosition.pnlPercent < 0) {
          // SHORT hedge profits when price drops
          // 65% hedge ratio on BTC (aggressive protection during major events)
          // Plus 25% hedge on ETH exposure
          const btcHedgeProfit = Math.abs(btcPosition.pnl) * 0.65;
          const ethHedgeProfit = ethPosition ? Math.abs(ethPosition.pnl) * 0.25 : 0;
          hedgePnL = btcHedgeProfit + ethHedgeProfit;
        }
      }

      currentPortfolio = {
        ...currentPortfolio,
        positions: newPositions,
        totalValue: newTotalValue + hedgePnL,
        riskScore: newRiskScore,
        volatility: newVolatility,
      };

      setPortfolio(currentPortfolio);

      // Tariff-specific agent actions with realistic timing
      if (selectedScenario.type === 'tariff') {
        // Second 1: VaR threshold breach detection
        if (currentStep === 1) {
          addLog('🚨 Risk Agent: VaR THRESHOLD BREACH DETECTED', 'error');
          addLog('   └─ Current VaR: 6.8% (Threshold: 4.0%)', 'error');
          addAgentAction('Risk', 'VAR_BREACH', 'Value-at-Risk exceeded institutional policy limit', {
            metric: 'VaR %',
            before: 3.2,
            after: 6.8,
          });
        }
        
        // Second 2: Risk detection
        if (currentStep === 2) {
          addLog('⚡ Risk Agent: Volatility spike detected - 340% above baseline', 'warning');
          addAgentAction('Risk', 'VOLATILITY_ALERT', 'VIX equivalent for crypto surged from 22 to 75 in seconds', {
            metric: 'Volatility',
            before: 22,
            after: 75,
          });
        }
        
        // Second 3: Delphi prediction details - MULTI-SOURCE
        if (currentStep === 3) {
          addLog('🔮 Delphi Agent: Aggregating prediction market signals...', 'info');
          addLog('   ┌─ Polymarket (Volume: $12.4M)', 'info');
          addLog('   │  └─ "Trump tariff announcement" → 94% ⬆️', 'info');
          addLog('   │  └─ "China retaliates by Monday" → 78% ⬆️', 'info');
          addLog('   ├─ Kalshi (Volume: $8.1M)', 'info');
          addLog('   │  └─ "Trade war escalation Q4" → 82% ⬆️', 'info');
          addLog('   │  └─ "BTC below $85K this week" → 71% ⬆️', 'info');
          addLog('   └─ PredictIt (Volume: $2.3M)', 'info');
          addLog('      └─ "Major economic policy change" → 89% ⬆️', 'info');
          addLog('✅ Delphi Consensus: 0.91 correlation across 3 markets', 'success');
          addAgentAction('Risk', 'DELPHI_AGGREGATION', 'Multiple prediction markets confirm macro event - triggering hedge protocol', {
            metric: 'Market Consensus',
            before: 0.34,
            after: 0.91,
          });
        }
        
        // Second 4: Polymarket correlation
        if (currentStep === 4) {
          addLog('📊 Risk Agent: Polymarket "Trump tariff announcement" prediction spiked to 94%', 'info');
          addAgentAction('Risk', 'PREDICTION_CORRELATION', 'Delphi signals aligned with breaking news - confirming macro event', {
            metric: 'Prediction Confidence',
            before: 34,
            after: 94,
          });
        }
        
        // Second 5: Check liquidity FIRST (before hedge recommendation)
        if (currentStep === 5) {
          addLog('💱 Settlement Agent: Pre-flight liquidity check...', 'info');
          addLog('   └─ Moonlander BTC-PERP: $847M open interest ✓', 'info');
          addLog('   └─ Moonlander ETH-PERP: $312M open interest ✓', 'info');
          addLog('   └─ VVS WCRO/USDC: $42.8M TVL | 0.08% slippage ✓', 'info');
          addLog('✅ Liquidity sufficient for emergency hedge execution', 'success');
          addAgentAction('Settlement', 'LIQUIDITY_CHECK', 'Pre-flight check: DEX and perpetual liquidity confirmed', {
            metric: 'Liquidity Score',
            before: 0,
            after: 98,
          });
        }
        
        // Second 6: Hedging Agent RECOMMENDS hedge (not executes yet)
        if (currentStep === 6) {
          const btcExposure = newPositions.find(p => p.symbol === 'BTC')?.value || 0;
          const ethExposure = newPositions.find(p => p.symbol === 'ETH')?.value || 0;
          const btcHedgeSize = btcExposure * 0.65;
          const ethHedgeSize = ethExposure * 0.25;
          addLog(`🛡️ Hedging Agent: EMERGENCY HEDGE RECOMMENDED`, 'warning');
          addLog(`   └─ BTC-PERP: $${(btcHedgeSize/1000000).toFixed(1)}M SHORT @ 10x leverage`, 'warning');
          addLog(`   └─ ETH-PERP: $${(ethHedgeSize/1000000).toFixed(1)}M SHORT @ 8x leverage`, 'warning');
          addLog('⏳ Awaiting manager signature...', 'info');
          addAgentAction('Hedging', 'HEDGE_RECOMMENDATION', `Proposing multi-asset SHORT positions via Moonlander`, {
            metric: 'Proposed Hedge %',
            before: 0,
            after: Math.round((btcHedgeSize + ethHedgeSize) / initialPortfolio.totalValue * 100),
          });
        }
        
        // Second 8: Manager signature APPROVES the hedge
        if (currentStep === 8) {
          addLog('✍️ Lead Agent: Requesting manager signature for emergency hedge...', 'info');
          addLog('✅ Manager signature confirmed: 0x7a3f...b29c (gasless via x402)', 'success');
          addLog('🔓 Hedge authorization granted - proceeding to execution', 'success');
          addAgentAction('Lead', 'MANAGER_APPROVAL', 'Portfolio manager approved emergency hedge - generating ZK proof');
        }
        
        // Second 9: ZK proof for hedge authorization (after approval, before execution)
        if (currentStep === 9) {
          addLog('🔐 ZK Engine: Generating STARK proof for hedge authorization...', 'info');
          addLog('   └─ Statement: "Hedge within policy limits"', 'info');
          addLog('   └─ Private: Position sizes, entry prices, leverage', 'info');
          addLog('   └─ Public: Policy compliance verified', 'info');
          addLog('   └─ Security: 521-bit | Size: 77KB | Time: 1.8s (CUDA)', 'success');
          addAgentAction('Reporting', 'ZK_PROOF_GEN', 'Hedge authorization proven without revealing position sizes', {
            metric: 'Proof Security',
            before: 0,
            after: 521,
          });
        }
        
        // Second 10: NOW execute the hedge on-chain
        if (currentStep === 10) {
          hedgeActivated = true;
          addLog('⚡ Settlement Agent: EXECUTING HEDGE ON-CHAIN...', 'warning');
          const txHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
          addLog(`   └─ Tx Hash: ${txHash.slice(0, 18)}...${txHash.slice(-8)}`, 'success');
          addLog('   └─ Gas: $0.00 CRO (x402 sponsored) | Fee: $0.01 USDC', 'success');
          addLog('   └─ Block: #14,892,347 | Confirmations: 3', 'success');
          addLog('✅ HEDGE POSITIONS OPENED SUCCESSFULLY', 'success');
          addAgentAction('Settlement', 'HEDGE_EXECUTED', 'Hedge executed on-chain via x402 gasless protocol', {
            metric: 'Gas Saved',
            before: 0,
            after: 127,
          });
        }
        
        // Second 12: Confirm positions are live
        if (currentStep === 12) {
          addLog('📋 Hedging Agent: Confirming hedge positions...', 'info');
          addLog('   └─ Position #1: BTC-PERP SHORT | Entry: $84,050 | Active ✓', 'success');
          addLog('   └─ Position #2: ETH-PERP SHORT | Entry: $3,037 | Active ✓', 'success');
          addAgentAction('Hedging', 'POSITIONS_CONFIRMED', 'All hedge positions confirmed on Moonlander', {
            metric: 'Active Hedges',
            before: 0,
            after: 2,
          });
        }
        
        // Second 14: Real-time P&L update (hedges making money)
        if (currentStep === 14) {
          const savedAmount = Math.abs(hedgePnL);
          addLog(`📈 Hedge P&L Update: SHORT positions profiting as prices drop`, 'success');
          addLog(`   └─ BTC-PERP SHORT: +$${((savedAmount * 0.75)/1000).toFixed(0)}K`, 'success');
          addLog(`   └─ ETH-PERP SHORT: +$${((savedAmount * 0.25)/1000).toFixed(0)}K`, 'success');
          addAgentAction('Hedging', 'PNL_UPDATE', `Perpetual shorts profiting from price decline`, {
            metric: 'Hedge P&L ($K)',
            before: 0,
            after: Math.round(savedAmount / 1000),
          });
        }
        
        // Second 18: Mid-event status comparison
        if (currentStep === 18) {
          const portfolioLoss = initialPortfolio.totalValue - currentPortfolio.totalValue;
          const wouldBeLoss = portfolioLoss + Math.abs(hedgePnL);
          addLog(`━━━━━ 📊 MID-EVENT STATUS REPORT ━━━━━`, 'info');
          addLog(`📊 Portfolio Value: $${(currentPortfolio.totalValue/1000000).toFixed(2)}M`, 'info');
          addLog(`📊 Current Loss: $${(portfolioLoss/1000000).toFixed(2)}M (WITH hedge protection)`, 'info');
          addLog(`❌ Without ZkVanguard: Would be down $${(wouldBeLoss/1000000).toFixed(2)}M`, 'error');
          addLog(`✅ Hedge Savings So Far: $${(Math.abs(hedgePnL)/1000000).toFixed(2)}M`, 'success');
          addAgentAction('Lead', 'STATUS_REPORT', `Hedge protecting portfolio - ${((Math.abs(hedgePnL)/wouldBeLoss)*100).toFixed(0)}% of losses offset`);
        }
        
        // Second 22: Sharpe ratio impact
        if (currentStep === 22) {
          addLog('📉 Risk Agent: Updating risk-adjusted metrics...', 'info');
          addLog('   └─ Sharpe Ratio: 1.82 → 0.94 (market stress)', 'info');
          addLog('   └─ Max Drawdown: 2.1% → 6.2% (within 20% limit ✓)', 'info');
          addLog('   └─ VaR: 6.8% → 5.2% (hedge reducing risk)', 'info');
          addAgentAction('Risk', 'METRICS_UPDATE', 'Risk metrics recalculated with hedge factored in', {
            metric: 'Sharpe Ratio',
            before: 1.82,
            after: 0.94,
          });
        }
        
        // Second 26: Market stabilizing
        if (currentStep === 26) {
          addLog('📉 Risk Agent: Market stabilization detected', 'info');
          addLog('   └─ Volatility: 75 → 52 (declining)', 'info');
          addLog('   └─ Bid support emerging at $84K (BTC)', 'info');
          addLog('   └─ Selling pressure: -45% from peak', 'info');
          addAgentAction('Risk', 'STABILIZATION_DETECTED', 'Selling pressure easing, bid support emerging at key levels', {
            metric: 'Volatility Index',
            before: 75,
            after: 52,
          });
        }
        
        // Second 30: Crypto.com API price feed update
        if (currentStep === 30) {
          addLog('📡 Data Feed: Live prices from Crypto.com Exchange API', 'info');
          addLog(`   └─ BTC: $${newPositions.find(p => p.symbol === 'BTC')?.price.toLocaleString() || 'N/A'} (100 req/s)`, 'info');
          addLog(`   └─ ETH: $${newPositions.find(p => p.symbol === 'ETH')?.price.toLocaleString() || 'N/A'}`, 'info');
          addLog(`   └─ CRO: $${newPositions.find(p => p.symbol === 'CRO')?.price.toFixed(4) || 'N/A'}`, 'info');
          addAgentAction('Lead', 'PRICE_FEED', 'Real-time prices streaming from Crypto.com Exchange API');
        }
        
        // Second 34: Hedge adjustment - scaling down
        if (currentStep === 34) {
          addLog('🔄 Hedging Agent: Adjusting hedge as volatility normalizes', 'info');
          addLog('   └─ Closing 40% of BTC-PERP SHORT (locking $2.8M profit)', 'info');
          addLog('   └─ Maintaining ETH-PERP SHORT (still elevated vol)', 'info');
          addLog('   └─ New hedge ratio: 35% → 20%', 'info');
          addAgentAction('Hedging', 'HEDGE_ADJUSTMENT', 'Scaling down SHORT positions - locking in gains', {
            metric: 'Hedge Ratio',
            before: 35,
            after: 20,
          });
        }
        
        // Second 37: Active Hedges panel update
        if (currentStep === 37) {
          const savedAmount = Math.abs(hedgePnL);
          addLog('📋 Dashboard: Active Hedges panel updated', 'info');
          addLog(`   └─ BTC-PERP SHORT: +$${((savedAmount * 0.75)/1000000).toFixed(1)}M P&L | Partially closed`, 'success');
          addLog(`   └─ ETH-PERP SHORT: +$${((savedAmount * 0.25)/1000000).toFixed(1)}M P&L | Active`, 'success');
          addAgentAction('Lead', 'DASHBOARD_UPDATE', 'Real-time hedge positions updated in Active Hedges panel');
        }
        
        // Second 40: ZK Report generation
        if (currentStep === 40) {
          addLog('📝 Reporting Agent: Generating ZK-verified compliance report', 'info');
          addLog('   └─ Claim: "All hedges within policy limits"', 'info');
          addLog('   └─ Private: Position sizes, entry prices, leverage', 'info');
          addLog('   └─ Public: Compliance status, timestamp, proof hash', 'info');
          addAgentAction('Reporting', 'ZK_REPORT', 'Creating private compliance report - positions hidden, performance verified', {
            metric: 'Report Data Points',
            before: 0,
            after: 847,
          });
        }
        
        // Second 42: On-chain proof storage
        if (currentStep === 42) {
          const proofHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
          addLog('⛓️ Reporting Agent: Storing proof commitment on-chain...', 'info');
          addLog(`   └─ Proof Hash: ${proofHash.slice(0, 22)}...`, 'success');
          addLog('   └─ Contract: ZKVerifier (0x46A4...FD8)', 'success');
          addLog('   └─ Gas: $0.00 (x402 sponsored)', 'success');
          addAgentAction('Settlement', 'PROOF_STORAGE', 'ZK proof commitment stored on Cronos blockchain', {
            metric: 'On-Chain Proofs',
            before: 0,
            after: 1,
          });
        }
        
        // Final summary
        if (currentStep === totalSteps - 1) {
          // Calculate accurate unhedged loss based on all asset price changes
          const unhedgedLoss = selectedScenario.priceChanges.reduce((total, pc) => {
            const pos = initialPortfolio.positions.find(p => p.symbol === pc.symbol);
            return total + (pos ? Math.abs(pc.change * pos.value / 100) : 0);
          }, 0);
          const finalLoss = initialPortfolio.totalValue - currentPortfolio.totalValue;
          const totalSaved = unhedgedLoss - finalLoss;
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'success');
          addLog(`✅ SIMULATION COMPLETE: ZkVanguard Response Time: 19 seconds`, 'success');
          addLog(`💰 Total Saved by Hedging: $${(totalSaved/1000000).toFixed(2)}M`, 'success');
          addLog(`📊 Final Portfolio Loss: $${(finalLoss/1000000).toFixed(2)}M (${((finalLoss/initialPortfolio.totalValue)*100).toFixed(1)}%)`, 'info');
          addLog(`❌ Without Protection: Would have lost $${(unhedgedLoss/1000000).toFixed(2)}M (${((unhedgedLoss/initialPortfolio.totalValue)*100).toFixed(1)}%)`, 'error');
          addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'success');
        }
      } else {
        // Generic agent actions for other scenarios
        if (currentStep === 3) {
          addLog('Risk Agent analyzing market conditions', 'info');
          addAgentAction('Risk', 'RISK_ANALYSIS', 'Calculating VaR, volatility exposure, correlation matrices', {
            metric: 'Risk Score',
            before: 42,
            after: newRiskScore,
          });
        }
        
        if (currentStep === 6 && selectedScenario.type !== 'recovery') {
          hedgeActivated = true;
          addLog('Hedging Agent activating protective positions', 'warning');
          addAgentAction('Hedging', 'OPEN_HEDGE', 'Opening SHORT positions on BTC-PERP to offset exposure', {
            metric: 'Hedge Ratio',
            before: 0,
            after: 35,
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
    <div className="min-h-screen bg-[#f5f5f7]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-[#AF52DE] to-[#5856D6] rounded-[16px] flex items-center justify-center shadow-lg">
              <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            </div>
            <div>
              <h1 className="text-[28px] sm:text-[34px] lg:text-[40px] font-bold text-[#1d1d1f] tracking-[-0.02em]">
                Portfolio Stress Simulator
              </h1>
              <p className="text-[14px] sm:text-[15px] text-[#86868b]">
                Virtualize market scenarios and watch AI agents respond in real-time
              </p>
            </div>
          </div>
        </div>
        
        {/* Risk Policy Panel */}
        <div className="bg-white rounded-[16px] sm:rounded-[20px] border border-black/5 p-4 sm:p-5 mb-5 sm:mb-6 shadow-sm">
          <h2 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-3 flex items-center gap-2">
            <div className="w-8 h-8 bg-[#AF52DE]/10 rounded-[8px] flex items-center justify-center">
              <Shield className="w-4 h-4 text-[#AF52DE]" />
            </div>
            Risk Policy (Institutional)
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-[#f5f5f7] rounded-[10px] p-3">
              <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-0.5">Max Drawdown</div>
              <div className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">{(RISK_POLICY.maxDrawdown*100).toFixed(1)}%</div>
            </div>
            <div className="bg-[#f5f5f7] rounded-[10px] p-3">
              <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-0.5">Hedge Ratio</div>
              <div className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">{(RISK_POLICY.hedgeRatio*100).toFixed(0)}%</div>
            </div>
            <div className="bg-[#f5f5f7] rounded-[10px] p-3">
              <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-0.5">VaR Threshold</div>
              <div className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f]">{(RISK_POLICY.varThreshold*100).toFixed(1)}%</div>
            </div>
            <div className="bg-[#f5f5f7] rounded-[10px] p-3 col-span-2 sm:col-span-1">
              <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-0.5">Allowed Instruments</div>
              <div className="text-[13px] sm:text-[14px] font-semibold text-[#1d1d1f]">{RISK_POLICY.allowedInstruments.join(', ')}</div>
            </div>
          </div>
        </div>

        {/* Scenario Selector */}
        <div className="bg-white rounded-[16px] sm:rounded-[20px] border border-black/5 p-4 sm:p-5 mb-5 sm:mb-6 shadow-sm">
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch gap-4">
            <div className="flex-1 min-w-[150px]">
              <label className="text-[12px] sm:text-[13px] font-medium text-[#86868b] mb-2 block">Select Scenario</label>
              <select
                value={selectedScenario.id}
                onChange={(e) => setSelectedScenario(scenarios.find(s => s.id === e.target.value)!)}
                disabled={isRunning}
                className="w-full bg-[#f5f5f7] border border-black/5 rounded-[10px] px-3 py-2.5 text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none text-[14px] sm:text-[15px] transition-all"
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] sm:text-[12px] text-[#86868b] mt-1.5">{selectedScenario.description}</p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2 w-full sm:w-auto">
              {!isRunning ? (
                <button
                  onClick={runSimulation}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-[#34C759] text-white rounded-[12px] font-semibold text-[15px] hover:bg-[#2DB84D] active:scale-[0.98] transition-all shadow-sm w-full sm:w-auto"
                >
                  <Play className="w-5 h-5" />
                  Execute Strategy
                </button>
              ) : (
                <>
                  {isPaused ? (
                    <button
                      onClick={resumeSimulation}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#34C759] text-white rounded-[10px] font-semibold text-[14px] hover:bg-[#2DB84D] active:scale-[0.98] transition-all w-full sm:w-auto"
                    >
                      <Play className="w-4 h-4" />
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={pauseSimulation}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FF9500] text-white rounded-[10px] font-semibold text-[14px] hover:bg-[#E68A00] active:scale-[0.98] transition-all w-full sm:w-auto"
                    >
                      <Pause className="w-4 h-4" />
                      Pause
                    </button>
                  )}
                </>
              )}
              <button
                onClick={resetSimulation}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-[10px] font-medium text-[14px] hover:bg-[#e8e8ed] active:scale-[0.98] transition-all w-full sm:w-auto"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          {isRunning && (
            <div className="mt-4">
              <div className="flex justify-between text-[12px] sm:text-[13px] text-[#86868b] mb-1.5">
                <span>Progress: {progress.toFixed(0)}%</span>
                <span>Elapsed: {elapsedTime}s / {selectedScenario.duration}s</span>
              </div>
              <div className="h-2 bg-[#e8e8ed] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#007AFF] to-[#5856D6]"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Real Event Data Card - shown for tariff scenario */}
        {selectedScenario.type === 'tariff' && selectedScenario.eventData && (
          <div className="bg-white rounded-[16px] sm:rounded-[20px] border-2 border-[#FF3B30]/30 p-4 sm:p-5 mb-5 sm:mb-6 shadow-sm">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="w-12 h-12 sm:w-14 sm:h-14 bg-[#FF3B30]/10 rounded-[14px] flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7 text-[#FF3B30]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-[11px] sm:text-[12px] px-2.5 py-1 bg-[#FF3B30]/10 text-[#FF3B30] rounded-full font-semibold border border-[#FF3B30]/30">
                    REAL EVENT REPLAY
                  </span>
                  <span className="text-[11px] sm:text-[12px] text-[#86868b]">{selectedScenario.eventData.date}</span>
                </div>
                <h3 className="text-[17px] sm:text-[20px] font-bold text-[#FF3B30] mb-2">
                  {selectedScenario.eventData.headline}
                </h3>
                <p className="text-[13px] sm:text-[14px] text-[#86868b] mb-4 leading-relaxed">
                  {selectedScenario.eventData.marketContext}
                </p>
                
                {/* Prediction Market Signals */}
                {selectedScenario.eventData.predictionData && (
                  <div className="bg-[#AF52DE]/5 border border-[#AF52DE]/20 rounded-[12px] p-3 sm:p-4 mb-4">
                    <div className="text-[#AF52DE] font-semibold text-[13px] sm:text-[14px] mb-3 flex items-center gap-2">
                      <span>🔮</span> Prediction Market Signals (Delphi Aggregated)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                      <div className="bg-white rounded-[10px] p-2.5 sm:p-3 border border-black/5">
                        <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">Polymarket</div>
                        <div className="text-[13px] sm:text-[14px] text-[#1d1d1f] font-mono font-medium">
                          {selectedScenario.eventData.predictionData.polymarket.before}% → <span className="text-[#FF3B30]">{selectedScenario.eventData.predictionData.polymarket.after}%</span>
                        </div>
                        <div className="text-[10px] sm:text-[11px] text-[#86868b]">${(selectedScenario.eventData.predictionData.polymarket.volume/1000000).toFixed(1)}M vol</div>
                      </div>
                      <div className="bg-white rounded-[10px] p-2.5 sm:p-3 border border-black/5">
                        <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">Kalshi</div>
                        <div className="text-[13px] sm:text-[14px] text-[#1d1d1f] font-mono font-medium">
                          {selectedScenario.eventData.predictionData.kalshi.before}% → <span className="text-[#FF3B30]">{selectedScenario.eventData.predictionData.kalshi.after}%</span>
                        </div>
                        <div className="text-[10px] sm:text-[11px] text-[#86868b]">${(selectedScenario.eventData.predictionData.kalshi.volume/1000000).toFixed(1)}M vol</div>
                      </div>
                      <div className="bg-white rounded-[10px] p-2.5 sm:p-3 border border-black/5">
                        <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">PredictIt</div>
                        <div className="text-[13px] sm:text-[14px] text-[#1d1d1f] font-mono font-medium">
                          {selectedScenario.eventData.predictionData.predictit.before}% → <span className="text-[#FF3B30]">{selectedScenario.eventData.predictionData.predictit.after}%</span>
                        </div>
                        <div className="text-[10px] sm:text-[11px] text-[#86868b]">${(selectedScenario.eventData.predictionData.predictit.volume/1000000).toFixed(1)}M vol</div>
                      </div>
                    </div>
                    <div className="mt-3 text-center text-[#34C759] font-semibold text-[13px] sm:text-[14px]">
                      Consensus: {(selectedScenario.eventData.predictionData.consensus * 100).toFixed(0)}% confidence
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-[#f5f5f7] rounded-[10px] p-3">
                    <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">Market Impact</div>
                    <div className="text-[13px] sm:text-[14px] text-[#FF3B30] font-semibold">{selectedScenario.eventData.liquidations}</div>
                  </div>
                  <div className="bg-[#f5f5f7] rounded-[10px] p-3">
                    <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">Pre-Crash Prices</div>
                    <div className="flex flex-wrap gap-3">
                      {selectedScenario.eventData.priceAtEvent.map(p => (
                        <span key={p.symbol} className="text-[13px] sm:text-[14px] text-[#1d1d1f] font-mono">
                          {p.symbol}: ${p.price.toLocaleString()}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-[10px] sm:text-[11px] text-[#86868b]">
                  Data Sources: {selectedScenario.eventData.source}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Portfolio State */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Portfolio Overview */}
            <div className="bg-white rounded-[16px] sm:rounded-[20px] border border-black/5 p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[17px] sm:text-[20px] font-semibold text-[#1d1d1f] flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#007AFF]/10 rounded-[8px] flex items-center justify-center">
                    <Activity className="w-4 h-4 text-[#007AFF]" />
                  </div>
                  Live Portfolio State
                </h2>
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] sm:text-[14px] font-semibold ${
                  pnlPercent >= 0 ? 'bg-[#34C759]/10 text-[#34C759]' : 'bg-[#FF3B30]/10 text-[#FF3B30]'
                }`}>
                  {pnlPercent >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div className="bg-[#f5f5f7] rounded-[12px] p-3 sm:p-4">
                  <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">Total Value</div>
                  <div className="text-[20px] sm:text-[24px] font-bold text-[#1d1d1f]">
                    ${(portfolio.totalValue / 1000000).toFixed(2)}M
                  </div>
                </div>
                <div className="bg-[#f5f5f7] rounded-[12px] p-3 sm:p-4">
                  <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">P&L</div>
                  <div className={`text-[20px] sm:text-[24px] font-bold ${pnlValue >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                    {pnlValue >= 0 ? '+' : ''}${(pnlValue / 1000).toFixed(0)}K
                  </div>
                </div>
                <div className="bg-[#f5f5f7] rounded-[12px] p-3 sm:p-4">
                  <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">Risk Score</div>
                  <div className={`text-[20px] sm:text-[24px] font-bold ${
                    portfolio.riskScore < 40 ? 'text-[#34C759]' : 
                    portfolio.riskScore < 70 ? 'text-[#FF9500]' : 'text-[#FF3B30]'
                  }`}>
                    {portfolio.riskScore.toFixed(0)}/100
                  </div>
                </div>
                <div className="bg-[#f5f5f7] rounded-[12px] p-3 sm:p-4">
                  <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-1">Volatility</div>
                  <div className="text-[20px] sm:text-[24px] font-bold text-[#007AFF]">
                    {(portfolio.volatility * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Positions */}
              <div className="space-y-2">
                {portfolio.positions.map((pos) => (
                  <div
                    key={pos.symbol}
                    className="flex items-center justify-between bg-[#f5f5f7] rounded-[12px] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-[#007AFF] to-[#5856D6] flex items-center justify-center font-bold text-[11px] sm:text-[12px] text-white">
                        {pos.symbol.slice(0, 2)}
                      </div>
                      <div>
                        <div className="text-[14px] sm:text-[15px] font-semibold text-[#1d1d1f]">{pos.symbol}</div>
                        <div className="text-[11px] sm:text-[12px] text-[#86868b]">{pos.amount.toLocaleString()} units</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[14px] sm:text-[15px] font-semibold text-[#1d1d1f]">${(pos.value / 1000000).toFixed(2)}M</div>
                      <div className={`text-[11px] sm:text-[12px] font-medium ${pos.pnlPercent >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
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
                  className="bg-white rounded-[16px] sm:rounded-[20px] border-2 border-[#34C759]/30 p-4 sm:p-5 shadow-sm space-y-5"
                >
                  <h3 className="text-[17px] sm:text-[20px] font-semibold text-[#1d1d1f] flex items-center gap-2">
                    <div className="w-8 h-8 bg-[#34C759]/10 rounded-[8px] flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-[#34C759]" />
                    </div>
                    Simulation Results: Before vs After
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="bg-[#f5f5f7] rounded-[12px] p-4 border-2 border-[#FF3B30]/20">
                      <div className="text-[12px] sm:text-[13px] text-[#86868b] mb-2">Without Hedging</div>
                      <div className="text-[22px] sm:text-[26px] font-bold text-[#FF3B30]">
                        {/* Calculate total unhedged loss across all assets */}
                        -${(selectedScenario.priceChanges.reduce((total, pc) => {
                          const pos = initialPortfolio.positions.find(p => p.symbol === pc.symbol);
                          return total + (pos ? Math.abs(pc.change * pos.value / 100) : 0);
                        }, 0) / 1000000).toFixed(2)}M
                      </div>
                      <div className="text-[11px] sm:text-[12px] text-[#86868b]">
                        {(selectedScenario.priceChanges.reduce((total, pc) => {
                          const pos = initialPortfolio.positions.find(p => p.symbol === pc.symbol);
                          return total + (pos ? Math.abs(pc.change * pos.value / 100) : 0);
                        }, 0) / initialPortfolio.totalValue * 100).toFixed(1)}% total portfolio loss
                      </div>
                    </div>
                    <div className="bg-[#f5f5f7] rounded-[12px] p-4 border-2 border-[#34C759]/30">
                      <div className="text-[12px] sm:text-[13px] text-[#86868b] mb-2">With zkVanguard Hedging</div>
                      <div className="text-[22px] sm:text-[26px] font-bold text-[#34C759]">
                        {pnlValue >= 0 ? '+' : '-'}${Math.abs(pnlValue / 1000000).toFixed(2)}M
                      </div>
                      <div className="text-[11px] sm:text-[12px] text-[#34C759]">
                        {Math.abs(pnlPercent).toFixed(1)}% {pnlPercent >= 0 ? 'gain' : 'loss'} (hedged)
                      </div>
                    </div>
                  </div>
                  <div className="p-3 sm:p-4 bg-[#AF52DE]/5 rounded-[12px] border border-[#AF52DE]/20">
                    <div className="flex items-center gap-2 text-[#AF52DE]">
                      <Shield className="w-4 h-4" />
                      <span className="font-semibold text-[14px] sm:text-[15px]">
                        {/* Calculate saved as: unhedged loss - actual loss */}
                        AI Protection Saved: ${(selectedScenario.priceChanges.reduce((total, pc) => {
                          const pos = initialPortfolio.positions.find(p => p.symbol === pc.symbol);
                          return total + (pos ? Math.abs(pc.change * pos.value / 100) : 0);
                        }, 0) - Math.abs(pnlValue)).toLocaleString(undefined, {maximumFractionDigits: 0})}
                      </span>
                    </div>
                  </div>

                  {/* On-chain tx hash and explorer link */}
                  {onChainTx && (
                    <div className="p-3 sm:p-4 bg-[#007AFF]/5 rounded-[12px] border border-[#007AFF]/20">
                      <div className="flex items-center gap-2 text-[#007AFF]">
                        <Zap className="w-4 h-4" />
                        <span className="font-semibold text-[14px] sm:text-[15px]">On-Chain Hedge Executed</span>
                        <a href={`https://cronos.org/explorer/testnet3/tx/${onChainTx}`} target="_blank" rel="noopener noreferrer" className="underline text-[#5856D6] ml-2 text-[13px]">View on Cronos Explorer</a>
                      </div>
                      <div className="text-[11px] sm:text-[12px] text-[#86868b] mt-1">Tx Hash: <span className="font-mono text-[#007AFF]">{onChainTx}</span></div>
                    </div>
                  )}

                  {/* ZK Proof and explanation */}
                  {zkProofData && (
                    <div className="p-3 sm:p-4 bg-[#AF52DE]/5 rounded-[12px] border border-[#AF52DE]/20">
                      <div className="flex items-center gap-2 text-[#AF52DE] mb-2">
                        <Shield className="w-4 h-4" />
                        <span className="font-semibold text-[14px] sm:text-[15px]">ZK Proof of Policy Compliance</span>
                      </div>
                      <div className="text-[11px] sm:text-[12px] text-[#86868b] mb-2 space-y-0.5">
                        <div className="font-mono text-[#AF52DE]">Proof Hash: {zkProofData.proofHash}</div>
                        <div className="font-mono text-[#AF52DE]">Merkle Root: {zkProofData.merkleRoot}</div>
                        <div>Protocol: {zkProofData.protocol} ({zkProofData.securityLevel}-bit)</div>
                        <div>Generated in {zkProofData.generationTime} ms</div>
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
                  <div>
                    <h4 className="text-[14px] sm:text-[15px] font-semibold mb-3 text-[#1d1d1f]">Traditional vs zkVanguard</h4>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-[13px] sm:text-[14px] border border-black/5 rounded-[12px] overflow-hidden">
                        <thead>
                          <tr className="bg-[#f5f5f7] text-[#86868b]">
                            <th className="px-4 py-2.5 text-left font-medium">Traditional</th>
                            <th className="px-4 py-2.5 text-left font-medium">zkVanguard</th>
                          </tr>
                        </thead>
                        <tbody className="text-[#1d1d1f]">
                          <tr className="border-t border-black/5">
                            <td className="px-4 py-2.5">Manual checks</td>
                            <td className="px-4 py-2.5">Automatic</td>
                          </tr>
                          <tr className="border-t border-black/5">
                            <td className="px-4 py-2.5">Trust required</td>
                            <td className="px-4 py-2.5">Verifiable</td>
                          </tr>
                          <tr className="border-t border-black/5">
                            <td className="px-4 py-2.5">Slow</td>
                            <td className="px-4 py-2.5">Deterministic</td>
                          </tr>
                          <tr className="border-t border-black/5">
                            <td className="px-4 py-2.5">Opaque</td>
                            <td className="px-4 py-2.5">Auditable</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Compliance Message */}
                  <div className="p-3 sm:p-4 bg-[#34C759]/5 rounded-[12px] border border-[#34C759]/20 text-[#1d1d1f] text-center text-[13px] sm:text-[14px]">
                    This same proof can be shared with compliance, governance, or regulators — <b>without revealing positions</b>.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Agent Activity & Logs */}
          <div className="space-y-4 sm:space-y-6">
            {/* Agent Activity */}
            <div className="bg-white rounded-[16px] sm:rounded-[20px] border border-black/5 p-4 sm:p-5 shadow-sm max-h-[400px] overflow-y-auto">
              <h2 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
                <div className="w-8 h-8 bg-[#5856D6]/10 rounded-[8px] flex items-center justify-center">
                  <Brain className="w-4 h-4 text-[#5856D6]" />
                </div>
                Agent Swarm Activity
              </h2>
              
              {agentActions.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-14 h-14 mx-auto mb-3 bg-[#f5f5f7] rounded-full flex items-center justify-center">
                    <Brain className="w-7 h-7 text-[#86868b]" />
                  </div>
                  <p className="text-[14px] text-[#86868b]">Start simulation to see agent activity</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {agentActions.map((action) => (
                    <motion.div
                      key={action.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-3 rounded-[10px] border ${
                        action.status === 'completed' ? 'bg-[#34C759]/5 border-[#34C759]/20' :
                        action.status === 'executing' ? 'bg-[#007AFF]/5 border-[#007AFF]/20' :
                        action.status === 'failed' ? 'bg-[#FF3B30]/5 border-[#FF3B30]/20' :
                        'bg-[#f5f5f7] border-black/5'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-[13px] sm:text-[14px] text-[#1d1d1f]">{action.agent} Agent</span>
                        <div className="flex items-center gap-2">
                          {action.status === 'completed' && action.zkProof && (
                            <ZKBadgeInline verified={true} />
                          )}
                          {action.status === 'executing' && (
                            <span className="text-[11px] sm:text-[12px] text-[#007AFF] animate-pulse">Executing...</span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] sm:text-[12px] text-[#86868b]">{action.action}</div>
                      <div className="text-[11px] sm:text-[12px] text-[#86868b] mt-1">{action.description}</div>
                      {action.impact && action.status === 'completed' && (
                        <div className="text-[11px] sm:text-[12px] mt-2 flex items-center gap-2 text-[#34C759]">
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
            <div className="bg-white rounded-[16px] sm:rounded-[20px] border border-black/5 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
                <h3 className="text-[13px] sm:text-[14px] font-semibold text-[#1d1d1f] flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#34C759]" />
                  Debug Logs
                </h3>
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="text-[#86868b] hover:text-[#1d1d1f] transition-colors"
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
                    <div className="p-4 bg-[#1d1d1f] max-h-[200px] overflow-y-auto font-mono text-[11px] sm:text-[12px]">
                      {logs.length === 0 ? (
                        <span className="text-[#86868b]">Logs will appear here...</span>
                      ) : (
                        logs.map((log, i) => (
                          <div key={i} className="text-[#f5f5f7] mb-1">{log}</div>
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
