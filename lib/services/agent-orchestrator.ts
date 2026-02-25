/**
 * Agent Orchestrator Service
 * Coordinates all AI agents and provides unified interface for API routes
 */

import { ethers } from 'ethers';
import { RiskAgent } from '@/agents/specialized/RiskAgent';
import { HedgingAgent } from '@/agents/specialized/HedgingAgent';
import { SettlementAgent } from '@/agents/specialized/SettlementAgent';
import { ReportingAgent } from '@/agents/specialized/ReportingAgent';
import { LeadAgent } from '@/agents/core/LeadAgent';
import { logger } from '@/lib/utils/logger';
import { getCronosProvider } from '@/lib/throttled-provider';

export interface AgentOrchestrationResult {
  success: boolean;
  data: unknown;
  agentId: string;
  executionTime: number;
  error?: string;
}

/**
 * Singleton orchestrator for all agents
 */
export class AgentOrchestrator {
  private static instance: AgentOrchestrator | null = null;
  private provider: ethers.Provider;
  private signer: ethers.Signer | null = null;
  private initialized: boolean = false;

  // Agent instances
  private riskAgent: RiskAgent | null = null;
  private hedgingAgent: HedgingAgent | null = null;
  private settlementAgent: SettlementAgent | null = null;
  private reportingAgent: ReportingAgent | null = null;
  private leadAgent: LeadAgent | null = null;

  private constructor() {
    // Initialize provider
    const rpcUrl = process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org';
    this.provider = getCronosProvider(rpcUrl).provider;

    // Initialize signer if private key available
    // Check multiple env var names for compatibility
    const privateKey = process.env.AGENT_PRIVATE_KEY 
      || process.env.SERVER_PRIVATE_KEY 
      || process.env.SERVER_WALLET_PRIVATE_KEY
      || process.env.PRIVATE_KEY;
    if (privateKey) {
      this.signer = new ethers.Wallet(privateKey, this.provider);
      logger.info('AgentOrchestrator: Signer initialized');
    } else {
      logger.warn('AgentOrchestrator: No private key found, agents will run in read-only mode');
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
    }
    return AgentOrchestrator.instance;
  }

  /**
   * Reset singleton instance for testing
   */
  public static async resetInstance(): Promise<void> {
    if (AgentOrchestrator.instance) {
      await AgentOrchestrator.instance.shutdown();
      AgentOrchestrator.instance = null;
    }
  }

  /**
   * Shutdown all agents
   */
  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    logger.info('Shutting down AgentOrchestrator...');
    const shutdownResults = await Promise.allSettled([
      this.riskAgent?.shutdown(),
      this.hedgingAgent?.shutdown(),
      this.settlementAgent?.shutdown(),
      this.reportingAgent?.shutdown(),
      this.leadAgent?.shutdown(),
    ]);

    shutdownResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const agentNames = ['RiskAgent', 'HedgingAgent', 'SettlementAgent', 'ReportingAgent', 'LeadAgent'];
        logger.warn(`${agentNames[index]} shutdown failed:`, { error: result.reason });
      }
    });

    this.initialized = false;
    this.riskAgent = null;
    this.hedgingAgent = null;
    this.settlementAgent = null;
    this.reportingAgent = null;
    this.leadAgent = null;
    logger.info('AgentOrchestrator shutdown complete.');
  }

  /**
   * Initialize all agents
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.info('AgentOrchestrator already initialized');
      return;
    }

    try {
      logger.info('Initializing AgentOrchestrator...', {
        hasPrivateKey: !!this.signer,
        providerUrl: await this.provider.getNetwork().then(n => n.name).catch(() => 'unknown'),
      });

      // Use demo signer if no real signer available
      const signerToUse = this.signer || ethers.Wallet.createRandom(this.provider);
      logger.info('Signer configured', { isDemoSigner: !this.signer });

      // Initialize specialized agents
      logger.info('Creating RiskAgent...');
      this.riskAgent = new RiskAgent(
        'risk-agent-001',
        this.provider
      );

      logger.info('Creating HedgingAgent...');
      this.hedgingAgent = new HedgingAgent(
        'hedging-agent-001',
        this.provider,
        signerToUse
      );

      logger.info('Creating SettlementAgent...');
      this.settlementAgent = new SettlementAgent(
        'settlement-agent-001',
        this.provider,
        signerToUse,
        process.env.PAYMENT_ROUTER_ADDRESS || '0x0000000000000000000000000000000000000000'
      );

      logger.info('Creating ReportingAgent...');
      this.reportingAgent = new ReportingAgent('reporting-agent-001', this.provider);

      logger.info('Creating LeadAgent...');
      // Create LeadAgent with provider, signer, and registry for agent delegation
      const { AgentRegistry } = await import('@/agents/core/AgentRegistry');
      const agentRegistry = new AgentRegistry();
      
      this.leadAgent = new LeadAgent(
        'lead-agent-001',
        this.provider,
        signerToUse,
        agentRegistry
      );
      
      // Register specialized agents with the registry so LeadAgent can delegate
      if (this.riskAgent) agentRegistry.register(this.riskAgent);
      if (this.hedgingAgent) agentRegistry.register(this.hedgingAgent);
      if (this.settlementAgent) agentRegistry.register(this.settlementAgent);
      if (this.reportingAgent) agentRegistry.register(this.reportingAgent);

      // Initialize all agents with individual error handling
      logger.info('Initializing agents...');
      const initResults = await Promise.allSettled([
        this.riskAgent.initialize().then(() => logger.info('✅ RiskAgent initialized')),
        this.hedgingAgent.initialize().then(() => logger.info('✅ HedgingAgent initialized')),
        this.settlementAgent.initialize().then(() => logger.info('✅ SettlementAgent initialized')),
        this.reportingAgent.initialize().then(() => logger.info('✅ ReportingAgent initialized')),
        this.leadAgent.initialize().then(() => logger.info('✅ LeadAgent initialized')),
      ]);

      // Log any initialization failures
      initResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const agentNames = ['RiskAgent', 'HedgingAgent', 'SettlementAgent', 'ReportingAgent', 'LeadAgent'];
          logger.warn(`${agentNames[index]} initialization failed:`, { error: result.reason });
        }
      });

      this.initialized = true;
      logger.info('AgentOrchestrator initialized successfully', {
        riskAgent: !!this.riskAgent,
        hedgingAgent: !!this.hedgingAgent,
        settlementAgent: !!this.settlementAgent,
        reportingAgent: !!this.reportingAgent,
        leadAgent: !!this.leadAgent,
      });

      // Start auto-hedging PnL tracking (but not auto-execute hedges by default)
      try {
        const { autoHedgingService } = await import('./AutoHedgingService');
        await autoHedgingService.start();
        logger.info('✅ AutoHedgingService started for PnL tracking');
      } catch (err) {
        logger.warn('AutoHedgingService start failed (non-critical)', { error: err });
      }
    } catch (error) {
      logger.error('Failed to initialize AgentOrchestrator', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Ensure orchestrator is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        logger.error('Failed to initialize orchestrator', { error });
        // Continue in degraded mode - agents will use fallbacks
      }
    }
  }

  /**
   * Analyze portfolio using real agents
   */
  public async analyzePortfolio(params: {
    address: string;
    portfolioData?: unknown;
  }): Promise<AgentOrchestrationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.riskAgent) {
        throw new Error('RiskAgent not initialized - check logs for initialization errors');
      }

      // Execute portfolio analysis via RiskAgent
      const result = await this.riskAgent.executeTask({
        id: `analyze-${Date.now()}`,
        action: 'analyze_portfolio',
        parameters: {
          address: params.address,
          includeAssets: true,
          includeRisk: true,
        },
        priority: 3,
        createdAt: new Date(),
      });

      return {
        success: result.success,
        data: result.data,
        agentId: 'risk-agent-001',
        executionTime: Date.now() - startTime,
        error: result.error || undefined,
      };
    } catch (error) {
      logger.error('Portfolio analysis failed', { error });
      return {
        success: false,
        data: null,
        agentId: 'risk-agent-001',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Assess risk using real RiskAgent
   */
  public async assessRisk(params: {
    address: string;
    portfolioData?: unknown;
  }): Promise<AgentOrchestrationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.riskAgent) {
        throw new Error('RiskAgent not initialized');
      }

      // Execute risk assessment
      const result = await this.riskAgent.executeTask({
        id: `risk-${Date.now()}`,
        action: 'assess_portfolio_risk',
        parameters: {
          portfolioAddress: params.address,
        },
        priority: 4,
        createdAt: new Date(),
      });

      return {
        success: result.success,
        data: result.data,
        agentId: "risk-agent-001",
        executionTime: Date.now() - startTime,
        error: result.error || undefined,
      };
    } catch (error) {
      logger.error('Risk assessment failed', { error });
      return {
        success: false,
        data: null,
        agentId: 'risk-agent-001',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate hedge recommendations using real HedgingAgent
   */
  public async generateHedgeRecommendations(params: {
    portfolioId: string;
    assetSymbol: string;
    notionalValue: number;
  }): Promise<AgentOrchestrationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.hedgingAgent) {
        throw new Error('HedgingAgent not initialized');
      }

      // Execute hedge analysis
      const result = await this.hedgingAgent.executeTask({
        id: `hedge-${Date.now()}`,
        action: 'analyze_hedge',
        parameters: {
          portfolioId: params.portfolioId,
          assetSymbol: params.assetSymbol,
          notionalValue: params.notionalValue,
        },
        priority: 4,
        createdAt: new Date(),
      });

      return {
        success: result.success,
        data: result.data,
        agentId: "hedging-agent-001",
        executionTime: Date.now() - startTime,
        error: result.error || undefined,
      };
    } catch (error) {
      logger.error('Hedge recommendation failed', { error });
      return {
        success: false,
        data: null,
        agentId: 'hedging-agent-001',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute hedge position using real HedgingAgent + Moonlander
   */
  public async executeHedge(params: {
    market: string;
    side: 'LONG' | 'SHORT';
    notionalValue: string;
    leverage?: number;
  }): Promise<AgentOrchestrationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.hedgingAgent) {
        throw new Error('HedgingAgent not initialized');
      }

      // Execute hedge via HedgingAgent (which uses MoonlanderClient)
      const result = await this.hedgingAgent.executeTask({
        id: `execute-hedge-${Date.now()}`,
        action: 'open_hedge',
        parameters: {
          market: params.market,
          side: params.side,
          notionalValue: params.notionalValue,
          leverage: params.leverage || 2,
        },
        priority: 5,
        createdAt: new Date(),
      });

      return {
        success: result.success,
        data: result.data,
        agentId: "hedging-agent-001",
        executionTime: Date.now() - startTime,
        error: result.error || undefined,
      };
    } catch (error) {
      logger.error('Hedge execution failed', { error });
      return {
        success: false,
        data: null,
        agentId: 'hedging-agent-001',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute settlement using real SettlementAgent + x402
   */
  public async executeSettlement(params: {
    portfolioId: string;
    beneficiary: string;
    amount: string;
    token: string;
    purpose: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }): Promise<AgentOrchestrationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.settlementAgent) {
        throw new Error('SettlementAgent not initialized');
      }

      // Create settlement request
      const createResult = await this.settlementAgent.executeTask({
        id: `create-settlement-${Date.now()}`,
        action: 'create_settlement',
        parameters: {
          portfolioId: params.portfolioId,
          beneficiary: params.beneficiary,
          amount: params.amount,
          token: params.token,
          purpose: params.purpose,
          priority: params.priority || 'MEDIUM',
        },
        priority: params.priority === 'URGENT' ? 5 : 3,
        createdAt: new Date(),
      });

      if (!createResult.success) {
        throw new Error(createResult.error || 'Failed to create settlement');
      }

      // If not urgent, process immediately for demo
      if (params.priority !== 'URGENT') {
        const processResult = await this.settlementAgent.executeTask({
          id: `process-settlement-${Date.now()}`,
          action: 'process_settlement',
          parameters: {
            requestId: (createResult.data as Record<string, unknown>).requestId,
          },
          priority: 4,
          createdAt: new Date(),
        });

        return {
          success: processResult.success,
          data: processResult.data,
          agentId: "settlement-agent-001",
          executionTime: Date.now() - startTime,
          error: processResult.error || undefined,
        };
      }

      return {
        success: createResult.success,
        data: createResult.data,
        agentId: 'settlement-agent-001',
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Settlement execution failed', { error });
      return {
        success: false,
        data: null,
        agentId: 'settlement-agent-001',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute batch settlement using x402
   */
  public async executeBatchSettlement(params: {
    transactions: Array<{
      beneficiary: string;
      amount: string;
      token: string;
      purpose: string;
    }>;
  }): Promise<AgentOrchestrationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.settlementAgent) {
        throw new Error('SettlementAgent not initialized');
      }

      // Create batch settlement
      const result = await this.settlementAgent.executeTask({
        id: `batch-settlement-${Date.now()}`,
        action: 'batch_settlements',
        parameters: {
          transactions: params.transactions,
        },
        priority: 4,
        createdAt: new Date(),
      });

      return {
        success: result.success,
        data: result.data,
        agentId: "settlement-agent-001",
        executionTime: Date.now() - startTime,
        error: result.error || undefined,
      };
    } catch (error) {
      logger.error('Batch settlement failed', { error });
      return {
        success: false,
        data: null,
        agentId: 'settlement-agent-001',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate report using ReportingAgent
   */
  public async generateReport(params: {
    reportType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
    startDate?: Date;
    endDate?: Date;
  }): Promise<AgentOrchestrationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      if (!this.reportingAgent) {
        throw new Error('ReportingAgent not initialized');
      }

      const result = await this.reportingAgent.executeTask({
        id: `report-${Date.now()}`,
        action: 'generate_report',
        parameters: {
          type: params.reportType,
          startDate: params.startDate,
          endDate: params.endDate,
        },
        priority: 2,
        createdAt: new Date(),
      });

      return {
        success: result.success,
        data: result.data,
        agentId: "reporting-agent-001",
        executionTime: Date.now() - startTime,
        error: result.error || undefined,
      };
    } catch (error) {
      logger.error('Report generation failed', { error });
      return {
        success: false,
        data: null,
        agentId: 'reporting-agent-001',
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get agent status
   */
  public getStatus(): {
    initialized: boolean;
    agents: {
      risk: boolean;
      hedging: boolean;
      settlement: boolean;
      reporting: boolean;
      lead: boolean;
    };
    signerAvailable: boolean;
  } {
    return {
      initialized: this.initialized,
      agents: {
        risk: this.riskAgent !== null,
        hedging: this.hedgingAgent !== null,
        settlement: this.settlementAgent !== null,
        reporting: this.reportingAgent !== null,
        lead: this.leadAgent !== null,
      },
      signerAvailable: this.signer !== null,
    };
  }

  /**
   * Backwards-compatible alias used by tests: getAgentStatus
   */
  public getAgentStatus(): {
    initialized: boolean;
    riskAgent: RiskAgent | null;
    hedgingAgent: HedgingAgent | null;
    settlementAgent: SettlementAgent | null;
    reportingAgent: ReportingAgent | null;
    leadAgent: LeadAgent | null;
    signerAvailable: boolean;
  } {
    return {
      initialized: this.initialized,
      riskAgent: this.riskAgent,
      hedgingAgent: this.hedgingAgent,
      settlementAgent: this.settlementAgent,
      reportingAgent: this.reportingAgent,
      leadAgent: this.leadAgent,
      signerAvailable: this.signer !== null,
    };
  }

  /**
   * Get LeadAgent for direct orchestration
   * Ensures orchestrator is initialized first
   */
  public async getLeadAgent(): Promise<LeadAgent | null> {
    await this.ensureInitialized();
    return this.leadAgent;
  }

  /**
   * Get RiskAgent for direct access
   */
  public async getRiskAgent(): Promise<RiskAgent | null> {
    await this.ensureInitialized();
    return this.riskAgent;
  }

  /**
   * Get HedgingAgent for direct access
   */
  public async getHedgingAgent(): Promise<HedgingAgent | null> {
    await this.ensureInitialized();
    return this.hedgingAgent;
  }
}

// Export singleton instance getter
export const getAgentOrchestrator = () => AgentOrchestrator.getInstance();

/**
 * Reset orchestrator for tests
 */
export const resetAgentOrchestrator = async () => {
  await AgentOrchestrator.resetInstance();
};


