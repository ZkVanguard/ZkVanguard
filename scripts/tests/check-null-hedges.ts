#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { query } from '../../lib/db/postgres';
import { ethers } from 'ethers';

async function main() {
  // Check NULL portfolio_id hedges - they may be community pool hedges
  console.log('=== Hedges with NULL portfolio_id (potential community pool) ===\n');
  const nullHedges = await query(
    `SELECT order_id, asset, side, size, notional_value, leverage, entry_price, 
            status, simulation_mode, reason, tx_hash, on_chain, created_at, wallet_address,
            contract_address, chain
     FROM hedges WHERE portfolio_id IS NULL ORDER BY created_at DESC`
  );
  
  nullHedges.forEach((h: any, i: number) => {
    console.log(`--- Hedge ${i+1} ---`);
    console.log(`  Order: ${h.order_id}`);
    console.log(`  ${h.side} ${h.asset} | Size: ${h.size} | Notional: $${h.notional_value}`);
    console.log(`  Leverage: ${h.leverage}x | Entry: $${h.entry_price} | Status: ${h.status}`);
    console.log(`  On-chain: ${h.on_chain} | Sim: ${h.simulation_mode}`);
    console.log(`  Wallet: ${h.wallet_address}`);
    console.log(`  Contract: ${h.contract_address} | Chain: ${h.chain}`);
    console.log(`  Created: ${h.created_at}`);
    if (h.tx_hash) console.log(`  TX: ${h.tx_hash}`);
    if (h.reason) console.log(`  Reason: ${h.reason}`);
    console.log();
  });

  // Check on-chain events in smaller batches
  console.log('\n=== On-Chain Event Scan (HedgeExecutorV2) ===');
  const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
  const hedgeAbi = [
    'event HedgeOpened(bytes32 indexed hedgeId, address indexed owner, address pair, bool isLong, uint256 collateral, uint256 leverage)',
    'event HedgeClosed(bytes32 indexed hedgeId, address indexed owner, int256 pnl)',
  ];
  const contract = new ethers.Contract('0x0F1d16AA9b4EA870b37A7D5350ae4386b1F452A2', hedgeAbi, provider);
  const currentBlock = await provider.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);
  
  // Scan in 2k block batches going back 20k blocks
  const allEvents: any[] = [];
  for (let end = currentBlock; end > currentBlock - 20000; end -= 2000) {
    const start = Math.max(0, end - 2000);
    try {
      const events = await contract.queryFilter('HedgeOpened', start, end);
      if (events.length > 0) {
        console.log(`  Blocks ${start}-${end}: found ${events.length} events`);
      }
      allEvents.push(...events);
    } catch (e: any) {
      console.log(`  Blocks ${start}-${end}: query failed - ${e.message?.slice(0, 80)}`);
    }
  }
  
  console.log(`\nTotal HedgeOpened events found: ${allEvents.length}`);
  allEvents.forEach((e: any, i: number) => {
    const a = e.args;
    console.log(`  ${i+1}. HedgeID: ${a.hedgeId}`);
    console.log(`     Owner: ${a.owner} | ${a.isLong ? 'LONG' : 'SHORT'}`);
    console.log(`     Collateral: ${ethers.formatUnits(a.collateral, 6)} USDC | Leverage: ${a.leverage}x`);
    console.log(`     Block: ${e.blockNumber} | TX: ${e.transactionHash}`);
  });

  // Also scan the original HedgeExecutor at a different address
  console.log('\n=== On-Chain Event Scan (Original HedgeExecutor @ 0x090b...) ===');
  const contract2 = new ethers.Contract('0x090b6221137690EbB37667E4644287487CE462B9', hedgeAbi, provider);
  const allEvents2: any[] = [];
  for (let end = currentBlock; end > currentBlock - 20000; end -= 2000) {
    const start = Math.max(0, end - 2000);
    try {
      const events = await contract2.queryFilter('HedgeOpened', start, end);
      if (events.length > 0) {
        console.log(`  Blocks ${start}-${end}: found ${events.length} events`);
      }
      allEvents2.push(...events);
    } catch {}
  }
  console.log(`Total: ${allEvents2.length} events`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
