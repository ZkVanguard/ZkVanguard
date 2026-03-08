#!/usr/bin/env npx tsx
/**
 * Check Community Pool Auto-Hedging Activity
 * Queries DB for hedges, cron state, and on-chain hedge data
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { query } from '../../lib/db/postgres';
import { ethers } from 'ethers';
import { COMMUNITY_POOL_PORTFOLIO_ID } from '../../lib/constants';

const HEDGE_EXECUTOR_V2 = '0x0F1d16AA9b4EA870b37A7D5350ae4386b1F452A2';
const COMMUNITY_POOL_V2 = '0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B';
const RPC_URL = 'https://evm-t3.cronos.org';

async function main() {
  console.log('🔍 Community Pool Auto-Hedging Activity Report\n');

  // 1. Check hedges for community pool (portfolio_id = COMMUNITY_POOL_PORTFOLIO_ID)
  console.log(`═══ 1. Database Hedges (portfolio_id = ${COMMUNITY_POOL_PORTFOLIO_ID}) ═══`);
  try {
    const communityHedges = await query(
      `SELECT order_id, asset, side, size, notional_value, leverage, entry_price, 
              status, simulation_mode, reason, tx_hash, on_chain, created_at, wallet_address 
       FROM hedges WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [COMMUNITY_POOL_PORTFOLIO_ID]
    );
    if (communityHedges.length === 0) {
      console.log(`  ⚠️  NO hedges found for portfolio_id = ${COMMUNITY_POOL_PORTFOLIO_ID}`);
    } else {
      console.log(`  Found ${communityHedges.length} hedges:`);
      communityHedges.forEach((h: any, i: number) => {
        console.log(`\n  --- Hedge ${i + 1} ---`);
        console.log(`    Order: ${h.order_id}`);
        console.log(`    ${h.side} ${h.asset} | Size: ${h.size} | Notional: $${h.notional_value}`);
        console.log(`    Leverage: ${h.leverage}x | Entry: $${h.entry_price}`);
        console.log(`    Status: ${h.status} | On-chain: ${h.on_chain} | Sim: ${h.simulation_mode}`);
        console.log(`    Created: ${h.created_at}`);
        if (h.tx_hash) console.log(`    TX: ${h.tx_hash}`);
        if (h.reason) console.log(`    Reason: ${h.reason}`);
      });
    }
  } catch (e: any) {
    console.log(`  ❌ Error querying hedges: ${e.message}`);
  }

  // 2. Check ALL hedges with their portfolio_id
  console.log('\n\n═══ 2. All Hedges (with portfolio IDs) ═══');
  try {
    const allHedges = await query(
      `SELECT order_id, portfolio_id, asset, side, status, on_chain, simulation_mode, 
              tx_hash, created_at, wallet_address
       FROM hedges ORDER BY created_at DESC LIMIT 15`
    );
    console.log(`  Total hedges in DB: showing last ${allHedges.length}`);
    allHedges.forEach((h: any, i: number) => {
      const onchain = h.on_chain ? '⛓️' : '💻';
      const sim = h.simulation_mode ? '(SIM)' : '';
      console.log(`  ${i + 1}. [Portfolio ${h.portfolio_id ?? 'NULL'}] ${onchain} ${h.side} ${h.asset} | ${h.status} ${sim} | ${h.created_at}`);
      if (h.tx_hash) console.log(`     TX: ${h.tx_hash}`);
    });
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }

  // 3. Check cron state for hedge/pool-related entries
  console.log('\n\n═══ 3. Cron State (hedge & pool related) ═══');
  try {
    const cronState = await query(
      `SELECT * FROM cron_state WHERE key LIKE '%hedge%' OR key LIKE '%pool%' OR key LIKE '%Pool%' ORDER BY updated_at DESC`
    );
    if (cronState.length === 0) {
      console.log('  ⚠️  No hedge/pool cron state found');
    } else {
      cronState.forEach((s: any) => {
        const val = s.value;
        let display: string;
        if (typeof val === 'number' && val > 1e12) {
          display = new Date(val).toLocaleString();
        } else {
          display = JSON.stringify(val);
        }
        console.log(`  ${s.key}: ${display}`);
        console.log(`    Updated: ${new Date(s.updated_at).toLocaleString()}`);
      });
    }
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }

  // 4. Check on-chain HedgeExecutorV2 for community pool hedges
  console.log('\n\n═══ 4. On-Chain HedgeExecutorV2 Data ═══');
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Check basic contract info
    const code = await provider.getCode(HEDGE_EXECUTOR_V2);
    console.log(`  Contract at ${HEDGE_EXECUTOR_V2}: ${code.length > 2 ? '✅ Deployed' : '❌ Not deployed'}`);
    
    // Check community pool contract
    const poolCode = await provider.getCode(COMMUNITY_POOL_V2);
    console.log(`  CommunityPool at ${COMMUNITY_POOL_V2}: ${poolCode.length > 2 ? '✅ Deployed' : '❌ Not deployed'}`);

    // Try to read hedge count or events from HedgeExecutor
    const hedgeAbi = [
      'function hedgeCount() view returns (uint256)',
      'function getHedge(bytes32) view returns (tuple(address owner, address pair, bool isLong, uint256 collateral, uint256 leverage, uint256 entryPrice, uint256 timestamp, bool active))',
      'event HedgeOpened(bytes32 indexed hedgeId, address indexed owner, address pair, bool isLong, uint256 collateral, uint256 leverage)',
      'event HedgeClosed(bytes32 indexed hedgeId, address indexed owner, int256 pnl)',
    ];
    const hedgeContract = new ethers.Contract(HEDGE_EXECUTOR_V2, hedgeAbi, provider);
    
    try {
      const count = await hedgeContract.hedgeCount();
      console.log(`  Total on-chain hedges: ${count}`);
    } catch {
      console.log('  hedgeCount() not available on this contract version');
    }

    // Query HedgeOpened events
    console.log('\n  Scanning for HedgeOpened events (last 100k blocks)...');
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100000);
    
    try {
      const openFilter = hedgeContract.filters.HedgeOpened();
      const openEvents = await hedgeContract.queryFilter(openFilter, fromBlock, currentBlock);
      console.log(`  Found ${openEvents.length} HedgeOpened events`);
      
      openEvents.forEach((e: any, i: number) => {
        const args = e.args;
        console.log(`\n  --- On-Chain Hedge ${i + 1} ---`);
        console.log(`    Hedge ID: ${args.hedgeId}`);
        console.log(`    Owner: ${args.owner}`);
        console.log(`    Pair: ${args.pair}`);
        console.log(`    Direction: ${args.isLong ? 'LONG' : 'SHORT'}`);
        console.log(`    Collateral: ${ethers.formatUnits(args.collateral, 6)} USDC`);
        console.log(`    Leverage: ${args.leverage}x`);
        console.log(`    Block: ${e.blockNumber} | TX: ${e.transactionHash}`);
      });
    } catch (e: any) {
      console.log(`  Could not query events: ${e.message?.slice(0, 100)}`);
    }

    // Check HedgeClosed events too
    try {
      const closeFilter = hedgeContract.filters.HedgeClosed();
      const closeEvents = await hedgeContract.queryFilter(closeFilter, fromBlock, currentBlock);
      console.log(`\n  Found ${closeEvents.length} HedgeClosed events`);
    } catch {
      console.log('  Could not query HedgeClosed events');
    }

  } catch (e: any) {
    console.log(`  ❌ RPC Error: ${e.message?.slice(0, 200)}`);
  }

  // 5. Check auto-hedge config
  console.log('\n\n═══ 5. Auto-Hedge Configuration ═══');
  try {
    const config = await query(
      'SELECT * FROM auto_hedge_configs WHERE portfolio_id = $1',
      [COMMUNITY_POOL_PORTFOLIO_ID]
    );
    if (config.length > 0) {
      const c = config[0];
      console.log(`  Community Pool: ${c.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
      console.log(`  Risk Threshold: ${c.risk_threshold}%`);
      console.log(`  Max Leverage: ${c.max_leverage}x`);
      console.log(`  Allowed Assets: ${c.allowed_assets}`);
    } else {
      console.log('  ⚠️  No DB config found, checking file...');
      const fs = await import('fs');
      const fileConfig = JSON.parse(fs.readFileSync('deployments/auto-hedge-configs.json', 'utf8'));
      const poolConfig = fileConfig.find((c: any) => c.portfolioId === COMMUNITY_POOL_PORTFOLIO_ID);
      if (poolConfig) {
        console.log(`  Community Pool: ${poolConfig.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
        console.log(`  Risk Threshold: ${poolConfig.riskThreshold}`);
        console.log(`  Max Leverage: ${poolConfig.maxLeverage}x`);
        console.log(`  Allowed Assets: ${poolConfig.allowedAssets.join(', ')}`);
      }
    }
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }

  console.log('\n\n══════════════════════════════════════');
  console.log('📋 Summary complete');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
