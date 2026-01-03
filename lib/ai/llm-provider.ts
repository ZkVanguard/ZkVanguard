
/**
 * Advanced LLM Provider for Chronos Vanguard
 * Integrates Crypto.com AI SDK with streaming, context management, and RAG capabilities
 */

import { logger } from '../utils/logger';
import { 
  executePortfolioAction, 
  getPortfolioData, 
  parseActionIntent,
  formatActionResult,
  type PortfolioAction 
} from '../services/portfolio-actions';
import { generatePrivateHedges, getHedgeSummary } from '../services/zk-hedge-service';

// Message types for conversation
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
  confidence?: number;
  sources?: string[];
  actionExecuted?: boolean;
  actionResult?: any;
  zkProof?: any; // ZK proof data if action was executed
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

// Context about Chronos Vanguard platform
const SYSTEM_CONTEXT = `You are an advanced AI assistant for Chronos Vanguard, a Web3 platform for institutional RWA (Real World Assets) risk management on Cronos zkEVM.

**Platform Capabilities:**
- Multi-agent AI swarm orchestration for portfolio management
- Real-time risk assessment (VaR, volatility, Sharpe ratio)
- Automated hedging strategies via Moonlander integration
- Gasless transactions using x402 protocol (zero CRO gas fees)
- Zero-knowledge proofs for privacy-preserving verification
- Real market data integration
- Compliance reporting and audit trails

**Your Role:**
- Provide intelligent, context-aware responses about DeFi, RWA, and portfolio management
- Help users understand risk metrics and investment strategies
- Guide users through platform features
- Explain complex financial concepts clearly
- Assist with hedging decisions and portfolio optimization
- Answer questions about blockchain, ZK proofs, and Cronos ecosystem

Be conversational, helpful, and technically accurate. When discussing financial strategies, always emphasize risk considerations.`;

class LLMProvider {
  private aiClient: any = null;
  private conversationHistory: Map<string, ChatMessage[]> = new Map();
  private maxHistoryLength = 20;

  constructor() {
    this.initializeClient();
  }

  private async initializeClient() {
    try {
      // Try to load Crypto.com AI SDK
      const apiKey = process.env.CRYPTOCOM_DEVELOPER_API_KEY || 
                     process.env.NEXT_PUBLIC_CRYPTOCOM_DEVELOPER_API_KEY ||
                     process.env.CRYPTOCOM_AI_API_KEY;

      if (!apiKey) {
        logger.warn('No Crypto.com AI API key found, using fallback LLM');
        return;
      }

      // Dynamic import for Crypto.com AI Agent SDK
      const module = await import('@crypto.com/ai-agent-client').catch(() => null);
      
      if (module && module.createClient) {
        this.aiClient = module.createClient({
          apiKey: apiKey,
        } as any);
        logger.info('Crypto.com AI Agent SDK initialized for LLM');
      }
    } catch (error) {
      logger.warn('Failed to initialize Crypto.com AI SDK, using fallback', { error: String(error) });
    }
  }

  /**
   * Check if real AI is available
   */
  isAvailable(): boolean {
    return this.aiClient !== null;
  }

