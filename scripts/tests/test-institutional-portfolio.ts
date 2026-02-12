/**
 * Test Institutional Portfolio - 150M Mock USDC
 * 
 * Tests the institutional portfolio with:
 * - BTC, ETH, CRO, SUI allocations
 * - AI Risk Management
 * - Real API price tracking
 * 
 * Usage: npx ts-node scripts/tests/test-institutional-portfolio.ts
 */

import { getInstitutionalPortfolioManager, resetInstitutionalPortfolioManager } from '../../lib/services/InstitutionalPortfolioManager';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function formatUSD(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function testInstitutionalPortfolio() {
  log('\n═══════════════════════════════════════════════════════════', colors.cyan);
  log('  🏛️  INSTITUTIONAL PORTFOLIO TEST - $150M MOCK USDC', colors.cyan);
  log('═══════════════════════════════════════════════════════════\n', colors.cyan);

  try {
    // Reset any existing instance
    resetInstitutionalPortfolioManager();

    // Initialize portfolio
    log('📊 Initializing $150M Portfolio...', colors.yellow);
    const manager = getInstitutionalPortfolioManager();
    await manager.initialize();
    log('✅ Portfolio initialized\n', colors.green);

    // Get summary
    log('📋 Portfolio Summary:', colors.blue);
    log('─'.repeat(50), colors.blue);
    
    const summary = await manager.getSummary();
    
    log(`Portfolio ID: ${summary.portfolioId}`, colors.reset);
    log(`Name: ${summary.name}`, colors.reset);
    log(`Initial Capital: ${formatUSD(summary.initialCapital)}`, colors.reset);
    log(`Current Value: ${formatUSD(summary.currentValue)}`, colors.reset);
    log(`P&L: ${formatUSD(summary.totalPnl)} (${summary.totalPnlPercentage.toFixed(2)}%)`, 
        summary.totalPnl >= 0 ? colors.green : colors.red);
    log(`Real API Tracking: ${summary.realAPITracking ? '✅' : '❌'}`, colors.reset);
    log(`AI Risk Management: ${summary.aiRiskManagement ? '✅' : '❌'}`, colors.reset);
    
    // Positions
    log('\n📈 Positions:', colors.blue);
    log('─'.repeat(70), colors.blue);
    log(`${'Symbol'.padEnd(8)} ${'Amount'.padStart(18)} ${'Price'.padStart(12)} ${'Value'.padStart(14)} ${'P&L'.padStart(10)}`, colors.cyan);
    log('─'.repeat(70), colors.blue);
    
    for (const pos of summary.positions) {
      const pnlColor = pos.pnl >= 0 ? colors.green : colors.red;
      log(
        `${pos.symbol.padEnd(8)} ` +
        `${pos.amount.toLocaleString('en-US', { maximumFractionDigits: 4 }).padStart(18)} ` +
        `${('$' + pos.currentPrice.toFixed(2)).padStart(12)} ` +
        `${formatUSD(pos.value).padStart(14)} ` +
        `${pnlColor}${(pos.pnlPercentage >= 0 ? '+' : '') + pos.pnlPercentage.toFixed(2) + '%'}${colors.reset}`
      );
    }
    
    // Risk Metrics
    log('\n🎯 Risk Metrics (AI-Powered):', colors.blue);
    log('─'.repeat(50), colors.blue);
    
    const risk = summary.riskMetrics;
    log(`Overall Risk Score: ${risk.overallRiskScore}/100`, colors.reset);
    log(`Portfolio Volatility: ${(risk.volatility * 100).toFixed(1)}%`, colors.reset);
    log(`Sharpe Ratio: ${risk.sharpeRatio.toFixed(2)}`, colors.reset);
    log(`Max Drawdown (est): ${(risk.maxDrawdown * 100).toFixed(1)}%`, colors.reset);
    log(`VaR 95% (daily): ${formatUSD(risk.var95)}`, colors.yellow);
    log(`Concentration Risk: ${risk.concentrationRisk.toFixed(1)}/100`, colors.reset);
    log(`Liquidity Score: ${risk.liquidityScore.toFixed(0)}/100`, colors.reset);
    
    if (risk.aiRecommendations?.length > 0) {
      log('\n🤖 AI Recommendations:', colors.magenta);
      for (const rec of risk.aiRecommendations) {
        log(`  • ${rec}`, colors.reset);
      }
    }
    
    // Hedge Recommendations
    log('\n🛡️ Hedge Recommendations:', colors.blue);
    log('─'.repeat(50), colors.blue);
    
    const hedges = await manager.getHedgeRecommendations();
    log(`Portfolio Size: ${(hedges as Record<string, unknown>).portfolioSize}`, colors.reset);
    log(`Dominant Asset: ${(hedges as Record<string, unknown>).dominantAsset}`, colors.reset);
    log(`AI Risk Management: ${(hedges as Record<string, unknown>).aiRiskManagement ? '✅' : '❌'}`, colors.reset);
    
    const recommendations = (hedges as Record<string, unknown>).recommendations as Array<{ strategy: string; reason?: string; notional?: number }>;
    if (recommendations?.length > 0) {
      log('\nRecommended Hedges:', colors.yellow);
      for (const hedge of recommendations) {
        log(`  • ${hedge.strategy}`, colors.reset);
        if (hedge.notional) {
          log(`    Notional: ${formatUSD(hedge.notional)}`, colors.cyan);
        }
        if (hedge.reason) {
          log(`    Reason: ${hedge.reason}`, colors.cyan);
        }
      }
    }
    
    log('\n═══════════════════════════════════════════════════════════', colors.green);
    log('  ✅ INSTITUTIONAL PORTFOLIO TEST COMPLETE', colors.green);
    log('═══════════════════════════════════════════════════════════\n', colors.green);
    
  } catch (error) {
    log(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testInstitutionalPortfolio().catch(console.error);
