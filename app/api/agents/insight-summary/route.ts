import { NextRequest, NextResponse } from 'next/server';
import type { PredictionMarket } from '@/lib/services/DelphiMarketService';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import type { RiskAnalysis } from '@shared/types/agent';

// ============================================================================
// Response Cache - prevents redundant AI processing for same predictions
// ============================================================================
interface CachedInsight {
  data: unknown;
  hash: string;
  timestamp: number;
}
let insightCache: CachedInsight = { data: null, hash: '', timestamp: 0 };
const INSIGHT_CACHE_TTL = 45000; // 45 second cache

function createPredictionHash(predictions: PredictionMarket[]): string {
  return predictions.slice(0, 5).map(p => `${p.id}:${p.probability}`).join('|');
}

function getCachedInsight(hash: string): unknown | null {
  if (!insightCache.data) return null;
  if (Date.now() - insightCache.timestamp > INSIGHT_CACHE_TTL) return null;
  if (insightCache.hash !== hash) return null;
  return insightCache.data;
}

function setCachedInsight(hash: string, data: unknown): void {
  Object.assign(insightCache, { data, hash, timestamp: Date.now() });
}

/**
 * Insight Summary API Route
 * Generates ONE unified AI summary across all prediction insights,
 * with per-token directional analysis (where BTC, ETH, CRO are headed).
 *
 * Uses REAL agents from the AgentOrchestrator:
 * 1. RiskAgent  → analyzeRisk() for market risk assessment
 * 2. HedgingAgent → analyze_hedge for each top token (leverage, direction)
 * 3. LeadAgent  → synthesizes all agent outputs + final approval
 */

interface InsightSummaryRequest {
  predictions: PredictionMarket[];
}

interface TokenDirection {
  symbol: string;
  direction: 'up' | 'down' | 'sideways';
  confidence: number; // 0-100
  shortTake: string;  // e.g. "Momentum strong, +9.6% 24h"
}

interface LeverageRecommendation {
  symbol: string;
  direction: 'long' | 'short' | 'neutral';
  leverage: string;         // e.g. "2x", "3x", "1.5x"
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
  rationale: string;        // e.g. "Strong momentum + 85% bullish probability supports leveraged long"
  confidence: number;       // 0-100
  allocation: number;       // % of portfolio, e.g. 50
}

interface UnifiedSummary {
  overview: string;         // Lead Agent approved market overview
  riskAgent: string;        // Risk Agent's actual analysis
  hedgingAgent: string;     // Hedging Agent's actual recommendation
  sentiment: 'bullish' | 'bearish' | 'neutral';
  tokenDirections: TokenDirection[];
  leverageRecommendations: LeverageRecommendation[];
  hedgeAlerts: number;
  leadAgentApproved: boolean;
  analyzedAt: number;
}

interface InsightSummaryResponse {
  summary: UnifiedSummary;
  model: string;
  agentsUsed: string[];
  agentsPipeline: {
    riskAgent: { ran: boolean; riskScore?: number; volatility?: number; sentiment?: string };
    hedgingAgent: { ran: boolean; tokensAnalyzed?: number; hedgesRecommended?: number };
    leadAgent: { ran: boolean; approved?: boolean; approvalRationale?: string };
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: InsightSummaryRequest = await request.json();
    const { predictions } = body;

    if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
      return NextResponse.json(
        { error: 'predictions array is required' },
        { status: 400 }
      );
    }

    // Check cache first
    const predictionHash = createPredictionHash(predictions);
    const cached = getCachedInsight(predictionHash);
    if (cached) {
      console.log('[InsightSummary] Returning cached response');
      return NextResponse.json(cached);
    }

    // ====================================================================
    // STEP 0: Extract REAL market data from prediction questions
    // ONLY from crypto-analysis source (Crypto.com API), NOT Polymarket
    // Polymarket questions contain random $ amounts that corrupt prices
    // ====================================================================
    interface TokenMarketData {
      price?: number;
      change24h?: number;
      volume?: string;
      stakingYield?: string;
    }

    const marketData: Record<string, TokenMarketData> = {};

    // First pass: extract from crypto-analysis predictions ONLY (real Crypto.com data)
    const cryptoPreds = predictions.filter(p => p.source === 'crypto-analysis');
    for (const p of cryptoPreds) {
      // Extract 24h change: "+8.84%" or "-3.5%"
      const changeMatch = p.question.match(/24h:\s*([+-]?\d+\.?\d*)%/);
      // Extract price patterns specific to Crypto.com predictions:
      // "Currently $70,479.72" or "ETH: $2,056.04" or "Price: $2,056.04" or "CRO: $0.0795"
      // Handles both comma-separated (107,479.72) and plain (107479.72) formats
      const priceMatch = p.question.match(/(?:Currently|Price:|[A-Z]{2,5}:)\s*\$([\d,]+(?:\.\d+)?)/);
      // Extract volume from the volume field: "$1.2B 24h vol"
      const volMatch = p.volume?.match(/\$([\d.]+[BMK])/);

      for (const asset of p.relatedAssets) {
        if (!marketData[asset]) marketData[asset] = {};

        // Only set data if this prediction is specific to this asset
        const isSpecific = p.relatedAssets.length <= 2 ||
          p.id?.toLowerCase().includes(asset.toLowerCase());

        if (changeMatch && isSpecific) {
          marketData[asset].change24h = parseFloat(changeMatch[1]);
        }
        if (priceMatch && isSpecific) {
          marketData[asset].price = parseFloat(priceMatch[1].replace(/,/g, ''));
        }
        if (volMatch && isSpecific) {
          marketData[asset].volume = `$${volMatch[1]}`;
        }
        // Extract staking info for ETH
        if (p.question.toLowerCase().includes('staking') && asset === 'ETH') {
          const yieldMatch = p.question.match(/(\d+)%\s*APY/);
          if (yieldMatch) marketData[asset].stakingYield = `${yieldMatch[1]}% APY`;
        }
      }
    }

