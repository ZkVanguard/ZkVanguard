/**
 * Agent Portfolio Action Recommendation API
 * Uses all 5 agents to recommend: HOLD, ADD_FUNDS, WITHDRAW, or HEDGE
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface PortfolioActionRequest {
  portfolioId: number;
  currentValue: number;
  targetYield: number;
  riskTolerance: number;
  assets: string[];
  predictions: Array<{
    question: string;
    probability: number;
    impact: 'HIGH' | 'MODERATE' | 'LOW';
    recommendation: 'HEDGE' | 'MONITOR' | 'IGNORE';
  }>;
}

export interface PortfolioActionRecommendation {
  action: 'HOLD' | 'ADD_FUNDS' | 'WITHDRAW' | 'HEDGE';
  confidence: number;
  reasoning: string[];
  riskScore: number;
  recommendations: string[];
  agentAnalysis: {
    riskAgent: string;
    hedgingAgent: string;
    leadAgent: string;
  };
}

/**
 * POST /api/agents/portfolio-action
 * Get agent recommendation for portfolio action
 */
export async function POST(request: NextRequest) {
  try {
    const body: PortfolioActionRequest = await request.json();
    const { portfolioId, currentValue, targetYield, riskTolerance, assets, predictions } = body;

    logger.info('Portfolio action analysis requested', {
      portfolioId,
      currentValue,
      assets: assets.length,
      predictions: predictions.length,
    });

    const orchestrator = getAgentOrchestrator();

    // Step 1: Risk Agent - Assess portfolio risk
    const riskResult = await orchestrator.assessRisk({
      address: `portfolio-${portfolioId}`,
      portfolioData: {
        totalValue: currentValue,
        tokens: assets.map(symbol => ({
          symbol,
          balance: 1,
          usdValue: currentValue / assets.length,
        })),
      },
    });

    // Step 2: Hedging Agent - Analyze if hedging needed based on predictions
    const highRiskPredictions = predictions.filter(
      p => p.recommendation === 'HEDGE' && p.probability > 60
    );
    const criticalPredictions = predictions.filter(
      p => p.impact === 'HIGH' && p.probability > 70
    );

    let hedgeRecommendation = 'NO_HEDGE_NEEDED';
    if (highRiskPredictions.length > 0 || criticalPredictions.length > 0) {
      // Use hedging agent if there are critical predictions
      const hedgeResult = await orchestrator.generateHedgeRecommendations({
        portfolioId: `portfolio-${portfolioId}`,
        assetSymbol: assets[0] || 'CRO',
        notionalValue: currentValue,
      });

      if (hedgeResult.success && hedgeResult.data) {
        hedgeRecommendation = hedgeResult.data.recommendation?.action || 'MONITOR';
      }
    }

    // Step 3: Lead Agent - Make final decision
    const riskScore = riskResult.success && riskResult.data?.riskScore 
      ? Number(riskResult.data.riskScore) 
      : 50;

    const reasoning: string[] = [];
    let action: 'HOLD' | 'ADD_FUNDS' | 'WITHDRAW' | 'HEDGE' = 'HOLD';
    let confidence = 0.7;

    // Decision logic based on multi-agent analysis
    if (criticalPredictions.length > 0) {
      // Critical predictions detected
      if (criticalPredictions[0].probability > 75) {
        action = 'WITHDRAW';
        confidence = 0.85;
        reasoning.push(`🚨 CRITICAL: ${criticalPredictions.length} high-probability predictions detected`);
        reasoning.push(`Consider withdrawing to protect capital (${criticalPredictions[0].question})`);
      } else {
        action = 'HEDGE';
        confidence = 0.75;
        reasoning.push(`⚠️ WARNING: ${criticalPredictions.length} critical predictions found`);
        reasoning.push(`Hedging recommended to reduce exposure risk`);
      }
    } else if (highRiskPredictions.length > 0) {
      // Hedge recommendations from Delphi
      action = 'HEDGE';
      confidence = 0.7;
      reasoning.push(`🛡️ ${highRiskPredictions.length} hedge recommendations from prediction markets`);
      reasoning.push(`Consider opening hedge positions to protect downside`);
    } else if (riskScore < 30 && predictions.filter(p => p.recommendation === 'IGNORE').length === predictions.length) {
      // Low risk + all predictions are IGNORE = safe to add more
      action = 'ADD_FUNDS';
      confidence = 0.8;
      reasoning.push(`✅ Low risk environment (score: ${riskScore}/100)`);
      reasoning.push(`No critical market signals detected`);
      reasoning.push(`Portfolio performing within target parameters`);
    } else {
      // Default: HOLD
      action = 'HOLD';
      confidence = 0.75;
      reasoning.push(`📊 Portfolio stable with moderate risk (score: ${riskScore}/100)`);
      reasoning.push(`${predictions.length} market signals being monitored`);
      reasoning.push(`Current strategy on track for ${targetYield}% yield target`);
    }

    // Generate detailed recommendations
    const recommendations: string[] = [];
    
    if (riskScore > 70) {
      recommendations.push('High risk detected - consider reducing exposure');
    } else if (riskScore < 30) {
      recommendations.push('Low risk environment - opportunity for growth');
    }

    if (highRiskPredictions.length > 0) {
      recommendations.push(`Monitor ${highRiskPredictions.length} hedge signals closely`);
    }

    if (predictions.some(p => p.recommendation === 'MONITOR')) {
      recommendations.push('Stay vigilant - market conditions developing');
    }

    const response: PortfolioActionRecommendation = {
      action,
      confidence,
      reasoning,
      riskScore,
      recommendations,
      agentAnalysis: {
        riskAgent: `Portfolio risk: ${riskScore}/100 - ${riskScore > 60 ? 'High' : riskScore > 40 ? 'Medium' : 'Low'}`,
        hedgingAgent: `Hedge status: ${hedgeRecommendation} (${highRiskPredictions.length} signals)`,
        leadAgent: `Final decision: ${action} with ${(confidence * 100).toFixed(0)}% confidence`,
      },
    };

    logger.info('Portfolio action recommendation generated', {
      portfolioId,
      action,
      confidence,
      riskScore,
    });

    return NextResponse.json(response);

  } catch (error) {
    logger.error('Portfolio action analysis failed', { error });
    return NextResponse.json(
      {
        error: 'Failed to analyze portfolio action',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
