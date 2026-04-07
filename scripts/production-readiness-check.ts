#!/usr/bin/env npx tsx
/**
 * PRODUCTION READINESS CHECK
 * 
 * Verifies all components are ready for mainnet/production deployment
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║       PRODUCTION READINESS CHECKLIST                   ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

interface CheckResult {
  name: string;
  status: 'READY' | 'WARNING' | 'BLOCKER';
  message: string;
}

const results: CheckResult[] = [];

function check(name: string, status: 'READY' | 'WARNING' | 'BLOCKER', message: string) {
  results.push({ name, status, message });
  const icon = status === 'READY' ? '✅' : status === 'WARNING' ? '⚠️ ' : '❌';
  console.log(`${icon} ${name}: ${message}`);
}

// ============ ON-CHAIN CONFIGURATION ============
console.log('═══ ON-CHAIN CONFIGURATION ═══\n');

import { SuiClient } from '@mysten/sui/client';
const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

const poolStateId = process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET;

async function checkOnChain() {
  try {
    const obj = await client.getObject({ 
      id: poolStateId!, 
      options: { showContent: true } 
    });
    
    if (!obj.data) {
      check('Pool State', 'BLOCKER', 'NOT FOUND on-chain');
      return;
    }
    
    check('Pool State', 'READY', `Found: ${poolStateId?.slice(0, 20)}...`);
    
    const fields = (obj.data.content as any)?.fields || {};
    
    // Treasury
    const treasury = fields.treasury;
    const expectedMsafe = '0x83b9f1bc3a2d32685e67fc52dce547e4e817afeeed90a996e8c6931e0ba35f2b';
    if (treasury === expectedMsafe) {
      check('MSafe Treasury', 'READY', 'Correctly set');
    } else if (!treasury) {
      check('MSafe Treasury', 'BLOCKER', 'NOT SET - fees will go nowhere');
    } else {
      check('MSafe Treasury', 'WARNING', `Set to different address: ${treasury.slice(0, 20)}...`);
    }
    
    // Performance Fee
    const perfFee = parseInt(fields.performance_fee_bps || '0');
    if (perfFee === 2000) {
      check('Performance Fee', 'READY', '20% (2000 bps)');
    } else {
      check('Performance Fee', 'WARNING', `${perfFee/100}% - expected 20%`);
    }
    
    // Shares/TVL
    const totalShares = BigInt(fields.total_shares || '0');
    if (totalShares > 0n) {
      check('Pool TVL', 'READY', `${(Number(totalShares) / 1e9).toFixed(4)} shares minted`);
    } else {
      check('Pool TVL', 'WARNING', 'No deposits yet');
    }
    
  } catch (e: any) {
    check('Pool State', 'BLOCKER', `Error: ${e.message}`);
  }
}

// ============ VERCEL/PRODUCTION ENV VARS ============
console.log('\n═══ VERCEL ENVIRONMENT VARIABLES ═══\n');

function checkEnvVars() {
  // Required for QStash
  const qstashCurrent = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const qstashNext = process.env.QSTASH_NEXT_SIGNING_KEY;
  
  if (qstashCurrent && qstashNext) {
    check('QStash Signing Keys', 'READY', 'Both keys configured');
  } else {
    check('QStash Signing Keys', 'WARNING', 'Not in .env.local (should be in Vercel)');
  }
  
  // Database
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.includes('neon.tech')) {
    check('Database (Neon)', 'READY', 'Neon PostgreSQL configured');
  } else if (dbUrl) {
    check('Database', 'READY', 'Custom database configured');
  } else {
    check('Database', 'BLOCKER', 'DATABASE_URL not set');
  }
  
  // BlueFin
  const bluefinKey = process.env.BLUEFIN_PRIVATE_KEY;
  if (bluefinKey) {
    check('BlueFin Private Key', 'READY', 'Configured for hedging');
  } else {
    check('BlueFin Private Key', 'WARNING', 'Not set - auto-hedge will not work');
  }
  
  // SUI Admin Key
  const suiAdminKey = process.env.SUI_PRIVATE_KEY;
  if (suiAdminKey) {
    check('SUI Admin Key', 'READY', 'Pool admin operations enabled');
  } else {
    check('SUI Admin Key', 'WARNING', 'Not set - cannot execute swaps');
  }
}

// ============ BLUEFIN ACCOUNT STATUS ============
console.log('\n═══ BLUEFIN HEDGING READINESS ═══\n');

async function checkBluefin() {
  const { BluefinService } = await import('../lib/services/sui/BluefinService');
  const service = BluefinService.getInstance();
  
  const privateKey = process.env.BLUEFIN_PRIVATE_KEY;
  if (!privateKey) {
    check('BlueFin Service', 'WARNING', 'No private key - hedging disabled');
    return;
  }
  
  try {
    await service.initialize(privateKey, 'testnet');
    check('BlueFin Auth', 'READY', 'Successfully authenticated');
    
    // Check account status
    try {
      const balance = await service.getBalance();
      if (balance > 0) {
        check('BlueFin Balance', 'READY', `${balance} USDC available for hedging`);
      } else {
        check('BlueFin Balance', 'WARNING', 'Zero balance - fund account for hedging');
      }
    } catch (e: any) {
      if (e.message.includes('404')) {
        check('BlueFin Account', 'WARNING', 'Account not onboarded - register at bluefin.io');
      } else {
        check('BlueFin Balance', 'WARNING', e.message);
      }
    }
    
    // Check market data access
    try {
      const btcData = await service.getMarketData('BTC-PERP');
      if (btcData?.price) {
        check('BlueFin Markets', 'READY', `BTC-PERP: $${btcData.price.toLocaleString()}`);
      }
    } catch {
      check('BlueFin Markets', 'WARNING', 'Cannot fetch market data');
    }
    
  } catch (e: any) {
    check('BlueFin Service', 'BLOCKER', `Init failed: ${e.message}`);
  }
}

// ============ DATABASE STATUS ============
console.log('\n═══ DATABASE STATUS ═══\n');

async function checkDatabase() {
  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // Check tables
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    const tableNames = tables.rows.map(r => r.table_name);
    const requiredTables = ['auto_hedge_configs', 'community_pool_state', 'user_positions'];
    
    for (const table of requiredTables) {
      if (tableNames.includes(table)) {
        check(`Table: ${table}`, 'READY', 'Exists');
      } else {
        check(`Table: ${table}`, 'WARNING', 'Missing - will be auto-created');
      }
    }
    
    // Check SUI auto-hedge config
    const suiConfig = await pool.query(
      'SELECT * FROM auto_hedge_configs WHERE portfolio_id = $1',
      [-2]
    );
    
    if (suiConfig.rows.length > 0 && suiConfig.rows[0].enabled) {
      check('SUI Auto-Hedge Config', 'READY', `Threshold: ${suiConfig.rows[0].risk_threshold}/10`);
    } else if (suiConfig.rows.length > 0) {
      check('SUI Auto-Hedge Config', 'WARNING', 'Config exists but disabled');
    } else {
      check('SUI Auto-Hedge Config', 'WARNING', 'No config - run seed-sui-auto-hedge.ts');
    }
    
    await pool.end();
  } catch (e: any) {
    check('Database Connection', 'BLOCKER', e.message);
  }
}

// ============ API ENDPOINT CHECK ============
console.log('\n═══ API ENDPOINTS ═══\n');

async function checkApis() {
  const http = await import('http');
  
  async function testEndpoint(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:3000${path}`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(5000, () => resolve(false));
    });
  }
  
  const endpoints = [
    '/api/sui/community-pool',
    '/api/sui/community-pool?action=treasury-info',
    '/api/sui/community-pool?action=allocation',
    '/api/health',
    '/api/prices?symbols=BTC,ETH',
  ];
  
  for (const endpoint of endpoints) {
    const ok = await testEndpoint(endpoint);
    if (ok) {
      check(`API: ${endpoint.split('?')[0]}`, 'READY', 'Responding');
    } else {
      check(`API: ${endpoint.split('?')[0]}`, 'WARNING', 'Not responding (dev server down?)');
    }
  }
}

// ============ SUMMARY ============
async function main() {
  await checkOnChain();
  checkEnvVars();
  await checkBluefin();
  await checkDatabase();
  await checkApis();
  
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                             ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  const blockers = results.filter(r => r.status === 'BLOCKER');
  const warnings = results.filter(r => r.status === 'WARNING');
  const ready = results.filter(r => r.status === 'READY');
  
  console.log(`✅ Ready:    ${ready.length}`);
  console.log(`⚠️  Warnings: ${warnings.length}`);
  console.log(`❌ Blockers: ${blockers.length}`);
  
  if (blockers.length > 0) {
    console.log('\n❌ BLOCKERS - Must fix before production:');
    blockers.forEach(b => console.log(`   • ${b.name}: ${b.message}`));
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  WARNINGS - Review before production:');
    warnings.forEach(w => console.log(`   • ${w.name}: ${w.message}`));
  }
  
  const verdict = blockers.length === 0 
    ? warnings.length === 0 
      ? '🚀 PRODUCTION READY!'
      : '⚠️  READY WITH WARNINGS'
    : '❌ NOT READY - FIX BLOCKERS';
  
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`   ${verdict}`);
  console.log(`${'═'.repeat(50)}\n`);
  
  process.exit(blockers.length > 0 ? 1 : 0);
}

main().catch(console.error);
