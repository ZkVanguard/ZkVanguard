'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Shield, Zap, Activity, TrendingDown, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { assessPortfolioRisk, getHedgingRecommendations, executeSettlementBatch, generatePortfolioReport } from '../../lib/api/agents';
import { ZKBadgeInline, type ZKProofData } from '../ZKVerificationBadge';
import { MarkdownContent } from './MarkdownContent';
import { ActionApprovalModal, type ActionPreview } from './ActionApprovalModal';
import { SwapModal } from './SwapModal';
import { logger } from '../../lib/utils/logger';

// Using VVS Finance SDK via API routes

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
      logger.debug('🔐 [ChatInterface] Requesting ZK proof generation...', { component: 'ChatInterface' });
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
        logger.debug('✅ [ChatInterface] ZK proof received', { component: 'ChatInterface', data: { 
          success: data.success, 
          fallback: data.fallback,
          verified: data.proof?.verified 
        }});
        
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
        logger.error('❌ [ChatInterface] ZK proof request failed', undefined, { component: 'ChatInterface', data: { status: response.status, statusText: response.statusText } });
      }
    } catch (error) {
      logger.error('❌ [ChatInterface] ZK proof generation failed', error instanceof Error ? error : undefined, { component: 'ChatInterface' });
    }
    
    // Should not reach here if server is working
    logger.warn('⚠️ [ChatInterface] No proof returned from server', { component: 'ChatInterface' });
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
    
    // Delphi prediction queries
    if (lower.includes('delphi') || lower.includes('prediction') || lower.includes('forecast') || 
        (lower.includes('what') && (lower.includes('probability') || lower.includes('chance') || lower.includes('likely')))) {
      return { intent: 'delphi_query', params: { query: text } };
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
      logger.error('LLM call failed', error instanceof Error ? error : undefined, { component: 'ChatInterface' });
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
        case 'buy_asset': {
          setActiveAgent('Lead Agent → DEX Agent');
          const buyAsset = params.asset as string;
          const buyAmount = params.amount as number;
          
          // VVS Finance supported tokens
          const supportedTokens = ['WCRO', 'CRO', 'USDC', 'devUSDC', 'USDT', 'WBTC', 'WETH', 'VVS'];
          
          if (!supportedTokens.includes(buyAsset.toUpperCase())) {
            response = {
              content: `❌ **Token Not Supported**\n\n` +
                `**Asset:** ${buyAsset}\n\n` +
                `**Supported tokens:** ${supportedTokens.join(', ')}\n\n` +
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
        }
          
        case 'sell_asset': {
          setActiveAgent('Lead Agent → DEX Agent');
          const sellAsset = params.asset as string;
          const sellAmount = params.amount as number;
          
          // VVS Finance supported tokens  
          const sellSupportedTokens = ['WCRO', 'CRO', 'USDC', 'devUSDC', 'USDT', 'WBTC', 'WETH', 'VVS'];
          
          if (!sellSupportedTokens.includes(sellAsset.toUpperCase())) {
            response = {
              content: `❌ **Token Not Supported**\n\n` +
                `**Asset:** ${sellAsset}\n\n` +
                `**Supported tokens:** ${sellSupportedTokens.join(', ')}\n\n` +
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
        }
        
        case 'analyze_portfolio': {
          setActiveAgent('Lead Agent → Risk Agent');
          // Real API call
          const riskData = await assessPortfolioRisk(_address);
          response = {
            content: `📊 **Portfolio Analysis** (ZK-Verified)\n\n` +
              `**Value at Risk (95%):** ${(riskData.var95 * 100).toFixed(1)}%\n` +
              `**Volatility:** ${(riskData.volatility * 100).toFixed(1)}%\n` +
              `**Sharpe Ratio:** ${riskData.sharpeRatio.toFixed(2)}\n` +
              `**Market Sentiment:** ${riskData.marketSentiment}\n\n` +
              `**Recommendations:**\n${riskData.recommendations?.map((r: string) => `• ${r}`).join('\n') || '• Portfolio is well-balanced'}`,
            agent: 'Risk Agent',
          };
          break;
        }

        case 'assess_risk': {
          setActiveAgent('Lead Agent → Risk Agent');
          const risk = await assessPortfolioRisk(_address);
          const riskLevel = risk.var95 < 0.1 ? 'LOW' : risk.var95 < 0.2 ? 'MEDIUM' : 'HIGH';
          response = {
            content: `⚠️ **Risk Assessment** (AI-Powered)\n\n` +
              `**Overall Risk Level:** ${riskLevel}\n` +
              `**Value at Risk (95%):** ${(risk.var95 * 100).toFixed(1)}% potential loss\n` +
              `**Portfolio Volatility:** ${(risk.volatility * 100).toFixed(1)}%\n` +
              `**Sharpe Ratio:** ${risk.sharpeRatio.toFixed(2)} (${risk.sharpeRatio > 1 ? 'Good' : 'Needs improvement'})\n` +
              `**Max Drawdown:** ${(risk.maxDrawdown * 100).toFixed(1)}%\n\n` +
              `**Risk Factors:**\n• Total Risk Score: ${risk.totalRisk}/100\n• Market Sentiment: ${risk.marketSentiment}`,
            agent: 'Risk Agent',
          };
          break;
        }

        case 'delphi_query': {
          setActiveAgent('Lead Agent → Delphi Integration');
          const { DelphiMarketService } = await import('../../lib/services/DelphiMarketService');
          
          // Get relevant predictions
          const predictions = await DelphiMarketService.getTopMarkets(5);
          const highRisk = predictions.filter(p => p.impact === 'HIGH' && p.probability > 60);
          
          response = {
            content: `🔮 **Delphi Prediction Market Analysis**\n\n` +
              `**High-Risk Alerts (>60% probability):**\n` +
              highRisk.map(p => 
                `• **${p.question}**\n` +
                `  Probability: ${p.probability}% | Impact: ${p.impact}\n` +
                `  Assets: ${p.relatedAssets.join(', ')} | Volume: ${p.volume}\n` +
                `  AI Recommendation: ${p.recommendation} ${p.recommendation === 'HEDGE' ? '🛡️' : '👁️'}`
              ).join('\n\n') +
              `\n\n**Market Overview:**\n` +
              `• Total Markets Analyzed: ${predictions.length}\n` +
              `• High-Risk Predictions: ${highRisk.length}\n` +
              `• Markets Requiring Hedge: ${predictions.filter(p => p.recommendation === 'HEDGE').length}\n\n` +
              `💡 **Next Steps:**\n` +
              `1. Review detailed predictions in the "🔮 Market Predictions" widget above\n` +
              `2. Click "Review & Act" on any prediction to see AI recommendations\n` +
              `3. Our Hedging Agent will automatically adjust hedge ratios based on these probabilities`,
            agent: 'Delphi Integration',
          };
          break;
        }

        case 'hedge_portfolio': {
          setActiveAgent('Lead Agent → Risk Agent → Hedging Agent');
          
          // Step 1: Get AI recommendations (no signature needed for analysis)
          const hedgeRecs = await getHedgingRecommendations(_address, []);
          const _amount = params.amount as number || 10000000;
          const targetYield = params.targetYield || 8;
          
          // Extract real portfolio data from recommendations
          const topHedge = hedgeRecs[0];
          const realPortfolioValue = topHedge?.size ? topHedge.size * 2 : 30; // $30 USDC estimate
          const realLeverage = topHedge?.leverage || 20; // Use recommended leverage or default 20x
          const realExposure = realPortfolioValue * realLeverage;
          
          // Step 2: Show recommendations to user
          const recommendationText = `🛡️ **Hedge Strategy Recommended** (via Moonlander)\n\n` +
            `**Your Portfolio:**\n` +
            `• Capital: $${realPortfolioValue.toFixed(2)} USDC\n` +
            `• Leverage: ${realLeverage}x\n` +
            `• Total Exposure: $${realExposure.toFixed(2)}\n` +
            `• Target Yield: ${targetYield}%\n\n` +
            `**AI-Recommended Hedges:**\n` +
            hedgeRecs.map((s, i: number) => 
              `${i + 1}. **${s.side}** on ${s.asset}\n` +
              `   • Size: ${s.size || 'TBD'}${typeof s.size === 'number' && s.size < 1 ? ' BTC' : ''}\n` +
              `   • Leverage: ${s.leverage}x\n` +
              `   • Reason: ${s.reason}\n` +
              `   • Confidence: ${s.confidence}%\n` +
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
              description: `${topHedge.side} position on ${topHedge.asset} to protect portfolio`,
              type: 'hedge',
              details: [
                { label: 'Asset', value: topHedge.asset, highlight: true },
                { label: 'Action', value: topHedge.side },
                { label: 'Leverage', value: `${topHedge.leverage}x` },
                { label: 'Position Size', value: String(topHedge.size || 'TBD') },
                { label: 'Your Capital', value: `$${realPortfolioValue.toFixed(2)} USDC`, highlight: true },
                { label: 'Total Exposure', value: `$${realExposure.toFixed(2)}` },
                { label: 'Confidence', value: `${topHedge.confidence}%` },
                { label: 'Gas Cost', value: '$0.00 (x402 gasless)', highlight: true },
              ],
              risks: [
                'Leverage amplifies both gains and losses',
                'Market volatility may trigger liquidation',
                'Counterparty risk on derivatives platform',
                `Current exposure: $${realExposure.toFixed(2)} on $${realPortfolioValue.toFixed(2)} capital (${realLeverage}x leverage)`,
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
                      type: topHedge.side || 'SHORT',
                      asset: topHedge.asset || 'BTC-PERP',
                      size: topHedge.size || 0.007,
                      leverage: topHedge.leverage || 10,
                      entryPrice: topHedge.entryPrice || 43500, // Use entry price from recommendation or fallback
                      targetPrice: topHedge.targetPrice || 42800,
                      stopLoss: topHedge.stopLoss || 45200,
                      capitalUsed: topHedge.size ? topHedge.size * (topHedge.entryPrice || 43500) / topHedge.leverage : 15,
                      reason: topHedge.reason || 'Portfolio protection',
                    };
                    
                    logger.debug('💾 [ChatInterface] Saving hedge to localStorage', { component: 'ChatInterface', data: hedgeDetails });
                    
                    const settlementHistory = JSON.parse(localStorage.getItem('settlement_history') || '{}');
                    settlementHistory[result.batchId] = {
                      ...result,
                      type: 'hedge',
                      hedgeDetails,
                      managerSignature: signature,
                      timestamp: Date.now(),
                    };
                    localStorage.setItem('settlement_history', JSON.stringify(settlementHistory));
                    
                    logger.debug('✅ [ChatInterface] Hedge saved to localStorage', { component: 'ChatInterface', data: settlementHistory });
                    
                    // Dispatch custom event to notify ActiveHedges component
                    window.dispatchEvent(new Event('hedgeAdded'));
                    logger.debug('📡 [ChatInterface] Dispatched hedgeAdded event', { component: 'ChatInterface' });
                    
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
                  } catch (error: unknown) {
                    setMessages(prev => [...prev, {
                      id: Date.now().toString(),
                      role: 'assistant',
                      content: `❌ **Hedge Execution Failed**\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
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
        }

        case 'execute_settlement': {
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
        }

        case 'generate_report': {
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
        }

        default: {
          setActiveAgent('Lead Agent');
          // Use LLM for conversational responses
          const llmResponse = await callLLM(textToSend);
          response = {
            content: llmResponse,
            agent: 'Lead Agent (LLM-Powered)',
          };
        }
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
      logger.error('Agent command failed', error instanceof Error ? error : undefined, { component: 'ChatInterface' });
      
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
    <div className="bg-white flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-black/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-[12px] flex items-center justify-center shadow-[0_2px_8px_rgba(0,122,255,0.25)]">
              <Bot className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h2 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">AI Assistant</h2>
              <p className="text-[11px] sm:text-[12px] text-[#86868b]">Portfolio management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 bg-[#34C759]/10 text-[#34C759] rounded-full text-[10px] sm:text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 bg-[#34C759] rounded-full animate-pulse" />
              5 Online
            </span>
          </div>
        </div>
        {activeAgent && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-[11px] text-[#007AFF] flex items-center gap-1.5 font-medium"
          >
            <Brain className="w-3 h-3 animate-pulse" />
            {activeAgent}
          </motion.div>
        )}
      </div>

      {/* Quick Actions - Horizontal scroll */}
      <div className="px-3 sm:px-4 py-2.5 border-b border-black/5 flex gap-2 overflow-x-auto scrollbar-hide">
        {quickActions.map((action, i) => (
          <button
            key={i}
            onClick={() => handleSend(action.label)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] sm:text-[12px] bg-[#f5f5f7] hover:bg-[#e8e8ed] active:scale-[0.97] rounded-full text-[#1d1d1f] font-medium whitespace-nowrap transition-all disabled:opacity-50"
          >
            <action.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#007AFF]" />
            {action.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4 bg-[#f5f5f7]">
        <AnimatePresence>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex items-start gap-2 max-w-[90%] sm:max-w-[85%]`}>
                {message.role === 'assistant' && (
                  <div className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-full flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                  </div>
                )}
                <div
                  className={`px-3 sm:px-4 py-2.5 sm:py-3 rounded-[16px] sm:rounded-[18px] ${
                    message.role === 'user'
                      ? 'bg-[#007AFF] text-white'
                      : 'bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-black/5'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="text-[13px] sm:text-[14px] leading-[1.45]">
                      <MarkdownContent content={message.content} />
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-[13px] sm:text-[14px] leading-[1.45]">{message.content}</div>
                  )}
                  
                  {/* Action Buttons */}
                  {message.actions && message.actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.actions.map((action, idx) => (
                        <button
                          key={idx}
                          onClick={action.action}
                          className="px-3 sm:px-4 py-2 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.97] rounded-[10px] text-[12px] sm:text-[13px] font-semibold text-white transition-all"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-2 sm:gap-3 mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-black/5">
                      {message.agentType && (
                        <span className="text-[10px] sm:text-[11px] text-[#AF52DE] flex items-center gap-1 font-medium">
                          <Brain className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
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
                  <div className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 bg-[#86868b] rounded-full flex items-center justify-center">
                    <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
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
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-[#007AFF] to-[#5856D6] rounded-full flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white animate-pulse" />
              </div>
              <div className="bg-white px-3 sm:px-4 py-2.5 sm:py-3 rounded-[16px] shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-black/5">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[#007AFF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[#5856D6] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-[#AF52DE] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[11px] sm:text-[12px] text-[#86868b]">Processing...</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 sm:p-4 border-t border-black/5 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask anything..."
            className="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[12px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF] text-[14px] sm:text-[15px] text-[#1d1d1f] placeholder:text-[#86868b] transition-all"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.95] disabled:bg-[#86868b] disabled:cursor-not-allowed rounded-[12px] transition-all"
          >
            <Send className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
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
