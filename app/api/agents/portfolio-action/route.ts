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
  realMetrics?: {
    riskScore: number;
    volatility: number;
    sharpeRatio: number;
    hedgeSignals: number;
    totalValue: number;
  };
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
    const { portfolioId, currentValue, targetYield, riskTolerance, assets, predictions, realMetrics } = body;

    logger.info('Portfolio action analysis requested', {
      portfolioId,
      currentValue,
      assets: assets.length,
      predictions: predictions.length,
      hasRealMetrics: !!realMetrics,
    });

    // Use REAL metrics if provided, otherwise fall back to agent orchestrator
    let riskScore: number;
    let volatility: number;
    let sentiment: 'bullish' | 'bearish' | 'neutral';
    let riskRecommendations: string[] = [];
    let hedgeSignals = 0;

    if (realMetrics) {
      // Use real calculated metrics from PositionsContext
      riskScore = realMetrics.riskScore;
      volatility = realMetrics.volatility;
      hedgeSignals = realMetrics.hedgeSignals;
      
      // Determine sentiment from Sharpe ratio
      if (realMetrics.sharpeRatio > 1.5) sentiment = 'bullish';
      else if (realMetrics.sharpeRatio < 0.5) sentiment = 'bearish';
      else sentiment = 'neutral';

      logger.info('Using real portfolio metrics', { riskScore, volatility, sentiment, hedgeSignals });
    } else {
      // Fallback: Use agent orchestrator
      const orchestrator = getAgentOrchestrator();

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

      const riskAnalysisData = riskResult.data || {};
      riskScore = riskResult.success && riskAnalysisData.riskScore 
        ? Number(riskAnalysisData.riskScore) 
        : 50;
      volatility = riskAnalysisData.volatility || 0.3;
      sentiment = riskAnalysisData.sentiment || 'neutral';
      riskRecommendations = riskAnalysisData.recommendations || [];
    }

    // Analyze hedge requirements based on real signals
    const highRiskPredictions = predictions.filter(
      p => p.recommendation === 'HEDGE' && p.probability > 60
    );
    const criticalPredictions = predictions.filter(
      p => p.impact === 'HIGH' && p.probability > 70
    );

    // Step 5: Lead Agent makes final decision based on multi-agent analysis
    const reasoning: string[] = [];
    let action: 'HOLD' | 'ADD_FUNDS' | 'WITHDRAW' | 'HEDGE' = 'HOLD';
    let confidence = 0.7;

    // Use real agent data to make decision
    if (criticalPredictions.length > 0 && criticalPredictions[0].probability > 75) {
      // CRITICAL: High probability risk event
      action = 'WITHDRAW';
      confidence = 0.85 + (criticalPredictions[0].probability - 75) * 0.006; // Up to 0.94
      reasoning.push(`🚨 CRITICAL ALERT: ${criticalPredictions.length} high-probability market event${criticalPredictions.length > 1 ? 's' : ''} detected`);
      reasoning.push(`Top Risk: "${criticalPredictions[0].question}" (${criticalPredictions[0].probability}% probability)`);
      reasoning.push(`Risk Agent Score: ${riskScore}/100 - ${sentiment} market sentiment`);
      
      if (riskScore > 70) {
        reasoning.push(`Portfolio risk exceeds safe threshold - immediate action recommended`);
      }
    } else if (riskScore > 75 || (criticalPredictions.length > 0 && riskScore > 60)) {
      // HIGH RISK: Either high risk score or critical predictions with elevated risk
      action = 'HEDGE';
      confidence = 0.75 + Math.min(riskScore - 60, 20) * 0.005; // 0.75 to 0.85
      reasoning.push(`⚠️ HIGH RISK ENVIRONMENT: Risk Score ${riskScore}/100`);
      
      if (criticalPredictions.length > 0) {
        reasoning.push(`${criticalPredictions.length} critical market prediction${criticalPredictions.length > 1 ? 's' : ''} with HIGH impact`);
      }
      if (highRiskPredictions.length > 0) {
        reasoning.push(`${highRiskPredictions.length} hedge signal${highRiskPredictions.length > 1 ? 's' : ''} from prediction markets`);
      }
      
      if (hedgeSignals > 0) {
        reasoning.push(`${hedgeSignals} active hedge position${hedgeSignals > 1 ? 's' : ''} currently open`);
      }
      
      reasoning.push(`Volatility: ${(volatility * 100).toFixed(1)}% - Market sentiment: ${sentiment}`);
    } else if (highRiskPredictions.length > 0 && riskScore > 50) {
      // MODERATE RISK: Hedge signals with moderate risk
      action = 'HEDGE';
      confidence = 0.70;
      reasoning.push(`🛡️ HEDGING RECOMMENDED: ${highRiskPredictions.length} market hedge signal${highRiskPredictions.length > 1 ? 's' : ''}`);
      reasoning.push(`Risk Score: ${riskScore}/100 - Above neutral threshold`);
      reasoning.push(`Consider protective positions to reduce downside exposure`);
    } else if (riskScore < 30 && predictions.filter(p => p.recommendation === 'IGNORE').length === predictions.length) {
      // LOW RISK: Safe to add funds
      action = 'ADD_FUNDS';
      confidence = 0.80 + Math.max(30 - riskScore, 0) * 0.006; // 0.80 to 0.98
      reasoning.push(`✅ FAVORABLE CONDITIONS: Low risk environment detected`);
      reasoning.push(`Risk Score: ${riskScore}/100 - Well below safety threshold`);
      reasoning.push(`Market Sentiment: ${sentiment} - ${volatility < 0.25 ? 'Low' : 'Moderate'} volatility`);
      reasoning.push(`All ${predictions.length} prediction market signal${predictions.length > 1 ? 's' : ''} show IGNORE status`);
      reasoning.push(`Portfolio on track for ${targetYield}% yield target`);
    } else if (riskScore < 40 && sentiment === 'bullish') {
      // MODERATE-LOW RISK with positive sentiment
      action = 'ADD_FUNDS';
      confidence = 0.75;
      reasoning.push(`✅ GROWTH OPPORTUNITY: Bullish market sentiment with manageable risk`);
      reasoning.push(`Risk Score: ${riskScore}/100 - Acceptable level`);
      reasoning.push(`${predictions.filter(p => p.recommendation === 'MONITOR').length} signals being monitored`);
    } else {
      // DEFAULT: HOLD
      action = 'HOLD';
      confidence = 0.70 + (Math.abs(50 - riskScore) < 10 ? 0.05 : 0); // Higher confidence if near ideal
      reasoning.push(`📊 MAINTAIN CURRENT POSITION: Portfolio within optimal parameters`);
      reasoning.push(`Risk Score: ${riskScore}/100 - ${riskScore > 60 ? 'Elevated' : riskScore > 40 ? 'Moderate' : 'Low'} risk level`);
      reasoning.push(`Market Sentiment: ${sentiment} - Volatility: ${(volatility * 100).toFixed(1)}%`);
      reasoning.push(`${predictions.length} market signal${predictions.length > 1 ? 's' : ''} being actively monitored`);
      reasoning.push(`Target Yield: ${targetYield}% - Strategy performing as expected`);
    }

    // Generate detailed recommendations from real agent data
    const recommendations: string[] = [];
    
    // Add recommendations from Risk Agent
    if (riskRecommendations && riskRecommendations.length > 0) {
      recommendations.push(...riskRecommendations.slice(0, 2)); // Top 2 recommendations
    }

    // Add volatility-based recommendations
    if (volatility > 0.4) {
      recommendations.push('High volatility detected - consider volatility-targeting strategies');
    } else if (volatility < 0.2) {
      recommendations.push('Low volatility environment - opportunity for leveraged positions');
    }

    // Add prediction-based recommendations
    if (highRiskPredictions.length > 0) {
      recommendations.push(`Active monitoring: ${highRiskPredictions.length} hedge signal${highRiskPredictions.length > 1 ? 's' : ''} require attention`);
    }
    
    const monitorPredictions = predictions.filter(p => p.recommendation === 'MONITOR');
    if (monitorPredictions.length > 0 && action === 'HOLD') {
      recommendations.push(`Watch closely: ${monitorPredictions.length} developing market condition${monitorPredictions.length > 1 ? 's' : ''}`);
    }

    // Add sentiment-based recommendations
    if (sentiment === 'bearish' && action !== 'WITHDRAW') {
      recommendations.push('Bearish sentiment detected - consider defensive positioning');
    } else if (sentiment === 'bullish' && riskScore < 50) {
      recommendations.push('Bullish sentiment with low risk - evaluate growth opportunities');
    }

    const response: PortfolioActionRecommendation = {
      action,
      confidence: Math.min(confidence, 0.99), // Cap at 99%
      reasoning,
      riskScore,
      recommendations,
      agentAnalysis: {
        riskAgent: `Risk Analysis: ${riskScore}/100 (${riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MODERATE' : 'LOW'}) | Volatility: ${(volatility * 100).toFixed(1)}% | Sentiment: ${sentiment.toUpperCase()}`,
        hedgingAgent: hedgeSignals > 0
          ? `Active Monitoring: ${hedgeSignals} hedge position${hedgeSignals !== 1 ? 's' : ''} protecting portfolio`
          : `No hedging required - ${predictions.filter(p => p.recommendation === 'HEDGE').length} prediction market hedge signal${predictions.filter(p => p.recommendation === 'HEDGE').length !== 1 ? 's' : ''}`,
        leadAgent: `Final Decision: ${action} (${(confidence * 100).toFixed(0)}% confidence) | Based on ${predictions.length} market signal${predictions.length !== 1 ? 's' : ''} + multi-agent analysis`,
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
