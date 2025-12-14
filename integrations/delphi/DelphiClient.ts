/**
 * Delphi Digital Client
 * Integration with Delphi prediction markets on Cronos
 */

import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';
import { logger } from '@shared/utils/logger';
import { config } from '@shared/utils/config';

export interface Market {
  marketId: string;
  question: string;
  category: string;
  outcomes: string[];
  endTime: number;
  resolutionTime: number;
  volume: string;
  liquidity: string;
  status: 'OPEN' | 'CLOSED' | 'RESOLVED' | 'CANCELLED';
  creator: string;
  resolver: string;
  createdAt: number;
}

export interface MarketPrice {
  marketId: string;
  outcome: string;
  price: number; // 0-1 (probability)
  volume24h: string;
  priceChange24h: number;
  timestamp: number;
}

export interface Position {
  positionId: string;
  marketId: string;
  outcome: string;
  shares: string;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnL: string;
  realizedPnL: string;
  status: 'OPEN' | 'CLOSED' | 'REDEEMED';
}

export interface OrderRequest {
  marketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  shares: string;
  price: number; // 0-1
  orderType: 'LIMIT' | 'MARKET';
}

export interface OrderResult {
  orderId: string;
  marketId: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  shares: string;
  price: number;
  status: 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED';
  filledShares: string;
  avgFillPrice: number;
  timestamp: number;
}

export interface MarketResolution {
  marketId: string;
  winningOutcome: string;
  resolutionTime: number;
  resolvedBy: string;
  finalPrices: { [outcome: string]: number };
}

export interface PredictionAnalysis {
  marketId: string;
  question: string;
  outcomes: {
    outcome: string;
    currentPrice: number;
    impliedProbability: number;
    volume: string;
    recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
    confidence: number;
  }[];
  marketSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volumeProfile: string;
  timestamp: number;
}

export class DelphiClient {
  private httpClient: AxiosInstance;
  private signer: ethers.Wallet | ethers.Signer;
  private marketContract?: ethers.Contract;
  private apiKey?: string;
  private initialized: boolean = false;

  // Delphi Market contract address
  private contractAddress: string;

