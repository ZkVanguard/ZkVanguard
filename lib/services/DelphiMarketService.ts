/**
 * Delphi Market Service
 * Simplified service for fetching prediction market data in the frontend
 */

export interface PredictionMarket {
  id: string;
  question: string;
  category: 'volatility' | 'price' | 'event' | 'protocol';
  probability: number; // 0-100
  volume: string;
  impact: 'HIGH' | 'MODERATE' | 'LOW';
  relatedAssets: string[];
  lastUpdate: number;
  confidence: number; // 0-100, based on volume and liquidity
  recommendation?: 'HEDGE' | 'MONITOR' | 'IGNORE';
}

export interface DelphiInsight {
  asset: string;
  predictions: PredictionMarket[];
  overallRisk: 'HIGH' | 'MODERATE' | 'LOW';
  suggestedAction: string;
  timestamp: number;
}

export class DelphiMarketService {
  private static readonly API_URL = process.env.NEXT_PUBLIC_DELPHI_API || 'https://api.delphi.markets';
  private static readonly MOCK_MODE = true; // Use mock data for hackathon demo

  /**
   * Get predictions relevant to a specific portfolio strategy
   * Filters by risk level and target yield
   */
  static async getPortfolioRelevantPredictions(
    assets: string[],
    riskTolerance: number, // 0-100
    targetYield: number // e.g., 10 = 10%
  ): Promise<PredictionMarket[]> {
    const allPredictions = await this.getRelevantMarkets(assets);
    
    // Filter predictions based on portfolio risk profile
    return allPredictions.filter(prediction => {
      // High risk portfolios (>60): show all predictions including high-impact ones
      if (riskTolerance > 60) {
        return true; // Show everything
      }
      
      // Medium risk portfolios (30-60): show HIGH and MODERATE, filter LOW
      if (riskTolerance >= 30) {
        return prediction.impact === 'HIGH' || prediction.impact === 'MODERATE';
      }
      
      // Low risk portfolios (<30): only show HIGH impact predictions
      return prediction.impact === 'HIGH';
    }).filter(prediction => {
      // For high yield targets (>15%), prioritize actionable predictions
      if (targetYield > 15) {
        return prediction.recommendation === 'HEDGE' || prediction.recommendation === 'MONITOR';
      }
      
      // For conservative yields (<=10%), only show critical hedges
      if (targetYield <= 10) {
        return prediction.recommendation === 'HEDGE' && prediction.probability > 65;
      }
      
      return true; // Medium yield targets show all
    });
  }

  /**
   * Get relevant prediction markets for portfolio assets
   */
  static async getRelevantMarkets(assets: string[]): Promise<PredictionMarket[]> {
    if (this.MOCK_MODE) {
      return this.getMockMarkets(assets);
    }

    try {
      // In production, fetch from real Delphi API
      const response = await fetch(`${this.API_URL}/v1/markets?category=crypto&limit=20`);
      if (!response.ok) throw new Error('Failed to fetch markets');
      
      const data = await response.json();
      return this.parseMarkets(data);
    } catch (error) {
      console.error('Error fetching Delphi markets:', error);
      // Fallback to mock data
      return this.getMockMarkets(assets);
    }
  }

  /**
   * Get prediction insights for specific asset
   */
  static async getAssetInsights(asset: string): Promise<DelphiInsight> {
    const predictions = await this.getRelevantMarkets([asset]);
    const assetPredictions = predictions.filter(p => p.relatedAssets.includes(asset));

    // Calculate overall risk based on predictions
    const highRiskCount = assetPredictions.filter(p => p.impact === 'HIGH' && p.probability > 60).length;
    let overallRisk: 'HIGH' | 'MODERATE' | 'LOW' = 'LOW';
    if (highRiskCount >= 2) overallRisk = 'HIGH';
    else if (highRiskCount === 1 || assetPredictions.some(p => p.impact === 'MODERATE')) overallRisk = 'MODERATE';

    // Generate suggested action
    let suggestedAction = 'Continue monitoring positions';
    if (overallRisk === 'HIGH') {
      suggestedAction = 'Consider opening hedge positions immediately';
    } else if (overallRisk === 'MODERATE') {
      suggestedAction = 'Prepare contingency hedges, monitor closely';
    }

    return {
      asset,
      predictions: assetPredictions,
      overallRisk,
      suggestedAction,
      timestamp: Date.now(),
    };
  }

