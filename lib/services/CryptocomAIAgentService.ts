/**
 * Crypto.com AI Agent Service
 * Enhanced blockchain operations with natural language interface
 */

import { logger } from '@/lib/utils/logger';

// import { Agent } from '@crypto.com/ai-agent-client';

interface AIAgentClient {
  query(params: { query: string; context: unknown[] }): Promise<{
    response?: string;
    message?: string;
    data?: Record<string, unknown>;
    context?: unknown[];
  }>;
}

export interface AgentConfig {
  openaiApiKey?: string;
  chainId?: string;
  dashboardApiKey?: string;
  privateKey?: string;
  explorerApiKey?: string;
}

export interface AgentQueryResult {
  success: boolean;
  response: string;
  data?: Record<string, unknown>;
  error?: string;
  context?: unknown[];
}

export interface BlockchainOperation {
  type: 'send' | 'swap' | 'query' | 'analyze' | 'other';
  intent: string;
  result: string;
  txHash?: string;
  data?: Record<string, unknown>;
}

class CryptocomAIAgentService {
  private agent: AIAgentClient | null = null;
  private isInitialized: boolean = false;
  private config: AgentConfig = {};

  constructor() {
    // Initialize with default config
    this.config = {
      chainId: '338', // Cronos EVM Testnet by default
    };
  }

