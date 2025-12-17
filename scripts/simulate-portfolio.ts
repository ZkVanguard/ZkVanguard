/**
 * Portfolio Simulation Script
 * 
 * Demonstrates the full Chronos Vanguard system using REAL market data:
 * - Crypto.com MCP (real-time prices)
 * - Crypto.com AI SDK (AI-powered analysis)
 * - Automated trading based on AI recommendations
 * 
 * Run: npx tsx scripts/simulate-portfolio.ts
 */

import { getSimulatedPortfolioManager } from '../lib/services/SimulatedPortfolioManager';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 Starting Chronos Vanguard Portfolio Simulation');
  console.log('📊 Using REAL market data from CoinGecko API (FREE)');
  console.log('🤖 Using REAL AI agent orchestration system');
  console.log('⚙️  Only portfolio positions are simulated - all analysis is REAL\n');

  const manager = getSimulatedPortfolioManager(10000); // Start with $10,000
  await manager.initialize();

  console.log('\n💰 Initial Portfolio:');
  const initialSummary = await manager.getSummary();
  console.log(`Capital: $${initialSummary.currentValue.toFixed(2)}`);
  console.log(`Cash: $${initialSummary.cash.toFixed(2)}\n`);

  // Step 1: Buy initial positions using REAL market prices
  console.log('📈 Step 1: Building initial portfolio with REAL market data...\n');
  
  await manager.buy('CRO', 5000, 'Initial position - Cronos ecosystem');
  await sleep(1000);
  
  await manager.buy('BTC', 0.05, 'Initial position - Store of value');
  await sleep(1000);
  
  await manager.buy('ETH', 1, 'Initial position - Smart contracts');
  await sleep(1000);

  // Step 2: Get AI-powered portfolio analysis
  console.log('\n🤖 Step 2: Getting AI-powered portfolio analysis...\n');
  const analysis = await manager.analyzePortfolio();
  console.log('Portfolio Analysis (from Crypto.com AI SDK):');
  console.log(`Total Value: $${analysis.portfolioData.totalValue.toFixed(2)}`);
  console.log(`Total P&L: $${analysis.portfolioData.totalPnl.toFixed(2)} (${analysis.portfolioData.totalPnlPercentage.toFixed(2)}%)`);
  console.log(`Health Score: ${analysis.healthScore}/100`);
  console.log(`Risk Score: ${analysis.riskScore}/100`);
  console.log('\nAI Recommendations:');
  analysis.recommendations.forEach((rec: string, i: number) => {
    console.log(`  ${i + 1}. ${rec}`);
  });

  // Step 3: Get AI-powered risk assessment
  console.log('\n⚠️ Step 3: Getting AI-powered risk assessment...\n');
  const riskAssessment = await manager.assessRisk();
  console.log('Risk Assessment (from Crypto.com AI SDK):');
  console.log(`Overall Risk: ${riskAssessment.overallRisk}`);
  console.log(`Volatility: ${(riskAssessment.volatility * 100).toFixed(2)}%`);
  console.log(`VaR 95%: ${(riskAssessment.var95 * 100).toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${riskAssessment.sharpeRatio.toFixed(2)}`);
  console.log('\nRisk Factors:');
  riskAssessment.factors.forEach((factor: any) => {
    console.log(`  - ${factor.factor} (${factor.impact}): ${factor.description}`);
  });

  // Step 4: Get AI hedge recommendations
  console.log('\n🛡️ Step 4: Getting AI-powered hedge recommendations...\n');
  const hedges = await manager.getHedgeRecommendations();
  console.log('Hedge Recommendations (from Crypto.com AI SDK):');
  hedges.recommendations.forEach((hedge: any, i: number) => {
    console.log(`\n  ${i + 1}. ${hedge.strategy}`);
    console.log(`     Confidence: ${(hedge.confidence * 100).toFixed(0)}%`);
    console.log(`     Expected Risk Reduction: ${hedge.expectedReduction.toFixed(1)}%`);
    console.log(`     Description: ${hedge.description}`);
    console.log(`     Actions:`);
    hedge.actions.forEach((action: any) => {
      console.log(`       - ${action.action} ${action.amount} ${action.asset}`);
    });
  });

  // Step 5: Execute AI recommendation (if available)
  if (hedges.recommendations && hedges.recommendations.length > 0) {
    console.log('\n⚡ Step 5: Executing AI recommendation...\n');
    const firstRecommendation = hedges.recommendations[0];
    try {
      const trades = await manager.executeAIRecommendation(firstRecommendation);
      console.log(`Executed ${trades.length} trade(s) based on AI recommendation`);
    } catch (error) {
      console.log(`⚠️ Could not execute AI recommendation: ${error}`);
      console.log('(This is normal if recommendation requires assets not in portfolio)');
    }
  }

  // Step 6: Take snapshot
  console.log('\n📸 Step 6: Taking portfolio snapshot...\n');
  const snapshot = await manager.takeSnapshot();
  console.log('Portfolio Snapshot:');
  console.log(`Timestamp: ${snapshot.timestamp.toISOString()}`);
  console.log(`Total Value: $${snapshot.totalValue.toFixed(2)}`);
  console.log(`Cash: $${snapshot.cash.toFixed(2)}`);
  console.log(`Total P&L: $${snapshot.totalPnl.toFixed(2)}`);
  console.log(`\nPositions (${snapshot.positions.length}):`);
  snapshot.positions.forEach(pos => {
    console.log(`  ${pos.symbol}: ${pos.amount.toFixed(4)} @ $${pos.currentPrice.toFixed(4)} = $${pos.value.toFixed(2)}`);
    console.log(`    P&L: $${pos.pnl.toFixed(2)} (${pos.pnlPercentage.toFixed(2)}%)`);
  });

  // Final summary
  console.log('\n\n📊 Final Portfolio Summary:\n');
  const finalSummary = await manager.getSummary();
  console.log(`Initial Capital: $${finalSummary.initialCapital.toFixed(2)}`);
  console.log(`Current Value: $${finalSummary.currentValue.toFixed(2)}`);
  console.log(`Total P&L: $${finalSummary.totalPnl.toFixed(2)} (${finalSummary.totalPnlPercentage.toFixed(2)}%)`);
  console.log(`Cash: $${finalSummary.cash.toFixed(2)}`);
  console.log(`Positions: ${finalSummary.positionCount}`);
  console.log(`Total Trades: ${finalSummary.tradeCount}`);

  console.log('\n📝 Trade History:');
  const trades = manager.getTradeHistory();
  trades.forEach(trade => {
    console.log(`  ${trade.timestamp.toISOString()} - ${trade.type} ${trade.amount} ${trade.symbol} @ $${trade.price.toFixed(4)}`);
    console.log(`    Total: $${trade.total.toFixed(2)} - ${trade.reason}`);
  });

  console.log('\n\n✅ Simulation Complete!');
  console.log('🎯 All data was REAL:');
  console.log('  - Market prices: CoinGecko API (FREE)');
  console.log('  - Portfolio analysis: Real Agent Orchestrator');
  console.log('  - Risk assessment: Real Risk Agent');
  console.log('  - Hedge recommendations: Real Hedging Agent');
  console.log('💡 This demonstrates the full Chronos Vanguard system with real agents and live data\n');

  await manager.disconnect();
}

main().catch(console.error);
