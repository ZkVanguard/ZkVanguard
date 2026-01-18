#!/usr/bin/env npx tsx
/**
 * Test Demo Portfolio Creation
 */

import { getSimulatedPortfolioManager, resetSimulatedPortfolioManager } from '../lib/services/SimulatedPortfolioManager';

async function testDemoPortfolio() {
  console.log('🧪 Testing Demo Portfolio Creation\n');
  
  // Reset to force new initialization
  resetSimulatedPortfolioManager();
  
  const manager = getSimulatedPortfolioManager();
  await manager.initialize();
  
  const summary = await manager.getSummary();
  
  console.log('📊 Portfolio Summary:');
  console.log(`  Total Value: $${summary.totalValue?.toFixed(2)}`);
  console.log(`  Cash: $${summary.cash?.toFixed(2)}`);
  console.log(`  Positions: ${summary.positions?.length || 0}`);
  
  if (summary.positions && summary.positions.length > 0) {
    console.log('\n📈 Holdings:');
    for (const p of summary.positions) {
      console.log(`  • ${p.symbol}: ${p.amount?.toFixed(4)} @ $${p.currentPrice?.toFixed(2)} = $${p.value?.toFixed(2)}`);
    }
    console.log('\n✅ Demo portfolio created successfully!');
  } else {
    console.log('\n❌ No positions - demo portfolio not created');
  }
}

testDemoPortfolio().catch(console.error);
