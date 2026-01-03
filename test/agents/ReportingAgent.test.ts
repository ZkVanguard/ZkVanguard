/**
 * ReportingAgent Tests
 * Comprehensive tests for report generation
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ethers } from 'ethers';
import { ReportingAgent } from '../../agents/specialized/ReportingAgent';
import { AgentTask } from '../../shared/types/agent';

describe('ReportingAgent', () => {
  let agent: ReportingAgent;
  let provider: ethers.Provider;

  beforeEach(async () => {
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    agent = new ReportingAgent('test-reporting-agent', provider);
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
      expect(capabilities).toContain('DATA_ANALYSIS');
      expect(capabilities).toContain('REPORTING');
    });
  });

  describe('Risk Reports', () => {
    it('should generate risk report', async () => {
      const task: AgentTask = {
        id: 'test-risk-1',
        action: 'generate_risk_report',
        parameters: {
          portfolioId: 'portfolio-1',
          includeZKProofs: true,
        },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('reportId');
      expect(result.data.report).toHaveProperty('summary');
      expect(result.data.report).toHaveProperty('assetRisks');
      expect(result.data.report).toHaveProperty('hedges');
      expect(result.data.report.zkProofs).toBeDefined();
    });

    it('should include risk metrics', async () => {
      const task: AgentTask = {
        id: 'test-risk-2',
        action: 'generate_risk_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.report;

      expect(report.summary).toHaveProperty('var95');
      expect(report.summary).toHaveProperty('cvar95');
      expect(report.summary).toHaveProperty('sharpeRatio');
      expect(report.summary).toHaveProperty('riskLevel');
    });

    it('should calculate asset risk contributions', async () => {
      const task: AgentTask = {
        id: 'test-risk-3',
        action: 'generate_risk_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.report;

      expect(report.assetRisks.length).toBeGreaterThan(0);
      
      const totalContribution = report.assetRisks.reduce(
        (sum: number, asset: any) => sum + asset.contribution,
        0
      );
      expect(totalContribution).toBeGreaterThan(0);
    });
  });

  describe('Performance Reports', () => {
    it('should generate performance report', async () => {
      const task: AgentTask = {
        id: 'test-perf-1',
        action: 'generate_performance_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.report).toHaveProperty('summary');
      expect(result.data.report).toHaveProperty('trades');
      expect(result.data.report).toHaveProperty('dailyReturns');
    });

    it('should calculate returns correctly', async () => {
      const task: AgentTask = {
        id: 'test-perf-2',
        action: 'generate_performance_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const summary = result.data.report.summary;

      expect(summary).toHaveProperty('absoluteReturn');
      expect(summary).toHaveProperty('percentageReturn');
      expect(summary).toHaveProperty('sharpeRatio');
      expect(summary).toHaveProperty('maxDrawdown');
    });

    it('should include benchmark comparison', async () => {
      const task: AgentTask = {
        id: 'test-perf-3',
        action: 'generate_performance_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.report;

      expect(report.benchmarkComparison).toBeDefined();
      expect(report.benchmarkComparison).toHaveProperty('alpha');
      expect(report.benchmarkComparison).toHaveProperty('beta');
    });

    it('should provide daily returns data', async () => {
      const task: AgentTask = {
        id: 'test-perf-4',
        action: 'generate_performance_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.report;

      expect(report.dailyReturns.length).toBeGreaterThan(0);
      expect(report.dailyReturns[0]).toHaveProperty('date');
      expect(report.dailyReturns[0]).toHaveProperty('value');
      expect(report.dailyReturns[0]).toHaveProperty('return');
    });
  });

  describe('Settlement Reports', () => {
    it('should generate settlement report', async () => {
      const task: AgentTask = {
        id: 'test-settle-1',
        action: 'generate_settlement_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.report).toHaveProperty('summary');
      expect(result.data.report).toHaveProperty('settlements');
      expect(result.data.report).toHaveProperty('batches');
    });

    it('should calculate settlement statistics', async () => {
      const task: AgentTask = {
        id: 'test-settle-2',
        action: 'generate_settlement_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const summary = result.data.report.summary;

      expect(summary).toHaveProperty('totalSettlements');
      expect(summary).toHaveProperty('totalVolume');
      expect(summary).toHaveProperty('successRate');
      expect(summary).toHaveProperty('avgProcessingTime');
      expect(summary).toHaveProperty('gasSaved');
    });
  });

  describe('Portfolio Reports', () => {
    it('should generate portfolio report', async () => {
      const task: AgentTask = {
        id: 'test-portfolio-1',
        action: 'generate_portfolio_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.report).toHaveProperty('overview');
      expect(result.data.report).toHaveProperty('allocation');
      expect(result.data.report).toHaveProperty('strategies');
      expect(result.data.report).toHaveProperty('recentActivity');
    });

    it('should show asset allocation', async () => {
      const task: AgentTask = {
        id: 'test-portfolio-2',
        action: 'generate_portfolio_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.report;

      expect(report.allocation.length).toBeGreaterThan(0);
      
      const totalPercentage = report.allocation.reduce(
        (sum: number, asset: any) => sum + asset.percentage,
        0
      );
      expect(totalPercentage).toBeCloseTo(100, 1);
    });
  });

  describe('Audit Reports', () => {
    it('should generate audit report', async () => {
      const task: AgentTask = {
        id: 'test-audit-1',
        action: 'generate_audit_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.report).toHaveProperty('agentActivity');
      expect(result.data.report).toHaveProperty('transactions');
      expect(result.data.report).toHaveProperty('zkVerifications');
      expect(result.data.report).toHaveProperty('anomalies');
    });

    it('should track agent activity', async () => {
      const task: AgentTask = {
        id: 'test-audit-2',
        action: 'generate_audit_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.report;

      expect(report.agentActivity.length).toBeGreaterThan(0);
      expect(report.agentActivity[0]).toHaveProperty('agentId');
      expect(report.agentActivity[0]).toHaveProperty('tasksExecuted');
      expect(report.agentActivity[0]).toHaveProperty('successRate');
    });

    it('should include ZK proof verifications', async () => {
      const task: AgentTask = {
        id: 'test-audit-3',
        action: 'generate_audit_report',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.report;

      expect(report.zkVerifications).toBeDefined();
      if (report.zkVerifications.length > 0) {
        expect(report.zkVerifications[0]).toHaveProperty('proofHash');
        expect(report.zkVerifications[0]).toHaveProperty('verified');
      }
    });
  });

  describe('Comprehensive Reports', () => {
    it('should generate comprehensive report', async () => {
      const task: AgentTask = {
        id: 'test-comprehensive-1',
        action: 'generate_comprehensive_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.report).toHaveProperty('executiveSummary');
      expect(result.data.report).toHaveProperty('riskReport');
      expect(result.data.report).toHaveProperty('performanceReport');
      expect(result.data.report).toHaveProperty('settlementReport');
      expect(result.data.report).toHaveProperty('auditReport');
      expect(result.data.report).toHaveProperty('recommendations');
    });

    it('should include executive summary', async () => {
      const task: AgentTask = {
        id: 'test-comprehensive-2',
        action: 'generate_comprehensive_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const summary = result.data.report.executiveSummary;

      expect(summary).toHaveProperty('totalValue');
      expect(summary).toHaveProperty('overallReturn');
      expect(summary).toHaveProperty('totalSettlements');
      expect(summary).toHaveProperty('systemHealth');
    });

    it('should provide actionable recommendations', async () => {
      const task: AgentTask = {
        id: 'test-comprehensive-3',
        action: 'generate_comprehensive_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const recommendations = result.data.report.recommendations;

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0]).toHaveProperty('priority');
      expect(recommendations[0]).toHaveProperty('category');
      expect(recommendations[0]).toHaveProperty('recommendation');
      expect(recommendations[0]).toHaveProperty('rationale');
    });
  });

  describe('Report Export', () => {
    let reportId: string;

    beforeEach(async () => {
      const task = await agent['executeTask']({
        id: 'setup-export',
        action: 'generate_risk_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      });
      reportId = task.data.reportId;
    });

    it('should export report as JSON', async () => {
      const task: AgentTask = {
        id: 'test-export-1',
        action: 'export_report',
        parameters: { reportId, format: 'JSON' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.format).toBe('JSON');
      expect(() => JSON.parse(result.data.data)).not.toThrow();
    });

    it('should export report as CSV', async () => {
      const task: AgentTask = {
        id: 'test-export-2',
        action: 'export_report',
        parameters: { reportId, format: 'CSV' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.format).toBe('CSV');
      expect(result.data.data).toContain(',');
    });

    it('should export report as HTML', async () => {
      const task: AgentTask = {
        id: 'test-export-3',
        action: 'export_report',
        parameters: { reportId, format: 'HTML' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.format).toBe('HTML');
      expect(result.data.data).toContain('<!DOCTYPE html>');
    });

    it('should handle invalid report ID', async () => {
      const task: AgentTask = {
        id: 'test-export-4',
        action: 'export_report',
        parameters: { reportId: 'invalid-id', format: 'JSON' },
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('List Reports', () => {
    beforeEach(async () => {
      // Generate multiple reports
      await agent['executeTask']({
        id: 'setup-list-1',
        action: 'generate_risk_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      });

      await agent['executeTask']({
        id: 'setup-list-2',
        action: 'generate_performance_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      });
    });

    it('should list all reports', async () => {
      const task: AgentTask = {
        id: 'test-list-1',
        action: 'list_reports',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);

      expect(result.success).toBe(true);
      expect(result.data.reports.length).toBeGreaterThanOrEqual(2);
      expect(result.data.total).toBeGreaterThanOrEqual(2);
    });

    it('should include report metadata', async () => {
      const task: AgentTask = {
        id: 'test-list-2',
        action: 'list_reports',
        parameters: {},
        priority: 1,
        createdAt: Date.now(),
      };

      const result = await agent['executeTask'](task);
      const report = result.data.reports[0];

      expect(report).toHaveProperty('reportId');
      expect(report).toHaveProperty('type');
      expect(report).toHaveProperty('createdAt');
    });
  });

  describe('Report Retrieval', () => {
    let reportId: string;

    beforeEach(async () => {
      const task = await agent['executeTask']({
        id: 'setup-retrieve',
        action: 'generate_risk_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      });
      reportId = task.data.reportId;
    });

    it('should retrieve report by ID', () => {
      const report = agent.getReport(reportId);

      expect(report).toBeDefined();
      expect(report).toHaveProperty('portfolioId');
    });

    it('should return null for non-existent report', () => {
      const report = agent.getReport('non-existent-id');

      expect(report).toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should generate reports quickly', async () => {
      const task: AgentTask = {
        id: 'test-perf-1',
        action: 'generate_risk_report',
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      };

      const startTime = Date.now();
      const result = await agent['executeTask'](task);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(2000); // 2 seconds max
    });

    it('should handle concurrent report generation', async () => {
      const tasks = [
        'generate_risk_report',
        'generate_performance_report',
        'generate_settlement_report',
      ].map((action, i) => ({
        id: `concurrent-${i}`,
        action,
        parameters: { portfolioId: 'portfolio-1' },
        priority: 1,
        createdAt: Date.now(),
      }));

      const promises = tasks.map(task => agent.addTask(task));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
    });
  });
});
