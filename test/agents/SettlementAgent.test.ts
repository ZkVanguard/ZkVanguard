/**
 * SettlementAgent Tests
 * Comprehensive tests for payment settlement and batch processing
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { SettlementAgent, SettlementRequest, BatchSettlement } from '../../agents/specialized/SettlementAgent';
import { AgentTask } from '../../shared/types/agent';

// Mock X402Client with proper implementation
jest.mock('../../integrations/x402/X402Client', () => ({
  X402Client: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    executeGaslessTransfer: jest.fn().mockResolvedValue({
      txHash: '0x' + '1'.repeat(64),
      success: true,
      gasSponsored: true,
    }),
    batchTransfer: jest.fn().mockImplementation(async (transfers: unknown[]) => ({
      txHash: '0x' + '2'.repeat(64),
      success: true,
      count: (transfers as unknown[]).length,
    })),
    getBalance: jest.fn().mockResolvedValue('1000000'),
    getStatus: jest.fn().mockResolvedValue({ active: true }),
  })),
}));

describe('SettlementAgent', () => {
  let agent: SettlementAgent;
  let provider: ethers.Provider;
  let signer: ethers.Wallet;
  const paymentRouterAddress = '0x1234567890123456789012345678901234567890';

  beforeEach(async () => {
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    signer = ethers.Wallet.createRandom().connect(provider);

    agent = new SettlementAgent('test-settlement-agent', provider, signer, paymentRouterAddress);
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(agent).toBeDefined();
      expect(agent.getStatus().status).toBe('idle');
    });

    it('should have correct capabilities', () => {
      const capabilities = agent.getCapabilities();
      expect(capabilities).toContain('PAYMENT_PROCESSING');
      expect(capabilities).toContain('SETTLEMENT');
    });

    it('should start with no pending settlements', () => {
      expect(agent.getPendingCount()).toBe(0);
    });
  });

  describe('Creating Settlements', () => {
    it('should create settlement request', async () => {
      const task: AgentTask = {
        id: 'test-create-1',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary123',
          amount: '1000',
          token: '0xUSDC',
          purpose: 'Profit distribution',
          priority: 'MEDIUM',
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('requestId');
      expect(result.data.status).toBe('PENDING');
      expect(result.data.amount).toBe('1000');
      expect(agent.getPendingCount()).toBe(1);
    });

    it('should auto-process urgent settlements', async () => {
      const task: AgentTask = {
        id: 'test-create-2',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary456',
          amount: '5000',
          token: '0xUSDC',
          purpose: 'Urgent payment',
          priority: 'URGENT',
        },
        priority: 5,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.priority).toBe('URGENT');
      // Give time for auto-processing
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should generate unique request IDs', async () => {
      const ids = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const task: AgentTask = {
          id: `test-create-${i}`,
          action: 'create_settlement',
          parameters: {
            portfolioId: 'portfolio-1',
            beneficiary: '0xBeneficiary',
            amount: '100',
            token: '0xUSDC',
            purpose: 'Test',
            priority: 'LOW',
          },
          priority: 1,
          createdAt: Date.now(),
        };

        const result = await agent['executeTask'](task);
        ids.add(result.data.requestId);
      }

      expect(ids.size).toBe(10);
    });

    it('should support custom time windows', async () => {
      const validAfter = Math.floor(Date.now() / 1000) + 300; // 5 min future
      const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour future

      const task: AgentTask = {
        id: 'test-create-3',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary',
          amount: '2000',
          token: '0xUSDC',
          purpose: 'Scheduled payment',
          priority: 'MEDIUM',
          validAfter,
          validBefore,
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.validAfter).toBe(validAfter);
      expect(result.data.validBefore).toBe(validBefore);
    });
  });

  describe('Processing Settlements', () => {
    let settlementId: string;

    beforeEach(async () => {
      // Create a test settlement
      const task: AgentTask = {
        id: 'setup-settlement',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary',
          amount: '1000',
          token: '0xUSDC',
          purpose: 'Test payment',
          priority: 'MEDIUM',
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      settlementId = result.data.requestId;
    });

    it('should process settlement successfully', async () => {
      const task: AgentTask = {
        id: 'test-process-1',
        action: 'process_settlement',
        parameters: {
          requestId: settlementId,
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('COMPLETED');
      expect(result.data).toHaveProperty('transactionId');
      expect(agent.getPendingCount()).toBe(0);
      expect(agent.getCompletedCount()).toBe(1);
    });

    it('should fail processing already processed settlement', async () => {
      // Process once
      await agent['executeTask']({
        id: 'test-process-2a',
        action: 'process_settlement',
        parameters: { requestId: settlementId },
        priority: 2,
        createdAt: Date.now(),
      });

      // Try processing again
      const task: AgentTask = {
        id: 'test-process-2b',
        action: 'process_settlement',
        parameters: { requestId: settlementId },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(false);
    });

    it('should handle non-existent settlement', async () => {
      const task: AgentTask = {
        id: 'test-process-3',
        action: 'process_settlement',
        parameters: {
          requestId: 'non-existent-id',
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should track processing time', async () => {
      const task: AgentTask = {
        id: 'test-process-4',
        action: 'process_settlement',
        parameters: { requestId: settlementId },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.data).toHaveProperty('processingTime');
      expect(result.data.processingTime).toBeGreaterThan(0);
    });
  });

  describe('Batch Processing', () => {
    beforeEach(async () => {
      // Create multiple test settlements
      for (let i = 0; i < 10; i++) {
        await agent['executeTask']({
          id: `setup-batch-${i}`,
          action: 'create_settlement',
          parameters: {
            portfolioId: 'portfolio-1',
            beneficiary: `0xBeneficiary${i}`,
            amount: '1000',
            token: '0xUSDC',
            purpose: `Payment ${i}`,
            priority: 'MEDIUM',
          },
          priority: 1,
          createdAt: Date.now(),
        });
      }
    });

    it('should batch all pending settlements', async () => {
      expect(agent.getPendingCount()).toBe(10);

      const task: AgentTask = {
        id: 'test-batch-1',
        action: 'batch_settlements',
        parameters: {},
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.totalProcessed).toBe(10);
      expect(result.data).toHaveProperty('batchId');
      expect(result.data.results).toBeDefined();
    });

    it('should respect batch size limits', async () => {
      const task: AgentTask = {
        id: 'test-batch-2',
        action: 'batch_settlements',
        parameters: {
          maxBatchSize: 5,
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.totalProcessed).toBe(5);
      expect(agent.getPendingCount()).toBe(5);
    });

    it('should process by priority order', async () => {
      // Add high priority settlement
      await agent['executeTask']({
        id: 'setup-priority',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xHighPriority',
          amount: '10000',
          token: '0xUSDC',
          purpose: 'High priority',
          priority: 'HIGH',
        },
        priority: 1,
        createdAt: Date.now(),
      });

      const task: AgentTask = {
        id: 'test-batch-3',
        action: 'batch_settlements',
        parameters: {
          maxBatchSize: 5,
        },
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      // High priority should be processed first
    });

    it('should group by token for efficiency', async () => {
      // Add settlements with different tokens
      await agent['executeTask']({
        id: 'setup-usdt',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary',
          amount: '500',
          token: '0xUSDT',
          purpose: 'USDT payment',
          priority: 'MEDIUM',
        },
        priority: 1,
        createdAt: Date.now(),
      });

      const task: AgentTask = {
        id: 'test-batch-4',
        action: 'batch_settlements',
        parameters: {},
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.results.length).toBeGreaterThan(1); // Multiple token groups
    });

    it('should handle empty batch gracefully', async () => {
      // Process all settlements first
      await agent['executeTask']({
        id: 'clear-all',
        action: 'batch_settlements',
        parameters: {},
        priority: 2,
        createdAt: Date.now(),
      });

      // Try batching again
      const task: AgentTask = {
        id: 'test-batch-5',
        action: 'batch_settlements',
        parameters: {},
        priority: 2,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('No settlements');
    });
  });

  describe('Cancellation', () => {
    let settlementId: string;

    beforeEach(async () => {
      const task = await agent['executeTask']({
        id: 'setup-cancel',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary',
          amount: '1000',
          token: '0xUSDC',
          purpose: 'Cancellable payment',
          priority: 'LOW',
        },
        priority: 1,
        createdAt: Date.now(),
      });
      settlementId = task.data.requestId;
    });

    it('should cancel pending settlement', async () => {
      const task: AgentTask = {
        id: 'test-cancel-1',
        action: 'cancel_settlement',
        parameters: {
          requestId: settlementId,
        },
        priority: 3,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('CANCELLED');
      expect(agent.getPendingCount()).toBe(0);
    });

    it('should not cancel non-pending settlement', async () => {
      // Process settlement first
      await agent['executeTask']({
        id: 'process-first',
        action: 'process_settlement',
        parameters: { requestId: settlementId },
        priority: 2,
        createdAt: Date.now(),
      });

      // Try to cancel
      const task: AgentTask = {
        id: 'test-cancel-2',
        action: 'cancel_settlement',
        parameters: { requestId: settlementId },
        priority: 3,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(false);
    });
  });

  describe('Scheduling', () => {
    it('should create settlement schedule', async () => {
      const task: AgentTask = {
        id: 'test-schedule-1',
        action: 'create_schedule',
        parameters: {
          frequency: 'DAILY',
          minBatchSize: 10,
          maxBatchSize: 100,
          minAmount: '100',
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('scheduleId');
      expect(result.data.frequency).toBe('DAILY');
      expect(result.data.active).toBe(true);
    });

    it('should support different frequencies', async () => {
      const frequencies = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'];

      for (const frequency of frequencies) {
        const task: AgentTask = {
          id: `test-schedule-${frequency}`,
          action: 'create_schedule',
          parameters: {
            frequency,
            minBatchSize: 5,
            maxBatchSize: 50,
          },
          priority: 1,
          createdAt: Date.now(),
        };

        const result = await agent['executeTask'](task);

        expect(result.success).toBe(true);
        expect(result.data.frequency).toBe(frequency);
      }
    });

    it('should start automatic processing', () => {
      agent.startAutomaticProcessing();
      
      expect(agent['processingInterval']).toBeDefined();
      
      agent.stopAutomaticProcessing();
    });

    it('should stop automatic processing', () => {
      agent.startAutomaticProcessing();
      agent.stopAutomaticProcessing();
      
      expect(agent['processingInterval']).toBeUndefined();
    });
  });

  describe('Reporting', () => {
    beforeEach(async () => {
      // Create and process some settlements
      for (let i = 0; i < 5; i++) {
        const createResult = await agent['executeTask']({
          id: `setup-report-${i}`,
          action: 'create_settlement',
          parameters: {
            portfolioId: 'portfolio-1',
            beneficiary: `0xBeneficiary${i}`,
            amount: '1000',
            token: '0xUSDC',
            purpose: `Payment ${i}`,
            priority: 'MEDIUM',
          },
          priority: 1,
          createdAt: Date.now(),
        });

        await agent['executeTask']({
          id: `process-report-${i}`,
          action: 'process_settlement',
          parameters: { requestId: createResult.data.requestId },
          priority: 2,
          createdAt: Date.now(),
        });
      }
    });

    it('should generate settlement report', async () => {
      const task: AgentTask = {
        id: 'test-report-1',
        action: 'generate_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('period');
      expect(result.data).toHaveProperty('statistics');
      expect(result.data).toHaveProperty('settlements');
      expect(result.data.statistics.totalSettlements).toBe(5);
    });

    it('should calculate success rate', async () => {
      const task: AgentTask = {
        id: 'test-report-2',
        action: 'generate_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.data.statistics.successRate).toBeGreaterThanOrEqual(0);
      expect(result.data.statistics.successRate).toBeLessThanOrEqual(100);
    });

    it('should estimate gas savings', async () => {
      const task: AgentTask = {
        id: 'test-report-3',
        action: 'generate_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.data.statistics).toHaveProperty('gasSavings');
      expect(parseFloat(result.data.statistics.gasSavings)).toBeGreaterThan(0);
    });

    it('should support custom date ranges', async () => {
      const startDate = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
      const endDate = Date.now();

      const task: AgentTask = {
        id: 'test-report-4',
        action: 'generate_report',
        parameters: { startDate, endDate },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.period.start).toBe(startDate);
      expect(result.data.period.end).toBe(endDate);
    });
  });

  describe('Status Checking', () => {
    let settlementId: string;

    beforeEach(async () => {
      const result = await agent['executeTask']({
        id: 'setup-status',
        action: 'create_settlement',
        parameters: {
          portfolioId: 'portfolio-1',
          beneficiary: '0xBeneficiary',
          amount: '1000',
          token: '0xUSDC',
          purpose: 'Status check payment',
          priority: 'MEDIUM',
        },
        priority: 1,
        createdAt: Date.now(),
      });
      settlementId = result.data.requestId;
    });

    it('should check pending settlement status', async () => {
      const task: AgentTask = {
        id: 'test-status-1',
        action: 'check_status',
        parameters: { requestId: settlementId },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('PENDING');
    });

    it('should check completed settlement status', async () => {
      // Process settlement
      await agent['executeTask']({
        id: 'process-status',
        action: 'process_settlement',
        parameters: { requestId: settlementId },
        priority: 2,
        createdAt: Date.now(),
      });

      const task: AgentTask = {
        id: 'test-status-2',
        action: 'check_status',
        parameters: { requestId: settlementId },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('COMPLETED');
      expect(result.data).toHaveProperty('processedAt');
    });
  });

  describe('Performance', () => {
    it('should handle high volume of settlements', async () => {
      const count = 100;
      const startTime = Date.now();

      for (let i = 0; i < count; i++) {
        await agent.addTask({
          id: `perf-create-${i}`,
          action: 'create_settlement',
          parameters: {
            portfolioId: 'portfolio-1',
            beneficiary: `0xBeneficiary${i}`,
            amount: '100',
            token: '0xUSDC',
            purpose: `Perf test ${i}`,
            priority: 'LOW',
          },
          priority: 1,
          createdAt: Date.now(),
        });
      }

      const duration = Date.now() - startTime;

      expect(agent.getPendingCount()).toBe(count);
      expect(duration).toBeLessThan(10000); // 10 seconds for 100 settlements
    });

    it('should batch process efficiently', async () => {
      // Create 50 settlements
      for (let i = 0; i < 50; i++) {
        await agent['executeTask']({
          id: `perf-batch-${i}`,
          action: 'create_settlement',
          parameters: {
            portfolioId: 'portfolio-1',
            beneficiary: `0xBeneficiary${i}`,
            amount: '100',
            token: '0xUSDC',
            purpose: `Batch test ${i}`,
            priority: 'MEDIUM',
          },
          priority: 1,
          createdAt: Date.now(),
        });
      }

      const startTime = Date.now();

      const result = await agent['executeTask']({
        id: 'perf-batch-process',
        action: 'batch_settlements',
        parameters: {},
        priority: 2,
        createdAt: Date.now(),
      });

      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.data.totalProcessed).toBe(50);
      expect(duration).toBeLessThan(5000); // 5 seconds for batch
    });
  });
});
