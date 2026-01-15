#!/usr/bin/env npx tsx
/**
 * Test getPortfolioData directly
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getPortfolioData } from '../lib/services/portfolio-actions';

async function test() {
  console.log('🧪 Testing getPortfolioData() directly\n');
  
  const data = await getPortfolioData();
  
  if (data?.success) {
    console.log('✅ SUCCESS: Got on-chain portfolio data!\n');
    console.log(`📍 Address: ${data.portfolio.address}`);
    console.log(`💰 Total Value: $${data.portfolio.totalValue.toFixed(2)}`);
    console.log(`📊 Positions: ${data.portfolio.positions.length}`);
    
    if (data.portfolio.positions.length > 0) {
      console.log('\nHoldings:');
      for (const p of data.portfolio.positions) {
        console.log(`  • ${p.symbol}: ${p.amount.toFixed(4)} @ $${p.currentPrice.toFixed(4)} = $${p.value.toFixed(2)}`);
      }
    }
  } else {
    console.log('❌ FAILED: Could not get portfolio data');
    console.log('Data:', data);
  }
}

test().catch(console.error);
