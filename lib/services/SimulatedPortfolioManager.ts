/**
 * Simulated Portfolio Manager
 * 
 * Manages a simulated trading portfolio using REAL system components:
 * - CoinGecko API (real-time prices - FREE)
 * - Crypto.com AI SDK (AI-powered analysis)
 * - Real agent orchestration system
 * - Real risk assessment agents
 * 
 * Only the portfolio positions are simulated - all data and analysis is REAL.
 */

import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import axios from 'axios';

export interface Position {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPercentage: number;
}

export interface PortfolioSnapshot {
  timestamp: Date;
  totalValue: number;
  positions: Position[];
  cash: number;
  dailyPnl: number;
  totalPnl: number;
}

export interface Trade {
  id: string;
  timestamp: Date;
  type: 'BUY' | 'SELL';
  symbol: string;
  amount: number;
  price: number;
  total: number;
  reason: string;
}

// CoinGecko ID mapping
const COINGECKO_IDS: Record<string, string> = {
  'CRO': 'crypto-com-chain',
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'VVS': 'vvs-finance',
  'WBTC': 'wrapped-bitcoin',
  'WETH': 'weth',
};

export class SimulatedPortfolioManager {
  private positions: Map<string, Position>;
  private cash: number;
  private initialCapital: number;
  private trades: Trade[];
  private snapshots: PortfolioSnapshot[];
  private priceCache: Map<string, { price: number; timestamp: number }>;
  private isInitialized: boolean = false;

  constructor(initialCapital: number = 10000) {
    this.positions = new Map();
    this.cash = initialCapital;
    this.initialCapital = initialCapital;
    this.trades = [];
    this.snapshots = [];
    this.priceCache = new Map();
  }

  /**
   * Initialize the portfolio manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log('✅ Simulated Portfolio Manager initialized');
    this.isInitialized = true;
  }

  /**
   * Get current portfolio value using REAL market prices
   */
  async getPortfolioValue(): Promise<number> {
    let totalValue = this.cash;

    for (const [symbol, position] of this.positions) {
      const price = await this.getCurrentPrice(symbol);
      position.currentPrice = price;
      position.value = position.amount * price;
      position.pnl = position.value - (position.amount * position.entryPrice);
      position.pnlPercentage = (position.pnl / (position.amount * position.entryPrice)) * 100;
      totalValue += position.value;
    }

    return totalValue;
  }

  /**
   * Get current price from CoinGecko (REAL market data - FREE)
   */
  private async getCurrentPrice(symbol: string): Promise<number> {
    // Check cache first (1 minute TTL)
    const cached = this.priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.price;
    }

    // Fetch fresh price from CoinGecko
    const coinId = COINGECKO_IDS[symbol];
    if (!coinId) {
      throw new Error(`Unknown symbol: ${symbol}`);
    }

    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      
      const price = response.data[coinId]?.usd;
      if (!price) {
        throw new Error(`Price not available for ${symbol}`);
      }

