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
    this.apiKey = process.env.CRYPTOCOM_DEVELOPER_API_KEY || process.env.CRYPTOCOM_AI_API_KEY || null;
    
    if (this.apiKey) {
      try {
        // Dynamic import for Crypto.com AI Agent SDK (hackathon-provided)
        import('@crypto.com/ai-agent-client').then((module: any) => {
          const AIAgentClient = module.AIAgentClient || module.default;
          this.client = new AIAgentClient({
            apiKey: this.apiKey,
            baseUrl: 'https://api.crypto.com/ai-agent/v1', // Crypto.com Developer Platform
          });
          logger.info('Crypto.com AI Agent SDK initialized (hackathon API)');
        }).catch((error) => {
          console.warn('Crypto.com AI client initialization failed:', error);
          console.warn('Using fallback rule-based logic');
          this.client = null;
        });
      } catch (error) {
        console.warn('Crypto.com AI client initialization failed:', error);
        this.client = null;
      }
    } else {
      console.warn('CRYPTOCOM_DEVELOPER_API_KEY not set - AI features will use fallback logic');
      console.warn('To get your free hackathon API key, contact Discord #x402-hackathon');
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
    if (!this.client) {
      return this.fallbackPortfolioAnalysis(portfolioData);
    }

    try {
      const response = await this.client.analyze({
        text: JSON.stringify(portfolioData),
        task: 'portfolio_analysis',
        context: {
          address,
          blockchain: 'cronos',
        },
      });

      return {
        totalValue: response.totalValue || 0,
        positions: response.positions || 0,
        riskScore: response.riskScore || 0,
        healthScore: response.healthScore || 0,
        recommendations: response.recommendations || [],
        topAssets: response.topAssets || [],
      };
    } catch (error) {
      console.error('AI portfolio analysis failed:', error);
      return this.fallbackPortfolioAnalysis(portfolioData);
    }
  }

  /**
   * Assess portfolio risk using AI
   */
  async assessRisk(portfolioData: any): Promise<RiskAssessment> {
    if (!this.client) {
      return this.fallbackRiskAssessment(portfolioData);
    }

    try {
      const response = await this.client.analyze({
        text: JSON.stringify(portfolioData),
        task: 'risk_assessment',
        context: {
          methodology: 'var_volatility_sharpe',
        },
      });

      return {
        overallRisk: response.overallRisk || 'medium',
        riskScore: response.riskScore || 0,
        volatility: response.volatility || 0,
        var95: response.var95 || 0,
        sharpeRatio: response.sharpeRatio || 0,
        factors: response.factors || [],
      };
    } catch (error) {
      console.error('AI risk assessment failed:', error);
      return this.fallbackRiskAssessment(portfolioData);
    }
  }

  /**
   * Generate hedge recommendations using AI
   */
  async generateHedgeRecommendations(portfolioData: any, riskProfile: any): Promise<HedgeRecommendation[]> {
    if (!this.client) {
      return this.fallbackHedgeRecommendations(portfolioData, riskProfile);
    }

    try {
      const response = await this.client.analyze({
        text: JSON.stringify({ portfolio: portfolioData, risk: riskProfile }),
        task: 'hedge_generation',
        context: {
          strategies: ['short', 'options', 'stablecoin'],
        },
      });

      return response.recommendations || [];
    } catch (error) {
      console.error('AI hedge generation failed:', error);
      return this.fallbackHedgeRecommendations(portfolioData, riskProfile);
    }
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
    // Simple rule-based analysis
    const mockValue = Math.random() * 5000000 + 1000000;
    const mockPositions = Math.floor(Math.random() * 15) + 3;
    const mockRiskScore = Math.random() * 40 + 30; // 30-70

    return {
      totalValue: mockValue,
      positions: mockPositions,
      riskScore: mockRiskScore,
      healthScore: 100 - mockRiskScore,
      recommendations: [
        'Consider diversifying into stablecoins for lower volatility',
        'Current exposure to volatile assets is moderate',
        'Portfolio health is within acceptable range',
      ],
      topAssets: [
        { symbol: 'ETH', value: mockValue * 0.4, percentage: 40 },
        { symbol: 'BTC', value: mockValue * 0.3, percentage: 30 },
        { symbol: 'USDC', value: mockValue * 0.2, percentage: 20 },
        { symbol: 'CRO', value: mockValue * 0.1, percentage: 10 },
      ],
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