    // Second pass: for any token still missing price, try the BTC $100K prediction format
    // "Will Bitcoin reach $100,000? (Currently $70,479.72, 41.9% away)"
    if (!marketData['BTC']?.price) {
      const btc100k = cryptoPreds.find(p => p.id === 'crypto-btc-100k');
      if (btc100k) {
        const currentlyMatch = btc100k.question.match(/Currently\s*\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/);
        if (currentlyMatch) {
          if (!marketData['BTC']) marketData['BTC'] = {};
          marketData['BTC'].price = parseFloat(currentlyMatch[1].replace(/,/g, ''));
        }
      }
    }

    console.log('[InsightSummary] Extracted real market data:', marketData);

    // Extract unique tokens from all predictions — analyze BTC, ETH, and CRO
    const INSIGHT_TOKENS = ['BTC', 'ETH', 'CRO'];
    const allTokens = [...new Set(predictions.flatMap(p => p.relatedAssets))]
      .filter(t => INSIGHT_TOKENS.includes(t));
    const hedgeAlerts = predictions.filter(p => p.recommendation === 'HEDGE').length;

    const agentsPipeline = {
      riskAgent: { ran: false } as { ran: boolean; riskScore?: number; volatility?: number; sentiment?: string },
      hedgingAgent: { ran: false } as { ran: boolean; tokensAnalyzed?: number; hedgesRecommended?: number },
      leadAgent: { ran: false } as { ran: boolean; approved?: boolean; approvalRationale?: string },
    };

    let summary: UnifiedSummary;
    let modelUsed = 'agent-orchestrator';

