/**
 * Crypto.com AI Agent Service Wrapper
 * 
 * Provides AI-powered portfolio analysis, risk assessment, and natural language
 * intent parsing using Crypto.com's AI Agent SDK.
 */

import { logger } from '@/lib/utils/logger';

// Note: @crypto.com/ai-agent-client types will be available at runtime
// Using any for now until proper types are available
type AIAgentClient = any;

// Types for AI analysis
export interface PortfolioAnalysis {
  totalValue: number;
  positions: number;
  riskScore: number;
  healthScore: number;
  recommendations: string[];
  topAssets: Array<{
    symbol: string;
    value: number;
    percentage: number;
  }>;
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high';
  riskScore: number;
  volatility: number;
  var95: number;
  sharpeRatio: number;
  factors: Array<{
    factor: string;
    impact: 'low' | 'medium' | 'high';
    description: string;
  }>;
}

export interface HedgeRecommendation {
  strategy: string;
  confidence: number;
  expectedReduction: number;
  description: string;
  actions: Array<{
    action: string;
    asset: string;
    amount: number;
  }>;
}

export interface IntentParsing {
  intent: 'analyze_portfolio' | 'assess_risk' | 'generate_hedge' | 'execute_settlement' | 'generate_report' | 'unknown';
  confidence: number;
  entities: Record<string, any>;
  parameters: Record<string, any>;
}

class CryptocomAIService {
  private client: AIAgentClient | null = null;
  private apiKey: string | null = null;

  constructor() {
    // Initialize with API key from environment (hackathon-provided)
    // Check both NEXT_PUBLIC_ (client-side) and regular (server-side) versions
    this.apiKey = process.env.NEXT_PUBLIC_CRYPTOCOM_DEVELOPER_API_KEY || 
                   process.env.CRYPTOCOM_DEVELOPER_API_KEY || 
                   process.env.CRYPTOCOM_AI_API_KEY || 
                   null;
    
    if (this.apiKey) {
      try {
        // Dynamic import for Crypto.com AI Agent SDK (hackathon-provided)
        import('@crypto.com/ai-agent-client').then((module: any) => {
          const { createClient } = module;
          if (createClient) {
            this.client = createClient({
              openaiApiKey: this.apiKey,
              blockchainRpcUrl: process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org',
            }) as AIAgentClient;
            logger.info('Crypto.com AI Agent SDK initialized successfully');
          } else {
            console.warn('createClient not found in @crypto.com/ai-agent-client');
            this.client = null;
          }
        }).catch((error) => {
          // Silent catch - fallback logic will be used
          this.client = null;
        });
      } catch (error) {
        this.client = null;
      }
    }
  }

  /**
   * Check if AI service is available
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Parse user intent from natural language input
   */
  async parseIntent(input: string): Promise<IntentParsing> {
    if (!this.client) {
      return this.fallbackIntentParsing(input);
    }

    try {
      // Use Crypto.com AI for intent classification
      const response = await this.client.analyze({
        text: input,
        task: 'intent_classification',
        context: {
          domain: 'defi_portfolio_management',
          available_intents: [
            'analyze_portfolio',
            'assess_risk',
            'generate_hedge',
            'execute_settlement',
            'generate_report',
          ],
        },
      });

      return {
        intent: response.intent || 'unknown',
        confidence: response.confidence || 0,
        entities: response.entities || {},
        parameters: response.parameters || {},
      };
    } catch (error) {
      console.error('AI intent parsing failed:', error);
      return this.fallbackIntentParsing(input);
    }
  }

  /**
   * Analyze portfolio using AI
   */
  async analyzePortfolio(address: string, portfolioData: any): Promise<PortfolioAnalysis> {
    // Always use fallback logic for now - AI SDK integration pending
    return this.fallbackPortfolioAnalysis(portfolioData);
  }

  /**
   * Assess portfolio risk using AI
   */
  async assessRisk(portfolioData: any): Promise<RiskAssessment> {
    // Always use fallback logic for now - AI SDK integration pending
    return this.fallbackRiskAssessment(portfolioData);
  }

  /**
   * Generate hedge recommendations using AI
   */
  async generateHedgeRecommendations(portfolioData: any, riskProfile: any): Promise<HedgeRecommendation[]> {
    // Always use fallback logic for now - AI SDK integration pending
    return this.fallbackHedgeRecommendations(portfolioData, riskProfile);
  }

  // ==================== Fallback Logic (Rule-Based) ====================

  private fallbackIntentParsing(input: string): IntentParsing {
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes('portfolio') || lowerInput.includes('overview') || lowerInput.includes('balance')) {
      return {
        intent: 'analyze_portfolio',
        confidence: 0.85,
        entities: {},
        parameters: {},
      };
    }

    if (lowerInput.includes('risk') || lowerInput.includes('volatility') || lowerInput.includes('var')) {
      return {
        intent: 'assess_risk',
        confidence: 0.85,
        entities: {},
        parameters: {},
      };
    }

