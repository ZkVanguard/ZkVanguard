/**
 * Settlement Agent
 * Specialized agent for payment settlement and batch processing using x402
 */

import { BaseAgent } from '../core/BaseAgent';
import { AgentCapability, AgentTask, TaskResult, AgentMessage } from '@shared/types/agent';
import { X402Client } from '@integrations/x402/X402Client';
import { ethers } from 'ethers';
import { logger } from '@shared/utils/logger';

export interface SettlementRequest {
  requestId: string;
  portfolioId: string;
  beneficiary: string;
  amount: string;
  token: string;
  purpose: string;
  validAfter?: number;
  validBefore?: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: number;
  processedAt?: number;
}

export interface BatchSettlement {
  batchId: string;
  requests: SettlementRequest[];
  totalAmount: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  transactionHash?: string;
  gaslessTransactionId?: string;
  createdAt: number;
  completedAt?: number;
}

export interface SettlementSchedule {
  scheduleId: string;
  frequency: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  minBatchSize: number;
  maxBatchSize: number;
  minAmount: string;
  active: boolean;
}

export interface SettlementReport {
  period: {
    start: number;
    end: number;
  };
  statistics: {
    totalSettlements: number;
    totalAmount: string;
    successRate: number;
    avgProcessingTime: number;
    gasSavings: string;
  };
  settlements: SettlementRequest[];
  batches: BatchSettlement[];
}

export class SettlementAgent extends BaseAgent {
  private x402Client: X402Client;
  private pendingSettlements: Map<string, SettlementRequest> = new Map();
  private completedSettlements: Map<string, SettlementRequest> = new Map();
  private batchHistory: Map<string, BatchSettlement> = new Map();
  private schedules: Map<string, SettlementSchedule> = new Map();
  private processingInterval?: NodeJS.Timeout;

  constructor(
    agentId: string,
    private provider: ethers.Provider,
    private signer: ethers.Wallet | ethers.Signer,
    private paymentRouterAddress: string
  ) {
    super(agentId, 'SettlementAgent', [
      AgentCapability.PAYMENT_PROCESSING,
      AgentCapability.SETTLEMENT,
    ]);

    this.x402Client = new X402Client(provider);
  }

  /**
   * Initialize agent
   */
  protected async onInitialize(): Promise<void> {
    try {
      logger.info('SettlementAgent initialized', { agentId: this.agentId });
    } catch (error) {
      logger.error('Failed to initialize SettlementAgent', { error });
      throw error;
    }
  }
  
  /**
   * Handle incoming messages
   */
  protected onMessageReceived(_message: AgentMessage): void {
    // Handle messages from other agents
  }
  
  /**
   * Cleanup on shutdown
   */
  protected async onShutdown(): Promise<void> {
    try {
      logger.info('SettlementAgent shutdown complete', { agentId: this.agentId });
    } catch (error) {
      logger.error('Error during SettlementAgent shutdown', { error });
    }
  }

