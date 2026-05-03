/**
 * End-to-End Test: AI Market Intelligence Pipeline
 * 
 * Tests the complete flow:
 * 1. Data Sources → AIMarketIntelligence
 * 2. AIMarketIntelligence → AI Agents
 * 3. AI Agents → Decision Making
 */

import { AIMarketIntelligence } from './lib/services/AIMarketIntelligence';
import { DelphiMarketService } from './lib/services/market-data/DelphiMarketService';
import { Polymarket5MinService } from './lib/services/market-data/Polymarket5MinService';
import { SuiPoolAgent } from './agents/specialized/SuiPoolAgent';
import { RiskAgent } from './agents/specialized/RiskAgent';
import { HedgingAgent } from './agents/specialized/HedgingAgent';
import { LeadAgent } from './agents/core/LeadAgent';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(msg);
}

function logSection(title: string) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function recordResult(name: string, passed: boolean, duration: number, details?: string, error?: string) {
  const status = passed ? 'PASS' : 'FAIL';
  results.push({ name, status, duration, details, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name} (${duration}ms)`);
  if (details) console.log(`   └─ ${details}`);
  if (error) console.log(`   └─ ERROR: ${error}`);
}

async function runTest<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const start = Date.now();
  try {
    const result = await fn();
    recordResult(name, true, Date.now() - start);
    return result;
  } catch (err: any) {
    recordResult(name, false, Date.now() - start, undefined, err.message);
    return null;
  }
}

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     END-TO-END AI MARKET INTELLIGENCE PIPELINE TEST          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const totalStart = Date.now();

  // ═══════════════════════════════════════════════════════════════
  // STAGE 1: Data Sources
  // ═══════════════════════════════════════════════════════════════
  logSection('STAGE 1: DATA SOURCES');

  // Test 1.1: Polymarket 5-min BTC Signal
  const fiveMinSignal = await runTest('Polymarket 5-min BTC Signal', async () => {
    const signal = await Polymarket5MinService.getLatest5MinSignal();
    if (!signal) throw new Error('No signal returned');
    console.log(`   Direction: ${signal.direction} | Probability: ${signal.probability}% | Confidence: ${signal.confidence}%`);
    return signal;
  });

  // Test 1.2: DelphiMarketService - Prediction Markets
  const predictions = await runTest('DelphiMarketService Predictions', async () => {
    const markets = await DelphiMarketService.getRelevantMarkets(['BTC', 'ETH', 'SUI', 'CRO']);
    if (!markets || markets.length === 0) throw new Error('No predictions returned');
    console.log(`   Retrieved ${markets.length} prediction markets`);
    return markets;
  });

  // Test 1.3: Real-time price data
  await runTest('Crypto.com Price Data', async () => {
    const response = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Price API unavailable');
    const data = await response.json();
    const btc = data.result?.data?.find((t: any) => t.i === 'BTC_USDT');
    console.log(`   BTC Price: $${parseFloat(btc?.a || '0').toLocaleString()}`);
    return data;
  });

  // ═══════════════════════════════════════════════════════════════
  // STAGE 2: AI Market Intelligence
  // ═══════════════════════════════════════════════════════════════
  logSection('STAGE 2: AI MARKET INTELLIGENCE');

  // Test 2.1: Full AI Context Generation
  const aiContext = await runTest('AIMarketIntelligence.getMarketContext()', async () => {
    const ctx = await AIMarketIntelligence.getMarketContext();
    if (!ctx) throw new Error('No context returned');
    console.log(`   Sentiment: ${ctx.marketSentiment.label} (${ctx.marketSentiment.score})`);
    console.log(`   Primary Signal: ${ctx.summary.primarySignal} | Urgency: ${ctx.summary.urgency}`);
    console.log(`   Risk Cascade: ${ctx.riskCascade.detected ? `YES (${ctx.riskCascade.severity}/100)` : 'No'}`);
    return ctx;
  });

  // Test 2.2: Streak Analysis
  await runTest('Streak Analysis Valid', async () => {
    if (!aiContext) throw new Error('No AI context');
    const { streaks } = aiContext;
    if (!['UP', 'DOWN', 'MIXED'].includes(streaks.streak5Min.direction)) {
      throw new Error('Invalid streak direction');
    }
    console.log(`   5-min: ${streaks.streak5Min.direction} (${streaks.streak5Min.count})`);
    console.log(`   Reversal Probability: ${streaks.reversalProbability}%`);
    return streaks;
  });

  // Test 2.3: Correlation Analysis
  await runTest('Correlation Analysis Valid', async () => {
    if (!aiContext) throw new Error('No AI context');
    const { correlation } = aiContext;
    if (correlation.btcEthCorrelation < 0 || correlation.btcEthCorrelation > 1) {
      throw new Error('Invalid correlation value');
    }
    console.log(`   BTC/ETH Correlation: ${(correlation.btcEthCorrelation * 100).toFixed(1)}%`);
    console.log(`   Market Alignment: ${correlation.marketAlignment}%`);
    return correlation;
  });

  // Test 2.4: Actionable Summary
  await runTest('Actionable Summary Valid', async () => {
    if (!aiContext) throw new Error('No AI context');
    const { summary } = aiContext;
    if (!summary.suggestedAction) throw new Error('No suggested action');
    console.log(`   Action: ${summary.suggestedAction}`);
    console.log(`   Key Factors: ${summary.keyFactors.slice(0, 2).join(', ')}`);
    return summary;
  });

  // ═══════════════════════════════════════════════════════════════
  // STAGE 3: AI AGENTS
  // ═══════════════════════════════════════════════════════════════
  logSection('STAGE 3: AI AGENTS');

  // Test 3.1: SuiPoolAgent - Enhanced Allocation
  await runTest('SuiPoolAgent.getEnhancedAllocationContext()', async () => {
    const agent = new SuiPoolAgent('testnet');
    await agent.initialize();
    const context = await agent.getEnhancedAllocationContext();
    
    if (!context.allocations) throw new Error('No allocations returned');
    const total = Object.values(context.allocations).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 1) throw new Error(`Allocations don't sum to 100: ${total}`);
    
    console.log(`   Allocations: BTC=${context.allocations.BTC}%, ETH=${context.allocations.ETH}%, SUI=${context.allocations.SUI}%, CRO=${context.allocations.CRO}%`);
    console.log(`   Sentiment: ${context.marketSentiment} | Urgency: ${context.urgency}`);
    console.log(`   Recommendations: ${context.recommendations.length} | Alerts: ${context.riskAlerts.length}`);
    return context;
  });

  // Test 3.2: RiskAgent - Enhanced Risk Context
  await runTest('RiskAgent.getEnhancedRiskContext()', async () => {
    const agent = new RiskAgent('risk-agent-test');
    await agent.initialize();
    const result = await agent.getEnhancedRiskContext();
    
    if (!result.riskAssessment.overallRisk) throw new Error('No risk level returned');
    if (!['LOW', 'MODERATE', 'HIGH'].includes(result.riskAssessment.overallRisk)) {
      throw new Error(`Invalid risk level: ${result.riskAssessment.overallRisk}`);
    }
    
    console.log(`   Risk Level: ${result.riskAssessment.overallRisk}`);
    console.log(`   Market Condition: ${result.riskAssessment.marketCondition}`);
    console.log(`   Alerts: ${result.riskAssessment.alerts.length} | Recommendations: ${result.riskAssessment.recommendations.length}`);
    return result;
  });

  // Test 3.3: HedgingAgent - Enhanced Market Context
  await runTest('HedgingAgent.getEnhancedMarketContext()', async () => {
    const agent = new HedgingAgent('hedging-agent-test');
    await agent.initialize();
    const result = await agent.getEnhancedMarketContext();
    
    if (!result.hedgingRecommendation.urgency) throw new Error('No hedge urgency returned');
    if (!['IMMEDIATE', 'SOON', 'MONITOR', 'NO_ACTION'].includes(result.hedgingRecommendation.urgency)) {
      throw new Error(`Invalid hedge urgency: ${result.hedgingRecommendation.urgency}`);
    }
    
    console.log(`   Hedge Urgency: ${result.hedgingRecommendation.urgency}`);
    console.log(`   Direction: ${result.hedgingRecommendation.direction} | Confidence: ${result.hedgingRecommendation.confidenceScore}%`);
    console.log(`   Reasons: ${result.hedgingRecommendation.reasons.slice(0, 2).join('; ')}`);
    return result;
  });

  // Test 3.4: LeadAgent - Orchestration Context
  await runTest('LeadAgent.getOrchestrationContext()', async () => {
    const agent = new LeadAgent('lead-agent-test');
    await agent.initialize();
    const context = await agent.getOrchestrationContext();
    
    if (!context.marketCondition) throw new Error('No market condition returned');
    if (!['STABLE', 'VOLATILE', 'TRENDING', 'CRISIS'].includes(context.marketCondition)) {
      throw new Error(`Invalid market condition: ${context.marketCondition}`);
    }
    
    console.log(`   Market Condition: ${context.marketCondition}`);
    console.log(`   Urgency Level: ${context.urgencyLevel}`);
    console.log(`   Agent Priorities: ${context.agentPriorities.map(p => `${p.agent}(${p.priority})`).join(', ')}`);
    console.log(`   Recommendations: ${context.orchestrationRecommendations.length}`);
    return context;
  });

  // ═══════════════════════════════════════════════════════════════
  // STAGE 4: DECISION MAKING
  // ═══════════════════════════════════════════════════════════════
  logSection('STAGE 4: DECISION MAKING SIMULATION');

  // Test 4.1: Full decision pipeline
  await runTest('Full Decision Pipeline', async () => {
    // Simulate what would happen in production
    const aiCtx = await AIMarketIntelligence.getMarketContext();
    
    // Determine action based on AI context
    let action = 'HOLD';
    let reason = '';
    
    if (aiCtx.riskCascade.severity > 70) {
      action = 'EMERGENCY_HEDGE';
      reason = `Risk cascade detected at ${aiCtx.riskCascade.severity}/100`;
    } else if (aiCtx.summary.primarySignal === 'BEARISH' && aiCtx.summary.urgency === 'HIGH') {
      action = 'HEDGE_SHORT';
      reason = 'Bearish signal with high urgency';
    } else if (aiCtx.summary.primarySignal === 'BULLISH' && aiCtx.summary.confidence > 70) {
      action = 'INCREASE_EXPOSURE';
      reason = 'Bullish signal with high confidence';
    } else {
      reason = 'No strong signal - maintaining positions';
    }
    
    console.log(`   Decision: ${action}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   Based on: ${aiCtx.summary.keyFactors.slice(0, 3).join(', ')}`);
    return { action, reason };
  });

  // Test 4.2: Cross-agent consensus
  await runTest('Cross-Agent Consensus', async () => {
    const suiAgent = new SuiPoolAgent('testnet');
    const riskAgent = new RiskAgent('risk-test');
    const hedgingAgent = new HedgingAgent('hedging-test');
    
    await Promise.all([
      suiAgent.initialize(),
      riskAgent.initialize(),
      hedgingAgent.initialize(),
    ]);
    
    const [suiCtx, riskResult, hedgeResult] = await Promise.all([
      suiAgent.getEnhancedAllocationContext(),
      riskAgent.getEnhancedRiskContext(),
      hedgingAgent.getEnhancedMarketContext(),
    ]);
    
    // Check consensus
    const isBullish = suiCtx.marketSentiment === 'BULLISH';
    const riskCondition = riskResult.riskAssessment.marketCondition;
    const hedgeDirection = hedgeResult.hedgingRecommendation.direction;
    
    console.log(`   SuiPool: ${suiCtx.marketSentiment} | Urgency: ${suiCtx.urgency}`);
    console.log(`   Risk: ${riskResult.riskAssessment.overallRisk} | ${riskCondition}`);
    console.log(`   Hedging: ${hedgeDirection} | Urgency: ${hedgeResult.hedgingRecommendation.urgency}`);
    
    const consensus = (isBullish && riskCondition === 'BULLISH' && hedgeDirection === 'LONG') ||
                      (!isBullish && riskCondition === 'BEARISH' && hedgeDirection === 'SHORT')
                      ? 'UNANIMOUS' : 'MIXED';
    console.log(`   Consensus: ${consensus}`);
    return { consensus, suiCtx, riskResult, hedgeResult };
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  logSection('TEST SUMMARY');
  
  const totalDuration = Date.now() - totalStart;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  
  console.log(`\n  Total Tests: ${results.length}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏱️  Duration: ${totalDuration}ms`);
  console.log(`  📊 Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  
  if (failed > 0) {
    console.log('\n  Failed Tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`    ❌ ${r.name}`);
      if (r.error) console.log(`       ${r.error}`);
    });
  }
  
  console.log('\n' + (failed === 0 
    ? '🎉 END-TO-END PIPELINE: ALL TESTS PASSED!' 
    : `⚠️  END-TO-END PIPELINE: ${failed} TESTS FAILED`));
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n💥 FATAL ERROR:', err);
  process.exit(1);
});
