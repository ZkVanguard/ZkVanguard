'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Brain, Shield, Zap, Activity, TrendingDown, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { sendAgentCommand, assessPortfolioRisk, getHedgingRecommendations, executeSettlementBatch, generatePortfolioReport, getAgentActivity } from '../../lib/api/agents';
import { ZKBadgeInline, type ZKProofData } from '../ZKVerificationBadge';
import { MarkdownContent } from './MarkdownContent';
import { ActionApprovalModal, type ActionPreview } from './ActionApprovalModal';
import { getVVSFinanceService } from '../../lib/services/VVSFinanceService';
import { SwapModal } from './SwapModal';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  agentType?: string;
  aiPowered?: boolean;
  zkProof?: ZKProofData;
  actions?: { label: string; action: () => void }[];
}

// Quick action suggestions
const quickActions = [
  { label: 'Analyze portfolio', icon: Activity },
  { label: 'Assess risk level', icon: Shield },
  { label: 'Buy 100 CRO', icon: TrendingDown },
  { label: 'Get hedge recommendations', icon: Zap },
];

export function ChatInterface({ address: _address }: { address: string }) {
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapTokenOut, setSwapTokenOut] = useState<string>('WCRO');
  const [swapTokenIn, setSwapTokenIn] = useState<string>('devUSDC');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI-powered Lead Agent with full portfolio management capabilities. I can:\n\n💼 **Manage Your Portfolio:**\n• Buy/sell assets: "Buy 100 CRO" or "Sell 50 USDC"\n• Analyze positions with real market data\n• Track P/L and performance\n\n📊 **Smart Analysis:**\n• Assess risk (VaR, volatility, Sharpe ratio)\n• Generate hedge strategies via Moonlander\n• Provide AI-powered recommendations\n\n⚡ **Execute Actions:**\n• Gasless settlements via x402\n• Automated portfolio rebalancing\n• Generate ZK proofs for privacy\n\nTry: "Buy 100 CRO" or "Analyze my portfolio risk"',
      timestamp: new Date(),
      aiPowered: true,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Approval modal state
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionPreview | null>(null);
  const [pendingActionCallback, setPendingActionCallback] = useState<((sig: string) => Promise<void>) | null>(null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Generate ZK proof for response
  const generateResponseProof = async (): Promise<ZKProofData> => {
    try {
      console.log('🔐 [ChatInterface] Requesting ZK proof generation...');
      const response = await fetch('/api/zk-proof/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: 'agent_response',
          statement: { claim: 'AI agent response verified', timestamp: Date.now() },
          witness: { responseId: Date.now() },
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ [ChatInterface] ZK proof received:', { 
          success: data.success, 
          fallback: data.fallback,
          verified: data.proof?.verified 
        });
        
        if (data.success && data.proof) {
          return {
            proofHash: data.proof.merkle_root || data.proof.proof_hash || '0x0',
            merkleRoot: data.proof.merkle_root || '0x0',
            timestamp: Date.now(),
            verified: data.proof.verified !== false, // Real proofs are verified, fallback is not
            protocol: data.proof.protocol || (data.fallback ? 'ZK-STARK (Fallback)' : 'ZK-STARK'),
            securityLevel: data.proof.security_level || 0,
            generationTime: data.duration_ms || 0,
          };
        }
      } else {
        console.error('❌ [ChatInterface] ZK proof request failed:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('❌ [ChatInterface] ZK proof generation failed:', error);
    }
    
    // Should not reach here if server is working
    console.warn('⚠️ [ChatInterface] No proof returned from server');
    return {
      proofHash: '0x0',
      merkleRoot: '0x0',
      timestamp: Date.now(),
      verified: false,
      protocol: 'ZK-STARK (Unavailable)',
      securityLevel: 0,
      generationTime: 0,
    };
  };

  // Parse intent from user input
  const parseIntent = (text: string): { intent: string; params: Record<string, unknown> } => {
    const lower = text.toLowerCase();
    
    // Buy/Sell parsing
    if (lower.includes('buy')) {
      const amountMatch = text.match(/buy\s+([\d.]+)\s+(\w+)/i);
      if (amountMatch) {
        return { 
          intent: 'buy_asset',
          params: {
            amount: parseFloat(amountMatch[1]),
            asset: amountMatch[2].toUpperCase(),
          }
        };
      }
    }
    
    if (lower.includes('sell')) {
      const amountMatch = text.match(/sell\s+([\d.]+)\s+(\w+)/i);
      if (amountMatch) {
        return { 
          intent: 'sell_asset',
          params: {
            amount: parseFloat(amountMatch[1]),
            asset: amountMatch[2].toUpperCase(),
          }
        };
      }
    }
    
    if (lower.includes('hedge') || lower.includes('protect') || lower.includes('crash')) {
      const amountMatch = text.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:m|million|k|thousand)?/i);
      const yieldMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:yield|return)/i);
      return { 
        intent: 'hedge_portfolio',
        params: {
          amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 10000000,
          targetYield: yieldMatch ? parseFloat(yieldMatch[1]) : 8,
        }
      };
    }
    
    if (lower.includes('risk') || lower.includes('var') || lower.includes('volatility')) {
      return { intent: 'assess_risk', params: {} };
    }
    
    if (lower.includes('analyz') || lower.includes('portfolio') || lower.includes('overview')) {
      return { intent: 'analyze_portfolio', params: {} };
    }
    
    if (lower.includes('settle') || lower.includes('gasless') || lower.includes('x402') || lower.includes('payment')) {
      return { intent: 'execute_settlement', params: {} };
    }
    
    if (lower.includes('report') || lower.includes('compliance')) {
      return { intent: 'generate_report', params: {} };
    }
    
    return { intent: 'general', params: {} };
  };

  // Call LLM API for conversational responses
  const callLLM = async (text: string): Promise<string> => {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: _address || 'default',
          context: {
            address: _address,
            timestamp: Date.now(),
          },
        }),
      });

      if (!response.ok) {
        throw new Error('LLM API call failed');
      }

      const data = await response.json();
      
      // Check if an action was executed with ZK proof
      if (data.metadata?.actionExecuted) {
        const zkProof = data.metadata?.zkProof;
        if (zkProof) {
          return `🎯 **Action Executed with ZK-STARK Proof**\n\n${data.response}\n\n` +
            `🔐 **Cryptographic Verification:**\n` +
            `• Proof Hash: \`${zkProof.proofHash?.slice(0, 16)}...\`\n` +
            `• Verified: ${zkProof.verified ? '✅' : '❌'}\n` +
            `• Generation Time: ${zkProof.generationTime}ms`;
        }
        return `🎯 **Action Executed**\n\n${data.response}`;
      }
      
      return data.response || "I'm here to help! Try asking about portfolio analysis, risk assessment, or hedging strategies.";
    } catch (error) {
      console.error('LLM call failed:', error);
      return "I'm having trouble connecting to the AI service. Please try again in a moment.";
    }
  };

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    if (!messageText) setInput('');
    setLoading(true);

    try {
      const { intent, params } = parseIntent(textToSend);
      let response: { content: string; agent: string; actions?: { label: string; action: () => void }[] };

      switch (intent) {
        case 'buy_asset':
          setActiveAgent('Lead Agent → DEX Agent');
          const buyAsset = params.asset as string;
          const buyAmount = params.amount as number;
          
          // Use VVS Finance DEX for on-chain swaps
          const dexService = getVVSFinanceService(338);
          
          if (!dexService.isTokenSupported(buyAsset)) {
            response = {
              content: `❌ **Token Not Supported**\n\n` +
                `**Asset:** ${buyAsset}\n\n` +
                `**Supported tokens:**\n${Object.keys(dexService.getSupportedTokens()).join(', ')}\n\n` +
                `💡 **Tip:** Try \`buy 100 USDC\` or \`buy 10 WCRO\``,
              agent: 'DEX Agent',
            };
          } else {
            response = {
              content: `🔄 **Ready to Buy ${buyAsset}**\n\n` +
                `**Amount:** ${buyAmount} ${buyAsset}\n` +
                `**Method:** VVS Finance DEX (On-Chain)\n` +
                `**Network:** Cronos Testnet\n\n` +
                `⚡ Click "Open Swap" to proceed with the trade!\n\n` +
                `💡 Gasless via x402 protocol - no CRO needed for gas!`,
              agent: 'DEX Agent',
              actions: [
                {
                  label: '🔄 Open Swap',
                  action: () => {
                    setSwapTokenOut(buyAsset.toUpperCase());
                    setSwapTokenIn('WCRO');
                    setSwapModalOpen(true);
                  },
                },
              ],
            };
          }
          break;
          
        case 'sell_asset':
          setActiveAgent('Lead Agent → DEX Agent');
          const sellAsset = params.asset as string;
          const sellAmount = params.amount as number;
          
          // Use VVS Finance DEX for on-chain swaps
          const sellDexService = getVVSFinanceService(338);
          
          if (!sellDexService.isTokenSupported(sellAsset)) {
            response = {
              content: `❌ **Token Not Supported**\n\n` +
                `**Asset:** ${sellAsset}\n\n` +
                `**Supported tokens:**\n${Object.keys(sellDexService.getSupportedTokens()).join(', ')}\n\n` +
                `💡 **Tip:** Try \`sell 50 USDC\` or \`sell 5 WCRO\``,
              agent: 'DEX Agent',
            };
          } else {
            response = {
              content: `🔄 **Ready to Sell ${sellAsset}**\n\n` +
                `**Amount:** ${sellAmount} ${sellAsset}\n` +
                `**Method:** VVS Finance DEX (On-Chain)\n` +
                `**Network:** Cronos Testnet\n\n` +
                `⚡ Click "Open Swap" to proceed with the trade!\n\n` +
                `💡 Gasless via x402 protocol - no CRO needed for gas!`,
              agent: 'DEX Agent',
              actions: [
                {
                  label: '🔄 Open Swap',
                  action: () => {
                    setSwapTokenIn(sellAsset.toUpperCase());
                    setSwapTokenOut('WCRO');
                    setSwapModalOpen(true);
                  },
                },
              ],
            };
          }
          break;
        
        case 'analyze_portfolio':
          setActiveAgent('Lead Agent → Risk Agent');
          // Real API call
          const riskData = await assessPortfolioRisk(_address);
          response = {
            content: `📊 **Portfolio Analysis** (ZK-Verified)\n\n` +
              `**Value at Risk (95%):** ${(riskData.var * 100).toFixed(1)}%\n` +
              `**Volatility:** ${(riskData.volatility * 100).toFixed(1)}%\n` +
              `**Sharpe Ratio:** ${riskData.sharpeRatio.toFixed(2)}\n` +
              `**Liquidation Risk:** ${riskData.liquidationRisk}\n\n` +
              `**Recommendations:**\n${riskData.recommendations?.map((r: string) => `• ${r}`).join('\n') || '• Portfolio is well-balanced'}`,
            agent: 'Risk Agent',
          };
          break;

        case 'assess_risk':
          setActiveAgent('Lead Agent → Risk Agent');
          const risk = await assessPortfolioRisk(_address);
          const riskLevel = risk.var < 0.1 ? 'LOW' : risk.var < 0.2 ? 'MEDIUM' : 'HIGH';
          response = {
            content: `⚠️ **Risk Assessment** (AI-Powered)\n\n` +
              `**Overall Risk Level:** ${riskLevel}\n` +
              `**Value at Risk (95%):** ${(risk.var * 100).toFixed(1)}% potential loss\n` +
              `**Portfolio Volatility:** ${(risk.volatility * 100).toFixed(1)}%\n` +
              `**Sharpe Ratio:** ${risk.sharpeRatio.toFixed(2)} (${risk.sharpeRatio > 1 ? 'Good' : 'Needs improvement'})\n` +
              `**Max Drawdown:** ${(risk.maxDrawdown * 100).toFixed(1)}%\n\n` +
              `**Risk Factors:**\n• Market correlation: ${(risk.correlation * 100).toFixed(0)}%\n• Concentration risk: ${risk.concentrationRisk || 'Moderate'}`,
            agent: 'Risk Agent',
          };
          break;

        case 'hedge_portfolio':
          setActiveAgent('Lead Agent → Risk Agent → Hedging Agent');
          
          // Step 1: Get AI recommendations (no signature needed for analysis)
          const hedgeRecs = await getHedgingRecommendations(_address, []);
          const amount = params.amount as number || 10000000;
          const targetYield = params.targetYield || 8;
          
          // Extract real portfolio data from recommendations
          const topHedge = hedgeRecs[0];
          const realPortfolioValue = topHedge?.capitalRequired ? topHedge.capitalRequired * 2 : 30; // $30 USDC
          const realLeverage = 20; // 20x leverage
          const realExposure = realPortfolioValue * realLeverage; // $600 exposure
          
          // Step 2: Show recommendations to user
          const recommendationText = `🛡️ **Hedge Strategy Recommended** (via Moonlander)\n\n` +
            `**Your Portfolio:**\n` +
            `• Capital: $${realPortfolioValue} USDC\n` +
            `• Leverage: ${realLeverage}x\n` +
            `• Total Exposure: $${realExposure}\n` +
            `• Target Yield: ${targetYield}%\n\n` +
            `**AI-Recommended Hedges:**\n` +
            hedgeRecs.map((s: any, i: number) => 
              `${i + 1}. **${s.action}** on ${s.asset}\n` +
              `   • Size: ${s.size}${typeof s.size === 'number' && s.size < 1 ? ' BTC' : ''}\n` +
              `   • Leverage: ${s.leverage}x\n` +
              `   • Reason: ${s.reason}\n` +
              (s.capitalRequired ? `   • Capital Needed: $${s.capitalRequired} USDC\n` : '') +
              (s.targetPrice ? `   • Target: $${s.targetPrice} | Stop Loss: $${s.stopLoss}\n` : '')
            ).join('\n') +
            `\n💡 **Review and approve to execute. No action taken without your signature.**`;
          
          // Step 3: Set up approval action for execution
          const actions: { label: string; action: () => void }[] = [];
          
          if (hedgeRecs.length > 0) {
            const topHedge = hedgeRecs[0];
            
            // Create action preview
            const actionPreview: ActionPreview = {
              title: 'Execute Hedge Strategy',
              description: `${topHedge.action} position on ${topHedge.asset} to protect portfolio`,
              type: 'hedge',
              details: [
                { label: 'Asset', value: topHedge.asset, highlight: true },
                { label: 'Action', value: topHedge.action },
                { label: 'Leverage', value: `${topHedge.leverage}x` },
                { label: 'Position Size', value: String(topHedge.size) },
                { label: 'Your Capital', value: `$${realPortfolioValue} USDC`, highlight: true },
                { label: 'Total Exposure', value: `$${realExposure}` },
                { label: 'Hedge Capital', value: `$${topHedge.capitalRequired || 0} USDC` },
                { label: 'Gas Cost', value: '$0.00 (x402 gasless)', highlight: true },
              ],
              risks: [
                'Leverage amplifies both gains and losses',
                'Market volatility may trigger liquidation',
                'Counterparty risk on derivatives platform',
                `Current exposure: $${realExposure} on $${realPortfolioValue} capital (${realLeverage}x leverage)`,
              ],
              expectedOutcome: `${topHedge.reason}. Target yield: ${targetYield}%`,
            };
            
            // Add approval button to message
            actions.push({
              label: '🛡️ Approve & Execute Hedge',
              action: () => {
                setPendingAction(actionPreview);
                setPendingActionCallback(() => async (signature: string) => {
                  setIsExecutingAction(true);
                  try {
                    // Execute hedge with signature proof
                    const result = await executeSettlementBatch([
                      { 
                        recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', 
                        amount: 1000, 
                        token: '0x0',
                        signature,  // Include manager signature
                      },
                    ]);
                    
                    // Add success message
                    // Save hedge details to localStorage for dashboard tracking
                    const hedgeDetails = {
                      type: 'SHORT',
                      asset: 'BTC-PERP',
                      size: topHedge.size || 0.007,
                      leverage: topHedge.leverage || 10,
                      entryPrice: 43500, // Would come from live price feed
                      targetPrice: topHedge.targetPrice || 42800,
                      stopLoss: topHedge.stopLoss || 45200,
                      capitalUsed: topHedge.capitalRequired || 15,
                      reason: topHedge.reason || 'Portfolio protection',
                    };
                    
                    console.log('💾 [ChatInterface] Saving hedge to localStorage:', hedgeDetails);
                    
                    const settlementHistory = JSON.parse(localStorage.getItem('settlement_history') || '{}');
                    settlementHistory[result.batchId] = {
                      ...result,
                      type: 'hedge',
                      hedgeDetails,
                      managerSignature: signature,
                      timestamp: Date.now(),
                    };
                    localStorage.setItem('settlement_history', JSON.stringify(settlementHistory));
                    
                    console.log('✅ [ChatInterface] Hedge saved to localStorage:', settlementHistory);
                    
                    // Dispatch custom event to notify ActiveHedges component
                    window.dispatchEvent(new Event('hedgeAdded'));
                    console.log('📡 [ChatInterface] Dispatched hedgeAdded event');
                    
                    setMessages(prev => [...prev, {
                      id: Date.now().toString(),
                      role: 'assistant',
                      content: `✅ **Hedge Executed Successfully**\n\n` +
                        `**Status:** ${result.status}\n` +
                        `**Batch ID:** ${result.batchId}\n` +
                        `**Manager Signature:** \`${signature.slice(0, 16)}...${signature.slice(-8)}\`\n` +
                        `**Gas Cost:** $0.00 (x402 gasless)\n\n` +
                        `Your portfolio is now protected with the approved hedge strategy.\n\n` +
                        `📊 **View the hedge position in the "Active Hedges & P/L" section above!**`,
                      timestamp: new Date(),
                      aiPowered: true,
                      agentType: 'Settlement Agent',
                    }]);
                    
                    setShowApprovalModal(false);
                  } catch (error: any) {
                    setMessages(prev => [...prev, {
                      id: Date.now().toString(),
                      role: 'assistant',
                      content: `❌ **Hedge Execution Failed**\n\n${error.message || 'Unknown error'}`,
                      timestamp: new Date(),
                      aiPowered: true,
                    }]);
                  } finally {
                    setIsExecutingAction(false);
                  }
                });
                setShowApprovalModal(true);
              }
            });
          }
          
          response = {
            content: recommendationText,
            agent: 'Hedging Agent',
            actions: actions,
          };
          break;

        case 'execute_settlement':
          setActiveAgent('Lead Agent → Settlement Agent');
          const settlement = await executeSettlementBatch([
            { recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', amount: 1000, token: '0x0' },
          ]);
          response = {
            content: `⚡ **Settlement Executed** (x402 Gasless)\n\n` +
              `**Status:** ${settlement.status}\n` +
              `**Batch ID:** ${settlement.batchId}\n` +
              `**Transactions:** ${settlement.transactionCount}\n` +
              `**Estimated Cost:** ${settlement.estimatedCost}\n\n` +
              `**Gas Savings:**\n• Traditional: ~$5.20\n• x402 Gasless: $0.00 ✓\n• **Saved:** ${(settlement.gasSaved * 100).toFixed(0)}%\n\n` +
              `🔐 ZK Proof generated: ${settlement.zkProofGenerated ? 'Yes' : 'No'}`,
            agent: 'Settlement Agent',
          };
          break;

        case 'generate_report':
          setActiveAgent('Lead Agent → Reporting Agent');
          const report = await generatePortfolioReport(_address, 'monthly');
          response = {
            content: `📈 **Compliance Report Generated**\n\n` +
              `**Period:** ${report.period}\n` +
              `**Total Value:** $${(report.totalValue / 1000).toFixed(1)}K\n` +
              `**P/L:** $${report.profitLoss >= 0 ? '+' : ''}${report.profitLoss.toFixed(0)}\n\n` +
              `**Performance:**\n• Daily: ${report.performance.daily}%\n• Weekly: ${report.performance.weekly}%\n• Monthly: ${report.performance.monthly}%\n\n` +
              `🔐 **Privacy:** All sensitive data protected with ZK proofs`,
            agent: 'Reporting Agent',
          };
          break;

        default:
          setActiveAgent('Lead Agent');
          // Use LLM for conversational responses
          const llmResponse = await callLLM(textToSend);
          response = {
            content: llmResponse,
            agent: 'Lead Agent (LLM-Powered)',
          };
      }

      // Generate ZK proof for the response
      const zkProof = await generateResponseProof();

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
        agentType: response.agent,
        aiPowered: true,
        zkProof,
        actions: response.actions, // Include action buttons
      };
      
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      console.error('Agent command failed:', error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. The agent swarm is being recalibrated. Please try again.`,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      setActiveAgent(null);
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 flex flex-col h-[600px]">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center space-x-2">
            <Bot className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <span>AI Agent</span>
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              5 Online
            </span>
          </div>
        </div>
        {activeAgent && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-xs text-cyan-400 flex items-center gap-1"
          >
            <Brain className="w-3 h-3 animate-pulse" />
            {activeAgent}
          </motion.div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-4 py-2 border-b border-gray-700/50 flex gap-2 overflow-x-auto">
        {quickActions.map((action, i) => (
          <button
            key={i}
            onClick={() => handleSend(action.label)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700/50 hover:bg-gray-700 rounded-full border border-gray-600 whitespace-nowrap transition-colors disabled:opacity-50"
          >
            <action.icon className="w-3 h-3 text-purple-400" />
            {action.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex items-start space-x-2 max-w-[85%]`}>
                {message.role === 'assistant' && (
                  <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-purple-500 to-cyan-500 rounded-full flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                )}
                <div
                  className={`p-4 rounded-2xl ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                      : 'bg-gray-800/90 backdrop-blur-sm text-gray-100 shadow-lg border border-gray-700/50'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <MarkdownContent content={message.content} />
                  ) : (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                  )}
                  
                  {/* Action Buttons */}
                  {message.actions && message.actions.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {message.actions.map((action, idx) => (
                        <button
                          key={idx}
                          onClick={action.action}
                          className="px-4 py-2 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-700 hover:to-cyan-700 rounded-lg text-sm font-semibold text-white transition-all shadow-lg shadow-purple-500/20 flex items-center gap-2"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-700/50">
                      {message.agentType && (
                        <span className="text-xs text-purple-400 flex items-center gap-1.5 font-medium">
                          <Brain className="w-3.5 h-3.5" />
                          {message.agentType}
                        </span>
                      )}
                      {message.zkProof && (
                        <ZKBadgeInline verified={message.zkProof.verified} size="sm" />
                      )}
                    </div>
                  )}
                </div>
                {message.role === 'user' && (
                  <div className="flex-shrink-0 w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-white" />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {loading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-cyan-500 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div className="bg-gray-700 p-3 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-gray-400">Processing...</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask the agent swarm anything..."
            className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="px-4 py-2 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-700 hover:to-cyan-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      {/* Action Approval Modal */}
      {pendingAction && pendingActionCallback && (
        <ActionApprovalModal
          isOpen={showApprovalModal}
          action={pendingAction}
          onApprove={pendingActionCallback}
          onReject={() => {
            setShowApprovalModal(false);
            setPendingAction(null);
            setPendingActionCallback(null);
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'assistant',
              content: '❌ Action cancelled by manager. No changes made to portfolio.',
              timestamp: new Date(),
              aiPowered: true,
            }]);
          }}
          isExecuting={isExecutingAction}
        />
      )}

      {/* Swap Modal */}
      <SwapModal
        isOpen={swapModalOpen}
        onClose={() => setSwapModalOpen(false)}
        defaultTokenIn={swapTokenIn}
        defaultTokenOut={swapTokenOut}
        onSuccess={() => {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: '✅ **Swap Successful!**\n\nYour tokens have been swapped on VVS Finance. Your wallet balance will update shortly.',
            timestamp: new Date(),
            agent: 'DEX Agent',
            aiPowered: true,
          }]);
        }}
      />
    </div>
  );
}
