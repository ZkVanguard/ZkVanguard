/**
 * Comprehensive Test Suite for AI and Portfolio Integration
 * Tests all AI features, API endpoints, and components
 */

import { getCryptocomAIService } from '../lib/ai/cryptocom-service';

// Mock portfolio data for testing
const mockPortfolio = {
  tokens: [
    { symbol: 'BTC', usdValue: 50000 },
    { symbol: 'ETH', usdValue: 30000 },
    { symbol: 'CRO', usdValue: 15000 },
    { symbol: 'USDC', usdValue: 5000 },
  ],
  totalValue: 100000,
};

describe('AI Service Tests', () => {
  describe('CryptocomAIService Initialization', () => {
    test('should initialize service without API key', () => {
      const service = getCryptocomAIService();
      expect(service).toBeDefined();
      expect(service.isAvailable()).toBeDefined();
    });

    test('should provide fallback logic when unavailable', async () => {
      const service = getCryptocomAIService();
      const intent = await service.parseIntent('analyze my portfolio');
      expect(intent).toHaveProperty('intent');
      expect(intent).toHaveProperty('confidence');
      expect(intent.intent).toBe('analyze_portfolio');
    });
  });

  describe('Intent Parsing', () => {
    const service = getCryptocomAIService();

    test('should recognize portfolio analysis intent', async () => {
      const result = await service.parseIntent('show me my portfolio');
      expect(result.intent).toBe('analyze_portfolio');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should recognize risk assessment intent', async () => {
      const result = await service.parseIntent('what is my risk level');
      expect(result.intent).toBe('assess_risk');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should recognize hedge generation intent', async () => {
      const result = await service.parseIntent('suggest hedges for my positions');
      expect(result.intent).toBe('generate_hedge');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should handle unknown intents', async () => {
      const result = await service.parseIntent('random gibberish xyz123');
      expect(result.intent).toBe('unknown');
      expect(result.confidence).toBe(0);
    });
  });

  describe('Portfolio Analysis', () => {
    const service = getCryptocomAIService();

    test('should analyze portfolio and return valid data', async () => {
      const analysis = await service.analyzePortfolio('0x123', {});
      expect(analysis).toHaveProperty('totalValue');
      expect(analysis).toHaveProperty('positions');
      expect(analysis).toHaveProperty('riskScore');
      expect(analysis).toHaveProperty('healthScore');
      expect(analysis).toHaveProperty('recommendations');
      expect(analysis).toHaveProperty('topAssets');
      expect(Array.isArray(analysis.recommendations)).toBe(true);
      expect(Array.isArray(analysis.topAssets)).toBe(true);
    });

    test('should return reasonable values', async () => {
      const analysis = await service.analyzePortfolio('0x456', mockPortfolio);
      expect(analysis.totalValue).toBeGreaterThan(0);
      expect(analysis.riskScore).toBeGreaterThanOrEqual(0);
      expect(analysis.riskScore).toBeLessThanOrEqual(100);
      expect(analysis.healthScore).toBeGreaterThanOrEqual(0);
      expect(analysis.healthScore).toBeLessThanOrEqual(100);
    });

    test('should provide top assets', async () => {
      const analysis = await service.analyzePortfolio('0x789', mockPortfolio);
      expect(analysis.topAssets.length).toBeGreaterThan(0);
      analysis.topAssets.forEach(asset => {
        expect(asset).toHaveProperty('symbol');
        expect(asset).toHaveProperty('value');
        expect(asset).toHaveProperty('percentage');
        expect(asset.percentage).toBeGreaterThanOrEqual(0);
        expect(asset.percentage).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('Risk Assessment', () => {
    const service = getCryptocomAIService();

    test('should assess risk and return valid metrics', async () => {
      const risk = await service.assessRisk({});
      expect(risk).toHaveProperty('overallRisk');
      expect(risk).toHaveProperty('riskScore');
      expect(risk).toHaveProperty('volatility');
      expect(risk).toHaveProperty('var95');
      expect(risk).toHaveProperty('sharpeRatio');
      expect(risk).toHaveProperty('factors');
      expect(['low', 'medium', 'high']).toContain(risk.overallRisk);
    });

    test('should provide risk factors', async () => {
      const risk = await service.assessRisk({});
      expect(Array.isArray(risk.factors)).toBe(true);
      expect(risk.factors.length).toBeGreaterThan(0);
      risk.factors.forEach(factor => {
        expect(factor).toHaveProperty('factor');
        expect(factor).toHaveProperty('impact');
        expect(factor).toHaveProperty('description');
        expect(['low', 'medium', 'high']).toContain(factor.impact);
      });
    });

    test('should return reasonable risk values', async () => {
      const risk = await service.assessRisk({});
      expect(risk.volatility).toBeGreaterThanOrEqual(0);
      expect(risk.volatility).toBeLessThanOrEqual(1);
      expect(risk.var95).toBeGreaterThanOrEqual(0);
      expect(risk.var95).toBeLessThanOrEqual(1);
      expect(risk.sharpeRatio).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Hedge Recommendations', () => {
    const service = getCryptocomAIService();

    test('should generate hedge recommendations', async () => {
      const hedges = await service.generateHedgeRecommendations({}, {});
      expect(Array.isArray(hedges)).toBe(true);
      expect(hedges.length).toBeGreaterThan(0);
    });

    test('should provide valid hedge structure', async () => {
      const hedges = await service.generateHedgeRecommendations({}, {});
      hedges.forEach(hedge => {
        expect(hedge).toHaveProperty('strategy');
        expect(hedge).toHaveProperty('confidence');
        expect(hedge).toHaveProperty('expectedReduction');
        expect(hedge).toHaveProperty('description');
        expect(hedge).toHaveProperty('actions');
        expect(Array.isArray(hedge.actions)).toBe(true);
        expect(hedge.confidence).toBeGreaterThanOrEqual(0);
        expect(hedge.confidence).toBeLessThanOrEqual(1);
      });
    });

    test('should provide actionable hedge steps', async () => {
      const hedges = await service.generateHedgeRecommendations({}, {});
      const firstHedge = hedges[0];
      expect(firstHedge.actions.length).toBeGreaterThan(0);
      firstHedge.actions.forEach(action => {
        expect(action).toHaveProperty('action');
        expect(action).toHaveProperty('asset');
        expect(action).toHaveProperty('amount');
      });
    });
  });
});

describe('API Endpoint Tests', () => {
  // Helper to check if server is running
  const isServerRunning = async (): Promise<boolean> => {
    try {
      const response = await fetch('http://localhost:3000/api/agents/status', {
        signal: AbortSignal.timeout(1000)
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  describe('Portfolio Analysis API', () => {
    test('GET /api/agents/portfolio/analyze - should return status', async () => {
      const serverRunning = await isServerRunning();
      if (!serverRunning) {
        console.log('⚠️  Server not running - skipping API test (run: npm run dev)');
        return; // Skip test if server isn't running
      }

      const response = await fetch('http://localhost:3000/api/agents/portfolio/analyze');
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data.status).toContain('operational');
    });

    test('POST /api/agents/portfolio/analyze - should analyze portfolio', async () => {
      const serverRunning = await isServerRunning();
      if (!serverRunning) {
        console.log('⚠️  Server not running - skipping API test (run: npm run dev)');
        return; // Skip test if server isn't running
      }

      const response = await fetch('http://localhost:3000/api/agents/portfolio/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEbC' }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('analysis');
      expect(data.analysis).toHaveProperty('totalValue');
      expect(data.analysis).toHaveProperty('healthScore');
    });
  });

  describe('Risk Assessment API', () => {
    test('POST /api/agents/risk/assess - should assess risk', async () => {
      const serverRunning = await isServerRunning();
      if (!serverRunning) {
        console.log('⚠️  Server not running - skipping API test (run: npm run dev)');
        return; // Skip test if server isn't running
      }

      const response = await fetch('http://localhost:3000/api/agents/risk/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEbC' }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('var');
      expect(data).toHaveProperty('volatility');
      expect(data).toHaveProperty('riskScore');
      expect(data).toHaveProperty('aiPowered');
    });
  });

  describe('Hedging Recommendations API', () => {
    test('POST /api/agents/hedging/recommend - should generate hedges', async () => {
      const serverRunning = await isServerRunning();
      if (!serverRunning) {
        console.log('⚠️  Server not running - skipping API test (run: npm run dev)');
        return; // Skip test if server isn't running
      }

      const response = await fetch('http://localhost:3000/api/agents/hedging/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEbC' }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('recommendations');
      expect(data).toHaveProperty('aiPowered');
      expect(Array.isArray(data.recommendations)).toBe(true);
    });
  });
});

export {};