  /**
   * Get top prediction markets by volume
   */
  static async getTopMarkets(limit: number = 10): Promise<PredictionMarket[]> {
    const markets = await this.getRelevantMarkets(['BTC', 'ETH', 'CRO', 'USDC']);
    return markets
      .sort((a, b) => parseFloat(b.volume.replace(/[^0-9.]/g, '')) - parseFloat(a.volume.replace(/[^0-9.]/g, '')))
      .slice(0, limit);
  }

  /**
   * Mock markets for hackathon demo
   * Only returns predictions relevant to provided assets (portfolio-based filtering)
   */
  private static getMockMarkets(assets: string[]): PredictionMarket[] {
    const now = Date.now();
    
    // All available predictions (expanded for better demo)
    const allMarkets = [
      {
        id: 'cro-breakout',
        question: 'Will CRO reach $0.20 in Q1 2026?',
        category: 'price' as const,
        probability: 58,
        volume: '$156,000',
        impact: 'MODERATE' as const,
        relatedAssets: ['CRO', 'WCRO'],
        lastUpdate: now - 900000,
        confidence: 72,
        recommendation: 'MONITOR' as const,
      },
      {
        id: 'usdc-depeg-risk',
        question: 'Will USDC depeg by >2% in next 90 days?',
        category: 'event' as const,
        probability: 12,
        volume: '$412,000',
        impact: 'HIGH' as const,
        relatedAssets: ['USDC', 'devUSDC'],
        lastUpdate: now - 1200000,
        confidence: 91,
        recommendation: 'IGNORE' as const,
      },
      {
        id: 'defi-tvl-drop',
        question: 'Will DeFi TVL drop 30%+ in Q1 2026?',
        category: 'event' as const,
        probability: 28,
        volume: '$198,000',
        impact: 'HIGH' as const,
        relatedAssets: ['ETH', 'BTC', 'CRO'],
        lastUpdate: now - 1800000,
        confidence: 76,
        recommendation: 'MONITOR' as const,
      },
      {
        id: 'fed-rate-hike',
        question: 'Will Fed raise rates in Q1 2026?',
        category: 'event' as const,
        probability: 68,
        volume: '$524,000',
        impact: 'HIGH' as const,
        relatedAssets: ['BTC', 'ETH', 'CRO', 'USDC'],
        lastUpdate: now - 3000000,
        confidence: 88,
        recommendation: 'HEDGE' as const,
      },
      {
        id: 'vvs-liquidity',
        question: 'Will VVS Finance maintain $150M+ TVL?',
        category: 'protocol' as const,
        probability: 79,
        volume: '$67,000',
        impact: 'LOW' as const,
        relatedAssets: ['CRO'],
        lastUpdate: now - 3600000,
        confidence: 58,
        recommendation: 'IGNORE' as const,
      },
      {
        id: 'cronos-upgrade',
        question: 'Will Cronos zkEVM launch by March 2026?',
        category: 'event' as const,
        probability: 84,
        volume: '$112,000',
        impact: 'MODERATE' as const,
        relatedAssets: ['CRO'],
        lastUpdate: now - 4200000,
        confidence: 71,
        recommendation: 'MONITOR' as const,
      },
      {
        id: 'btc-volatility',
        question: 'Will BTC volatility exceed 80% in Q1?',
        category: 'volatility' as const,
        probability: 73,
        volume: '$892,000',
        impact: 'HIGH' as const,
        relatedAssets: ['BTC'],
        lastUpdate: now - 600000,
        confidence: 85,
        recommendation: 'HEDGE' as const,
      },
      {
        id: 'eth-gas-spike',
        question: 'Will ETH gas fees spike above 200 gwei?',
        category: 'protocol' as const,
        probability: 45,
        volume: '$234,000',
        impact: 'MODERATE' as const,
        relatedAssets: ['ETH'],
        lastUpdate: now - 1500000,
        confidence: 68,
        recommendation: 'MONITOR' as const,
      },
      {
        id: 'cro-staking-apr',
        question: 'Will CRO staking APR drop below 5%?',
        category: 'protocol' as const,
        probability: 32,
        volume: '$145,000',
        impact: 'MODERATE' as const,
        relatedAssets: ['CRO'],
        lastUpdate: now - 2100000,
        confidence: 64,
        recommendation: 'MONITOR' as const,
      },
      {
        id: 'usdc-yield',
        question: 'Will USDC yields stay above 4% APY?',
        category: 'price' as const,
        probability: 67,
        volume: '$321,000',
        impact: 'LOW' as const,
        relatedAssets: ['USDC', 'devUSDC'],
        lastUpdate: now - 2700000,
        confidence: 77,
        recommendation: 'IGNORE' as const,
      },
      {
        id: 'cronos-dex-volume',
        question: 'Will Cronos DEX volume exceed $500M monthly?',
        category: 'protocol' as const,
        probability: 55,
        volume: '$189,000',
        impact: 'LOW' as const,
        relatedAssets: ['CRO'],
        lastUpdate: now - 3300000,
        confidence: 62,
        recommendation: 'IGNORE' as const,
      },
      {
        id: 'btc-price-target',
        question: 'Will BTC reach $100K in 2026?',
        category: 'price' as const,
        probability: 78,
        volume: '$1,234,000',
        impact: 'HIGH' as const,
        relatedAssets: ['BTC'],
        lastUpdate: now - 450000,
        confidence: 92,
        recommendation: 'MONITOR' as const,
      },
    ];

    // Filter markets based on portfolio assets
    // If no assets provided, return all markets
    if (assets.length === 0) {
      return allMarkets;
    }

    // Normalize asset names for matching (handle variations like BTC/WBTC, USDC/devUSDC)
    const normalizedAssets = assets.map(a => a.toUpperCase().replace(/^(W|DEV)/, ''));

    return allMarkets.filter(market => {
      // Count how many of the market's assets are in the user's portfolio
      const matchingAssets = market.relatedAssets.filter(relatedAsset => {
        const normalized = relatedAsset.toUpperCase().replace(/^(W|DEV)/, '');
        return normalizedAssets.includes(normalized);
      });

      // VERY STRICT FILTERING: Only show predictions directly relevant to portfolio
      // Strategy:
      // - Single/double asset predictions: show if ANY asset matches (directly about your holdings)
      // - Multi-asset predictions (3+): only show if ALL or most assets match
      //   This filters out broad market events that mention your assets but aren't ABOUT them
      
      if (matchingAssets.length === 0) {
        return false; // No match at all
      }
      
      // For 1-2 asset predictions: show them (specific predictions)
      if (market.relatedAssets.length <= 2) {
        return true;
      }
      
      // For 3+ asset predictions: require 75%+ match (strict)
      // Example: "Fed rate hike affects BTC, ETH, CRO, USDC" - only show if you own 3 of 4
      const matchPercentage = matchingAssets.length / market.relatedAssets.length;
      return matchPercentage >= 0.75;
    });
  }

