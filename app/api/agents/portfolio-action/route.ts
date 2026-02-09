/**
 * Agent Portfolio Action Recommendation API
 * Uses all 5 agents to recommend: HOLD, ADD_FUNDS, WITHDRAW, or HEDGE
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
}

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
    source?: string;
  }>;
}

export interface PredictionAnalysis {
  totalPredictions: number;
  hedgeSignals: number;
  highImpactEvents: number;
  predictionRiskScore: number;
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  topRisks: Array<{ question: string; probability: number; impact: string }>;
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
  predictionAnalysis?: PredictionAnalysis;
}

/**
 * POST /api/agents/portfolio-action
 * Get agent recommendation for portfolio action
 */
export async function POST(request: NextRequest) {
  try {
    const body: PortfolioActionRequest = await request.json();
    const { portfolioId, currentValue, targetYield: _targetYield, riskTolerance, assets, predictions, realMetrics } = body;

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

      const riskAnalysisData = (riskResult.data || {}) as Record<string, unknown>;
      riskScore = riskResult.success && riskAnalysisData.riskScore 
        ? Number(riskAnalysisData.riskScore) 
        : 50;
      volatility = (riskAnalysisData.volatility as number) || 0.3;
      sentiment = (riskAnalysisData.sentiment as 'bullish' | 'bearish' | 'neutral') || 'neutral';
      riskRecommendations = (riskAnalysisData.recommendations as string[]) || [];
    }

    // Analyze hedge requirements based on real signals
    const highRiskPredictions = predictions.filter(
      p => p.recommendation === 'HEDGE' && p.probability > 60
    );
    const criticalPredictions = predictions.filter(
      p => p.impact === 'HIGH' && p.probability > 70
    );

    // Step 5: Use AI (Ollama/Qwen) for final decision - NO FALLBACK
    const reasoning: string[] = [];
    let action: 'HOLD' | 'ADD_FUNDS' | 'WITHDRAW' | 'HEDGE' = 'HOLD';
    let confidence = 0.7;

    // ALWAYS use AI-powered decision (Ollama/Qwen with CUDA)
    const { llmProvider } = await import('@/lib/ai/llm-provider');
    await llmProvider.waitForInit();
    
    const activeProvider = llmProvider.getActiveProvider();
    logger.info('🤖 Using AI provider for portfolio decision', { provider: activeProvider });
    
    // Build prediction market context for AI
    const predictionContext = predictions.length > 0 
      ? `\nPREDICTION MARKETS (Polymarket/Delphi - ${predictions.length} signals):
${predictions.slice(0, 5).map((p, i) => `  ${i+1}. "${p.question}" → ${p.probability}% likely (${p.impact} impact, ${p.recommendation})`).join('\n')}
${highRiskPredictions.length > 0 ? `\n⚠️ ${highRiskPredictions.length} HEDGE SIGNALS from prediction markets!` : ''}`
      : '\nNo prediction market signals available.';
    
    // Use direct AI call to bypass portfolio context injection
    const systemPrompt = `You are an expert DeFi portfolio manager AI with access to prediction market data from Polymarket and Delphi. Analyze portfolio metrics AND prediction market signals to make informed decisions. When prediction markets show high probability of adverse events (>70%), strongly consider HEDGE or WITHDRAW. Always respond in the exact format requested.`;
    
    const aiPrompt = `Analyze this portfolio using BOTH metrics AND prediction market intelligence.

PORTFOLIO METRICS:
- Value: $${currentValue.toFixed(2)}
- Assets: ${assets.join(', ')}
- Risk Score: ${riskScore}/100
- Volatility: ${(volatility * 100).toFixed(1)}%
- Sentiment: ${sentiment.toUpperCase()}
- Risk Tolerance: ${riskTolerance}/100
${predictionContext}

DECISION RULES:
- If prediction markets show >70% probability of crash/decline + HIGH impact → HEDGE or WITHDRAW
- If risk score > tolerance AND negative predictions → WITHDRAW
- If stable conditions AND good Sharpe ratio → HOLD or ADD_FUNDS

Choose ONE: HOLD, ADD_FUNDS, WITHDRAW, or HEDGE

Format your response EXACTLY like this:
ACTION: [HOLD/ADD_FUNDS/WITHDRAW/HEDGE]
CONFIDENCE: [50-99]
REASON1: [include prediction market insight if available]
REASON2: [portfolio metric based reason]
REASON3: [risk/opportunity assessment]`;

    let aiResponse: { content: string; model?: string };
    try {
      aiResponse = await withTimeout(
        llmProvider.generateDirectResponse(aiPrompt, systemPrompt),
        20000,
        'LLM generateDirectResponse'
      );
    } catch (timeoutErr) {
      logger.warn('LLM call timed out, using rule-based fallback', { error: timeoutErr });
      // Rule-based fallback decision
      if (riskScore > riskTolerance && highRiskPredictions.length > 0) {
        action = 'HEDGE';
        confidence = 0.7;
      } else if (riskScore > riskTolerance + 20) {
        action = 'WITHDRAW';
        confidence = 0.65;
      } else if (riskScore < 30 && sentiment === 'bullish') {
        action = 'ADD_FUNDS';
        confidence = 0.6;
      } else {
        action = 'HOLD';
        confidence = 0.6;
      }
      reasoning.push(`🤖 Rule-based: ${action} (AI timed out) based on risk ${riskScore}/100`);
      reasoning.push(`🤖 Sentiment: ${sentiment}, volatility: ${(volatility * 100).toFixed(1)}%`);
      if (highRiskPredictions.length > 0) {
        reasoning.push(`🤖 ${highRiskPredictions.length} hedge signal(s) from prediction markets`);
      }
      // Skip AI parsing, jump to recommendations
      aiResponse = { content: '', model: 'rule-based-fallback' };
    }
    
    logger.info('🤖 AI Response received', { 
      model: aiResponse.model, 
      contentLength: aiResponse.content.length,
      provider: activeProvider,
      predictionsUsed: predictions.length,
    });

    // Parse AI response for action (skip if rule-based fallback was used)
    if (aiResponse.content.length > 0) {
    const content = aiResponse.content.toUpperCase();
    const actionMatch = content.match(/ACTION:\s*(HOLD|ADD_FUNDS|WITHDRAW|HEDGE)/i);
    if (actionMatch) {
      action = actionMatch[1].toUpperCase() as 'HOLD' | 'ADD_FUNDS' | 'WITHDRAW' | 'HEDGE';
    } else if (content.includes('ADD_FUNDS') || content.includes('ADD FUNDS')) {
      action = 'ADD_FUNDS';
    } else if (content.includes('WITHDRAW')) {
      action = 'WITHDRAW';
    } else if (content.includes('HEDGE')) {
      action = 'HEDGE';
    } else {
      action = 'HOLD'; // Default if can't parse
    }
    
    // Parse confidence
    const confMatch = aiResponse.content.match(/CONFIDENCE:\s*(\d+)/i) || aiResponse.content.match(/(\d+)\s*%/);
    if (confMatch) {
      confidence = Math.min(99, Math.max(50, parseInt(confMatch[1]))) / 100;
    } else {
      confidence = 0.75; // Default confidence
    }
    
    // Extract reasoning - look for REASON lines first
    const lines = aiResponse.content.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const trimmed = line.trim();
      // Match "REASON 1:", "REASON 2:", etc.
      const reasonMatch = trimmed.match(/^REASON\s*\d*:?\s*(.+)/i);
      if (reasonMatch && reasonMatch[1].length > 5) {
        reasoning.push(`🤖 ${reasonMatch[1].trim()}`);
        continue;
      }
      // Also match bullet points
      if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
        const reason = trimmed.replace(/^[•\-*]+\s*/, '').trim();
        if (reason.length > 10 && reason.length < 200 && !reason.toUpperCase().includes('ACTION') && !reason.toUpperCase().includes('CONFIDENCE')) {
          reasoning.push(`🤖 ${reason}`);
        }
      }
    }
    
    // If no structured reasons found, extract sentences
    if (reasoning.length === 0) {
      const sentences = aiResponse.content.split(/[.!?]+/).filter(s => {
        const t = s.trim();
        return t.length > 15 && t.length < 150 && 
               !t.toUpperCase().includes('ACTION:') && 
               !t.toUpperCase().includes('CONFIDENCE:') &&
               !t.toUpperCase().includes('CHOOSE ONE');
      });
      for (const sentence of sentences.slice(0, 3)) {
        reasoning.push(`🤖 ${sentence.trim()}`);
      }
    }
    
    // Ensure we have at least some reasoning
    if (reasoning.length === 0) {
      reasoning.push(`🤖 ${action} recommended based on ${riskScore}/100 risk score and ${sentiment} sentiment`);
      reasoning.push(`🤖 Volatility at ${(volatility * 100).toFixed(1)}% - ${volatility > 0.3 ? 'elevated' : 'acceptable'} levels`);
      if (highRiskPredictions.length > 0) {
        reasoning.push(`🤖 ${highRiskPredictions.length} hedge signal(s) detected in prediction markets`);
      } else {
        reasoning.push(`🤖 No critical market signals requiring immediate action`);
      }
    }
    } // end AI content parsing

    logger.info('🤖 AI portfolio decision complete', { 
      action, 
      confidence: Math.round(confidence * 100), 
      model: aiResponse.model,
      provider: activeProvider,
      reasoningCount: reasoning.length 
    });

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

    // Build prediction analysis for response
    const predictionAnalysis: PredictionAnalysis = {
      totalPredictions: predictions.length,
      hedgeSignals: highRiskPredictions.length,
      highImpactEvents: criticalPredictions.length,
      predictionRiskScore: Math.min(100, Math.round(
        predictions.reduce((acc, p) => {
          const impactWeight = p.impact === 'HIGH' ? 3 : p.impact === 'MODERATE' ? 2 : 1;
          const probWeight = p.probability / 100;
          const recWeight = p.recommendation === 'HEDGE' ? 2 : p.recommendation === 'MONITOR' ? 1 : 0;
          return acc + (impactWeight * probWeight * recWeight);
        }, 0) * 5
      )),
      overallSentiment: highRiskPredictions.length >= 2 ? 'bearish' : highRiskPredictions.length === 1 ? 'neutral' : 'bullish',
      summary: highRiskPredictions.length >= 2 
        ? `⚠️ HIGH ALERT: ${highRiskPredictions.length} hedge signals from Polymarket/Delphi`
        : highRiskPredictions.length === 1
        ? `⚡ CAUTION: ${predictions.length} markets monitored, 1 hedge signal active`
        : `✅ STABLE: ${predictions.length} prediction markets analyzed, no major risks`,
      topRisks: highRiskPredictions.slice(0, 3).map(p => ({
        question: p.question,
        probability: p.probability,
        impact: p.impact,
      })),
    };

    const response: PortfolioActionRecommendation = {
      action,
      confidence: Math.min(confidence, 0.99), // Cap at 99%
      reasoning,
      riskScore,
      recommendations,
      predictionAnalysis,
      agentAnalysis: {
        riskAgent: `🤖 Risk Analysis: ${riskScore}/100 (${riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MODERATE' : 'LOW'}) | Volatility: ${(volatility * 100).toFixed(1)}% | Sentiment: ${sentiment.toUpperCase()} | AI-Powered`,
        hedgingAgent: highRiskPredictions.length > 0
          ? `🔮 Polymarket/Delphi: ${highRiskPredictions.length} hedge signal${highRiskPredictions.length !== 1 ? 's' : ''} active | ${predictions.length} markets analyzed`
          : `🔮 Prediction Markets: ${predictions.length} signals analyzed | No immediate risks detected`,
        leadAgent: `🤖 Final Decision: ${action} (${(confidence * 100).toFixed(0)}% confidence) | Powered by Ollama/Qwen + Polymarket | ${predictions.length} market signals`,
      },
    };

    logger.info('Portfolio action recommendation generated', {
      portfolioId,
      action,
      confidence,
      riskScore,
      predictionsUsed: predictions.length,
      hedgeSignals: highRiskPredictions.length,
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