    try {
      // ====================================================================
      // STEP 1: Initialize Agent Orchestrator & get real agents
      // ====================================================================
      const orchestrator = getAgentOrchestrator();
      const [riskAgent, hedgingAgent, leadAgent] = await Promise.all([
        orchestrator.getRiskAgent(),
        orchestrator.getHedgingAgent(),
        orchestrator.getLeadAgent(),
      ]);

      console.log('[InsightSummary] Agents loaded:', {
        risk: !!riskAgent,
        hedging: !!hedgingAgent,
        lead: !!leadAgent,
      });

      // ====================================================================
      // STEP 2: RiskAgent — analyze market risk with prediction context
      // ====================================================================
      let riskAnalysis: RiskAnalysis | null = null;

      if (riskAgent) {
        try {
          console.log('[InsightSummary] Running RiskAgent.analyzeRisk()...');
          const riskResult = await riskAgent.executeTask({
            id: `insight-risk-${Date.now()}`,
            action: 'analyze_risk',
            parameters: {
              address: 'market-overview',
            },
            priority: 4,
            createdAt: new Date(),
          });

          if (riskResult.success && riskResult.data) {
            riskAnalysis = riskResult.data as RiskAnalysis;
            agentsPipeline.riskAgent = {
              ran: true,
              riskScore: riskAnalysis.totalRisk,
              volatility: riskAnalysis.volatility,
              sentiment: riskAnalysis.marketSentiment,
            };
            console.log('[InsightSummary] ✅ RiskAgent completed:', {
              riskScore: riskAnalysis.totalRisk,
              volatility: riskAnalysis.volatility,
              sentiment: riskAnalysis.marketSentiment,
            });
          }
        } catch (err) {
          console.warn('[InsightSummary] RiskAgent failed, continuing:', err);
        }
      }

      // ====================================================================
      // STEP 3: HedgingAgent — analyze hedge for top tokens
      // ====================================================================
      interface HedgeData {
        symbol: string;
        action: string;
        side: string;
        leverage: number;
        hedgeRatio: number;
        reason: string;
        var95: number;
        hedgeEffectiveness: number;
      }

      const hedgeResults: HedgeData[] = [];

      if (hedgingAgent) {
        // Only analyze tokens with directional prediction signals
        const tokensToHedge = allTokens
          .filter(t => t !== 'USDC' && t !== 'USDT')
          .slice(0, 4); // Top 4 tokens

        console.log('[InsightSummary] Running HedgingAgent for tokens:', tokensToHedge);

        for (const symbol of tokensToHedge) {
          try {
            // Use market-cap-proportional notional for realistic differentiation
            // BTC dominance ~50%, ETH ~18%, others smaller
            const notionalByAsset: Record<string, number> = {
              'BTC': 2_000_000,  // $2M — largest, most liquid
              'ETH': 1_000_000,  // $1M — second largest
              'CRO': 250_000,    // $250K — mid-cap
              'SOL': 500_000,    // $500K
            };
            const notionalValue = notionalByAsset[symbol] ?? 500_000;

            const hedgeResult = await hedgingAgent.executeTask({
              id: `insight-hedge-${symbol}-${Date.now()}`,
              action: 'analyze_hedge',
              parameters: {
                portfolioId: `insight-${symbol}`,
                assetSymbol: symbol,
                notionalValue,
              },
              priority: 3,
              createdAt: new Date(),
            });

            if (hedgeResult.success && hedgeResult.data) {
              const analysis = hedgeResult.data as {
                recommendation: { action: string; side: string; leverage: number; reason: string; size: string };
                exposure: { volatility: number };
                riskMetrics: { portfolioVar: number; hedgeEffectiveness: number };
              };
              hedgeResults.push({
                symbol,
                action: analysis.recommendation.action,
                side: analysis.recommendation.side,
                leverage: analysis.recommendation.leverage,
                hedgeRatio: parseFloat(analysis.recommendation.size) / notionalValue,
                reason: analysis.recommendation.reason,
                var95: analysis.riskMetrics.portfolioVar,
                hedgeEffectiveness: analysis.riskMetrics.hedgeEffectiveness,
              });
            }
          } catch (err) {
            console.warn(`[InsightSummary] HedgingAgent failed for ${symbol}:`, err);
          }
        }

        agentsPipeline.hedgingAgent = {
          ran: hedgeResults.length > 0,
          tokensAnalyzed: hedgeResults.length,
          hedgesRecommended: hedgeResults.filter(h => h.action === 'OPEN').length,
        };
        console.log('[InsightSummary] ✅ HedgingAgent completed:', agentsPipeline.hedgingAgent);
      }

      // ====================================================================
      // STEP 4: LeadAgent — synthesize all agent outputs + approve
      // ====================================================================
      let leadApproved = false;
      let leadOverview = '';
      let approvalRationale = '';

      if (leadAgent) {
        try {
          console.log('[InsightSummary] Running LeadAgent for synthesis + approval...');

          // Build the predictions context for the lead agent
          const predictionsContext = predictions.map(p =>
            `${p.question} — ${p.probability}% (${p.impact}, ${p.recommendation})`
          ).join('\n');

          // Build risk context from RiskAgent output
          const riskContext = riskAnalysis
            ? `Risk Score: ${riskAnalysis.totalRisk}/100, Volatility: ${(riskAnalysis.volatility * 100).toFixed(1)}%, Sentiment: ${riskAnalysis.marketSentiment}, Recommendations: ${riskAnalysis.recommendations.slice(0, 3).join('; ')}`
            : 'RiskAgent: unavailable';

          // Build hedge context from HedgingAgent output
          const hedgeContext = hedgeResults.length > 0
            ? hedgeResults.map(h =>
                `${h.symbol}: ${h.action} ${h.side} ${h.leverage}x (effectiveness: ${h.hedgeEffectiveness.toFixed(0)}%, reason: ${h.reason.substring(0, 80)})`
              ).join('\n')
            : 'HedgingAgent: no positions analyzed';

          // Use LeadAgent's executeStrategyFromIntent for full pipeline approval
          const report = await leadAgent.executeStrategyFromIntent({
            action: 'analyze',
            targetPortfolio: 0,
            objectives: {
              yieldTarget: undefined,
              riskLimit: riskAnalysis?.totalRisk,
            },
            constraints: {
              maxSlippage: 0.5,
              timeframe: 3600,
            },
            requiredAgents: ['risk', 'reporting'],
            estimatedComplexity: 'medium',
          });

          // Lead Agent ran + generated an AI summary
          leadApproved = report.status === 'success';

          // Now get LLM synthesis via Lead Agent context
          try {
            const { llmProvider } = await import('@/lib/ai/llm-provider');
            await llmProvider.waitForInit();

            // Compute tentative token directions BEFORE sending to LLM,
            // so the LLM overview text aligns with the badges shown in UI
            const tentativeDirections = allTokens.map(token => {
              const tokenSpecificPreds = predictions.filter(p => 
                p.relatedAssets.includes(token) && p.source === 'crypto-analysis' &&
                (p.relatedAssets.length <= 2 || p.id?.toLowerCase().includes(token.toLowerCase()))
              );
              const tAvg = tokenSpecificPreds.length > 0
                ? tokenSpecificPreds.reduce((s, p) => s + p.probability, 0) / tokenSpecificPreds.length
                : 50;
              const tBullish = tokenSpecificPreds.some(p => p.category === 'price' && p.probability > 55) || tAvg > 60;
              const tHedge = tokenSpecificPreds.filter(p => p.recommendation === 'HEDGE');
              const tBearish = tHedge.length > 0 && tAvg < 45;
              return { token, direction: tBullish ? 'bullish' : tBearish ? 'bearish' : 'neutral' };
            });
            const directionHint = tentativeDirections.map(d => `${d.token}: ${d.direction}`).join(', ');

            const synthesisResponse = await llmProvider.generateDirectResponse(
              `You are the Lead Agent approving a multi-agent market insights analysis. This is a general market analysis focused on BTC, ETH, and CRO — NOT portfolio-specific. Do NOT mention portfolio values, portfolio health, or portfolio allocations.

RISK AGENT OUTPUT:
${riskContext}

HEDGING AGENT OUTPUT:
${hedgeContext}

PREDICTION MARKET DATA:
${predictionsContext}

Tokens analyzed: ${allTokens.join(', ')}.
Token outlook from prediction analysis: ${directionHint}.

IMPORTANT: Your overview text MUST be consistent with these token outlooks. If a token is bullish, describe its outlook positively (price strength, uptrend, positive momentum). If bearish, describe downside risks. Do NOT contradict the above directional signals.

As the Lead Agent, provide your APPROVAL and synthesis in this JSON:
{
  "approved": true,
  "approvalRationale": "One sentence explaining why you approve/reject based on market insights",
  "overview": "2-3 sentence market overview for BTC, ETH, and CRO with specific prices and percentages. Consistent with token outlooks above. No portfolio references."
}

Return ONLY valid JSON.`,
              'You are the Lead Agent orchestrator for market insights. You approve or reject recommendations from RiskAgent and HedgingAgent. Focus on BTC, ETH, and CRO market outlook. Never mention portfolio values or portfolio health.'
            );

            try {
              let jsonStr = synthesisResponse.content.trim();
              const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
              if (jsonMatch) jsonStr = jsonMatch[0];
              const parsed = JSON.parse(jsonStr);
              leadApproved = parsed.approved !== false;
              leadOverview = parsed.overview || '';
              approvalRationale = parsed.approvalRationale || '';
              // LLM sentiment is intentionally ignored — we derive sentiment
              // from computed token directions for guaranteed consistency
              modelUsed = synthesisResponse.model || 'agent-orchestrator';
            } catch {
              console.warn('[InsightSummary] Could not parse LeadAgent synthesis JSON');
            }
          } catch {
            console.warn('[InsightSummary] LLM unavailable for LeadAgent synthesis');
          }

          agentsPipeline.leadAgent = {
            ran: true,
            approved: leadApproved,
            approvalRationale: approvalRationale || (report.aiSummary ?? undefined),
          };
          console.log('[InsightSummary] ✅ LeadAgent completed:', agentsPipeline.leadAgent);
        } catch (err) {
          console.warn('[InsightSummary] LeadAgent failed, continuing:', err);
        }
      }

      // ====================================================================
      // STEP 5: Assemble unified summary from real agent outputs
      // ====================================================================

      // Build risk agent text from actual RiskAgent output (insights-only, no portfolio refs)
      const riskAgentText = riskAnalysis
        ? `Market risk score ${riskAnalysis.totalRisk}/100 with ${(riskAnalysis.volatility * 100).toFixed(1)}% volatility. ${cleanAgentText(riskAnalysis.recommendations[0] || 'Monitor market conditions closely.')}`
        : 'RiskAgent analysis pending — using prediction-based risk estimate.';

      // Build hedging agent text from actual HedgingAgent output
      const openHedges = hedgeResults.filter(h => h.action === 'OPEN');
      const hedgingAgentText = hedgeResults.length > 0
        ? `${openHedges.length} hedge position(s) recommended: ${openHedges.map(h => `${h.symbol} ${h.side} ${h.leverage}x`).join(', ') || 'HOLD on all positions'}. Avg hedge effectiveness: ${(hedgeResults.reduce((s, h) => s + h.hedgeEffectiveness, 0) / hedgeResults.length).toFixed(0)}%.`
        : 'HedgingAgent: no immediate hedge triggers — maintaining monitor mode.';

      // Build token directions from prediction data + hedge agent context
      // Direction is derived from PREDICTION signals, not just hedge action.
      // HedgingAgent HOLD = "no hedge needed" — could still be bullish.
      const tokenDirections: TokenDirection[] = allTokens.map(token => {
        const hedge = hedgeResults.find(h => h.symbol === token);
        const tokenPreds = predictions.filter(p => p.relatedAssets.includes(token));

        // Prefer token-SPECIFIC predictions (where this token is the primary/sole asset)
        // over shared predictions that mention many tokens
        const specificPreds = tokenPreds.filter(p =>
          p.relatedAssets.length <= 2 ||
          p.id?.toLowerCase().includes(token.toLowerCase()) ||
          p.question.toLowerCase().includes(token.toLowerCase()) ||
          p.question.toLowerCase().includes(token === 'BTC' ? 'bitcoin' : token === 'ETH' ? 'ethereum' : token === 'CRO' ? 'cronos' : token.toLowerCase())
        );
        const bestPreds = specificPreds.length > 0 ? specificPreds : tokenPreds;

        const avgProb = bestPreds.length > 0
          ? bestPreds.reduce((s, p) => s + p.probability, 0) / bestPreds.length
          : 50;

        // Determine direction from prediction probabilities
        const bullishPreds = bestPreds.filter(p => p.category === 'price' && p.probability > 55);
        const hedgePreds = bestPreds.filter(p => p.recommendation === 'HEDGE');
        const hasBullishSignal = bullishPreds.length > 0 || avgProb > 60;
        const hasBearishSignal = hedgePreds.length > 0 && avgProb < 45;

        let direction: 'up' | 'down' | 'sideways';
        let confidence: number;
        let shortTake: string;

        // Get prediction-level confidence (from the prediction data, not hardcoded)
        const avgPredConfidence = bestPreds.length > 0
          ? bestPreds.reduce((s, p) => s + (p.confidence ?? 50), 0) / bestPreds.length
          : 50;
        // Risk agent contribution: lower risk → higher confidence in the direction
        const riskContrib = riskAnalysis ? (100 - Math.min(riskAnalysis.totalRisk, 100)) : 50;

        if (hedge) {
          if (hedge.action === 'OPEN' && hedge.side === 'SHORT') {
            direction = hasBearishSignal ? 'down' : 'up';
          } else if (hedge.action === 'OPEN' && hedge.side === 'LONG') {
            direction = 'down';
          } else {
            direction = hasBullishSignal ? 'up' : hasBearishSignal ? 'down' : 'sideways';
          }
          // Weighted composite: prediction probability (40%) + prediction confidence (35%) + risk score (25%)
          // Note: hedge effectiveness measures protection quality, NOT directional confidence
          confidence = Math.round(
            avgProb * 0.40 +
            avgPredConfidence * 0.35 +
            riskContrib * 0.25
          );
        } else {
          direction = hasBullishSignal ? 'up' : hasBearishSignal ? 'down' : 'sideways';
          // Without hedge data: prediction probability (40%) + prediction confidence (35%) + risk score (25%)
          confidence = Math.round(
            avgProb * 0.40 +
            avgPredConfidence * 0.35 +
            riskContrib * 0.25
          );
        }

        // Build shortTake using REAL market data extracted from predictions
        const md = marketData[token];
        const parts: string[] = [];
        if (md?.price) parts.push(`$${md.price.toLocaleString('en-US', { maximumFractionDigits: md.price < 1 ? 4 : 2 })}`);
        if (md?.change24h !== undefined) parts.push(`${md.change24h > 0 ? '+' : ''}${md.change24h.toFixed(2)}% 24h`);
        if (md?.volume) parts.push(`${md.volume} vol`);
        if (md?.stakingYield) parts.push(md.stakingYield);

        if (parts.length > 0) {
          shortTake = parts.join(' · ');
        } else {
          const topPred = bestPreds.sort((a, b) => b.probability - a.probability)[0];
          shortTake = topPred
            ? `${topPred.probability}% prob — ${direction === 'up' ? 'bullish' : direction === 'down' ? 'bearish' : 'mixed'} signals`
            : `${confidence}% confidence — ${direction === 'up' ? 'bullish' : direction === 'down' ? 'bearish' : 'monitoring'}`;
        }

        return { symbol: token, direction, confidence, shortTake };
      });

      // Derive overall sentiment from computed token directions (majority vote)
      // This ensures the banner is always consistent with individual token cards
      const upTokens = tokenDirections.filter(t => t.direction === 'up').length;
      const downTokens = tokenDirections.filter(t => t.direction === 'down').length;
      let overallSentiment: 'bullish' | 'bearish' | 'neutral';
      if (upTokens > downTokens) {
        overallSentiment = 'bullish';
      } else if (downTokens > upTokens) {
        overallSentiment = 'bearish';
      } else {
        overallSentiment = 'neutral';
      }

      // Build leverage recommendations from HedgingAgent data + prediction signals
      // Direction is based on WHERE the token is going (predictions), not just hedge action.
      // If HedgingAgent says HOLD and predictions are bullish → LONG (no hedge needed = confident in upside)
      const leverageRecommendations: LeverageRecommendation[] = hedgeResults
        .sort((a, b) => b.hedgeEffectiveness - a.hedgeEffectiveness)
        .slice(0, 4)
        .map((hedge, _i, arr) => {
          // Cross-reference with prediction data for this token
          const tokenPreds = predictions.filter(p => p.relatedAssets.includes(hedge.symbol));

          // Prefer token-SPECIFIC predictions over broad/shared ones
          const specificPreds = tokenPreds.filter(p =>
            p.relatedAssets.length <= 2 ||
            p.id?.toLowerCase().includes(hedge.symbol.toLowerCase()) ||
            p.question.toLowerCase().includes(hedge.symbol.toLowerCase()) ||
            p.question.toLowerCase().includes(hedge.symbol === 'BTC' ? 'bitcoin' : hedge.symbol === 'ETH' ? 'ethereum' : hedge.symbol === 'CRO' ? 'cronos' : hedge.symbol.toLowerCase())
          );
          const bestPreds = specificPreds.length > 0 ? specificPreds : tokenPreds;

          const avgProb = bestPreds.length > 0
            ? bestPreds.reduce((s, p) => s + p.probability, 0) / bestPreds.length
            : 50;
          const bullishPreds = bestPreds.filter(p => p.category === 'price' && p.probability > 55);
          const hedgePreds = bestPreds.filter(p => p.recommendation === 'HEDGE');
          const isBullish = bullishPreds.length > 0 || avgProb > 60;
          const isBearish = hedgePreds.length > 0 && avgProb < 45;

          // Direction: use prediction signals, not just hedge action
          let direction: 'long' | 'short' | 'neutral';
          if (hedge.action === 'OPEN') {
            // Agent is opening a hedge position
            direction = hedge.side === 'SHORT' ? 'long' : 'short';
          } else {
            // HOLD = no hedge needed → use prediction direction
            direction = isBullish ? 'long' : isBearish ? 'short' : 'neutral';
          }

          // Adjust leverage based on confidence + hedge effectiveness + direction strength + risk score
          // Lower risk score → more room for leverage. Higher hedge effectiveness → better risk coverage.
          // Risk score is factored in: riskScore ≤ 30 boosts leverage tiers by ~1 step.
          let leverage: number;
          let riskLevel: 'conservative' | 'moderate' | 'aggressive';
          const hedgeEff = hedge.hedgeEffectiveness;
          const riskScore = riskAnalysis?.totalRisk ?? 50;
          const lowRisk = riskScore <= 30;       // favorable conditions — allow higher leverage
          const medRisk = riskScore <= 50;       // normal conditions

          if (direction === 'neutral') {
            leverage = lowRisk ? 1.5 : 1;
            riskLevel = 'conservative';
          } else if (avgProb >= 75 && isBullish && !isBearish && hedgeEff >= 85) {
            // Very strong signal + good hedge coverage
            leverage = Math.min(hedge.leverage || 5, lowRisk ? 5 : 4);
            riskLevel = 'aggressive';
          } else if ((avgProb >= 60 || (avgProb >= 50 && lowRisk)) && isBullish && hedgeEff >= 75) {
            // Strong signal, or moderate signal with low risk + decent hedge
            leverage = lowRisk ? 4 : medRisk ? 3 : 2.5;
            riskLevel = lowRisk ? 'moderate' : 'moderate';
          } else if ((avgProb >= 45 || lowRisk) && hedgeEff >= 70) {
            // Moderate signal with hedge coverage — risk score differentiates
            leverage = lowRisk ? 3 : medRisk ? 2.5 : 2;
            riskLevel = lowRisk ? 'moderate' : 'conservative';
          } else if (avgProb >= 40 && hedgeEff >= 50) {
            // Lower conviction — scale with risk tolerance
            leverage = lowRisk ? 2.5 : medRisk ? 2 : 1.5;
            riskLevel = 'conservative';
          } else {
            // Weak signal — minimal leverage
            leverage = lowRisk ? 2 : 1.5;
            riskLevel = 'conservative';
          }

          const leverageStr = `${leverage}x`;

          // Distribute allocation evenly across recommended tokens
          const allocation = Math.round(80 / arr.length);

          // Build rationale from REAL data: agent metrics + market data + prediction context
          const md = marketData[hedge.symbol];
          const topPred = bestPreds.sort((a, b) => b.probability - a.probability)[0];
          const cleanReason = cleanAgentText(hedge.reason);

          // Build a data-rich rationale using actual numbers
          const rationaleParts: string[] = [];
          if (md?.change24h !== undefined) {
            rationaleParts.push(`24h: ${md.change24h > 0 ? '+' : ''}${md.change24h.toFixed(2)}%`);
          }
          if (md?.price) {
            rationaleParts.push(`Price: $${md.price.toLocaleString('en-US', { maximumFractionDigits: md.price < 1 ? 4 : 2 })}`);
          }
          if (hedge.hedgeEffectiveness > 0) {
            rationaleParts.push(`Hedge eff: ${hedge.hedgeEffectiveness.toFixed(0)}%`);
          }
          if (hedge.var95 > 0) {
            rationaleParts.push(`VaR95: $${(hedge.var95 / 1000).toFixed(0)}K`);
          }
          if (topPred) {
            rationaleParts.push(`${topPred.probability}% ${topPred.category} signal`);
          }

          let rationale: string;
          if (rationaleParts.length >= 2) {
            rationale = `${rationaleParts.join(' · ')} → ${direction.toUpperCase()} ${leverageStr}`;
          } else if (topPred) {
            rationale = `${topPred.probability}% market probability supports ${direction.toUpperCase()} at ${leverageStr}`;
          } else if (cleanReason.length > 20) {
            rationale = cleanReason.substring(0, 100);
          } else {
            rationale = `${avgProb.toFixed(0)}% avg confidence supports ${direction} position at ${leverageStr}`;
          }

          // Weighted composite confidence from multiple agent signals
          const avgPredConf = bestPreds.length > 0
            ? bestPreds.reduce((s, p) => s + (p.confidence ?? 50), 0) / bestPreds.length
            : 50;
          const riskContrib = riskAnalysis ? (100 - Math.min(riskAnalysis.totalRisk, 100)) : 50;
          const leverageConfidence = Math.round(
            avgProb * 0.30 +
            avgPredConf * 0.25 +
            hedge.hedgeEffectiveness * 0.25 +
            riskContrib * 0.20
          );

          return {
            symbol: hedge.symbol,
            direction,
            leverage: leverageStr,
            riskLevel,
            rationale,
            confidence: leverageConfidence,
            allocation,
          };
        });

      // Add fallback entries for tokens not covered by HedgingAgent
      for (const token of allTokens) {
        if (!leverageRecommendations.find(lr => lr.symbol === token)) {
          const td = tokenDirections.find(t => t.symbol === token);
          if (td && td.direction !== 'sideways') {
            leverageRecommendations.push({
              symbol: token,
              direction: td.direction === 'up' ? 'long' : 'short',
              leverage: '1.5x',
              riskLevel: 'conservative',
              rationale: `${td.shortTake} — conservative leverage pending full agent analysis`,
              confidence: td.confidence,
              allocation: 10,
            });
          }
        }
      }

      // Build overview from Lead Agent or synthesize
      const overviewText = leadOverview
        || `Multi-agent analysis across ${allTokens.join(', ')}: Risk score ${riskAnalysis?.totalRisk ?? 'N/A'}/100, ${openHedges.length} hedge(s) recommended. ${leadApproved ? '✅ Lead Agent APPROVED' : '⚠️ Awaiting Lead Agent approval'}.`;

      summary = {
        overview: overviewText,
        riskAgent: riskAgentText,
        hedgingAgent: hedgingAgentText,
        sentiment: overallSentiment,
        tokenDirections,
        leverageRecommendations,
        hedgeAlerts,
        leadAgentApproved: leadApproved,
        analyzedAt: Date.now(),
      };
    } catch (orchestratorError) {
      // ====================================================================
      // FALLBACK: If agent orchestrator fails, use prediction-based logic
      // ====================================================================
      console.warn('[InsightSummary] Agent pipeline failed, using fallback:', orchestratorError);
      const fallback = generateFallbackSummary(predictions, allTokens, hedgeAlerts);
      summary = { ...fallback, leadAgentApproved: false };
      modelUsed = 'agent-fallback';
    }

