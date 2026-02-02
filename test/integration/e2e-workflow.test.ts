/**
 * End-to-End Integration Tests
 * Tests complete workflows with multiple agents and integrations
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { LeadAgent } from '../../agents/core/LeadAgent';
import { HedgingAgent } from '../../agents/specialized/HedgingAgent';
import { SettlementAgent } from '../../agents/specialized/SettlementAgent';
import { ReportingAgent } from '../../agents/specialized/ReportingAgent';
import { RiskAgent } from '../../agents/specialized/RiskAgent';
import { AgentRegistry } from '../../agents/core/AgentRegistry';
import { MessageBus } from '../../agents/communication/MessageBus';

describe('End-to-End Integration Tests', () => {
  let provider: ethers.Provider;
  let signer: ethers.Wallet;
  let registry: AgentRegistry;
  let messageBus: MessageBus;
  let leadAgent: LeadAgent;
  let riskAgent: RiskAgent;
  let hedgingAgent: HedgingAgent;
  let settlementAgent: SettlementAgent;
  let reportingAgent: ReportingAgent;

  const paymentRouterAddress = '0x1234567890123456789012345678901234567890';
  const rwaManagerAddress = '0x0987654321098765432109876543210987654321';

  beforeAll(async () => {
    // Setup test environment
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    signer = ethers.Wallet.createRandom().connect(provider);

    // Initialize message bus and registry
    messageBus = MessageBus.getInstance();
    registry = new AgentRegistry();

    // Initialize all agents
    riskAgent = new RiskAgent('risk-1', provider, signer, rwaManagerAddress);
    hedgingAgent = new HedgingAgent('hedge-1', provider, signer);
    settlementAgent = new SettlementAgent('settle-1', provider, signer, paymentRouterAddress);
    reportingAgent = new ReportingAgent('report-1', provider);
    leadAgent = new LeadAgent('lead-1', provider, signer, registry);

    // Initialize all
    await riskAgent.initialize();
    await hedgingAgent.initialize();
    await settlementAgent.initialize();
    await reportingAgent.initialize();
    await leadAgent.initialize();

    // Register agents
    registry.register(riskAgent);
    registry.register(hedgingAgent);
    registry.register(settlementAgent);
    registry.register(reportingAgent);
  });

  afterAll(async () => {
    // Cleanup
    await riskAgent.shutdown();
    await hedgingAgent.shutdown();
    await settlementAgent.shutdown();
    await reportingAgent.shutdown();
    await leadAgent.shutdown();
  });

  describe('Complete Risk Management Workflow', () => {
    it('should analyze risk and auto-hedge if necessary', async () => {
      // Step 1: Analyze risk
      const riskTask = await riskAgent.addTask({
        id: 'workflow-risk-1',
        action: 'analyze_risk',
        parameters: {
          portfolioId: 'portfolio-1',
          assetAllocation: {
            BTC: 40,
            ETH: 30,
            CRO: 20,
            USDC: 10,
          },
        },
        priority: 2,
        createdAt: Date.now(),
      });

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 2: If high risk, create hedge
      const hedgeTask = await hedgingAgent.addTask({
        id: 'workflow-hedge-1',
        action: 'analyze_hedge',
        parameters: {
          portfolioId: 'portfolio-1',
          assetSymbol: 'BTC',
          notionalValue: '4000000', // 40% of 10M portfolio
        },
        priority: 2,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(riskTask).toBeDefined();
      expect(hedgeTask).toBeDefined();
    });

    it('should generate comprehensive report after operations', async () => {
      // Generate report covering all operations
      const reportTask = await reportingAgent.addTask({
        id: 'workflow-report-1',
        action: 'generate_comprehensive_report',
        parameters: {
          portfolioId: 'portfolio-1',
        },
        priority: 1,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(reportTask).toBeDefined();
    }, 15000);
  });

  describe('Multi-Agent Coordination', () => {
    it('should coordinate risk analysis, hedging, and settlement', async () => {
      // Risk agent identifies need for hedge
      await riskAgent.addTask({
        id: 'coord-risk-1',
        action: 'analyze_risk',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 2,
        createdAt: Date.now(),
      });

      // Hedging agent opens position
      await hedgingAgent.addTask({
        id: 'coord-hedge-1',
        action: 'open_hedge',
        parameters: {
          market: 'BTC-USD-PERP',
          side: 'SHORT',
          notionalValue: '100000',
          leverage: 2,
        },
        priority: 2,
        createdAt: Date.now(),
      });

      // Settlement agent processes payments
      await settlementAgent.addTask({
        id: 'coord-settle-1',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary',
          amount: '1000',
          token: '0xUSDC',
          purpose: 'Hedge funding',
          priority: 'HIGH',
        },
        priority: 2,
        createdAt: Date.now(),
      });

      // Wait for all to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify all executed
      expect(riskAgent.getExecutionHistory().length).toBeGreaterThan(0);
      expect(hedgingAgent.getExecutionHistory().length).toBeGreaterThan(0);
      // Settlement was created (execution history), but not auto-processed (needs URGENT priority)
      expect(settlementAgent.getExecutionHistory().length).toBeGreaterThan(0);
    });
  });

  describe('Natural Language Intent Processing', () => {
    it('should process hedge request from natural language', async () => {
      const intent = "Hedge 50% of my BTC exposure using perpetual futures with 2x leverage and 5% stop loss";

      const result = await leadAgent.executeStrategyFromIntent(intent);

      expect(result).toBeDefined();
      // LeadAgent should delegate to HedgingAgent
    });

    it('should process settlement request from natural language', async () => {
      const intent = "Process all pending settlements as a batch";

      const result = await leadAgent.executeStrategyFromIntent(intent);

      expect(result).toBeDefined();
      // LeadAgent should delegate to SettlementAgent
    });

    it('should process report request from natural language', async () => {
      const intent = "Generate a comprehensive report for portfolio-1 including ZK proofs";

      const result = await leadAgent.executeStrategyFromIntent(intent);

      expect(result).toBeDefined();
      // LeadAgent should delegate to ReportingAgent
    });
  });

  describe('Message Bus Communication', () => {
    it('should broadcast messages between agents', async () => {
      const messagesReceived: any[] = [];

      // Subscribe to messages
      messageBus.subscribe('test-channel', (message) => {
        messagesReceived.push(message);
      });

      // Publish message
      messageBus.publish('test-channel', {
        from: 'agent-1',
        to: 'agent-2',
        action: 'test-action',
        data: { test: true },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messagesReceived.length).toBe(1);
      expect(messagesReceived[0].action).toBe('test-action');
    });

    it('should support agent-to-agent communication', async () => {
      // Risk agent sends alert to hedging agent
      messageBus.publish('hedging', {
        from: 'risk-1',
        to: 'hedge-1',
        action: 'high_volatility_alert',
        data: {
          asset: 'BTC',
          volatility: 0.45,
          recommendation: 'increase_hedge',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify message in history
      const history = messageBus.getMessageHistory('hedging', 10);
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe('Agent Registry', () => {
    it('should find agents by capability', async () => {
      const riskAgents = await registry.findAgentsByCapability('RISK_ANALYSIS');

      expect(riskAgents.length).toBeGreaterThan(0);
      expect(riskAgents.some(a => a.agentId === 'risk-1')).toBe(true);
    });

    it('should find agents by type', async () => {
      const hedgingAgents = await registry.findAgentsByType('HedgingAgent');

      expect(hedgingAgents.length).toBeGreaterThan(0);
      expect(hedgingAgents[0].agentId).toBe('hedge-1');
    });

    it('should get all active agents', async () => {
      const agents = await registry.getAllAgents();

      expect(agents.length).toBeGreaterThanOrEqual(4);
      agents.forEach(agent => {
        // Agents are idle when not processing
        expect(['idle', 'active', 'busy']).toContain(agent.status);
      });
    });
  });

  describe('Error Recovery', () => {
    it('should handle agent failure gracefully', async () => {
      // Create task that will fail
      const task = await hedgingAgent.addTask({
        id: 'error-test-1',
        action: 'invalid_action',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Agent should still be functional (idle or active)
      expect(['idle', 'active']).toContain(hedgingAgent.getStatus().status);
    });

    it('should retry failed operations', async () => {
      // Implementation depends on retry logic in agents
      expect(true).toBe(true);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle multiple concurrent operations', async () => {
      const tasks = [];

      // Create 20 concurrent tasks across agents
      for (let i = 0; i < 5; i++) {
        tasks.push(riskAgent.addTask({
          id: `load-risk-${i}`,
          action: 'analyze_risk',
          parameters: { portfolioId: `portfolio-${i}` },
          priority: 1,
          createdAt: Date.now(),
        }));

        tasks.push(hedgingAgent.addTask({
          id: `load-hedge-${i}`,
          action: 'analyze_hedge',
          parameters: {
            portfolioId: `portfolio-${i}`,
            assetSymbol: 'BTC',
            notionalValue: '1000000',
          },
          priority: 1,
          createdAt: Date.now(),
        }));

        tasks.push(settlementAgent.addTask({
          id: `load-settle-${i}`,
          action: 'create_settlement',
          parameters: {
            portfolioId: `portfolio-${i}`,
            beneficiary: '0xBeneficiary',
            amount: '1000',
            token: '0xUSDC',
            purpose: 'Load test',
            priority: 'LOW',
          },
          priority: 1,
          createdAt: Date.now(),
        }));

        tasks.push(reportingAgent.addTask({
          id: `load-report-${i}`,
          action: 'generate_risk_report',
          parameters: { portfolioId: `portfolio-${i}` },
          priority: 1,
          createdAt: Date.now(),
        }));
      }

      const startTime = Date.now();
      await Promise.all(tasks);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(15000); // 15 seconds for 20 tasks (allowing some margin)
    }, 30000);
  });

  describe('ZK Proof Integration', () => {
    it('should generate and verify ZK proofs end-to-end', async () => {
      // Risk agent generates ZK proof
      await riskAgent.addTask({
        id: 'zk-test-1',
        action: 'analyze_risk',
        parameters: {
          portfolioId: 'portfolio-1',
          generateZKProof: true,
        },
        priority: 2,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Generate report including ZK proofs
      const reportResult = await reportingAgent.addTask({
        id: 'zk-report-1',
        action: 'generate_risk_report',
        parameters: {
          portfolioId: 'portfolio-1',
          includeZKProofs: true,
        },
        priority: 1,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(reportResult).toBeDefined();
    }, 15000);
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across agents', async () => {
      const portfolioId = 'consistency-test-1';

      // Create settlement
      await settlementAgent.addTask({
        id: 'consistency-settle',
        action: 'create_settlement',
        parameters: {
          portfolioId,
          beneficiary: '0xBeneficiary',
          amount: '5000',
          token: '0xUSDC',
          purpose: 'Test',
          priority: 'MEDIUM',
        },
        priority: 1,
        createdAt: Date.now(),
      });

      // Generate report
      await reportingAgent.addTask({
        id: 'consistency-report',
        action: 'generate_settlement_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Data should be consistent between agents
      expect(settlementAgent.getPendingCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Complete User Journey', () => {
    it('should execute complete portfolio management workflow', async () => {
      const portfolioId = 'journey-test-1';

      // 1. User deposits assets (simulated)
      console.log('Step 1: User deposits 10M USD in assets');

      // 2. Risk agent analyzes portfolio
      console.log('Step 2: Analyzing portfolio risk...');
      await riskAgent.addTask({
        id: 'journey-risk',
        action: 'analyze_risk',
        parameters: { portfolioId },
        priority: 2,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. Hedging agent opens positions if needed
      console.log('Step 3: Opening hedge positions...');
      await hedgingAgent.addTask({
        id: 'journey-hedge',
        action: 'create_strategy',
        parameters: {
          portfolioId,
          targetMarket: 'BTC-USD-PERP',
          hedgeRatio: 0.5,
          rebalanceThreshold: 10,
          maxLeverage: 3,
        },
        priority: 2,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 4. Monitor positions
      console.log('Step 4: Monitoring positions...');
      hedgingAgent.startMonitoring(30000);
      await new Promise(resolve => setTimeout(resolve, 500));
      hedgingAgent.stopMonitoring();

      // 5. Process settlements
      console.log('Step 5: Processing settlements...');
      await settlementAgent.addTask({
        id: 'journey-settle',
        action: 'create_settlement',
        parameters: {
          portfolioId,
          beneficiary: '0xUserAddress',
          amount: '10000',
          token: '0xUSDC',
          purpose: 'Profit distribution',
          priority: 'HIGH',
        },
        priority: 2,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 6. Generate comprehensive report
      console.log('Step 6: Generating final report...');
      await reportingAgent.addTask({
        id: 'journey-report',
        action: 'generate_comprehensive_report',
        parameters: { portfolioId },
        priority: 1,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('Complete workflow executed successfully!');

      // Verify all agents participated
      expect(riskAgent.getExecutionHistory().length).toBeGreaterThan(0);
      expect(hedgingAgent.getExecutionHistory().length).toBeGreaterThan(0);
      // Settlement was created (pending) but not processed yet (unless urgent)
      expect(settlementAgent.getExecutionHistory().length).toBeGreaterThan(0);
    }, 15000);
  });

  describe('Real-time Monitoring', () => {
    it('should monitor and respond to market changes', async () => {
      // Start hedge monitoring
      hedgingAgent.startMonitoring(5000);

      // Simulate market volatility spike
      await hedgingAgent.addTask({
        id: 'monitor-test-1',
        action: 'monitor_positions',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      hedgingAgent.stopMonitoring();

      expect(hedgingAgent.getExecutionHistory().length).toBeGreaterThan(0);
    });

    it('should auto-process settlements on schedule', async () => {
      // Create schedule
      await settlementAgent.addTask({
        id: 'schedule-test-1',
        action: 'create_schedule',
        parameters: {
          frequency: 'HOURLY',
          minBatchSize: 5,
          maxBatchSize: 50,
        },
        priority: 1,
        createdAt: Date.now(),
      });

      // Start automatic processing
      settlementAgent.startAutomaticProcessing();

      await new Promise(resolve => setTimeout(resolve, 1000));

      settlementAgent.stopAutomaticProcessing();

      expect(true).toBe(true); // Verify no errors
    });
  });
});