  /**
   * Generate a conversational response with full context
   */
  async generateResponse(
    userMessage: string,
    conversationId: string = 'default',
    context?: Record<string, any>
  ): Promise<LLMResponse> {
    try {
      // Get or initialize conversation history
      let history = this.conversationHistory.get(conversationId) || [];
      
      // Add system context if this is a new conversation
      if (history.length === 0) {
        history.push({
          role: 'system',
          content: SYSTEM_CONTEXT,
          timestamp: Date.now(),
        });
      }

      // SMART FEATURE: Fetch real portfolio data for context-aware responses
      let portfolioContext = '';
      try {
        const portfolioData = await getPortfolioData();
        if (portfolioData && portfolioData.portfolio) {
          const p = portfolioData.portfolio;
          portfolioContext = `\n\nCurrent Portfolio:\n` +
            `• Total Value: $${p.totalValue?.toFixed(2) || 'N/A'}\n` +
            `• Cash: $${p.cash?.toFixed(2) || 'N/A'}\n` +
            `• Positions: ${p.positions?.length || 0}\n` +
            `• Total P/L: $${p.totalPnl?.toFixed(2) || 'N/A'} (${p.totalPnlPercentage?.toFixed(2) || 'N/A'}%)`;
          
          if (p.positions && p.positions.length > 0) {
            portfolioContext += '\n• Holdings: ' + p.positions.map((pos: any) => 
              `${pos.symbol} ($${pos.value?.toFixed(2)}, ${pos.pnlPercentage?.toFixed(1)}%)`
            ).join(', ');
          }
        }
      } catch (error) {
        logger.warn('Could not fetch portfolio data for context');
      }

      // SMART FEATURE: Detect if user wants to execute an action
      const actionIntent = parseActionIntent(userMessage);
      let actionResult = null;
      let actionExecuted = false;

      if (actionIntent) {
        // Execute the action
        actionResult = await executePortfolioAction(actionIntent);
        actionExecuted = true;
        
        // Add action result to context
        const formattedResult = formatActionResult(actionIntent, actionResult);
        
        // Return the action result directly with ZK proof
        history.push({
          role: 'user',
          content: userMessage,
          timestamp: Date.now(),
        });

        history.push({
          role: 'assistant',
          content: formattedResult,
          timestamp: Date.now(),
          metadata: { 
            actionExecuted: true, 
            action: actionIntent.type,
            zkProof: actionResult.zkProof, // Include ZK proof in metadata
          },
        });

        this.conversationHistory.set(conversationId, history);

        return {
          content: formattedResult,
          model: 'action-executor',
          confidence: 1.0,
          actionExecuted: true,
          actionResult: actionResult.data,
          zkProof: actionResult.zkProof, // Return ZK proof in response
        };
      }

      // Add user message to history with portfolio context
      const enrichedMessage = userMessage + portfolioContext;
      history.push({
        role: 'user',
        content: enrichedMessage,
        timestamp: Date.now(),
      });

      // Trim history if too long (keep system message + recent messages)
      if (history.length > this.maxHistoryLength) {
        history = [
          history[0], // Keep system message
          ...history.slice(-(this.maxHistoryLength - 1))
        ];
      }

      let response: LLMResponse;

      if (this.aiClient) {
        // Use real Crypto.com AI
        response = await this.generateWithCryptocomAI(history, context);
      } else {
        // Use intelligent fallback
        response = await this.generateFallbackResponse(userMessage, context, portfolioContext);
      }

      // Add assistant response to history
      history.push({
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        metadata: { model: response.model, confidence: response.confidence },
      });

      // Save updated history
      this.conversationHistory.set(conversationId, history);

      return response;
    } catch (error) {
      logger.error('Error generating LLM response:', error);
      return {
        content: "I apologize, but I encountered an error processing your request. Please try rephrasing or contact support if the issue persists.",
        confidence: 0,
      };
    }
  }

  /**
   * Generate response using Crypto.com AI SDK
   */
  private async generateWithCryptocomAI(
    history: ChatMessage[],
    context?: Record<string, any>
  ): Promise<LLMResponse> {
    try {
      // Format messages for the AI
      const messages = history.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add context if provided
      if (context) {
        const contextStr = Object.entries(context)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        messages[messages.length - 1].content += `\n\nContext:\n${contextStr}`;
      }

      // Call Crypto.com AI
      const result = await this.aiClient.chat.completions.create({
        model: 'gpt-4',
        messages,
        temperature: 0.7,
        max_tokens: 800,
      });

      return {
        content: result.choices[0].message.content,
        tokensUsed: result.usage?.total_tokens,
        model: 'gpt-4-via-cryptocom',
        confidence: 0.9,
      };
    } catch (error) {
      logger.error('Crypto.com AI call failed:', error);
      // Fall back to intelligent response
      return this.generateFallbackResponse(
        history[history.length - 1].content,
        context
      );
    }
  }