  /**
   * Execute task
   */
  protected async onExecuteTask(task: AgentTask): Promise<TaskResult> {
    logger.info('Executing settlement task', { taskId: task.id, action: task.action });

    try {
      switch (task.action) {
        case 'create_settlement':
          return await this.createSettlement(task);
        
        case 'process_settlement':
          return await this.processSettlement(task);
        
        case 'batch_settlements':
          return await this.batchSettlements(task);
        
        case 'cancel_settlement':
          return await this.cancelSettlement(task);
        
        case 'create_schedule':
          return await this.createSchedule(task);
        
        case 'generate_report':
          return await this.generateReport(task);
        
        case 'check_status':
          return await this.checkSettlementStatus(task);
        
        default:
          throw new Error(`Unknown action: ${task.action}`);
      }
    } catch (error) {
      logger.error('Task execution failed', { taskId: task.id, error });
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: 0,
        agentId: this.agentId,
      };
    }
  }

  /**
   * Create settlement request
   */
  private async createSettlement(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { portfolioId: string; beneficiary: string; amount: string; token: string; purpose: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; validAfter?: number; validBefore?: number };
    const { portfolioId, beneficiary, amount, token, purpose, priority, validAfter, validBefore } = parameters;

    try {
      const settlement: SettlementRequest = {
        requestId: `settlement-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        portfolioId,
        beneficiary,
        amount,
        token,
        purpose,
        priority: priority || 'MEDIUM',
        validAfter,
        validBefore,
        status: 'PENDING',
        createdAt: Date.now(),
      };

      this.pendingSettlements.set(settlement.requestId, settlement);

      logger.info('Settlement request created', {
        requestId: settlement.requestId,
        amount,
        beneficiary,
      });

      // Auto-process if urgent
      if (settlement.priority === 'URGENT') {
        await this.processSettlement({
          id: `process-${settlement.requestId}`,
          action: 'process_settlement',
          parameters: { requestId: settlement.requestId },
          priority: 5,
          createdAt: new Date(),
        });
      }

      return {
        success: true,
        data: settlement,
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to create settlement', { error });
      throw error;
    }
  }

  /**
   * Process individual settlement
   */
  private async processSettlement(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { requestId: string };
    const { requestId } = parameters;

    try {
      const settlement = this.pendingSettlements.get(requestId);
      if (!settlement) {
        throw new Error(`Settlement ${requestId} not found`);
      }

      if (settlement.status !== 'PENDING') {
        throw new Error(`Settlement ${requestId} already ${settlement.status}`);
      }

      logger.info('Processing settlement via x402 (GASLESS)', { requestId });
      settlement.status = 'PROCESSING';

      // Execute TRUE gasless transfer via x402 Facilitator
      // NO GAS COSTS - x402 handles everything!
      const result = typeof (this.x402Client as any).executeGaslessTransfer === 'function'
        ? await (this.x402Client as any).executeGaslessTransfer({
        token: settlement.token,
        from: await this.signer.getAddress(),
        to: settlement.beneficiary,
        amount: settlement.amount,
        })
        : await (this.x402Client as any).batchTransfer({
          token: settlement.token,
          from: await this.signer.getAddress(),
          to: settlement.beneficiary,
          amount: settlement.amount,
        });

      settlement.status = 'COMPLETED';
      settlement.processedAt = Date.now();

      // Move to completed
      this.pendingSettlements.delete(requestId);
      this.completedSettlements.set(requestId, settlement);

      logger.info('Settlement processed successfully', {
        requestId,
        transactionId: result.txHash,
      });

      return {
        success: true,
        data: {
          requestId,
          transactionId: result.txHash,
          status: 'COMPLETED',
          processingTime: Math.max(1, Date.now() - startTime),
        },
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to process settlement', { requestId, error });
      
      const settlement = this.pendingSettlements.get(requestId);
      if (settlement) {
        settlement.status = 'FAILED';
      }
      
      throw error;
    }
  }

  /**
   * Batch multiple settlements
   */
  private async batchSettlements(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { requestIds?: string[]; maxBatchSize?: number };
    const { requestIds, maxBatchSize } = parameters;

    try {
      // Get pending settlements
      const settlementsToProcess: SettlementRequest[] = [];
      
      if (requestIds) {
        // Specific settlements
        for (const id of requestIds) {
          const settlement = this.pendingSettlements.get(id);
          if (settlement && settlement.status === 'PENDING') {
            settlementsToProcess.push(settlement);
          }
        }
      } else {
        // All pending settlements
        for (const settlement of this.pendingSettlements.values()) {
          if (settlement.status === 'PENDING') {
            settlementsToProcess.push(settlement);
          }
        }
      }

      if (settlementsToProcess.length === 0) {
        return {
          success: true,
          data: { message: 'No settlements to process' },
          error: null,
          executionTime: Date.now() - startTime,
          agentId: this.agentId,
        };
      }

      // Sort by priority
      settlementsToProcess.sort((a, b) => {
        const priorityWeight = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return priorityWeight[b.priority] - priorityWeight[a.priority];
      });

      // Limit batch size
      const batchSize = maxBatchSize || 50;
      const batch = settlementsToProcess.slice(0, batchSize);

      logger.info('Processing batch settlements', { count: batch.length });

      // Group by token for efficient batching
      const tokenGroups = new Map<string, SettlementRequest[]>();
      for (const settlement of batch) {
        const group = tokenGroups.get(settlement.token) || [];
        group.push(settlement);
        tokenGroups.set(settlement.token, group);
      }

      // Process each token group as a batch via x402 (GASLESS)
      const results = [];
      for (const [token, settlements] of tokenGroups.entries()) {
        const batchRequest = {
          token,
          from: await this.signer.getAddress(),
          recipients: settlements.map(s => s.beneficiary),
          amounts: settlements.map(s => s.amount),
        };

        try {
          // Execute TRUE gasless batch via x402 - NO GAS COSTS!
          const batchResult = typeof (this.x402Client as any).executeBatchTransfer === 'function'
            ? await (this.x402Client as any).executeBatchTransfer(batchRequest)
            : await (this.x402Client as any).batchTransfer(batchRequest);
          
          // Update settlement statuses
          for (const settlement of settlements) {
            settlement.status = 'COMPLETED';
            settlement.processedAt = Date.now();
            this.pendingSettlements.delete(settlement.requestId);
            this.completedSettlements.set(settlement.requestId, settlement);
          }

          results.push({
            token,
            count: settlements.length,
            transactionId: batchResult.txHash,
            status: 'COMPLETED',
          });
        } catch (error) {
          logger.error('Batch processing failed for token', { token, error });
          
          // Mark as failed
          for (const settlement of settlements) {
            settlement.status = 'FAILED';
          }
          
          results.push({
            token,
            count: settlements.length,
            status: 'FAILED',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Create batch record
      const batchRecord: BatchSettlement = {
        batchId: `batch-${Date.now()}`,
        requests: batch,
        totalAmount: batch.reduce((sum, s) => sum + parseFloat(s.amount), 0).toString(),
        status: results.every(r => r.status === 'COMPLETED') ? 'COMPLETED' : 'FAILED',
        createdAt: startTime,
        completedAt: Date.now(),
      };

      this.batchHistory.set(batchRecord.batchId, batchRecord);

      logger.info('Batch settlements completed', {
        batchId: batchRecord.batchId,
        totalSettlements: batch.length,
        successCount: results.filter(r => r.status === 'COMPLETED').length,
      });

      return {
        success: true,
        data: {
          batchId: batchRecord.batchId,
          totalProcessed: batch.length,
          results,
          executionTime: Date.now() - startTime,
        },
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to batch settlements', { error });
      throw error;
    }
  }

  /**
   * Cancel settlement
   */
  private async cancelSettlement(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { requestId: string };
    const { requestId } = parameters;

    try {
      const settlement = this.pendingSettlements.get(requestId);
      if (!settlement) {
        throw new Error(`Settlement ${requestId} not found`);
      }

      if (settlement.status !== 'PENDING') {
        throw new Error(`Cannot cancel settlement with status ${settlement.status}`);
      }

      this.pendingSettlements.delete(requestId);
      logger.info('Settlement cancelled', { requestId });

      return {
        success: true,
        data: { requestId, status: 'CANCELLED' },
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to cancel settlement', { requestId, error });
      throw error;
    }
  }

  /**
   * Create settlement schedule
   */
  private async createSchedule(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { frequency?: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY'; minBatchSize?: number; maxBatchSize?: number; minAmount?: string };
    const { frequency, minBatchSize, maxBatchSize, minAmount } = parameters;

    try {
      const schedule: SettlementSchedule = {
        scheduleId: `schedule-${Date.now()}`,
        frequency: frequency || 'DAILY',
        minBatchSize: minBatchSize || 5,
        maxBatchSize: maxBatchSize || 50,
        minAmount: minAmount || '0',
        active: true,
      };

      this.schedules.set(schedule.scheduleId, schedule);

      logger.info('Settlement schedule created', { scheduleId: schedule.scheduleId });

      return {
        success: true,
        data: schedule,
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to create schedule', { error });
      throw error;
    }
  }

  /**
   * Generate settlement report
   */
  private async generateReport(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { startDate?: number; endDate?: number };
    const { startDate, endDate } = parameters;

    try {
      const start = startDate || Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
      const end = endDate || Date.now();

      // Filter settlements by date range
      const settlements = Array.from(this.completedSettlements.values())
        .filter(s => s.createdAt >= start && s.createdAt <= end);

      // Filter batches by date range
      const batches = Array.from(this.batchHistory.values())
        .filter(b => b.createdAt >= start && b.createdAt <= end);

      // Calculate statistics
      const totalAmount = settlements.reduce((sum, s) => sum + parseFloat(s.amount), 0);
      const successCount = settlements.filter(s => s.status === 'COMPLETED').length;
      const totalProcessingTime = settlements.reduce((sum, s) => 
        s.processedAt ? sum + (s.processedAt - s.createdAt) : sum, 0
      );

      // Estimate gas savings from batching
      const individualtxCost = 50000; // gas units
      const batchTxCost = 100000; // gas units for batch
      const savedGas = settlements.length * individualtxCost - batches.length * batchTxCost;

      const report: SettlementReport = {
        period: { start, end },
        statistics: {
          totalSettlements: settlements.length,
          totalAmount: totalAmount.toString(),
          successRate: settlements.length > 0 ? (successCount / settlements.length) * 100 : 0,
          avgProcessingTime: settlements.length > 0 ? totalProcessingTime / settlements.length : 0,
          gasSavings: savedGas.toString(),
        },
        settlements,
        batches,
      };

      logger.info('Settlement report generated', {
        period: report.period,
        totalSettlements: report.statistics.totalSettlements,
      });

      return {
        success: true,
        data: report,
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to generate report', { error });
      throw error;
    }
  }

  /**
   * Check settlement status
   */
  private async checkSettlementStatus(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    const parameters = task.parameters as { requestId: string };
    const { requestId } = parameters;

    try {
      let settlement = this.pendingSettlements.get(requestId);
      if (!settlement) {
        settlement = this.completedSettlements.get(requestId);
      }

      if (!settlement) {
        throw new Error(`Settlement ${requestId} not found`);
      }

      return {
        success: true,
        data: settlement,
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.agentId,
      };
    } catch (error) {
      logger.error('Failed to check settlement status', { requestId, error });
      throw error;
    }
  }

  /**
   * Start automatic processing based on schedules
   */
  startAutomaticProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // Check every minute
    this.processingInterval = setInterval(async () => {
      try {
        for (const schedule of this.schedules.values()) {
          if (!schedule.active) continue;

          const pendingCount = this.pendingSettlements.size;
          
          // Check if we should process
          if (pendingCount >= schedule.minBatchSize) {
            this.enqueueTask({
              id: `auto-batch-${Date.now()}`,
              action: 'batch_settlements',
              parameters: { maxBatchSize: schedule.maxBatchSize },
              priority: 2,
              createdAt: new Date(),
            });
          }
        }
      } catch (error) {
        logger.error('Automatic processing error', { error });
      }
    }, 60000); // Every minute

    logger.info('Automatic settlement processing started');
  }

  /**
   * Stop automatic processing
   */
  stopAutomaticProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
      logger.info('Automatic settlement processing stopped');
    }
  }

  /**
   * Get AI-powered batch optimization recommendations
   */
  async getAIBatchOptimization(): Promise<{
    recommendation: string;
    optimalBatchSize: number;
    priorityOrder: string[];
    estimatedGasSavings: string;
  }> {
    const pendingList = Array.from(this.pendingSettlements.values());
    const completedList = Array.from(this.completedSettlements.values()).slice(-50);
    
    const defaultResult = {
      recommendation: 'Process settlements in priority order',
      optimalBatchSize: Math.min(pendingList.length, 20),
      priorityOrder: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'],
      estimatedGasSavings: '100%', // x402 is gasless
    };

    if (pendingList.length === 0) {
      return { ...defaultResult, recommendation: 'No pending settlements' };
    }

    try {
      const { llmProvider } = await import('@/lib/ai/llm-provider');
      
      // Analyze pending settlements
      const urgentCount = pendingList.filter(s => s.priority === 'URGENT').length;
      const highCount = pendingList.filter(s => s.priority === 'HIGH').length;
      const totalAmount = pendingList.reduce((sum, s) => sum + parseFloat(s.amount), 0);
      const tokenTypes = [...new Set(pendingList.map(s => s.token))];
      
      // Analyze historical performance
      const avgProcessingTime = completedList.length > 0
        ? completedList.reduce((sum, s) => sum + ((s.processedAt || s.createdAt) - s.createdAt), 0) / completedList.length
        : 0;

      const systemPrompt = `You are a payment optimization specialist for x402 gasless settlements on Cronos zkEVM.`;

      const aiPrompt = `Optimize this settlement batch:

PENDING SETTLEMENTS:
- Total: ${pendingList.length}
- Urgent: ${urgentCount}, High: ${highCount}
- Total Amount: $${totalAmount.toLocaleString()}
- Token Types: ${tokenTypes.join(', ')}

HISTORICAL:
- Avg Processing Time: ${avgProcessingTime}ms
- Recent Completions: ${completedList.length}

Provide optimization in this EXACT format:
BATCH_SIZE: [number 1-50]
RECOMMENDATION: [one sentence optimization strategy]

Consider: x402 is 100% gasless, so optimize for speed and reliability, not gas.`;

      const aiResponse = await llmProvider.generateDirectResponse(aiPrompt, systemPrompt);
      
      // Parse response
      const batchMatch = aiResponse.content.match(/BATCH_SIZE:\s*(\d+)/i);
      const recMatch = aiResponse.content.match(/RECOMMENDATION:\s*(.+)/i);
      
      const optimalBatchSize = batchMatch ? Math.min(parseInt(batchMatch[1]), 50) : defaultResult.optimalBatchSize;
      const recommendation = recMatch ? `🤖 ${recMatch[1].trim()}` : defaultResult.recommendation;
      
      logger.info('🤖 AI settlement optimization generated', { 
        optimalBatchSize,
        model: aiResponse.model,
      });

      return {
        recommendation,
        optimalBatchSize,
        priorityOrder: urgentCount > 0 ? ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] : ['HIGH', 'MEDIUM', 'LOW', 'URGENT'],
        estimatedGasSavings: '100%', // x402 is gasless!
      };
    } catch (error) {
      logger.warn('AI batch optimization failed, using defaults', { error });
      return defaultResult;
    }
  }

  /**
   * Get pending settlements count
   */
  getPendingCount(): number {
    return this.pendingSettlements.size;
  }

  /**
   * Get completed settlements count
   */
  getCompletedCount(): number {
    return this.completedSettlements.size;
  }

  /**
   * Shutdown agent
   */
  async shutdown(): Promise<void> {
    this.stopAutomaticProcessing();
    await super.shutdown();
  }
}
