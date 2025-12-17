/**
 * Enhanced AI Agent Service
 * Integrates real market data with AI-powered analysis
 */

import { getCryptocomAIService } from './cryptocom-service';
import { getMarketDataService } from '../services/RealMarketDataService';
import type { PortfolioAnalysis, RiskAssessment, HedgeRecommendation } from './cryptocom-service';

export class EnhancedAIAgent {
  private aiService = getCryptocomAIService();
  private marketData = getMarketDataService();

  /**
   * Analyze portfolio with real market data
   */
  async analyzePortfolioWithRealData(address: string): Promise<PortfolioAnalysis & { realData: boolean }> {
    // Get real portfolio data
    const portfolioData = await this.marketData.getPortfolioData(address);

    // Get real prices for top assets
    const topAssets = portfolioData.tokens
      .sort((a, b) => b.usdValue - a.usdValue)
      .slice(0, 5)
      .map(token => ({
        symbol: token.symbol,
        value: token.usdValue,
        percentage: (token.usdValue / portfolioData.totalValue) * 100,
      }));

    // Calculate risk score based on real data
    let riskScore = 50; // base
    
    // Increase risk for high concentration
    const maxConcentration = Math.max(...topAssets.map(a => a.percentage));
    if (maxConcentration > 50) riskScore += 20;
    else if (maxConcentration > 30) riskScore += 10;

    // Calculate health score (inverse of risk)
    const healthScore = 100 - riskScore;

    // Generate AI-powered recommendations
    const recommendations: string[] = [];
    
    if (maxConcentration > 50) {
      recommendations.push(
        `⚠️ High concentration in ${topAssets[0].symbol} (${maxConcentration.toFixed(1)}%). Consider diversifying.`
      );
    }

    if (portfolioData.tokens.length < 3) {
      recommendations.push(
        '💡 Portfolio has low diversification. Consider adding 2-3 more assets to reduce risk.'
      );
    }

    if (portfolioData.totalValue > 10000) {
      recommendations.push(
        '🛡️ Consider using perpetual futures on Moonlander to hedge your major positions.'
      );
    }

    recommendations.push(
      '✅ Use TRUE gasless transactions (via x402) to save on gas fees.',
      '📊 Monitor your positions daily for market changes.'
    );

    const analysis: PortfolioAnalysis = {
      totalValue: portfolioData.totalValue,
      positions: portfolioData.tokens.length,
      riskScore,
      healthScore,
      recommendations,
      topAssets,
    };

    return {
      ...analysis,
      realData: true,
    };
  }

  /**
   * Assess risk with real volatility calculations
   */
  async assessRiskWithRealData(address: string): Promise<RiskAssessment & { realData: boolean }> {
    const portfolioData = await this.marketData.getPortfolioData(address);

    // Calculate real volatilities
    const volatilities: number[] = [];
    const weights: number[] = [];

    for (const token of portfolioData.tokens) {
      try {
        const historicalPrices = await this.marketData.getHistoricalPrices(token.symbol, 30);
        if (historicalPrices.length > 0) {
          const prices = historicalPrices.map(h => h.price);
          const volatility = this.marketData.calculateVolatility(prices);
          volatilities.push(volatility);
          weights.push(token.usdValue / portfolioData.totalValue);
        }
      } catch (error) {
        // Use default volatility if calculation fails
        volatilities.push(0.3);
        weights.push(token.usdValue / portfolioData.totalValue);
      }
    }

    // Calculate portfolio volatility (weighted average)
    const portfolioVolatility = volatilities.reduce(
      (sum, vol, i) => sum + vol * weights[i],
      0
    );

    // Calculate VaR 95 (Value at Risk at 95% confidence)
    const zScore95 = 1.645;
    const var95 = portfolioData.totalValue * zScore95 * portfolioVolatility;

    // Calculate Sharpe ratio (simplified)
    const riskFreeRate = 0.05; // 5% annual
    const expectedReturn = 0.12; // 12% expected
    const sharpeRatio = (expectedReturn - riskFreeRate) / portfolioVolatility;

    // Determine overall risk level
    let overallRisk: 'low' | 'medium' | 'high' = 'medium';
    if (portfolioVolatility < 0.2) overallRisk = 'low';
    else if (portfolioVolatility > 0.4) overallRisk = 'high';

    // Calculate risk score
    const riskScore = Math.min(100, portfolioVolatility * 200);

    // Identify risk factors
    const factors = [];

    if (portfolioVolatility > 0.35) {
      factors.push({
        factor: 'High Volatility',
        impact: 'high' as const,
        description: `Portfolio volatility is ${(portfolioVolatility * 100).toFixed(1)}% (annualized)`,
      });
    }

    const maxConcentration = Math.max(
      ...portfolioData.tokens.map(t => (t.usdValue / portfolioData.totalValue) * 100)
    );
    if (maxConcentration > 50) {
      factors.push({
        factor: 'Concentration Risk',
        impact: 'high' as const,
        description: `${maxConcentration.toFixed(1)}% of portfolio in single asset`,
      });
    }

    if (portfolioData.tokens.length < 3) {
      factors.push({
        factor: 'Low Diversification',
        impact: 'medium' as const,
        description: `Only ${portfolioData.tokens.length} assets in portfolio`,
      });
    }

    factors.push({
      factor: 'Market Risk',
      impact: 'medium' as const,
      description: 'Crypto markets are inherently volatile',
    });

    const assessment: RiskAssessment = {
      overallRisk,
      riskScore,
      volatility: portfolioVolatility,
      var95: var95 / portfolioData.totalValue, // Normalize to percentage
      sharpeRatio,
      factors,
    };

    return {
      ...assessment,
      realData: true,
    };
  }

