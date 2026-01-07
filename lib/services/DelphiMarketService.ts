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
   */
  private static getMockMarkets(assets: string[]): PredictionMarket[] {
    const now = Date.now();
    
    return [
      {
        id: 'btc-vol-spike-30d',
        question: 'Will BTC volatility exceed 60% in next 30 days?',
        category: 'volatility',
        probability: 73,
        volume: '$245,000',
        impact: 'HIGH',
        relatedAssets: ['BTC', 'WBTC'],
        lastUpdate: now - 300000,
        confidence: 85,
        recommendation: 'HEDGE',
      },
      {
        id: 'eth-price-3k',
        question: 'Will ETH drop below $3,000 this week?',
        category: 'price',
        probability: 42,
        volume: '$89,000',
        impact: 'MODERATE',
        relatedAssets: ['ETH', 'WETH'],
        lastUpdate: now - 600000,
        confidence: 68,
        recommendation: 'MONITOR',
      },
      {
        id: 'cro-breakout',
        question: 'Will CRO reach $0.20 in Q1 2026?',
        category: 'price',
        probability: 58,
        volume: '$156,000',
        impact: 'MODERATE',
        relatedAssets: ['CRO', 'WCRO'],
        lastUpdate: now - 900000,
        confidence: 72,
        recommendation: 'MONITOR',
      },
      {
        id: 'usdc-depeg-risk',
        question: 'Will USDC depeg by >2% in next 90 days?',
        category: 'event',
        probability: 12,
        volume: '$412,000',
        impact: 'HIGH',
        relatedAssets: ['USDC', 'devUSDC'],
        lastUpdate: now - 1200000,
        confidence: 91,
        recommendation: 'IGNORE',
      },
      {
        id: 'defi-tvl-drop',
        question: 'Will DeFi TVL drop 30%+ in Q1 2026?',
        category: 'event',
        probability: 28,
        volume: '$198,000',
        impact: 'HIGH',
        relatedAssets: ['ETH', 'BTC', 'CRO'],
        lastUpdate: now - 1800000,
        confidence: 76,
        recommendation: 'MONITOR',
      },
      {
        id: 'lido-tvl-risk',
        question: 'Will Lido TVL drop 20%+ this month?',
        category: 'protocol',
        probability: 31,
        volume: '$203,000',
        impact: 'MODERATE',
        relatedAssets: ['ETH', 'stETH'],
        lastUpdate: now - 2400000,
        confidence: 64,
        recommendation: 'MONITOR',
      },
      {
        id: 'fed-rate-hike',
        question: 'Will Fed raise rates in Q1 2026?',
        category: 'event',
        probability: 68,
        volume: '$524,000',
        impact: 'HIGH',
        relatedAssets: ['BTC', 'ETH', 'CRO', 'USDC'],
        lastUpdate: now - 3000000,
        confidence: 88,
        recommendation: 'HEDGE',
      },
      {
        id: 'vvs-liquidity',
        question: 'Will VVS Finance maintain $150M+ TVL?',
        category: 'protocol',
        probability: 79,
        volume: '$67,000',
        impact: 'LOW',
        relatedAssets: ['CRO'],
        lastUpdate: now - 3600000,
        confidence: 58,
        recommendation: 'IGNORE',
      },
      {
        id: 'cronos-upgrade',
        question: 'Will Cronos zkEVM launch by March 2026?',
        category: 'event',
        probability: 84,
        volume: '$112,000',
        impact: 'MODERATE',
        relatedAssets: ['CRO'],
        lastUpdate: now - 4200000,
        confidence: 71,
        recommendation: 'MONITOR',
      },
      {
        id: 'btc-halving-rally',
        question: 'Will BTC reach new ATH post-halving 2024?',
        category: 'price',
        probability: 67,
        volume: '$789,000',
        impact: 'MODERATE',
        relatedAssets: ['BTC', 'WBTC'],
        lastUpdate: now - 4800000,
        confidence: 82,
        recommendation: 'MONITOR',
      },
    ];
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
