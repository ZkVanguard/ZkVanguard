import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';

/**
 * AI-Powered Portfolio Analysis API
 * Provides comprehensive portfolio insights using real RiskAgent + Crypto.com AI
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
      const result = await orchestrator.analyzePortfolio({ address, portfolioData });

      if (result.success && result.data) {
        return NextResponse.json({
          success: true,
          analysis: result.data,
          agentId: result.agentId,
          executionTime: result.executionTime,
          realAgent: true,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Fallback to AI service
    const aiService = getCryptocomAIService();
    const analysis = await aiService.analyzePortfolio(address, portfolioData || {});

    return NextResponse.json({
      success: true,
      analysis: {
        totalValue: analysis.totalValue,
        positions: analysis.positions,
        riskScore: analysis.riskScore,
        healthScore: analysis.healthScore,
        recommendations: analysis.recommendations,
        topAssets: analysis.topAssets,
      },
      aiPowered: aiService.isAvailable(),
      realAgent: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Portfolio analysis error:', error);
    return NextResponse.json(
      { 
        error: 'Portfolio analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const aiService = getCryptocomAIService();
  return NextResponse.json({
    status: 'AI Portfolio Analysis API operational',
    aiAvailable: aiService.isAvailable(),
    provider: 'Crypto.com AI Agent Service',
  });
}