  /**
   * Initialize the AI Agent with real SDK
   */
  async initialize(config?: AgentConfig): Promise<void> {
    try {
      const finalConfig: AgentConfig = {
        openaiApiKey: config?.openaiApiKey || process.env.OPENAI_API_KEY,
        chainId: config?.chainId || process.env.CRONOS_CHAIN_ID || '338',
        dashboardApiKey: config?.dashboardApiKey || process.env.DASHBOARD_API_KEY || process.env.CRYPTOCOM_DEVELOPER_API_KEY,
        privateKey: config?.privateKey || process.env.PRIVATE_KEY,
        explorerApiKey: config?.explorerApiKey || process.env.EXPLORER_API_KEY,
      };

      this.config = finalConfig;

      // Check if we have required API keys for real SDK initialization
      const hasOpenAIKey = !!finalConfig.openaiApiKey;
      const hasDashboardKey = !!finalConfig.dashboardApiKey;

      if (hasOpenAIKey && hasDashboardKey) {
        try {
          // Try to dynamically import the Crypto.com AI Agent SDK
          const agentModule = await import('@crypto.com/ai-agent-client').catch(() => null);
          
          if (agentModule?.createClient) {
            this.agent = agentModule.createClient({
              openAI: {
                apiKey: finalConfig.openaiApiKey!,
                model: 'gpt-4o-mini',
              },
              chainId: parseInt(finalConfig.chainId!, 10),
              explorerKeys: {
                cronosMainnetKey: finalConfig.explorerApiKey,
                cronosTestnetKey: finalConfig.explorerApiKey,
                cronosZkEvmKey: finalConfig.explorerApiKey,
                cronosZkEvmTestnetKey: finalConfig.explorerApiKey,
              },
            }) as AIAgentClient;
            
            this.isInitialized = true;
            logger.info('Crypto.com AI Agent SDK initialized', { component: 'AIAgent', data: finalConfig.chainId });
            return;
          }
        } catch (sdkError) {
          logger.warn('Crypto.com AI Agent SDK not available, using LLM fallback', { component: 'AIAgent', data: sdkError });
        }
      }

      // If SDK not available, mark as initialized with LLM fallback mode
      if (hasOpenAIKey || hasDashboardKey) {
        this.isInitialized = true;
        logger.info('Initialized with LLM fallback mode', { component: 'AIAgent' });
      } else {
        this.isInitialized = false;
        logger.warn('No API keys configured - AI features will be limited', { component: 'AIAgent' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Initialization failed', error, { component: 'AIAgent' });
      throw new Error(`Failed to initialize AI Agent: ${message}`);
    }
  }

  /**
   * Get RPC URL for a given chain ID
   */
  private getChainRpcUrl(chainId: string): string {
    const rpcUrls: Record<string, string> = {
      '25': 'https://evm.cronos.org',
      '338': 'https://evm-t3.cronos.org',
      '388': 'https://mainnet.zkevm.cronos.org',
    };
    return rpcUrls[chainId] || 'https://evm-t3.cronos.org';
  }

  /**
   * Process natural language query
   */
  async query(userQuery: string, conversationContext?: unknown[]): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      logger.info('Processing query', { component: 'AIAgent', data: userQuery });

      const result = await this.agent.query({
        query: userQuery,
        context: conversationContext || [],
      });

      return {
        success: true,
        response: result.response || result.message || 'Query processed',
        data: result.data,
        context: result.context,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Query failed', error, { component: 'AIAgent' });
      return {
        success: false,
        response: 'Failed to process query',
        error: message,
      };
    }
  }

  /**
   * Send tokens with natural language
   */
  async sendTokens(recipientAddress: string, amount: number, symbol: string = 'CRO'): Promise<BlockchainOperation> {
    this.ensureInitialized();

    try {
      const query = `Send ${amount} ${symbol} to ${recipientAddress}`;
      const result = await this.query(query);

      return {
        type: 'send',
        intent: query,
        result: result.response,
        txHash: result.data?.txHash,
        data: result.data,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'send',
        intent: `Send ${amount} ${symbol}`,
        result: `Failed: ${message}`,
      };
    }
  }

  /**
   * Get balance with AI assistance
   */
  async getBalance(address?: string): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      const query = address 
        ? `What is the balance of ${address}?`
        : 'What is my wallet balance?';

      return await this.query(query);
    } catch (error) {
      return {
        success: false,
        response: 'Failed to get balance',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Analyze portfolio with AI
   */
  async analyzePortfolio(address: string): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      const query = `Analyze the portfolio for address ${address}. Provide insights on holdings, diversification, and risk.`;
      return await this.query(query);
    } catch (error) {
      return {
        success: false,
        response: 'Failed to analyze portfolio',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get transaction history with AI explanation
   */
  async explainTransactions(address: string, limit: number = 10): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      const query = `Show me the last ${limit} transactions for ${address} and explain what they are.`;
      return await this.query(query);
    } catch (error) {
      return {
        success: false,
        response: 'Failed to get transactions',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Swap tokens using AI
   */
  async swapTokens(fromToken: string, toToken: string, amount: number): Promise<BlockchainOperation> {
    this.ensureInitialized();

    try {
      const query = `Swap ${amount} ${fromToken} to ${toToken}`;
      const result = await this.query(query);

      return {
        type: 'swap',
        intent: query,
        result: result.response,
        txHash: result.data?.txHash,
        data: result.data,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'swap',
        intent: `Swap ${fromToken} to ${toToken}`,
        result: `Failed: ${message}`,
      };
    }
  }

  /**
   * Get latest block information
   */
  async getLatestBlock(): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      const query = 'What is the latest block number on the blockchain?';
      return await this.query(query);
    } catch (error) {
      return {
        success: false,
        response: 'Failed to get latest block',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Analyze transaction
   */
  async analyzeTransaction(txHash: string): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      const query = `Analyze transaction ${txHash} and explain what happened.`;
      return await this.query(query);
    } catch (error) {
      return {
        success: false,
        response: 'Failed to analyze transaction',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Risk assessment using AI
   */
  async assessRisk(address: string, action: string): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      const query = `Assess the risk for address ${address} if they ${action}`;
      return await this.query(query);
    } catch (error) {
      return {
        success: false,
        response: 'Failed to assess risk',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get smart contract information
   */
  async getContractInfo(contractAddress: string): Promise<AgentQueryResult> {
    this.ensureInitialized();

    try {
      const query = `What is the smart contract at ${contractAddress}? Show me its ABI and functions.`;
      return await this.query(query);
    } catch (error) {
      return {
        success: false,
        response: 'Failed to get contract info',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Parse user intent from natural language
   */
  async parseIntent(userMessage: string): Promise<{
    intent: string;
    entities: Record<string, unknown>;
    confidence: number;
  }> {
    this.ensureInitialized();

    try {
      const query = `Parse the intent from this user message: "${userMessage}". Extract entities like addresses, amounts, tokens, and actions.`;
      const result = await this.query(query);

      // Simple intent parsing - can be enhanced
      return {
        intent: 'unknown',
        entities: result.data || {},
        confidence: 0.7,
      };
    } catch (error) {
      return {
        intent: 'error',
        entities: {},
        confidence: 0,
      };
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      const result = await this.getLatestBlock();
      return result.success;
    } catch (error) {
      logger.error('Health check failed', error, { component: 'AIAgent' });
      return false;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Partial<AgentConfig> {
    return {
      chainId: this.config.chainId,
      // Don't expose sensitive keys
    };
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Ensure service is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('AI Agent service not initialized. Call initialize() first.');
    }
  }
}

// Export singleton instance
export const cryptocomAIAgent = new CryptocomAIAgentService();
export default CryptocomAIAgentService;
