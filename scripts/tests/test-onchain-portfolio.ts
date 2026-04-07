#!/usr/bin/env npx tsx
/**
 * Test On-Chain Portfolio Data
 * Fetches real portfolio data from Cronos testnet
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { ethers } from 'ethers';
import { getMarketDataService } from '../lib/services/market-data/RealMarketDataService';

async function testOnChainPortfolio() {
  console.log('🔗 Testing On-Chain Portfolio Data\n');

  // Get wallet address from private key (check multiple env vars)
  const pk = process.env.PRIVATE_KEY || 
             process.env.AGENT_PRIVATE_KEY || 
             process.env.SERVER_WALLET_PRIVATE_KEY;
  
  if (!pk) {
    console.log('❌ No wallet private key found in .env.local');
    console.log('   Checked: PRIVATE_KEY, AGENT_PRIVATE_KEY, SERVER_WALLET_PRIVATE_KEY');
    return;
  }

  const wallet = new ethers.Wallet(pk);
  console.log(`📍 Wallet Address: ${wallet.address}`);
  console.log(`   (from SERVER_WALLET_PRIVATE_KEY in .env.local)\n`);

  // Fetch on-chain portfolio data
  const marketData = getMarketDataService();
  
  console.log('⏳ Fetching on-chain balances from Cronos Testnet...\n');
  
  try {
    const portfolioData = await marketData.getPortfolioData(wallet.address);
    
    console.log('📊 On-Chain Portfolio:');
    console.log(`   Total Value: $${portfolioData.totalValue.toFixed(2)}`);
    console.log(`   Tokens: ${portfolioData.tokens.length}`);
    
    if (portfolioData.tokens.length > 0) {
      console.log('\n💰 Holdings:');
      for (const token of portfolioData.tokens) {
        console.log(`   • ${token.symbol}: ${parseFloat(token.balance).toFixed(4)} ($${token.usdValue.toFixed(2)})`);
      }
      console.log('\n✅ On-chain portfolio data retrieved successfully!');
    } else {
      console.log('\n⚠️ No tokens found in wallet');
      console.log('   To test with real data, send some testnet CRO to this address');
      console.log(`   Address: ${wallet.address}`);
      console.log('   Faucet: https://cronos.org/faucet');
    }
  } catch (error) {
    console.error('❌ Failed to fetch portfolio:', error);
  }
}

testOnChainPortfolio().catch(console.error);