    const response: InsightSummaryResponse = {
      summary,
      model: modelUsed,
      agentsUsed: [
        agentsPipeline.riskAgent.ran ? 'RiskAgent (live)' : 'RiskAgent (fallback)',
        agentsPipeline.hedgingAgent.ran ? 'HedgingAgent (live)' : 'HedgingAgent (fallback)',
        agentsPipeline.leadAgent.ran ? 'LeadAgent (live)' : 'LeadAgent (fallback)',
      ],
      agentsPipeline,
    };

    // Cache the response for future requests
    setCachedInsight(predictionHash, response);
    console.log('[InsightSummary] Cached response');

    return NextResponse.json(response);
  } catch (error) {
    console.error('Insight summary error:', error);
    return NextResponse.json(
      { error: 'Failed to generate insight summary', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

/**
 * Strip markdown, emoji prefixes, and raw agent formatting from text
 */
function cleanAgentText(text: string): string {
  return text
    .replace(/🤖|📊|🔮|⚠️|✅|❌|🛡️|💸|🚀|⚡|💰|📈|📉|🔒|🔑|💎|🏦/g, '')  // Remove emoji
    .replace(/\*\*[^*]+\*\*/g, match => match.replace(/\*\*/g, ''))  // Strip bold markdown
    .replace(/#+\s*/g, '')  // Strip headings
    .replace(/•\s*[^•\n]*/g, '')  // Strip bullet point items
    .replace(/\d+(\.\d+)?%\s*\)/g, '')  // Strip "97.4%)" patterns
    .replace(/\([^)]*%[^)]*\)/g, '')  // Strip "(97.4%)" parenthetical percentages
    .replace(/[A-Z]{2,5}:\s*\$[\d.,]+/g, '')  // Strip "CRO: $0.79" asset values
    .replace(/Portfolio\s*Analysis[^.]*\.?/gi, '')  // Strip portfolio analysis text
    .replace(/Portfolio\s*Value[^.]*\.?/gi, '')  // Strip portfolio value references
    .replace(/Health\s*Score[^.]*\.?/gi, '')  // Strip health score references
    .replace(/Risk\s*Score[^.]*\.?/gi, '')  // Strip risk score refs
    .replace(/across\s+\d+\s+assets?/gi, '')  // Strip "across N assets"
    .replace(/portfolio[^.]*\.?/gi, '')  // Strip any portfolio mentions
    .replace(/Risks:\s*/gi, '')  // Strip "Risks:" header
    .replace(/Low\s+diversificati\w*/gi, '')  // Strip truncated diversification text
    .replace(/---+/g, '')  // Strip horizontal rules
    .replace(/\|/g, '')  // Strip table pipes
    .replace(/\n+/g, ' ')  // Collapse newlines
    .replace(/\s{2,}/g, ' ')  // Collapse whitespace
    .trim();
}

/**
 * Generate a token direction from prediction data when LLM is unavailable
 */
function generateTokenFallback(token: string, predictions: PredictionMarket[]): TokenDirection {
  const tokenPreds = predictions.filter(p => p.relatedAssets.includes(token));
  if (tokenPreds.length === 0) {
    return { symbol: token, direction: 'sideways', confidence: 40, shortTake: 'Insufficient data to assess' };
  }

  // Prefer token-specific predictions
  const specificPreds = tokenPreds.filter(p =>
    p.relatedAssets.length <= 2 ||
    p.id?.toLowerCase().includes(token.toLowerCase()) ||
    p.question.toLowerCase().includes(token.toLowerCase()) ||
    p.question.toLowerCase().includes(token === 'BTC' ? 'bitcoin' : token === 'ETH' ? 'ethereum' : token.toLowerCase())
  );
  const bestPreds = specificPreds.length > 0 ? specificPreds : tokenPreds;

  const avgProb = bestPreds.reduce((s, p) => s + p.probability, 0) / bestPreds.length;
  const hasBullish = bestPreds.some(p => p.category === 'price' && p.probability > 55);
  const hasHedge = bestPreds.some(p => p.recommendation === 'HEDGE');
  // Match main path logic: bearish requires BOTH hedge signals AND low probability
  const hasBearish = hasHedge && avgProb < 45;

  const direction: 'up' | 'down' | 'sideways' = hasBullish ? 'up' : hasBearish ? 'down' : 'sideways';
  const confidence = Math.round(avgProb);

  const topPred = bestPreds.sort((a, b) => b.probability - a.probability)[0];
  const shortTake = topPred
    ? `${topPred.probability}% — ${topPred.question.substring(0, 40)}${topPred.question.length > 40 ? '...' : ''}`
    : direction === 'up'
    ? `Bullish signals at ${confidence}% avg probability`
    : direction === 'down'
    ? `Risk elevated — hedge alerts active`
    : `Mixed signals, monitoring recommended`;

  return { symbol: token, direction, confidence, shortTake };
}

/**
 * Generate full fallback summary using agent logic when LLM is unavailable
 */
function generateFallbackSummary(
  predictions: PredictionMarket[],
  tokens: string[],
  hedgeAlerts: number
): UnifiedSummary {
  const highImpact = predictions.filter(p => p.impact === 'HIGH');
  const avgProb = predictions.reduce((s, p) => s + p.probability, 0) / predictions.length;
  const hedgePreds = predictions.filter(p => p.recommendation === 'HEDGE');

  // Determine overall sentiment
  const bullishCount = predictions.filter(p => p.category === 'price' && p.probability > 55).length;
  const bearishCount = hedgePreds.length;
  const sentiment: 'bullish' | 'bearish' | 'neutral' =
    bullishCount > bearishCount ? 'bullish' : bearishCount > bullishCount ? 'bearish' : 'neutral';

  const overview = `${highImpact.length} high-impact events detected across ${tokens.join(', ')} with ${Math.round(avgProb)}% average probability. ${
    hedgeAlerts > 0
      ? `${hedgeAlerts} prediction(s) flagged for hedging — elevated risk environment.`
      : 'No immediate hedge signals — market conditions stable for monitored positions.'
  } Overall agent consensus is ${sentiment}.`;

  const riskAgent = hedgeAlerts > 0
    ? `Market risk elevated with ${hedgeAlerts} active hedge alert(s). ${highImpact.length} high-impact predictions increase volatility exposure across ${tokens.slice(0, 3).join('/')}.`
    : `Market risk is moderate. ${highImpact.length} high-impact predictions warrant attention but no immediate protective action required.`;

  const hedgingAgent = hedgePreds.length > 0
    ? `Consider protective positions on ${[...new Set(hedgePreds.flatMap(p => p.relatedAssets))].join(', ')}. Recommended hedge ratio: ${avgProb > 60 ? '30-50%' : '15-25%'} via perpetual futures.`
    : `No hedge triggers activated. Continue monitoring ${tokens.slice(0, 3).join(', ')} for entry signals — set alerts at ±5% deviation.`;

  const tokenDirections: TokenDirection[] = tokens.map(token =>
    generateTokenFallback(token, predictions)
  );

  // Generate leverage recommendations from agent logic
  const leverageRecommendations: LeverageRecommendation[] = tokenDirections
    .filter(td => td.direction !== 'sideways')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((td, i, arr) => {
      const isUp = td.direction === 'up';
      const direction: 'long' | 'short' | 'neutral' = isUp ? 'long' : 'short';
      const tokenPreds = predictions.filter(p => p.relatedAssets.includes(td.symbol));
      const topPred = tokenPreds.sort((a, b) => b.probability - a.probability)[0];

      let leverage: string;
      let riskLevel: 'conservative' | 'moderate' | 'aggressive';
      if (td.confidence >= 80 && isUp) {
        leverage = '3x';
        riskLevel = 'aggressive';
      } else if (td.confidence >= 65) {
        leverage = '2x';
        riskLevel = 'moderate';
      } else {
        leverage = '1.5x';
        riskLevel = 'conservative';
      }

      // Allocation: split evenly among top tokens
      const allocation = Math.round(80 / arr.length);

      const rationale = topPred
        ? `${topPred.probability}% probability ${topPred.question.substring(0, 60)}... supports ${direction} at ${leverage}`
        : `${td.confidence}% confidence in ${td.direction} trend supports ${direction} position`;

      return {
        symbol: td.symbol,
        direction,
        leverage,
        riskLevel,
        rationale,
        confidence: td.confidence,
        allocation,
      };
    });

  return {
    overview,
    riskAgent,
    hedgingAgent,
    sentiment,
    tokenDirections,
    leverageRecommendations,
    hedgeAlerts,
    leadAgentApproved: false,
    analyzedAt: Date.now(),
  };
}

export async function GET() {
  return NextResponse.json({
    status: 'Insight Summary Agent API operational',
    agents: ['Lead Agent', 'Risk Agent', 'Hedging Agent'],
    capabilities: ['unified-summary', 'token-direction', 'risk-assessment', 'hedge-recommendation'],
  });
}
