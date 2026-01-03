/**
 * @fileoverview Lead Agent - Main orchestrator for the multi-agent system
 * @module agents/core/LeadAgent
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { BaseAgent } from './BaseAgent';
import { AgentRegistry } from './AgentRegistry';
import { logger } from '@shared/utils/logger';
import {
  AgentConfig,
  AgentTask,
  AgentMessage,
  StrategyInput,
  StrategyIntent,
  AgentExecutionReport,
  AgentType,
  TaskResult,
  RiskAnalysis,
  HedgingStrategy,
  SettlementResult,
} from '@shared/types/agent';
import { ethers } from 'ethers';

/**
 * Lead Agent class - Orchestrates all specialized agents
 */
export class LeadAgent extends BaseAgent {
  private agentRegistry: AgentRegistry;
  private executionReports: Map<string, AgentExecutionReport>;
  private provider?: ethers.Provider;
  private signer?: ethers.Wallet | ethers.Signer;

  constructor(
    agentId: string,
    provider?: ethers.Provider,
    signer?: ethers.Wallet | ethers.Signer,
    agentRegistry?: AgentRegistry
  ) {
    super(agentId, 'LeadAgent', ['intent-parsing', 'task-delegation', 'result-aggregation', 'orchestration']);
    this.agentRegistry = agentRegistry || new AgentRegistry();
    this.executionReports = new Map();
    this.provider = provider;
    this.signer = signer;
  }

  protected async onInitialize(): Promise<void> {
    logger.info('Lead Agent initializing...', { agentId: this.id });
    
    // Register message handlers
    this.messageBus.on('strategy-input', this.handleStrategyInput.bind(this));
    this.messageBus.on('agent-result', this.handleAgentResult.bind(this));
    
    logger.info('Lead Agent initialized successfully', { agentId: this.id });
  }

