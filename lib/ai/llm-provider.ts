
/**
 * Advanced LLM Provider for ZkVanguard
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

// Context about ZkVanguard platform
const SYSTEM_CONTEXT = `You are an advanced AI assistant for ZkVanguard, a Web3 platform for institutional RWA (Real World Assets) risk management on Cronos zkEVM.

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
  private openAIClient: any = null;
  private anthropicClient: any = null;
  private asiApiKey: string | null = null;
  private asiApiUrl: string = 'https://api.asi1.ai/v1';
  private asiAvailable: boolean = false;
  private ollamaAvailable: boolean = false;
  private ollamaBaseUrl: string = 'http://localhost:11434';
  private activeProvider: string = 'none';
  private conversationHistory: Map<string, ChatMessage[]> = new Map();
  private maxHistoryLength = 20;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initializeClient();
  }

  private async initializeClient() {
    try {
      // Configuration
      const cryptocomKey = process.env.CRYPTOCOM_DEVELOPER_API_KEY || 
                           process.env.NEXT_PUBLIC_CRYPTOCOM_DEVELOPER_API_KEY ||
                           process.env.CRYPTOCOM_AI_API_KEY;
      
      const openaiKey = process.env.OPENAI_API_KEY ||
                        process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      
      const anthropicKey = process.env.ANTHROPIC_API_KEY ||
                           process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
      
      // ASI API key for production AI (Fetch.ai's ASI:One platform)
      const asiApiKey = (process.env.ASI_API_KEY ||
                        process.env.NEXT_PUBLIC_ASI_API_KEY ||
                        process.env.ASI_ONE_API_KEY || '').trim() || null;
      
      this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      this.asiApiKey = asiApiKey;

      // PRIORITY 1: Crypto.com AI Agent SDK + Ollama (HACKATHON + LOCAL AI)
      // The Crypto.com SDK uses OpenAI-compatible API, and Ollama provides one at /v1
      // This gives us: Crypto.com ecosystem tools + Ollama/Qwen AI (FREE, LOCAL, CUDA)
      const ollamaOpenAIUrl = `${this.ollamaBaseUrl}/v1`;
      const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
      
      // First check if Ollama is running
      let ollamaRunning = false;
      try {
        const ollamaCheck = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);
        
        if (ollamaCheck && ollamaCheck.ok) {
          const models = await ollamaCheck.json();
          if (models.models && models.models.length > 0) {
            ollamaRunning = true;
            logger.info('✅ Ollama detected with models:', models.models.map((m: any) => m.name).join(', '));
          }
        }
      } catch (e) {
        logger.warn('Ollama check failed');
      }

      // Try Crypto.com SDK with Ollama as backend
      if (cryptocomKey && ollamaRunning) {
        try {
          // Use Function constructor to avoid Next.js static analysis
          const dynamicImport = new Function('modulePath', 'return import(modulePath)');
          const module = await dynamicImport('@crypto.com/ai-agent-client').catch(() => null);
          
          if (module && module.createClient) {
            // Configure Crypto.com SDK to use Ollama's OpenAI-compatible endpoint
            const client = module.createClient({
              openAI: {
                apiKey: 'ollama-local', // Ollama doesn't need real key
                model: ollamaModel,
                baseURL: ollamaOpenAIUrl, // Point to Ollama's OpenAI-compatible API
              },
              chainId: 240, // Cronos zkEVM Testnet
            } as any);
            
            if (client) {
              this.aiClient = client;
              this.ollamaAvailable = true; // Mark Ollama as available too
              this.activeProvider = 'cryptocom-ollama';
              logger.info('✅ Crypto.com AI SDK + Ollama/Qwen initialized - HACKATHON + LOCAL AI');
              logger.info(`   Using model: ${ollamaModel} via Ollama OpenAI-compatible API`);
              return;
            }
          }
        } catch (sdkError) {
          logger.warn('Crypto.com AI SDK + Ollama integration failed - trying alternatives');
        }
      }

      // PRIORITY 1A.5: Crypto.com AI SDK with ASI API (if Ollama not available but ASI is)
      if (cryptocomKey && this.asiApiKey) {
        try {
          const dynamicImport = new Function('modulePath', 'return import(modulePath)');
          const module = await dynamicImport('@crypto.com/ai-agent-client').catch(() => null);
          
          if (module && module.createClient) {
            // Configure Crypto.com SDK to use ASI API's OpenAI-compatible endpoint
            const client = module.createClient({
              openAI: {
                apiKey: this.asiApiKey,
                model: process.env.ASI_MODEL || 'asi1-mini',
                baseURL: this.asiApiUrl, // ASI API is OpenAI-compatible
              },
              chainId: 240, // Cronos zkEVM Testnet
            } as any);
            
            if (client) {
              this.aiClient = client;
              this.asiAvailable = true; // Mark ASI as available too
              this.activeProvider = 'cryptocom-asi';
              logger.info('✅ Crypto.com AI SDK + ASI API initialized - HACKATHON + PRODUCTION AI');
              logger.info(`   Using ASI model: ${process.env.ASI_MODEL || 'asi1-mini'} via ASI:One API`);
              return;
            }
          }
        } catch (sdkError) {
          logger.warn('Crypto.com AI SDK + ASI integration failed - trying alternatives');
        }
      }

      // PRIORITY 1B: Crypto.com AI SDK with OpenAI (if Ollama not available)
      if (cryptocomKey && openaiKey) {
        try {
          const dynamicImport = new Function('modulePath', 'return import(modulePath)');
          const module = await dynamicImport('@crypto.com/ai-agent-client').catch(() => null);
          
          if (module && module.createClient) {
            const client = module.createClient({
              openAI: {
                apiKey: openaiKey,
                model: 'gpt-4o',
              },
              chainId: 240, // Cronos zkEVM Testnet
            } as any);
            
            if (client) {
              this.aiClient = client;
              this.activeProvider = 'cryptocom-openai';
              logger.info('✅ Crypto.com AI SDK + OpenAI initialized - HACKATHON MODE');
              return;
            }
          }
        } catch (sdkError) {
          logger.warn('Crypto.com AI SDK + OpenAI failed - trying alternatives');
        }
      }

      // PRIORITY 2: Ollama standalone (if Crypto.com SDK not available)
      if (ollamaRunning) {
        this.ollamaAvailable = true;
        this.activeProvider = 'ollama';
        logger.info('✅ Using Ollama/Qwen standalone as AI provider');
        return;
      }
      
      // Check Ollama again if we didn't check before
      if (!ollamaRunning) {
        try {
          const ollamaCheck = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000),
          }).catch(() => null);
          
          if (ollamaCheck && ollamaCheck.ok) {
            const models = await ollamaCheck.json();
            if (models.models && models.models.length > 0) {
              this.ollamaAvailable = true;
              this.activeProvider = 'ollama';
              logger.info('✅ Ollama detected:', models.models.map((m: any) => m.name).join(', '));
              return;
            }
          }
        } catch (ollamaError) {
          logger.warn('Ollama not available');
        }
      }

      // Priority 2.5: ASI API (Fetch.ai's ASI:One - Production AI when Ollama unavailable)
      if (this.asiApiKey) {
        try {
          // Test ASI API connectivity
          const testResponse = await fetch(`${this.asiApiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.asiApiKey}`,
            },
            body: JSON.stringify({
              model: 'asi1-mini',
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 5,
            }),
            signal: AbortSignal.timeout(10000),
          });
          
          if (testResponse.ok) {
            this.asiAvailable = true;
            this.activeProvider = 'asi';
            logger.info('✅ ASI API (Fetch.ai ASI:One) initialized - PRODUCTION AI ENABLED');
            logger.info('   Using model: asi1-mini for balanced performance');
            return;
          } else {
            const errorData = await testResponse.json().catch(() => ({}));
            logger.warn(`ASI API test failed: ${testResponse.status} ${JSON.stringify(errorData)}`);
          }
        } catch (asiError) {
          logger.warn(`ASI API not available: ${String(asiError)}`);
        }
      }

      // Priority 3: OpenAI (enterprise-grade, scalable)
      if (openaiKey) {
        try {
          // Use Function constructor to avoid Next.js static analysis
          const dynamicImport = new Function('modulePath', 'return import(modulePath)');
          const openaiModule = await dynamicImport('openai').catch(() => null);
          if (openaiModule && openaiModule.default) {
            this.openAIClient = new openaiModule.default({ apiKey: openaiKey });
            this.activeProvider = 'openai';
            logger.info('✅ OpenAI client initialized - REAL AI ENABLED');
            return;
          }
        } catch (openaiError) {
          logger.warn('OpenAI module not installed (optional) - trying alternatives');
        }
      }

      // Priority 4: Anthropic Claude (safety-focused, enterprise-grade)
      // Note: Only enabled if @anthropic-ai/sdk is installed
      if (anthropicKey) {
        try {
          // Use Function constructor to avoid Next.js static analysis
          const dynamicImport = new Function('modulePath', 'return import(modulePath)');
          const anthropicModule = await dynamicImport('@anthropic-ai/sdk').catch(() => null);
          if (anthropicModule && anthropicModule.default) {
            this.anthropicClient = new anthropicModule.default({ apiKey: anthropicKey });
            this.activeProvider = 'anthropic';
            logger.info('✅ Anthropic Claude initialized - REAL AI ENABLED');
            return;
          }
        } catch (anthropicError) {
          logger.warn('Anthropic SDK not installed (optional) - skipping');
        }
      }

      // No AI provider available
      logger.error('❌ NO AI PROVIDER AVAILABLE');
      logger.error('Options to enable AI:');
      logger.error('  1. FREE & SECURE: Install Ollama (ollama.ai) and run: ollama pull llama3.2');
      logger.error('  2. PAID: Set OPENAI_API_KEY or ANTHROPIC_API_KEY');
      logger.error('  3. NATIVE: Set CRYPTOCOM_DEVELOPER_API_KEY for Crypto.com AI');
      this.activeProvider = 'fallback';
    } catch (error) {
      logger.error('Failed to initialize any AI provider', { error: String(error) });
      this.activeProvider = 'fallback';
    }
  }

  /**
   * Get the active AI provider name
   */
  getActiveProvider(): string {
    return this.activeProvider;
  }

  /**
   * Check if real AI is available (not just rule-based fallback)
   */
  isAvailable(): boolean {
    return this.aiClient !== null || this.openAIClient !== null || 
           this.anthropicClient !== null || this.ollamaAvailable || this.asiAvailable;
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
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
      let actionIntent = parseActionIntent(userMessage);
      let actionResult = null;
      let actionExecuted = false;

      // For analysis actions without portfolio data, let the LLM respond intelligently
      if (actionIntent) {
        const isAnalysisAction = ['analyze', 'assess-risk', 'get-hedges'].includes(actionIntent.type);
        const hasPortfolioData = portfolioContext.length > 50 && portfolioContext.includes('Total Value');
        
        if (isAnalysisAction && !hasPortfolioData) {
          // No portfolio data - Qwen can give a much better response than empty metrics!
          logger.info('📝 No portfolio data - letting LLM handle this intelligently');
          actionIntent = null; // Clear to fall through to LLM
        }
      }

      // Only execute action if we still have a valid intent (not cleared above)
      if (actionIntent) {
        // Execute the action
        actionResult = await executePortfolioAction(actionIntent);
        actionExecuted = true;
        
        // Format action result with better error messages
        let formattedResult: string;
        if (!actionResult.success) {
          formattedResult = `⚠️ **Action Failed**: ${actionResult.message}\n\n${actionResult.error || 'Please ensure you\'re connected to the network and try again.'}`;
        } else {
          formattedResult = formatActionResult(actionIntent, actionResult);
        }
        
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
            zkProof: actionResult.zkProof,
          },
        });

        this.conversationHistory.set(conversationId, history);

        return {
          content: formattedResult,
          model: 'action-executor',
          confidence: 1.0,
          actionExecuted: true,
          actionResult: actionResult.data,
          zkProof: actionResult.zkProof,
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

      // Ensure initialization is complete
      await this.waitForInit();

      // Use the active provider that was determined during initialization
      // Priority order: Ollama (free, local) > ASI API > Crypto.com AI > OpenAI > Anthropic
      if (this.ollamaAvailable) {
        // Priority 1: Use Ollama (FREE, LOCAL, SECURE)
        logger.info('Using Ollama (FREE LOCAL AI) for response generation');
        response = await this.generateWithOllama(history, context);
      } else if (this.asiAvailable) {
        // Priority 2: Use ASI API (Fetch.ai production AI)
        logger.info('Using ASI API (Fetch.ai ASI:One) for response generation');
        response = await this.generateWithASI(history, context);
      } else if (this.aiClient) {
        // Priority 3: Use Crypto.com AI
        logger.info('Using Crypto.com AI for response generation');
        response = await this.generateWithCryptocomAI(history, context);
      } else if (this.openAIClient) {
        // Priority 3: Use direct OpenAI
        logger.info('Using OpenAI for response generation');
        response = await this.generateWithOpenAI(history, context);
      } else if (this.anthropicClient) {
        // Priority 4: Use Anthropic Claude
        logger.info('Using Anthropic Claude for response generation');
        response = await this.generateWithAnthropic(history, context);
      } else {
        // Last resort: Use rule-based fallback (clearly marked)
        logger.warn('NO REAL AI AVAILABLE - Using rule-based fallback');
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

      logger.info('Crypto.com AI response generated successfully');
      return {
        content: result.choices[0].message.content,
        tokensUsed: result.usage?.total_tokens,
        model: 'gpt-4-via-cryptocom',
        confidence: 0.95,
      };
    } catch (error) {
      logger.error('Crypto.com AI call failed, trying fallbacks:', error);
      
      // Try ASI API as primary fallback (production AI)
      if (this.asiAvailable) {
        return this.generateWithASI(history, context);
      }
      
      // Try OpenAI as fallback if available
      if (this.openAIClient) {
        return this.generateWithOpenAI(history, context);
      }
      
      // Try Anthropic as fallback
      if (this.anthropicClient) {
        return this.generateWithAnthropic(history, context);
      }
      
      // Try Ollama as fallback
      if (this.ollamaAvailable) {
        return this.generateWithOllama(history, context);
      }
      
      // Last resort: rule-based fallback
      return this.generateFallbackResponse(
        history[history.length - 1].content,
        context
      );
    }
  }

  /**
   * Generate response using ASI API (Fetch.ai's ASI:One - Production AI)
   * Use this when Ollama is not available but you need real AI responses
   * API docs: https://docs.asi1.ai/
   */
  private async generateWithASI(
    history: ChatMessage[],
    context?: Record<string, any>
  ): Promise<LLMResponse> {
    try {
      if (!this.asiApiKey) {
        throw new Error('ASI API key not configured');
      }

      // Format messages for ASI API (OpenAI-compatible format)
      const messages = history.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add context if provided
      if (context && messages.length > 0) {
        const contextStr = Object.entries(context)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        messages[messages.length - 1].content += `\n\nContext:\n${contextStr}`;
      }

      // Use asi1-mini for balanced performance and speed
      // Other models available: asi1-fast, asi1-extended, asi1-agentic
      const model = process.env.ASI_MODEL || 'asi1-mini';

      // Call ASI API
      const response = await fetch(`${this.asiApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.asiApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 800,
        }),
        signal: AbortSignal.timeout(60000), // 60s timeout
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`ASI API returned ${response.status}: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content || '';

      logger.info(`ASI API (${model}) response generated successfully - PRODUCTION AI`);
      return {
        content,
        tokensUsed: result.usage?.total_tokens || 0,
        model: `asi-${model}`,
        confidence: 0.92,
      };
    } catch (error) {
      logger.error('ASI API call failed:', error);
      
      // Try OpenAI as fallback
      if (this.openAIClient) {
        return this.generateWithOpenAI(history, context);
      }
      // Try Anthropic as fallback
      if (this.anthropicClient) {
        return this.generateWithAnthropic(history, context);
      }
      // Try Ollama as fallback
      if (this.ollamaAvailable) {
        return this.generateWithOllama(history, context);
      }
      // Last resort: rule-based fallback
      return this.generateFallbackResponse(
        history[history.length - 1].content,
        context
      );
    }
  }

  /**
   * Generate response using direct OpenAI API
   */
  private async generateWithOpenAI(
    history: ChatMessage[],
    context?: Record<string, any>
  ): Promise<LLMResponse> {
    try {
      // Format messages for OpenAI
      const messages = history.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      }));

      // Add context if provided
      if (context) {
        const contextStr = Object.entries(context)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        messages[messages.length - 1].content += `\n\nContext:\n${contextStr}`;
      }

      // Call OpenAI directly
      const result = await this.openAIClient.chat.completions.create({
        model: 'gpt-4o-mini', // Cost-effective model
        messages,
        temperature: 0.7,
        max_tokens: 800,
      });

      logger.info('OpenAI response generated successfully');
      return {
        content: result.choices[0].message.content || '',
        tokensUsed: result.usage?.total_tokens,
        model: 'gpt-4o-mini-direct',
        confidence: 0.90,
      };
    } catch (error) {
      logger.error('OpenAI call failed:', error);
      // Try ASI API as fallback
      if (this.asiAvailable) {
        return this.generateWithASI(history, context);
      }
      // Try Anthropic as fallback
      if (this.anthropicClient) {
        return this.generateWithAnthropic(history, context);
      }
      // Try Ollama as fallback
      if (this.ollamaAvailable) {
        return this.generateWithOllama(history, context);
      }
      // Last resort: rule-based fallback
      return this.generateFallbackResponse(
        history[history.length - 1].content,
        context
      );
    }
  }

  /**
   * Generate response using Anthropic Claude API (enterprise-grade, safety-focused)
   */
  private async generateWithAnthropic(
    history: ChatMessage[],
    context?: Record<string, any>
  ): Promise<LLMResponse> {
    try {
      // Extract system message and format for Anthropic
      const systemMessage = history.find(m => m.role === 'system')?.content || SYSTEM_CONTEXT;
      const messages = history
        .filter(m => m.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));

      // Add context if provided
      if (context && messages.length > 0) {
        const contextStr = Object.entries(context)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        messages[messages.length - 1].content += `\n\nContext:\n${contextStr}`;
      }

      // Call Anthropic Claude
      const result = await this.anthropicClient.messages.create({
        model: 'claude-3-haiku-20240307', // Cost-effective model
        max_tokens: 800,
        system: systemMessage,
        messages,
      });

      const content = result.content[0]?.type === 'text' ? result.content[0].text : '';
      
      logger.info('Anthropic Claude response generated successfully');
      return {
        content,
        tokensUsed: result.usage?.input_tokens + result.usage?.output_tokens,
        model: 'claude-3-haiku',
        confidence: 0.92,
      };
    } catch (error) {
      logger.error('Anthropic Claude call failed:', error);
      // Try ASI API as fallback
      if (this.asiAvailable) {
        return this.generateWithASI(history, context);
      }
      // Try Ollama as fallback
      if (this.ollamaAvailable) {
        return this.generateWithOllama(history, context);
      }
      // Last resort: rule-based fallback
      return this.generateFallbackResponse(
        history[history.length - 1].content,
        context
      );
    }
  }

  /**
   * Generate response using Ollama (FREE, LOCAL, SECURE - no data leaves your server)
   * Install from https://ollama.ai and run: ollama pull qwen2.5:7b
   */
  private async generateWithOllama(
    history: ChatMessage[],
    context?: Record<string, any>
  ): Promise<LLMResponse> {
    try {
      // Use qwen2.5:7b which is already installed and optimized for CUDA
      const model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
      
      // Format messages for Ollama
      const messages = history.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add context if provided
      if (context && messages.length > 0) {
        const contextStr = Object.entries(context)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        messages[messages.length - 1].content += `\n\nContext:\n${contextStr}`;
      }

      // Call Ollama local API
      const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 800,
          },
        }),
        signal: AbortSignal.timeout(60000), // 60s timeout for local inference
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const content = result.message?.content || '';

      logger.info(`Ollama (${model}) response generated successfully - FREE LOCAL AI`);
      return {
        content,
        tokensUsed: result.eval_count || 0,
        model: `ollama-${model}`,
        confidence: 0.88,
      };
    } catch (error) {
      logger.error('Ollama call failed, trying ASI API fallback:', error);
      // Try ASI API as fallback (production AI)
      if (this.asiAvailable) {
        return this.generateWithASI(history, context);
      }
      // Last resort: rule-based fallback
      return this.generateFallbackResponse(
        history[history.length - 1].content,
        context
      );
    }
  }

  /**
   * Generate rule-based fallback response (clearly marked as non-AI)
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

    // Market Analysis
    if (lower.match(/market|cronos|cro|ecosystem|price|sentiment|conditions/)) {
      return {
        content: `I'll analyze the current market conditions for you! 📊\n\n**Market Intelligence:**\n• **Cronos Ecosystem**: Layer 1 blockchain with strong DeFi presence\n• **CRO Token**: Native token with utility across CDC ecosystem\n• **Current Trends**: Institutional adoption increasing, TVL growing\n• **Risk Factors**: Market volatility, regulatory changes, macro conditions\n\n**Portfolio Recommendations:**\n✓ Consider your risk tolerance and time horizon\n✓ Diversify across multiple assets (CRO, ETH, BTC, stablecoins)\n✓ Use hedging strategies for downside protection\n✓ Monitor correlation with broader crypto markets\n\n**Data-Driven Insights:**\nI use real-time market data, on-chain analytics, and AI models to provide actionable recommendations. Would you like me to analyze your specific portfolio in the context of current market conditions?`,
        model: 'rule-based-fallback',
        confidence: 0.85,
      };
    }

    // Risk Assessment
    if (lower.includes('risk') || lower.includes('var') || lower.includes('volatility')) {
      return {
        content: `Risk assessment is one of my core capabilities! 📈\n\n**I can evaluate:**\n• **Value at Risk (VaR)**: Maximum potential loss at 95% confidence\n• **Volatility**: Price fluctuation measurement\n• **Sharpe Ratio**: Risk-adjusted returns\n• **Correlation**: How assets move together\n• **Liquidation Risk**: Margin call probabilities\n\n**Methodology:**\nI use Monte Carlo simulations, historical data analysis, and correlation matrices to assess portfolio risk. Results are ZK-verified for accuracy.\n\nThe AI agents will analyze your positions using real market data and provide actionable insights. Want me to assess your current risk level?`,
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
        content: `Great question about ZK (Zero-Knowledge) proofs! 🔐\n\n**What are ZK Proofs?**\nThey let you prove something is true without revealing the underlying data. Think of it as proving you know a password without showing it.\n\n**On ZkVanguard:**\n• All AI agent responses are ZK-verified\n• Your portfolio data stays private\n• Compliance reports prove accuracy without exposing details\n• Cryptographic security (521-bit security level)\n\n**Real Benefits:**\n✓ Institutional-grade privacy\n✓ Regulatory compliance\n✓ Trustless verification\n✓ Protection from data breaches\n\nEvery major action generates a ZK-STARK proof that you can verify independently. Want to see a demo?`,
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

  /**
   * Direct AI call for agents - bypasses portfolio context and action parsing
   * Use this for agent-based analysis that needs clean, focused responses
   */
  async generateDirectResponse(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    await this.waitForInit();
    
    if (!this.ollamaAvailable && !this.asiAvailable && !this.openAIClient && !this.anthropicClient) {
      throw new Error('No AI provider available');
    }

    const model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
    
    const messages = [
      {
        role: 'system',
        content: systemPrompt || 'You are an expert AI assistant. Be concise and direct in your responses.',
      },
      {
        role: 'user',
        content: prompt,
      }
    ];

    // Use Ollama if available (preferred - free and local)
    if (this.ollamaAvailable) {
      try {
        const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: {
              temperature: 0.5, // Lower temperature for more focused responses
              num_predict: 500,
            },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          throw new Error(`Ollama returned ${response.status}`);
        }

        const result = await response.json();
        return {
          content: result.message?.content || '',
          tokensUsed: result.eval_count || 0,
          model: `ollama-${model}`,
          confidence: 0.88,
        };
      } catch (error) {
        logger.error('Direct Ollama call failed, trying ASI API:', error);
        // Fall through to ASI API
      }
    }

    // Use ASI API if available (production AI - Fetch.ai)
    if (this.asiAvailable && this.asiApiKey) {
      try {
        const asiModel = process.env.ASI_MODEL || 'asi1-mini';
        const response = await fetch(`${this.asiApiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.asiApiKey}`,
          },
          body: JSON.stringify({
            model: asiModel,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            temperature: 0.5,
            max_tokens: 500,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          throw new Error(`ASI API returned ${response.status}`);
        }

        const result = await response.json();
        return {
          content: result.choices?.[0]?.message?.content || '',
          tokensUsed: result.usage?.total_tokens || 0,
          model: `asi-${asiModel}-direct`,
          confidence: 0.92,
        };
      } catch (error) {
        logger.error('Direct ASI API call failed:', error);
        // Fall through to OpenAI/Anthropic
      }
    }

    // Fallback to OpenAI
    if (this.openAIClient) {
      const result = await this.openAIClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages.map(m => ({ role: m.role as any, content: m.content })),
        temperature: 0.5,
        max_tokens: 500,
      });
      return {
        content: result.choices[0].message.content || '',
        tokensUsed: result.usage?.total_tokens,
        model: 'gpt-4o-mini-direct',
        confidence: 0.90,
      };
    }

    // Fallback to Anthropic
    if (this.anthropicClient) {
      const result = await this.anthropicClient.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        system: messages[0].content,
        messages: [{ role: 'user', content: messages[1].content }],
      });
      return {
        content: result.content[0]?.type === 'text' ? result.content[0].text : '',
        tokensUsed: result.usage?.input_tokens + result.usage?.output_tokens,
        model: 'claude-3-haiku-direct',
        confidence: 0.92,
      };
    }

    throw new Error('No AI provider available for direct call');
  }
}

// Export singleton instance
export const llmProvider = new LLMProvider();