  /**
   * Parse API response to PredictionMarket format
   */
  private static parseMarkets(data: any[]): PredictionMarket[] {
    return data.map(market => {
      // Determine category
      const question = market.question.toLowerCase();
      let category: PredictionMarket['category'] = 'event';
      if (question.includes('volatility') || question.includes('vol')) category = 'volatility';
      else if (question.includes('price') || question.includes('reach') || question.includes('drop')) category = 'price';
      else if (question.includes('tvl') || question.includes('protocol')) category = 'protocol';

      // Extract probability from prices (assuming binary market)
      const probability = market.prices?.[0]?.price ? market.prices[0].price * 100 : 50;

      // Determine impact
      let impact: PredictionMarket['impact'] = 'LOW';
      if (category === 'volatility' || category === 'event') impact = 'HIGH';
      else if (category === 'price' || category === 'protocol') impact = 'MODERATE';

      // Extract related assets
      const relatedAssets: string[] = [];
      if (question.includes('btc') || question.includes('bitcoin')) relatedAssets.push('BTC');
      if (question.includes('eth') || question.includes('ethereum')) relatedAssets.push('ETH');
      if (question.includes('cro') || question.includes('cronos')) relatedAssets.push('CRO');
      if (question.includes('usdc')) relatedAssets.push('USDC');

      // Calculate confidence based on volume
      const volumeNum = parseFloat(market.volume || '0');
      const confidence = Math.min(Math.max(volumeNum / 10000 * 100, 20), 95);

      // Recommendation
      let recommendation: PredictionMarket['recommendation'] = 'IGNORE';
      if (impact === 'HIGH' && probability > 60) recommendation = 'HEDGE';
      else if (impact !== 'LOW' && probability > 40) recommendation = 'MONITOR';

      return {
        id: market.marketId || `market-${Math.random().toString(36).substr(2, 9)}`,
        question: market.question,
        category,
        probability: Math.round(probability),
        volume: `$${(volumeNum / 1000).toFixed(0)}K`,
        impact,
        relatedAssets,
        lastUpdate: market.timestamp || Date.now(),
        confidence: Math.round(confidence),
        recommendation,
      };
    });
  }

  /**
   * Format time ago
   */
  static formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}