    if (lowerInput.includes('hedge') || lowerInput.includes('protect') || lowerInput.includes('mitigate')) {
      return {
        intent: 'generate_hedge',
        confidence: 0.85,
        entities: {},
        parameters: {},
      };
    }

    if (lowerInput.includes('settle') || lowerInput.includes('execute') || lowerInput.includes('batch')) {
      return {
        intent: 'execute_settlement',
        confidence: 0.85,
        entities: {},
        parameters: {},
      };
    }

    if (lowerInput.includes('report') || lowerInput.includes('summary') || lowerInput.includes('analysis')) {
      return {
        intent: 'generate_report',
        confidence: 0.85,
        entities: {},
        parameters: {},
      };
    }

    return {
      intent: 'unknown',
      confidence: 0,
      entities: {},
      parameters: {},
    };
  }

  private fallbackPortfolioAnalysis(_portfolioData: unknown): PortfolioAnalysis {
    // Return empty analysis - will be populated from real on-chain data
    return {
      totalValue: 0,
      positions: 0,
      riskScore: 0,
      healthScore: 0,
      recommendations: [],
      topAssets: [],
    };
  }

  private fallbackRiskAssessment(portfolioData: any): RiskAssessment {
    // Deterministic fallback: compute volatility based on exposure to volatile assets
    try {
      const positions = Array.isArray(portfolioData.positions) ? portfolioData.positions : [];
      const totalValue = portfolioData.totalValue || positions.reduce((s: number, p: any) => s + (p.value || 0), 0) || 1;

      const volatileSymbols = new Set(['BTC', 'ETH', 'SOL', 'ADA', 'BNB', 'CRO', 'LTC', 'DOT']);
      const stableSymbols = new Set(['USDC', 'USDT', 'DAI']);

      let volatileExposure = 0;
      let stableExposure = 0;

      for (const p of positions) {
        const sym = (p.symbol || '').toUpperCase();
        const val = Number(p.value || 0);
        if (volatileSymbols.has(sym)) volatileExposure += val;
        if (stableSymbols.has(sym)) stableExposure += val;
      }

      const volatileRatio = Math.min(1, volatileExposure / totalValue);
      const stableRatio = Math.min(1, stableExposure / totalValue);

      // Base volatility scales with volatile exposure
      const volatility = Math.max(0.02, Math.min(1, 0.03 + volatileRatio * 0.6));
      // Scale VaR with portfolio size so larger portfolios show larger absolute VaR
      const sizeMultiplier = 0.05 * Math.log10(Math.max(10, totalValue));
      const var95 = Math.max(0.005, Math.min(0.5, volatility * (0.1 + sizeMultiplier)));
      const riskScore = Math.round(volatility * 100);
      const overallRisk: 'low' | 'medium' | 'high' = volatility < 0.08 ? 'low' : volatility < 0.25 ? 'medium' : 'high';

      return {
        overallRisk,
        riskScore,
        volatility,
        var95,
        sharpeRatio: Math.max(0.1, 1 / (volatility * 4)),
        factors: [
          {
            factor: 'Market Volatility',
            impact: overallRisk,
            description: 'Computed from portfolio exposure to volatile assets',
          },
          {
            factor: 'Concentration Risk',
            impact: volatileRatio > 0.5 ? 'high' : volatileRatio > 0.25 ? 'medium' : 'low',
            description: 'Higher concentration in a few assets increases risk',
          },
          {
            factor: 'Liquidity Risk',
            impact: stableRatio > 0.5 ? 'low' : 'medium',
            description: 'Stablecoin allocation reduces liquidity-driven volatility',
          },
        ],
      };
    } catch (e) {
      // Fallback deterministic defaults
      return {
        overallRisk: 'medium',
        riskScore: 50,
        volatility: 0.12,
        var95: 0.06,
        sharpeRatio: 1,
        factors: [],
      };
    }
  }

  private fallbackHedgeRecommendations(portfolioData: any, riskProfile: any): HedgeRecommendation[] {
    return [
      {
        strategy: 'Stablecoin Hedge',
        confidence: 0.82,
        expectedReduction: 0.25,
        description: 'Convert 20-30% of volatile assets to USDC to reduce downside risk',
        actions: [
          {
            action: 'swap',
            asset: 'ETH',
            amount: 1000,
          },
          {
            action: 'swap',
            asset: 'BTC',
            amount: 500,
          },
        ],
      },
      {
        strategy: 'Short Position',
        confidence: 0.68,
        expectedReduction: 0.35,
        description: 'Open short position on correlated assets to hedge against market downturn',
        actions: [
          {
            action: 'short',
            asset: 'ETH',
            amount: 500,
          },
        ],
      },
    ];
  }
}

// Singleton instance
let aiServiceInstance: CryptocomAIService | null = null;

export function getCryptocomAIService(): CryptocomAIService {
  if (!aiServiceInstance) {
    aiServiceInstance = new CryptocomAIService();
  }
  return aiServiceInstance;
}

export default CryptocomAIService;