  /**
   * Generate intelligent fallback response using pattern matching and templates
   */
  private async generateFallbackResponse(
    userMessage: string,
    context?: Record<string, any>,
    portfolioContext?: string
  ): Promise<LLMResponse> {
    const lower = userMessage.toLowerCase();

    // Portfolio customization and trading
    if (lower.match(/buy|purchase|get|add.*position/)) {
      return {
        content: `I can help you buy assets! 💰\n\nTo execute a trade, use this format:\n**"Buy [amount] [SYMBOL]"**\n\nFor example:\n• "Buy 100 CRO"\n• "Buy 50 USDC"\n• "Purchase 0.001 BTC"\n\n${portfolioContext || ''}\n\n💡 **Tip**: I'll automatically execute the trade and update your portfolio using real market prices!`,
        model: 'rule-based-fallback',
        confidence: 0.9,
      };
    }

    if (lower.match(/sell|liquidate|close.*position/)) {
      return {
        content: `I can help you sell assets! 📉\n\nTo execute a sale, use this format:\n**"Sell [amount] [SYMBOL]"**\n\nFor example:\n• "Sell 50 CRO"\n• "Liquidate all USDC"\n• "Sell 0.001 BTC"\n\n${portfolioContext || ''}\n\n💡 **Tip**: I'll execute the sale at current market price and show you the P/L!`,
        model: 'rule-based-fallback',
        confidence: 0.9,
      };
    }

    if (lower.match(/rebalance|optimize|adjust allocation/)) {
      return {
        content: `Let's optimize your portfolio! ⚖️\n\n**Rebalancing Options:**\n• Target allocations (e.g., "60% CRO, 40% USDC")\n• Risk-based rebalancing\n• Automated portfolio optimization\n\n${portfolioContext || ''}\n\n**Current Portfolio Analysis:**\nI can analyze your positions and suggest optimal rebalancing based on:\n✓ Risk tolerance\n✓ Market conditions\n✓ Diversification goals\n✓ Gas-efficient execution\n\nWould you like me to analyze your portfolio and suggest a rebalancing strategy?`,
        model: 'rule-based-fallback',
        confidence: 0.85,
      };
    }

    // Portfolio Analysis
    if (lower.includes('portfolio') && (lower.includes('analyz') || lower.includes('overview') || lower.includes('show'))) {
      return {
        content: `I can analyze your portfolio comprehensively! 📊\n\n${portfolioContext || ''}\n\n**Analysis Includes:**\n• Asset distribution and allocation\n• Risk scores (VaR, volatility, Sharpe ratio)\n• Performance metrics and P/L\n• Concentration risks\n• Diversification assessment\n• AI-powered recommendations\n\n**To get a full analysis, just say:**\n"Analyze my portfolio" or "Show portfolio analysis"\n\nI'll use real market data and AI agents to provide detailed insights with ZK-verified results!`,
        model: 'rule-based-fallback',
        confidence: 0.8,
      };
    }

    // Risk Assessment
    if (lower.includes('risk') || lower.includes('var') || lower.includes('volatility')) {
      return {
        content: `Risk assessment is one of my core capabilities! 📈\n\n**I can evaluate:**\n• **Value at Risk (VaR)**: Maximum potential loss at 95% confidence\n• **Volatility**: Price fluctuation measurement\n• **Sharpe Ratio**: Risk-adjusted returns\n• **Correlation**: How assets move together\n• **Liquidation Risk**: Margin call probabilities\n\nThe AI agents will analyze your positions using real market data and provide actionable insights. Want me to assess your current risk level?`,
        model: 'rule-based-fallback',
        confidence: 0.85,
      };
    }

    // Hedging
    if (lower.includes('hedge') || lower.includes('protect') || lower.includes('insurance')) {
      // Generate ZK-protected hedges
      let hedgeInfo = '';
      try {
        const portfolioData = await getPortfolioData();
        const portfolioValue = portfolioData?.portfolio?.totalValue || 10000;
        const riskScore = 0.65; // Could be fetched from risk assessment
        
        const privateHedges = await generatePrivateHedges(portfolioValue, riskScore);
        hedgeInfo = '\n\n' + getHedgeSummary(privateHedges);
      } catch (error) {
        logger.warn('Could not generate private hedges', { error: String(error) });
      }

      return {
        content: `I'll protect your portfolio with ZK-private hedging strategies! 🛡️\n\n` +
          `**Privacy-First Hedging:**\n` +
          `• Strategy details are NEVER disclosed\n` +
          `• Only effectiveness and cost are public\n` +
          `• Each hedge has a ZK-STARK proof\n` +
          `• Execution verified without revealing trades\n\n` +
          `**Available Hedge Types:**\n` +
          `• Short positions (high effectiveness)\n` +
          `• Put options (downside protection)\n` +
          `• Stablecoin allocation (safe haven)\n` +
          `• Cross-asset hedges (correlation protection)\n\n` +
          `**Privacy Benefits:**\n` +
          `✓ No front-running risk\n` +
          `✓ Strategy details remain confidential\n` +
          `✓ Cryptographic proof of execution\n` +
          `✓ Institutional-grade security\n` +
          (hedgeInfo || '\n\nSay "Generate private hedges" to create ZK-protected strategies for your portfolio.'),
        model: 'rule-based-fallback',
        confidence: 0.9,
      };
    }

    // ZK Proofs
    if (lower.includes('zk') || lower.includes('zero knowledge') || lower.includes('proof') || lower.includes('privacy')) {
      return {
        content: `Great question about ZK (Zero-Knowledge) proofs! 🔐\n\n**What are ZK Proofs?**\nThey let you prove something is true without revealing the underlying data. Think of it as proving you know a password without showing it.\n\n**On Chronos Vanguard:**\n• All AI agent responses are ZK-verified\n• Your portfolio data stays private\n• Compliance reports prove accuracy without exposing details\n• Cryptographic security (521-bit security level)\n\n**Real Benefits:**\n✓ Institutional-grade privacy\n✓ Regulatory compliance\n✓ Trustless verification\n✓ Protection from data breaches\n\nEvery major action generates a ZK-STARK proof that you can verify independently. Want to see a demo?`,
        model: 'rule-based-fallback',
        confidence: 0.9,
      };
    }

    // x402 Gasless
    if (lower.includes('x402') || lower.includes('gasless') || lower.includes('gas fee') || lower.includes('free transaction')) {
      return {
        content: `x402 is a game-changer for institutional users! ⚡\n\n**What is x402?**\nA gasless transaction protocol that lets you execute settlements without paying CRO gas fees.\n\n**How it Works:**\n1. You submit a transaction request\n2. x402 relay network processes it\n3. Sponsor covers the gas fees\n4. You pay $0.00 in CRO\n\n**Real Savings:**\n• Traditional settlement: ~$5.20 per tx\n• With x402: $0.00 ✓\n• Savings: 100%\n\n**Perfect for:**\n• Batch settlements\n• High-frequency operations\n• Multi-agent coordination\n• Institutional workflows\n\nWant to try a gasless settlement now?`,
        model: 'rule-based-fallback',
        confidence: 0.85,
      };
    }

    // General agent/platform questions
    if (lower.includes('agent') || lower.includes('how') || lower.includes('what can you')) {
      return {
        content: `I'm your AI-powered assistant orchestrating 5 specialized agents! 🤖\n\n**What I Can Do:**\n\n🎯 **Lead Agent (me!)**: Coordinate all other agents and provide conversational assistance\n\n📊 **Risk Agent**: Analyze portfolios, calculate VaR, assess volatility\n\n🛡️ **Hedging Agent**: Generate protection strategies via Moonlander\n\n⚡ **Settlement Agent**: Execute gasless transactions with x402\n\n📈 **Reporting Agent**: Generate compliance reports with ZK proofs\n\n**Smart Features:**\n• Natural language understanding\n• Real-time market data integration\n• Multi-step workflow automation\n• Privacy-preserving computation\n• Institutional-grade security\n\nTry asking me something like:\n• "Analyze my portfolio"\n• "What's my risk level?"\n• "Hedge $5M against market crash"\n• "Execute a gasless settlement"`,
        model: 'rule-based-fallback',
        confidence: 0.75,
      };
    }

    // Default response
    return {
      content: `I'm here to help with your DeFi portfolio management! 💼\n\nI can assist you with:\n• Portfolio analysis and risk assessment\n• Hedge strategy generation\n• Gasless transaction execution\n• Compliance reporting\n• Understanding Web3 concepts\n\nCould you rephrase your question or try one of these:\n• "Show me my portfolio risk"\n• "How does x402 gasless work?"\n• "Generate a hedge strategy"\n• "What are ZK proofs?"\n\nOr click a quick action button above to get started!`,
      model: 'rule-based-fallback',
      confidence: 0.5,
    };
  }

  /**
   * Stream response token by token (for better UX)
   */
  async* streamResponse(
    userMessage: string,
    conversationId: string = 'default',
    context?: Record<string, any>
  ): AsyncGenerator<StreamChunk> {
    // For now, generate full response and stream it
    // In production, this would use proper streaming APIs
    const response = await this.generateResponse(userMessage, conversationId, context);
    
    const words = response.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      yield {
        delta: words[i] + (i < words.length - 1 ? ' ' : ''),
        done: i === words.length - 1,
      };
      // Simulate streaming delay
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory(conversationId: string = 'default'): void {
    this.conversationHistory.delete(conversationId);
  }

  /**
   * Get conversation history
   */
  getHistory(conversationId: string = 'default'): ChatMessage[] {
    return this.conversationHistory.get(conversationId) || [];
  }
}

// Export singleton instance
export const llmProvider = new LLMProvider();