  protected async onExecuteTask(task: AgentTask): Promise<TaskResult> {
    const startTime = Date.now();
    try {
      let data: unknown;
      switch (task.type) {
        case 'parse-strategy':
          data = await this.parseStrategy(task.payload as StrategyInput);
          break;
        case 'execute-strategy':
          data = await this.executeStrategy(task.payload as StrategyIntent);
          break;
        case 'aggregate-results':
          data = await this.aggregateResults(task.payload);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      
      return {
        success: true,
        data,
        error: null,
        executionTime: Date.now() - startTime,
        agentId: this.id,
      };
    } catch (error) {
      return {
        success: false,
        data: undefined,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        agentId: this.id,
      };
    }
  }

  protected onMessageReceived(message: AgentMessage): void {
    logger.debug('Lead Agent received message', {
      agentId: this.id,
      messageType: message.type,
      from: message.from,
    });

    switch (message.type) {
      case 'task-result':
        this.handleTaskResult(message);
        break;
      case 'status-update':
        this.handleStatusUpdate(message);
        break;
      case 'error':
        this.handleAgentError(message);
        break;
      default:
        logger.warn('Unknown message type received', {
          messageType: message.type,
          agentId: this.id,
        });
    }
  }

  protected async onShutdown(): Promise<void> {
    logger.info('Lead Agent shutting down...', { agentId: this.id });
    this.messageBus.removeAllListeners('strategy-input');
    this.messageBus.removeAllListeners('agent-result');
  }

  /**
   * Handle incoming strategy input from user
   */
  private async handleStrategyInput(input: StrategyInput): Promise<void> {
    try {
      logger.info('Processing strategy input', {
        agentId: this.id,
        input: input.naturalLanguage,
      });

      // Parse natural language into structured intent
      const intent = await this.parseNaturalLanguage(input);
      
      // Execute the strategy
      const report = await this.executeStrategyFromIntent(intent);
      
      // Emit completion event
      this.messageBus.emit('strategy-completed', report);
      
      logger.info('Strategy execution completed', {
        agentId: this.id,
        executionId: report.executionId,
        status: report.status,
      });
    } catch (error) {
      logger.error('Strategy execution failed', {
        error,
        agentId: this.id,
      });
      
      this.messageBus.emit('strategy-failed', { error });
    }
  }

  /**
   * Parse natural language strategy into structured intent
   */
  private async parseNaturalLanguage(input: StrategyInput): Promise<StrategyIntent> {
    logger.info('Parsing natural language strategy', { agentId: this.id });

    // In production, this would use Crypto.com AI SDK
    // For now, implement basic parsing logic
    
    const text = input.naturalLanguage.toLowerCase();
    let action: StrategyIntent['action'] = 'analyze';
    const requiredAgents: AgentType[] = ['risk'];

    // Determine action from keywords
    if (text.includes('hedge')) {
      action = 'hedge';
      requiredAgents.push('hedging', 'settlement');
    } else if (text.includes('rebalance')) {
      action = 'rebalance';
      requiredAgents.push('settlement');
    } else if (text.includes('optimize')) {
      action = 'optimize';
      requiredAgents.push('hedging');
    }

    // Always include reporting agent
    requiredAgents.push('reporting');

    // Extract numerical values
    const yieldMatch = text.match(/(\d+\.?\d*)%?\s*yield/i);
    const riskMatch = text.match(/risk.*?(\d+)/i);

    const intent: StrategyIntent = {
      action,
      targetPortfolio: input.portfolioId || 0,
      objectives: {
        yieldTarget: yieldMatch ? parseFloat(yieldMatch[1]) : undefined,
        riskLimit: riskMatch ? parseInt(riskMatch[1]) : undefined,
      },
      constraints: {
        maxSlippage: input.constraints?.maxRisk || 0.5,
        timeframe: 3600, // 1 hour
      },
      requiredAgents,
      estimatedComplexity: requiredAgents.length > 3 ? 'high' : 'medium',
    };

    logger.info('Strategy intent parsed', {
      agentId: this.id,
      action: intent.action,
      requiredAgents: intent.requiredAgents,
    });

    return intent;
  }

  /**
   * Parse strategy from task payload
   */
  private async parseStrategy(payload: StrategyInput): Promise<StrategyIntent> {
    return await this.parseNaturalLanguage(payload);
  }

  /**
   * Execute strategy from intent (supports both string and StrategyIntent)
   */
  async executeStrategyFromIntent(intentInput: StrategyIntent | string): Promise<AgentExecutionReport> {
    // If input is a string, parse it as natural language first
    let intent: StrategyIntent;
    if (typeof intentInput === 'string') {
      intent = await this.parseNaturalLanguage({ naturalLanguage: intentInput, portfolioId: 0 });
    } else {
      // Ensure requiredAgents has a default if not provided
      intent = {
        ...intentInput,
        requiredAgents: intentInput.requiredAgents || ['risk'],
      };
    }
    
    const executionId = uuidv4();
    const startTime = Date.now();

    logger.info('Executing strategy', {
      agentId: this.id,
      executionId,
      action: intent.action,
    });

    // Create execution report
    const report: AgentExecutionReport = {
      executionId,
      portfolioId: intent.targetPortfolio,
      strategy: intent.action,
      timestamp: new Date(),
      agents: [],
      zkProofs: [],
      totalExecutionTime: 0,
      status: 'success',
    };

    try {
      // Execute agents in sequence based on dependencies
      const results: Record<string, unknown> = {};

      // 1. Risk Analysis (always first)
      if (intent.requiredAgents.includes('risk')) {
        const riskResult = await this.delegateToAgent('risk', {
          type: 'analyze-risk',
          portfolioId: intent.targetPortfolio,
          objectives: intent.objectives,
        });
        results.riskAnalysis = riskResult.data;
        report.riskAnalysis = riskResult.data as RiskAnalysis;
      }

      // 2. Hedging Strategy (if needed)
      if (intent.requiredAgents.includes('hedging')) {
        const hedgingResult = await this.delegateToAgent('hedging', {
          type: 'create-hedge',
          portfolioId: intent.targetPortfolio,
          riskAnalysis: results.riskAnalysis,
          objectives: intent.objectives,
        });
        results.hedgingStrategy = hedgingResult.data;
        report.hedgingStrategy = hedgingResult.data as HedgingStrategy;
      }

      // 3. Settlement (if transactions needed)
      if (intent.requiredAgents.includes('settlement')) {
        const settlementResult = await this.delegateToAgent('settlement', {
          type: 'settle-payments',
          portfolioId: intent.targetPortfolio,
          hedgingStrategy: results.hedgingStrategy,
        });
        results.settlement = settlementResult.data;
        report.settlement = settlementResult.data as SettlementResult;
      }

      // 4. Generate ZK proof for risk calculation
      if (results.riskAnalysis) {
        const zkProof = await this.generateZKProof('risk-calculation', results.riskAnalysis);
        report.zkProofs.push(zkProof);
      }

      // 5. Reporting (always last)
      if (intent.requiredAgents.includes('reporting')) {
        await this.delegateToAgent('reporting', {
          type: 'generate-report',
          executionId,
          results,
        });
      }

      report.totalExecutionTime = Date.now() - startTime;
      this.executionReports.set(executionId, report);

      logger.info('Strategy execution successful', {
        agentId: this.id,
        executionId,
        totalTime: report.totalExecutionTime,
      });

      return report;
    } catch (error) {
      report.status = 'failed';
      report.errors = [error instanceof Error ? error : new Error(String(error))];
      report.totalExecutionTime = Date.now() - startTime;

      logger.error('Strategy execution failed', {
        error,
        agentId: this.id,
        executionId,
      });

      throw error;
    }
  }

  /**
   * Execute strategy (main entry point)
   */
  private async executeStrategy(payload: StrategyIntent): Promise<AgentExecutionReport> {
    return await this.executeStrategyFromIntent(payload);
  }

  /**
   * Delegate task to specialized agent
   */
  private async delegateToAgent(agentType: AgentType, taskPayload: unknown): Promise<TaskResult> {
    const payload = taskPayload as { type: string };
    
    logger.info('Delegating task to agent', {
      leadAgentId: this.id,
      agentType,
      taskType: payload.type,
    });

    const agent = this.agentRegistry.getAgentByType(agentType);
    if (!agent) {
      throw new Error(`Agent not found: ${agentType}`);
    }

    const task: AgentTask = {
      id: uuidv4(),
      type: payload.type,
      status: 'queued',
      priority: 1,
      payload: taskPayload,
      createdAt: new Date(),
    };

    const result = await agent.executeTask(task);

    logger.info('Task completed by agent', {
      leadAgentId: this.id,
      agentType,
      taskId: task.id,
      executionTime: task.executionTime,
    });

    return result;
  }

  /**
   * Generate ZK proof for verification
   */
  private async generateZKProof(proofType: string, data: unknown): Promise<{ proofType: string; proofHash: string; verified: boolean; }> {
    // In production, this would call the actual ZK proof generator
    // For now, return a mock proof structure
    logger.info('Generating ZK proof', {
      agentId: this.id,
      proofType,
    });

    return {
      proofType,
      proofHash: `0x${Buffer.from(JSON.stringify(data)).toString('hex').substring(0, 64)}`,
      verified: true,
    };
  }

  /**
   * Aggregate results from multiple agents
   */
  private async aggregateResults(payload: unknown): Promise<unknown> {
    logger.info('Aggregating results', { agentId: this.id });
    
    // Implement result aggregation logic
    return payload;
  }

  /**
   * Handle task result from specialized agent
   */
  private handleTaskResult(message: AgentMessage): void {
    logger.debug('Received task result', {
      agentId: this.id,
      from: message.from,
      correlationId: message.correlationId,
    });

    this.emit('agent-result', message.payload);
  }

  /**
   * Handle status update from specialized agent
   */
  private handleStatusUpdate(message: AgentMessage): void {
    logger.debug('Received status update', {
      agentId: this.id,
      from: message.from,
      status: message.payload,
    });
  }

  /**
   * Handle error from specialized agent
   */
  private handleAgentError(message: AgentMessage): void {
    logger.error('Received error from agent', {
      agentId: this.id,
      from: message.from,
      error: message.payload,
    });

    // Implement error recovery logic
    this.emit('agent-error', message.payload);
  }

  /**
   * Handle agent result event
   */
  private handleAgentResult(result: unknown): void {
    logger.debug('Handling agent result', { agentId: this.id, result });
  }

  /**
   * Get execution report by ID
   */
  getExecutionReport(executionId: string): AgentExecutionReport | undefined {
    return this.executionReports.get(executionId);
  }

  /**
   * Get all execution reports
   */
  getAllExecutionReports(): AgentExecutionReport[] {
    return Array.from(this.executionReports.values());
  }
}
