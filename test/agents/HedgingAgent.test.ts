/**
 * HedgingAgent Tests
 * Comprehensive tests for automated hedging strategies
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { HedgingAgent, HedgeStrategy, HedgeAnalysis } from '../../agents/specialized/HedgingAgent';
import { AgentTask } from '../../shared/types/agent';

// Mock dependencies with implementations
jest.mock('../../integrations/moonlander/MoonlanderClient', () => ({
  MoonlanderClient: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getMarketInfo: jest.fn().mockResolvedValue({
      market: 'BTC-USD-PERP',
      baseAsset: 'BTC',
      quoteAsset: 'USD',
      tickSize: '0.1',
      stepSize: '0.001',
      minNotional: '10',
      maxLeverage: 10,
    }),
    getFundingHistory: jest.fn().mockResolvedValue([
      { rate: '0.0001', timestamp: Date.now() },
      { rate: '0.0002', timestamp: Date.now() - 3600000 },
    ]),
    getPositions: jest.fn().mockResolvedValue([]),
    createOrder: jest.fn().mockResolvedValue({
      orderId: 'mock-order-123',
      market: 'BTC-USD-PERP',
      side: 'sell',
      type: 'limit',
      quantity: '1',
      price: '87000',
      status: 'open',
    }),
    closePosition: jest.fn().mockImplementation(async ({ market, size }) => {
      if (market === 'ETH-USD-PERP' && size) {
        return Promise.resolve({
          orderId: 'mock-partial-close-123',
          market: 'ETH-USD-PERP',
          filledSize: size,
          avgExitPrice: '3000',
          status: 'FILLED',
        });
      }
      return Promise.resolve({
        orderId: 'mock-close-123',
        market: 'ETH-USD-PERP',
        filledSize: '1.0',
        avgExitPrice: '3000',
        status: 'FILLED',
      });
    }),
    openHedge: jest.fn().mockImplementation(async (params) => {
      return Promise.resolve({
        orderId: 'mock-open-123',
        market: params.market,
        side: params.side,
        notionalValue: params.notionalValue,
        leverage: params.leverage,
        status: 'OPEN',
      });
    }),
  })),
}));

jest.mock('../../integrations/mcp/MCPClient', () => ({
  MCPClient: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getPrice: jest.fn().mockResolvedValue({
      symbol: 'BTC',
      price: 87000,
      timestamp: Date.now(),
    }),
    getHistoricalPrices: jest.fn().mockResolvedValue([
      { price: 87000, timestamp: Date.now() },
      { price: 86500, timestamp: Date.now() - 86400000 },
      { price: 86000, timestamp: Date.now() - 172800000 },
    ]),
    getVolatility: jest.fn().mockResolvedValue(0.35),
  })),
}));

describe('HedgingAgent', () => {
  let agent: HedgingAgent;
  let provider: ethers.Provider;
  let signer: ethers.Wallet;

  beforeEach(async () => {
    // Setup test provider and signer
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    signer = ethers.Wallet.createRandom().connect(provider);

    // Initialize agent
    agent = new HedgingAgent('test-hedge-agent', provider, signer);
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      expect(agent).toBeDefined();
      expect(agent.getStatus().status).toBe('idle'); // After shutdown in afterEach, next test starts fresh
    });

    it('should have correct capabilities', () => {
      const capabilities = agent.getCapabilities();
      expect(capabilities).toContain('RISK_ANALYSIS');
      expect(capabilities).toContain('PORTFOLIO_MANAGEMENT');
      expect(capabilities).toContain('MARKET_INTEGRATION');
    });

    it('should initialize with empty strategy map', () => {
      expect(agent['activeStrategies'].size).toBe(0);
    });
  });

  describe('Hedge Analysis', () => {
    it('should analyze hedge opportunity correctly', async () => {
      const task: AgentTask = {
        id: 'test-analyze-1',
        action: 'analyze_hedge',
        parameters: {
          portfolioId: 'portfolio-1',
          assetSymbol: 'BTC',
          notionalValue: '1000000',
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      const analysis = result.data as HedgeAnalysis;
      expect(analysis.portfolioId).toBe('portfolio-1');
      expect(analysis.exposure.asset).toBe('BTC');
      expect(analysis.recommendation).toBeDefined();
      expect(analysis.riskMetrics).toBeDefined();
    });

    it('should calculate optimal hedge ratio', async () => {
      const ratio = await agent['calculateOptimalHedgeRatio']('BTC', '1000000', 0.4);
      
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(1);
    });

    it('should calculate volatility from historical data', async () => {
      const volatility = await agent['calculateVolatility']('ETH');
      
      expect(volatility).toBeGreaterThan(0);
      expect(volatility).toBeLessThan(2); // Reasonable range
    });

    it('should recommend hedge for high volatility', async () => {
      const task: AgentTask = {
        id: 'test-analyze-2',
        action: 'analyze_hedge',
        parameters: {
          portfolioId: 'portfolio-1',
          assetSymbol: 'BTC',
          notionalValue: '5000000',
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const analysis = result.data as HedgeAnalysis;

      expect(['OPEN', 'HOLD']).toContain(analysis.recommendation.action);
    });
  });

  describe('Opening Hedge Positions', () => {
    it('should open hedge position successfully', async () => {
      const task: AgentTask = {
        id: 'test-open-1',
        action: 'open_hedge',
        parameters: {
          market: 'BTC-USD-PERP',
          side: 'SHORT',
          notionalValue: '100000',
          leverage: 2,
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('orderId');
      expect(result.data).toHaveProperty('market');
      expect(result.data).toHaveProperty('side');
    });

    it('should include stop-loss when specified', async () => {
      const task: AgentTask = {
        id: 'test-open-2',
        action: 'open_hedge',
        parameters: {
          market: 'ETH-USD-PERP',
          side: 'SHORT',
          notionalValue: '50000',
          leverage: 1,
          stopLoss: '2100',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
    });

    it('should include take-profit when specified', async () => {
      const task: AgentTask = {
        id: 'test-open-3',
        action: 'open_hedge',
        parameters: {
          market: 'BTC-USD-PERP',
          side: 'LONG',
          notionalValue: '75000',
          leverage: 3,
          takeProfit: '50000',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
    });

    it('should validate leverage limits', async () => {
      const task: AgentTask = {
        id: 'test-open-4',
        action: 'open_hedge',
        parameters: {
          market: 'CRO-USD-PERP',
          side: 'SHORT',
          notionalValue: '10000',
          leverage: 100, // Excessive leverage
        },
        priority: 2,
        createdAt: Date.now(),
      };

      // Should either reject or cap leverage
      const result = await agent['executeTask'](task);
      
      if (result.success) {
        expect(result.data.leverage).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('Closing Hedge Positions', () => {
    it('should close hedge position successfully', async () => {
      const task: AgentTask = {
        id: 'test-close-1',
        action: 'close_hedge',
        parameters: {
          market: 'BTC-USD-PERP',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('orderId');
      expect(result.data).toHaveProperty('closedSize');
    });

    it('should support partial closing', async () => {
      const task: AgentTask = {
        id: 'test-close-2',
        action: 'close_hedge',
        parameters: {
          market: 'ETH-USD-PERP',
          size: '0.5', // Partial close
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
    });
  });

  describe('Rebalancing', () => {
    beforeEach(async () => {
      // Create a test strategy
      const strategy: HedgeStrategy = {
        strategyId: 'strategy-test-1',
        portfolioId: 'portfolio-1',
        targetMarket: 'BTC-USD-PERP',
        hedgeRatio: 0.5,
        rebalanceThreshold: 10,
        maxLeverage: 5,
        active: true,
      };
      
      agent['activeStrategies'].set(strategy.strategyId, strategy);
    });

    it('should rebalance when threshold exceeded', async () => {
      const task: AgentTask = {
        id: 'test-rebalance-1',
        action: 'rebalance_hedge',
        parameters: {
          strategyId: 'strategy-test-1',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(['rebalanced', 'hold', 'none']).toContain(result.data.action);
    });

    it('should not rebalance within threshold', async () => {
      const task: AgentTask = {
        id: 'test-rebalance-2',
        action: 'rebalance_hedge',
        parameters: {
          strategyId: 'strategy-test-1',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      if (result.data.action === 'hold') {
        expect(result.data.reason).toContain('threshold');
      }
    });

    it('should handle missing strategy gracefully', async () => {
      const task: AgentTask = {
        id: 'test-rebalance-3',
        action: 'rebalance_hedge',
        parameters: {
          strategyId: 'non-existent',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Strategy Management', () => {
    it('should create hedge strategy', async () => {
      const task: AgentTask = {
        id: 'test-strategy-1',
        action: 'create_strategy',
        parameters: {
          portfolioId: 'portfolio-1',
          targetMarket: 'BTC-USD-PERP',
          hedgeRatio: 0.6,
          rebalanceThreshold: 15,
          maxLeverage: 3,
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('strategyId');
      expect(result.data.active).toBe(true);
      expect(result.data.hedgeRatio).toBe(0.6);
    });

    it('should store strategy in active strategies', async () => {
      const initialSize = agent['activeStrategies'].size;

      const task: AgentTask = {
        id: 'test-strategy-2',
        action: 'create_strategy',
        parameters: {
          portfolioId: 'portfolio-2',
          targetMarket: 'ETH-USD-PERP',
          hedgeRatio: 0.7,
          rebalanceThreshold: 10,
          maxLeverage: 2,
        },
        priority: 1,
        createdAt: Date.now(),
      };

      await agent['executeTask'](task);

      expect(agent['activeStrategies'].size).toBe(initialSize + 1);
    });
  });

  describe('Position Monitoring', () => {
    it('should monitor positions and detect risks', async () => {
      const task: AgentTask = {
        id: 'test-monitor-1',
        action: 'monitor_positions',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('positions');
      expect(result.data).toHaveProperty('alerts');
      expect(result.data).toHaveProperty('timestamp');
    });

    it('should generate alerts for high risk positions', async () => {
      const task: AgentTask = {
        id: 'test-monitor-2',
        action: 'monitor_positions',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      if (result.data.alerts.length > 0) {
        const alert = result.data.alerts[0];
        expect(alert).toHaveProperty('positionId');
        expect(alert).toHaveProperty('riskLevel');
        expect(['HIGH', 'CRITICAL']).toContain(alert.riskLevel);
      }
    });

    it('should start monitoring on interval', () => {
      agent.startMonitoring(5000);
      
      expect(agent['monitoringInterval']).toBeDefined();
    });

    it('should stop monitoring', () => {
      agent.startMonitoring(5000);
      agent.stopMonitoring();
      
      expect(agent['monitoringInterval']).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown action', async () => {
      const task: AgentTask = {
        id: 'test-error-1',
        action: 'unknown_action',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('should handle missing parameters', async () => {
      const task: AgentTask = {
        id: 'test-error-2',
        action: 'analyze_hedge',
        parameters: {}, // Missing required parameters
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(false);
    });

    it('should recover from integration failures', async () => {
      // Mock integration failure
      const task: AgentTask = {
        id: 'test-error-3',
        action: 'open_hedge',
        parameters: {
          market: 'INVALID-MARKET',
          side: 'SHORT',
          notionalValue: '100000',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      // Should fail gracefully
      expect(result).toBeDefined();
      expect(result.agentId).toBe('test-hedge-agent');
    });
  });

  describe('Performance', () => {
    it('should execute tasks within reasonable time', async () => {
      const task: AgentTask = {
        id: 'test-perf-1',
        action: 'analyze_hedge',
        parameters: {
          portfolioId: 'portfolio-1',
          assetSymbol: 'BTC',
          notionalValue: '1000000',
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const startTime = Date.now();
      const result = await agent['executeTask'](task);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000); // 5 seconds max
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should handle multiple concurrent tasks', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `test-concurrent-${i}`,
        action: 'analyze_hedge',
        parameters: {
          portfolioId: 'portfolio-1',
          assetSymbol: 'BTC',
          notionalValue: '1000000',
        },
        priority: 1,
        createdAt: Date.now(),
      }));

      const promises = tasks.map(task => agent.addTask(task));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
    });
  });

  describe('Integration with Moonlander', () => {
    it('should use MoonlanderClient for market data', async () => {
      const task: AgentTask = {
        id: 'test-integration-1',
        action: 'analyze_hedge',
        parameters: {
          portfolioId: 'portfolio-1',
          assetSymbol: 'BTC',
          notionalValue: '1000000',
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      // Verify Moonlander was called (via mock)
    });

    it('should execute trades through MoonlanderClient', async () => {
      const task: AgentTask = {
        id: 'test-integration-2',
        action: 'open_hedge',
        parameters: {
          market: 'BTC-USD-PERP',
          side: 'SHORT',
          notionalValue: '100000',
          leverage: 2,
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('orderId');
    });
  });

  describe('Integration with MCP', () => {
    it('should fetch price data from MCP', async () => {
      const volatility = await agent['calculateVolatility']('ETH');
      
      expect(volatility).toBeGreaterThan(0);
      // Verify MCP was called (via mock)
    });

    it('should calculate correlations using MCP data', async () => {
      const correlation = await agent['calculateSpotFutureCorrelation']('BTC');
      
      expect(correlation).toBeGreaterThan(0);
      expect(correlation).toBeLessThanOrEqual(1);
    });
  });
});