      this.priceCache.set(symbol, { price, timestamp: Date.now() });
      return price;
    } catch (error) {
      console.warn(`Failed to fetch price for ${symbol}:`, error);
      // Return cached price if available, even if stale
      if (cached) {
        console.warn(`Using stale cached price for ${symbol}`);
        return cached.price;
      }
      throw error;
    }
  }

  /**
   * Execute a BUY order using REAL market prices
   */
  async buy(symbol: string, amount: number, reason: string = 'Manual trade'): Promise<Trade> {
    const price = await this.getCurrentPrice(symbol);
    const total = amount * price;

    if (total > this.cash) {
      throw new Error(`Insufficient funds. Need $${total.toFixed(2)}, have $${this.cash.toFixed(2)}`);
    }

    // Update position
    const existingPosition = this.positions.get(symbol);
    if (existingPosition) {
      // Average entry price
      const totalAmount = existingPosition.amount + amount;
      const totalCost = (existingPosition.amount * existingPosition.entryPrice) + (amount * price);
      existingPosition.entryPrice = totalCost / totalAmount;
      existingPosition.amount = totalAmount;
      existingPosition.currentPrice = price;
      existingPosition.value = totalAmount * price;
    } else {
      this.positions.set(symbol, {
        symbol,
        amount,
        entryPrice: price,
        currentPrice: price,
        value: total,
        pnl: 0,
        pnlPercentage: 0,
      });
    }

    this.cash -= total;

    const trade: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      type: 'BUY',
      symbol,
      amount,
      price,
      total,
      reason,
    };

    this.trades.push(trade);
    console.log(`✅ BUY ${amount} ${symbol} @ $${price.toFixed(4)} = $${total.toFixed(2)} - ${reason}`);

    return trade;
  }

  /**
   * Execute a SELL order using REAL market prices
   */
  async sell(symbol: string, amount: number, reason: string = 'Manual trade'): Promise<Trade> {
    const position = this.positions.get(symbol);
    if (!position || position.amount < amount) {
      throw new Error(`Insufficient ${symbol}. Have ${position?.amount || 0}, trying to sell ${amount}`);
    }

    const price = await this.getCurrentPrice(symbol);
    const total = amount * price;

    // Update position
    position.amount -= amount;
    if (position.amount === 0) {
      this.positions.delete(symbol);
    } else {
      position.value = position.amount * position.currentPrice;
    }

    this.cash += total;

    const trade: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      type: 'SELL',
      symbol,
      amount,
      price,
      total,
      reason,
    };

    this.trades.push(trade);
    console.log(`✅ SELL ${amount} ${symbol} @ $${price.toFixed(4)} = $${total.toFixed(2)} - ${reason}`);

    return trade;
  }

  /**
   * Get AI-powered portfolio analysis using REAL agent orchestrator
   */
  async analyzePortfolio(): Promise<any> {
    const portfolioValue = await this.getPortfolioValue();
    
    const portfolioData = {
      totalValue: portfolioValue,
      cash: this.cash,
      positions: Array.from(this.positions.values()),
      initialCapital: this.initialCapital,
      totalPnl: portfolioValue - this.initialCapital,
      totalPnlPercentage: ((portfolioValue - this.initialCapital) / this.initialCapital) * 100,
      tokens: Array.from(this.positions.values()).map(pos => ({
        symbol: pos.symbol,
        balance: pos.amount,
        price: pos.currentPrice,
        usdValue: pos.value,
      })),
    };

    // Use REAL agent orchestrator system
    const orchestrator = getAgentOrchestrator();
    const result = await orchestrator.analyzePortfolio({
      address: 'simulated-portfolio',
      portfolioData,
    });

    if (result.success && result.data) {
      return {
        ...result.data,
        portfolioData,
        agentId: result.agentId,
        executionTime: result.executionTime,
        realAgent: true,
        realData: true,
        dataSource: 'CoinGecko + Agent Orchestrator',
      };
    }

    // Fallback to AI service
    const aiService = getCryptocomAIService();
    const analysis = await aiService.analyzePortfolio('simulated-portfolio', portfolioData);

    return {
      ...analysis,
      portfolioData,
      realData: true,
      dataSource: 'CoinGecko + Crypto.com AI SDK',
    };
  }

  /**
   * Get AI-powered risk assessment using REAL agent orchestrator
   */
  async assessRisk(): Promise<any> {
    const portfolioValue = await this.getPortfolioValue();
    
    const portfolioData = {
      totalValue: portfolioValue,
      positions: Array.from(this.positions.values()),
      tokens: Array.from(this.positions.values()).map(pos => ({
        symbol: pos.symbol,
        balance: pos.amount,
        price: pos.currentPrice,
        usdValue: pos.value,
      })),
    };

    // Use REAL agent orchestrator system
    const orchestrator = getAgentOrchestrator();
    const result = await orchestrator.assessRisk({
      address: 'simulated-portfolio',
      portfolioData,
      volatilities: {},
    });

    if (result.success && result.data) {
      return {
        ...result.data,
        agentId: result.agentId,
        executionTime: result.executionTime,
        realAgent: true,
        realData: true,
        dataSource: 'Agent Orchestrator + CoinGecko',
      };
    }

    // Fallback to AI service
    const aiService = getCryptocomAIService();
    const riskAssessment = await aiService.assessRisk(portfolioData);

    return {
      ...riskAssessment,
      realData: true,
      dataSource: 'Crypto.com AI SDK + CoinGecko',
    };
  }

  /**
   * Get AI-powered hedge recommendations using REAL agent orchestrator
   */
  async getHedgeRecommendations(): Promise<any> {
    const portfolioValue = await this.getPortfolioValue();
    
    // Find dominant asset
    const positions = Array.from(this.positions.values());
    const dominantAsset = positions.reduce((max, pos) => 
      pos.value > (max?.value || 0) ? pos : max
    , positions[0]);

    if (!dominantAsset) {
      return {
        recommendations: [],
        realData: true,
        dataSource: 'Agent Orchestrator',
      };
    }

    // Use REAL agent orchestrator system
    const orchestrator = getAgentOrchestrator();
    const result = await orchestrator.generateHedgeRecommendations({
      portfolioId: 'simulated-portfolio',
      assetSymbol: dominantAsset.symbol,
      notionalValue: portfolioValue,
    });

    if (result.success && result.data) {
      const hedgeAnalysis = result.data;
      return {
        recommendations: [{
          strategy: `${hedgeAnalysis.recommendation.action} ${hedgeAnalysis.recommendation.side} Position`,
          confidence: hedgeAnalysis.riskMetrics.hedgeEffectiveness,
          expectedReduction: hedgeAnalysis.exposure.volatility * 60,
          description: hedgeAnalysis.recommendation.reason,
          actions: [{
            action: hedgeAnalysis.recommendation.action,
            market: hedgeAnalysis.recommendation.market,
            asset: hedgeAnalysis.exposure.asset,
            amount: parseFloat(hedgeAnalysis.recommendation.size),
            leverage: hedgeAnalysis.recommendation.leverage,
            reason: hedgeAnalysis.recommendation.reason,
          }]
        }],
        agentId: result.agentId,
        executionTime: result.executionTime,
        realAgent: true,
        realData: true,
        dataSource: 'Agent Orchestrator (Hedging Agent)',
      };
    }

    // Fallback to AI service
    const portfolioData = {
      totalValue: portfolioValue,
      positions: Array.from(this.positions.values()),
    };

    const riskProfile = {
      totalValue: portfolioValue,
      positions: Array.from(this.positions.values()),
    };

    const aiService = getCryptocomAIService();
    const recommendations = await aiService.generateHedgeRecommendations(portfolioData, riskProfile);

    return {
      recommendations,
      realData: true,
      dataSource: 'Crypto.com AI SDK',
    };
  }

  /**
   * Execute AI-recommended trades automatically
   */
  async executeAIRecommendation(recommendation: any): Promise<Trade[]> {
    const trades: Trade[] = [];

    for (const action of recommendation.actions || []) {
      try {
        if (action.action === 'buy' || action.action === 'BUY') {
          const trade = await this.buy(
            action.asset,
            action.amount,
            `AI Recommendation: ${recommendation.strategy}`
          );
          trades.push(trade);
        } else if (action.action === 'sell' || action.action === 'SELL') {
          const trade = await this.sell(
            action.asset,
            action.amount,
            `AI Recommendation: ${recommendation.strategy}`
          );
          trades.push(trade);
        }
      } catch (error) {
        console.error(`Failed to execute AI recommendation:`, error);
      }
    }

    return trades;
  }

  /**
   * Take a portfolio snapshot with REAL market data
   */
  async takeSnapshot(): Promise<PortfolioSnapshot> {
    const totalValue = await this.getPortfolioValue();
    const previousSnapshot = this.snapshots[this.snapshots.length - 1];

    const snapshot: PortfolioSnapshot = {
      timestamp: new Date(),
      totalValue,
      positions: Array.from(this.positions.values()),
      cash: this.cash,
      dailyPnl: previousSnapshot ? totalValue - previousSnapshot.totalValue : 0,
      totalPnl: totalValue - this.initialCapital,
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Get portfolio summary with REAL data
   */
  async getSummary(): Promise<any> {
    const totalValue = await this.getPortfolioValue();
    const totalPnl = totalValue - this.initialCapital;
    const totalPnlPercentage = (totalPnl / this.initialCapital) * 100;

    return {
      initialCapital: this.initialCapital,
      currentValue: totalValue,
      cash: this.cash,
      totalPnl,
      totalPnlPercentage,
      positions: Array.from(this.positions.values()),
      positionCount: this.positions.size,
      tradeCount: this.trades.length,
      realData: true,
      dataSource: 'CoinGecko API (real-time prices)',
    };
  }

  /**
   * Get trade history
   */
  getTradeHistory(): Trade[] {
    return [...this.trades];
  }

  /**
   * Get portfolio snapshots
   */
  getSnapshots(): PortfolioSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Clean up
   */
  async disconnect(): Promise<void> {
    const finalValue = await this.getPortfolioValue();
    console.log('\n📊 Portfolio simulation complete');
    console.log(`Final value: $${finalValue.toFixed(2)}`);
  }
}

// Singleton instance
let portfolioManager: SimulatedPortfolioManager | null = null;

export function getSimulatedPortfolioManager(initialCapital?: number): SimulatedPortfolioManager {
  if (!portfolioManager) {
    portfolioManager = new SimulatedPortfolioManager(initialCapital);
  }
  return portfolioManager;
}