  constructor(
    private provider: ethers.Provider,
    signerOrPrivateKey: ethers.Wallet | ethers.Signer | string
  ) {
    // Initialize HTTP client
    this.httpClient = axios.create({
      baseURL: process.env.NEXT_PUBLIC_DELPHI_API || 'https://api.delphi.markets',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Initialize signer
    if (typeof signerOrPrivateKey === 'string') {
      this.signer = new ethers.Wallet(signerOrPrivateKey, provider);
    } else {
      this.signer = signerOrPrivateKey;
    }

    this.contractAddress = process.env.NEXT_PUBLIC_DELPHI_CONTRACT || '0x0000000000000000000000000000000000000000';
    this.apiKey = process.env.NEXT_PUBLIC_DELPHI_API_KEY || '';

    if (this.apiKey) {
      this.httpClient.defaults.headers.common['X-API-KEY'] = this.apiKey;
    }

    logger.info('DelphiClient initialized', {
      apiUrl: this.httpClient.defaults.baseURL,
      hasApiKey: !!this.apiKey,
    });
  }

  /**
   * Initialize client
   */
  async initialize(): Promise<void> {
    try {
      // Initialize market contract if address provided
      if (this.contractAddress !== '0x0000000000000000000000000000000000000000') {
        const abi = [
          'function createMarket(string memory question, string[] memory outcomes, uint256 endTime) external returns (bytes32)',
          'function buy(bytes32 marketId, uint8 outcomeIndex, uint256 shares) external',
          'function sell(bytes32 marketId, uint8 outcomeIndex, uint256 shares) external',
          'function resolveMarket(bytes32 marketId, uint8 winningOutcome) external',
          'function redeemWinnings(bytes32 marketId) external',
        ];
        this.marketContract = new ethers.Contract(this.contractAddress, abi, this.signer);
      }

      this.initialized = true;
      logger.info('DelphiClient initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize DelphiClient', { error });
      throw error;
    }
  }

  /**
   * Get all active markets
   */
  async getMarkets(params?: {
    category?: string;
    status?: string;
    limit?: number;
  }): Promise<Market[]> {
    this.ensureInitialized();

    try {
      const response = await this.httpClient.get('/v1/markets', { params });
      return response.data;
    } catch (error) {
      logger.error('Failed to get markets', { error });
      throw error;
    }
  }

  /**
   * Get specific market
   */
  async getMarket(marketId: string): Promise<Market> {
    this.ensureInitialized();

    try {
      const response = await this.httpClient.get(`/v1/markets/${marketId}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get market', { marketId, error });
      throw error;
    }
  }

  /**
   * Get market prices
   */
  async getMarketPrices(marketId: string): Promise<MarketPrice[]> {
    this.ensureInitialized();

    try {
      const response = await this.httpClient.get(`/v1/markets/${marketId}/prices`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get market prices', { marketId, error });
      throw error;
    }
  }

  /**
   * Place order
   */
  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    this.ensureInitialized();

    try {
      logger.info('Placing order', { order });

      if (this.marketContract) {
        // On-chain order
        const { marketId, outcome, side, shares, price } = order;
        
        // Find outcome index
        const market = await this.getMarket(marketId);
        const outcomeIndex = market.outcomes.indexOf(outcome);
        
        if (outcomeIndex === -1) {
          throw new Error(`Invalid outcome: ${outcome}`);
        }

        const sharesWei = ethers.parseUnits(shares, 18);
        
        let tx;
        if (side === 'BUY') {
          tx = await this.marketContract.buy(
            ethers.id(marketId),
            outcomeIndex,
            sharesWei
          );
        } else {
          tx = await this.marketContract.sell(
            ethers.id(marketId),
            outcomeIndex,
            sharesWei
          );
        }

        const receipt = await tx.wait();

        logger.info('Order placed on-chain', { txHash: receipt.hash });

        return {
          orderId: receipt.hash,
          marketId,
          outcome,
          side,
          shares,
          price,
          status: 'FILLED',
          filledShares: shares,
          avgFillPrice: price,
          timestamp: Date.now(),
        };
      } else {
        // API order
        const response = await this.httpClient.post('/v1/orders', order);
        return response.data;
      }
    } catch (error) {
      logger.error('Failed to place order', { order, error });
      throw error;
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.httpClient.delete(`/v1/orders/${orderId}`);
      logger.info('Order cancelled', { orderId });
    } catch (error) {
      logger.error('Failed to cancel order', { orderId, error });
      throw error;
    }
  }

  /**
   * Get user positions
   */
  async getPositions(): Promise<Position[]> {
    this.ensureInitialized();

    try {
      const response = await this.httpClient.get('/v1/positions');
      return response.data;
    } catch (error) {
      logger.error('Failed to get positions', { error });
      throw error;
    }
  }

  /**
   * Get position for specific market
   */
  async getPosition(marketId: string): Promise<Position | null> {
    const positions = await this.getPositions();
    return positions.find(p => p.marketId === marketId) || null;
  }

  /**
   * Analyze market and generate prediction insights
   */
  async analyzeMarket(marketId: string): Promise<PredictionAnalysis> {
    this.ensureInitialized();

    try {
      logger.info('Analyzing market', { marketId });

      // Get market info and prices
      const market = await this.getMarket(marketId);
      const prices = await this.getMarketPrices(marketId);

      // Analyze each outcome
      const outcomes = prices.map(price => {
        // Calculate implied probability (price is already 0-1)
        const impliedProb = price.price * 100;

        // Simple recommendation logic based on price movements
        let recommendation: PredictionAnalysis['outcomes'][0]['recommendation'];
        if (price.priceChange24h > 10) {
          recommendation = 'STRONG_BUY';
        } else if (price.priceChange24h > 5) {
          recommendation = 'BUY';
        } else if (price.priceChange24h < -10) {
          recommendation = 'STRONG_SELL';
        } else if (price.priceChange24h < -5) {
          recommendation = 'SELL';
        } else {
          recommendation = 'HOLD';
        }

        // Confidence based on volume
        const volumeNum = parseFloat(price.volume24h);
        const confidence = Math.min(volumeNum / 100000, 1); // Normalize to 0-1

        return {
          outcome: price.outcome,
          currentPrice: price.price,
          impliedProbability: impliedProb,
          volume: price.volume24h,
          recommendation,
          confidence,
        };
      });

      // Determine overall market sentiment
      const avgPriceChange = prices.reduce((sum, p) => sum + p.priceChange24h, 0) / prices.length;
      let marketSentiment: PredictionAnalysis['marketSentiment'];
      if (avgPriceChange > 5) {
        marketSentiment = 'BULLISH';
      } else if (avgPriceChange < -5) {
        marketSentiment = 'BEARISH';
      } else {
        marketSentiment = 'NEUTRAL';
      }

      const analysis: PredictionAnalysis = {
        marketId,
        question: market.question,
        outcomes,
        marketSentiment,
        volumeProfile: market.volume,
        timestamp: Date.now(),
      };

      logger.info('Market analysis completed', { marketId });
      return analysis;
    } catch (error) {
      logger.error('Failed to analyze market', { marketId, error });
      throw error;
    }
  }

  /**
   * Create new market
   */
  async createMarket(params: {
    question: string;
    outcomes: string[];
    category: string;
    endTime: number;
    initialLiquidity?: string;
  }): Promise<{ marketId: string }> {
    this.ensureInitialized();

    try {
      logger.info('Creating market', { question: params.question });

      if (this.marketContract) {
        // On-chain market creation
        const { question, outcomes, endTime } = params;
        
        const tx = await this.marketContract.createMarket(
          question,
          outcomes,
          endTime
        );
        
        const receipt = await tx.wait();
        
        // Parse market ID from events (simplified)
        const marketId = receipt.hash;

        logger.info('Market created on-chain', { marketId });
        return { marketId };
      } else {
        // API market creation
        const response = await this.httpClient.post('/v1/markets', params);
        return response.data;
      }
    } catch (error) {
      logger.error('Failed to create market', { error });
      throw error;
    }
  }

  /**
   * Resolve market
   */
  async resolveMarket(marketId: string, winningOutcome: string): Promise<void> {
    this.ensureInitialized();

    try {
      logger.info('Resolving market', { marketId, winningOutcome });

      if (this.marketContract) {
        const market = await this.getMarket(marketId);
        const outcomeIndex = market.outcomes.indexOf(winningOutcome);
        
        if (outcomeIndex === -1) {
          throw new Error(`Invalid outcome: ${winningOutcome}`);
        }

        const tx = await this.marketContract.resolveMarket(
          ethers.id(marketId),
          outcomeIndex
        );
        
        await tx.wait();
        logger.info('Market resolved on-chain', { marketId });
      } else {
        await this.httpClient.post(`/v1/markets/${marketId}/resolve`, {
          winningOutcome,
        });
        logger.info('Market resolved via API', { marketId });
      }
    } catch (error) {
      logger.error('Failed to resolve market', { marketId, error });
      throw error;
    }
  }

  /**
   * Redeem winnings from resolved market
   */
  async redeemWinnings(marketId: string): Promise<{ amount: string; txHash?: string }> {
    this.ensureInitialized();

    try {
      logger.info('Redeeming winnings', { marketId });

      if (this.marketContract) {
        const tx = await this.marketContract.redeemWinnings(ethers.id(marketId));
        const receipt = await tx.wait();

        // Parse amount from events (simplified)
        logger.info('Winnings redeemed on-chain', { txHash: receipt.hash });
        
        return {
          amount: '0', // Would parse from events
          txHash: receipt.hash,
        };
      } else {
        const response = await this.httpClient.post(`/v1/markets/${marketId}/redeem`);
        return response.data;
      }
    } catch (error) {
      logger.error('Failed to redeem winnings', { marketId, error });
      throw error;
    }
  }

  /**
   * Get market statistics
   */
  async getMarketStats(marketId: string): Promise<{
    totalVolume: string;
    uniqueTraders: number;
    avgTradeSize: string;
    liquidityDepth: string;
    priceVolatility: number;
  }> {
    try {
      const response = await this.httpClient.get(`/v1/markets/${marketId}/stats`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get market stats', { marketId, error });
      throw error;
    }
  }

  /**
   * Search markets by keyword
   */
  async searchMarkets(query: string): Promise<Market[]> {
    try {
      const response = await this.httpClient.get('/v1/markets/search', {
        params: { q: query },
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to search markets', { query, error });
      throw error;
    }
  }

  /**
   * Ensure client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('DelphiClient not initialized. Call initialize() first.');
    }
  }

  /**
   * Disconnect client
   */
  async disconnect(): Promise<void> {
    this.initialized = false;
    logger.info('DelphiClient disconnected');
  }
}

// Export singleton instance factory
let delphiClient: DelphiClient | null = null;

export function getDelphiClient(
  provider: ethers.Provider,
  signer: ethers.Wallet | ethers.Signer | string
): DelphiClient {
  if (!delphiClient) {
    delphiClient = new DelphiClient(provider, signer);
  }
  return delphiClient;
}
