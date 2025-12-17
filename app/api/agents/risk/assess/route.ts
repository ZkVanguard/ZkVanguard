import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';

/**
 * Risk Assessment API Route
 * Uses real RiskAgent + Crypto.com AI for intelligent risk analysis
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, portfolioData, useRealAgent = true } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Use real agent orchestration if enabled
    if (useRealAgent) {
      const orchestrator = getAgentOrchestrator();
      const result = await orchestrator.assessRisk({ address, portfolioData });

      if (result.success && result.data) {
        return NextResponse.json({
          ...result.data,
          agentId: result.agentId,
          executionTime: result.executionTime,
          realAgent: true,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Fallback to AI service
    const aiService = getCryptocomAIService();
    const riskAssessment = await aiService.assessRisk(portfolioData || { address });

    const riskMetrics = {
      var: riskAssessment.var95,
      volatility: riskAssessment.volatility,
      sharpeRatio: riskAssessment.sharpeRatio,
      liquidationRisk: riskAssessment.riskScore > 70 ? 0.08 : riskAssessment.riskScore > 50 ? 0.05 : 0.02,
      healthScore: 100 - riskAssessment.riskScore,
      overallRisk: riskAssessment.overallRisk,
      riskScore: riskAssessment.riskScore,
      factors: riskAssessment.factors,
      recommendations: [
        `Overall risk level: ${riskAssessment.overallRisk}`,
        `Risk score: ${riskAssessment.riskScore.toFixed(1)}/100`,
        ...riskAssessment.factors.map(f => `${f.factor}: ${f.description}`),
      ],
      aiPowered: aiService.isAvailable(),
      realAgent: false,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(riskMetrics);
  } catch (error) {
    console.error('Risk assessment error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Risk Agent API operational' });
}