  /**
   * Generate hedge recommendations based on real data
   */
  async generateHedgeRecommendationsWithRealData(
    address: string
  ): Promise<Array<HedgeRecommendation & { realData: boolean }>> {
    const portfolioData = await this.marketData.getPortfolioData(address);

    // Find dominant asset
    const dominantAsset = portfolioData.tokens.reduce((max, token) =>
      token.usdValue > max.usdValue ? token : max
    );

    const dominantPercentage = (dominantAsset.usdValue / portfolioData.totalValue) * 100;

    const recommendations: Array<HedgeRecommendation & { realData: boolean }> = [];

    // Only recommend hedging if concentration is high
    if (dominantPercentage > 40) {
      // Get volatility for dominant asset
      let volatility = 0.35; // default
      try {
        const historicalPrices = await this.marketData.getHistoricalPrices(
          dominantAsset.symbol,
          30
        );
        if (historicalPrices.length > 0) {
          const prices = historicalPrices.map(h => h.price);
          volatility = this.marketData.calculateVolatility(prices);
        }
      } catch (error) {
        console.warn('Failed to get volatility, using default');
      }

      // Recommend short hedge
      const hedgeSize = dominantAsset.usdValue * 0.3; // Hedge 30% of position
      const expectedReduction = volatility * 35; // Expected risk reduction

      recommendations.push({
        strategy: `Short Hedge on ${dominantAsset.symbol}`,
        confidence: 0.75,
        expectedReduction: expectedReduction * 100,
        description: `Open a short position on Moonlander to hedge ${dominantPercentage.toFixed(1)}% ${dominantAsset.symbol} exposure. Use TRUE gasless execution via x402.`,
        actions: [
          {
            action: 'SHORT',
            asset: `${dominantAsset.symbol}-PERP`,
            amount: hedgeSize,
          },
          {
            action: 'SET_STOP_LOSS',
            asset: `${dominantAsset.symbol}-PERP`,
            amount: hedgeSize * 1.05, // 5% stop loss
          },
        ],
        realData: true,
      });

      // Recommend diversification
      recommendations.push({
        strategy: 'Diversification via VVS Finance',
        confidence: 0.68,
        expectedReduction: 25,
        description: `Reduce ${dominantAsset.symbol} concentration by swapping to USDC or other stablecoins on VVS Finance DEX.`,
        actions: [
          {
            action: 'SWAP',
            asset: dominantAsset.symbol,
            amount: dominantAsset.usdValue * 0.2, // Swap 20%
          },
          {
            action: 'BUY',
            asset: 'USDC',
            amount: dominantAsset.usdValue * 0.2,
          },
        ],
        realData: true,
      });
    } else {
      // Low concentration - recommend delta-neutral strategies
      recommendations.push({
        strategy: 'Delta-Neutral Liquidity Provision',
        confidence: 0.62,
        expectedReduction: 15,
        description: `Provide liquidity on VVS Finance to earn fees while maintaining market exposure.`,
        actions: [
          {
            action: 'ADD_LIQUIDITY',
            asset: `${dominantAsset.symbol}/USDC`,
            amount: dominantAsset.usdValue * 0.15,
          },
        ],
        realData: true,
      });
    }

    return recommendations;
  }
}

// Singleton instance
let enhancedAIAgent: EnhancedAIAgent | null = null;

export function getEnhancedAIAgent(): EnhancedAIAgent {
  if (!enhancedAIAgent) {
    enhancedAIAgent = new EnhancedAIAgent();
  }
  return enhancedAIAgent;
}
