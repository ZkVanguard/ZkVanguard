#!/usr/bin/env npx tsx
/**
 * COMPREHENSIVE PLATFORM TEST
 * 
 * Tests ALL critical components end-to-end:
 * 1. SUI Pool - On-chain data, treasury, fees
 * 2. BlueFin Integration - Credentials, markets, order capability
 * 3. Database - Connectivity, auto-hedge configs, user data
 * 4. API Endpoints - Real data verification (no static/mock)
 * 5. Cron Jobs - SUI pool rebalancing
 * 6. Auto-Hedge - Configuration and trigger logic
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Pool } from 'pg';

// Test result tracking
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
  duration: number;
}

const results: TestResult[] = [];
let totalPassed = 0;
let totalFailed = 0;
let totalWarnings = 0;

function log(icon: string, msg: string) {
  console.log(`${icon} ${msg}`);
}

function record(name: string, status: 'PASS' | 'FAIL' | 'WARN', details: string, duration: number) {
  results.push({ name, status, details, duration });
  if (status === 'PASS') totalPassed++;
  else if (status === 'FAIL') totalFailed++;
  else totalWarnings++;
}

async function runTest<T>(name: string, testFn: () => Promise<T>): Promise<T | null> {
  const start = Date.now();
  try {
    const result = await testFn();
    const duration = Date.now() - start;
    record(name, 'PASS', 'Success', duration);
    log('✅', `${name} (${duration}ms)`);
    return result;
  } catch (error: any) {
    const duration = Date.now() - start;
    record(name, 'FAIL', error.message, duration);
    log('❌', `${name}: ${error.message}`);
    return null;
  }
}

// =============================================================================
// 1. ENVIRONMENT VARIABLES CHECK
// =============================================================================
async function testEnvironmentVariables() {
  console.log('\n' + '═'.repeat(60));
  console.log('   1. ENVIRONMENT VARIABLES');
  console.log('═'.repeat(60));

  const requiredVars = [
    'DATABASE_URL',
    'SUI_POOL_ADMIN_KEY',
    'BLUEFIN_PRIVATE_KEY',
    'NEXT_PUBLIC_SUI_USDC_POOL_PACKAGE_ID',
    'NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET',
    'NEXT_PUBLIC_SUI_USDC_ADMIN_CAP',
    'CRON_SECRET'
  ];

  for (const varName of requiredVars) {
    await runTest(`ENV: ${varName}`, async () => {
      const value = process.env[varName];
      if (!value) throw new Error('Not set');
      if (value.includes('undefined') || value === 'YOUR_KEY_HERE') {
        throw new Error('Placeholder value');
      }
      return true;
    });
  }
}

// =============================================================================
// 2. DATABASE CONNECTIVITY
// =============================================================================
async function testDatabase() {
  console.log('\n' + '═'.repeat(60));
  console.log('   2. DATABASE CONNECTIVITY');
  console.log('═'.repeat(60));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Test connection
    await runTest('DB: Connection', async () => {
      const result = await pool.query('SELECT NOW() as time');
      return result.rows[0].time;
    });

    // Test auto_hedge_configs table
    await runTest('DB: auto_hedge_configs table', async () => {
      const result = await pool.query('SELECT COUNT(*) as count FROM auto_hedge_configs');
      const count = parseInt(result.rows[0].count);
      if (count === 0) throw new Error('No configs found');
      return count;
    });

    // Test SUI pool config specifically
    await runTest('DB: SUI pool config (portfolioId=-2)', async () => {
      const result = await pool.query(
        'SELECT * FROM auto_hedge_configs WHERE portfolio_id = $1',
        [-2]
      );
      if (result.rows.length === 0) throw new Error('SUI config not found');
      const config = result.rows[0];
      if (!config.enabled) throw new Error('SUI config disabled');
      return config;
    });

    // Test user positions table exists
    await runTest('DB: user_positions table', async () => {
      const result = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'user_positions'
        )`
      );
      if (!result.rows[0].exists) throw new Error('Table not found');
      return true;
    });

  } finally {
    await pool.end();
  }
}

// =============================================================================
// 3. SUI BLOCKCHAIN CONNECTIVITY
// =============================================================================
async function testSuiBlockchain() {
  console.log('\n' + '═'.repeat(60));
  console.log('   3. SUI BLOCKCHAIN');
  console.log('═'.repeat(60));

  const network = process.env.SUI_NETWORK || 'testnet';
  const rpcUrl = network === 'mainnet' 
    ? 'https://fullnode.mainnet.sui.io:443'
    : 'https://fullnode.testnet.sui.io:443';
  
  const client = new SuiClient({ url: rpcUrl });
  const poolStateId = process.env.NEXT_PUBLIC_SUI_USDC_POOL_STATE_TESTNET!;
  const adminCapId = process.env.NEXT_PUBLIC_SUI_USDC_ADMIN_CAP!;

  // Test RPC connection
  await runTest('SUI: RPC connectivity', async () => {
    const version = await client.getRpcApiVersion();
    if (!version) throw new Error('No version returned');
    return version;
  });

  // Test pool state exists on-chain
  let poolState: any = null;
  await runTest('SUI: Pool state on-chain', async () => {
    const obj = await client.getObject({
      id: poolStateId,
      options: { showContent: true }
    });
    if (!obj.data) throw new Error('Pool state not found');
    poolState = obj.data;
    return obj.data.objectId;
  });

  // Verify pool state has real data
  await runTest('SUI: Pool has real data (not empty)', async () => {
    if (!poolState?.content) throw new Error('No content');
    const fields = (poolState.content as any).fields;
    if (!fields) throw new Error('No fields');
    // Check it has expected structure
    if (!fields.total_shares && fields.total_shares !== '0') {
      throw new Error('Missing total_shares field');
    }
    return { totalShares: fields.total_shares };
  });

  // Test AdminCap exists
  await runTest('SUI: AdminCap exists', async () => {
    const obj = await client.getObject({ id: adminCapId });
    if (!obj.data) throw new Error('AdminCap not found');
    return obj.data.objectId;
  });

  // Test admin key derives to expected address
  await runTest('SUI: Admin key valid', async () => {
    const adminKey = process.env.SUI_POOL_ADMIN_KEY!;
    const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.slice(2), 'hex'));
    const address = keypair.getPublicKey().toSuiAddress();
    if (!address.startsWith('0x')) throw new Error('Invalid address');
    return address;
  });

  // Verify treasury is set (MSafe)
  await runTest('SUI: Treasury configured (MSafe)', async () => {
    if (!poolState?.content) throw new Error('No pool state');
    const fields = (poolState.content as any).fields;
    const treasury = fields.treasury;
    if (!treasury || treasury === '0x0' || treasury === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      throw new Error('Treasury not set');
    }
    // Verify it matches configured MSafe address from environment
    const expectedMsafe = process.env.SUI_MSAFE_ADDRESS;
    if (!expectedMsafe) {
      // If env var not set, just verify treasury exists (non-zero)
      return `Treasury set: ${treasury.slice(0, 20)}...`;
    }
    if (treasury !== expectedMsafe) {
      throw new Error(`Treasury mismatch: expected ${expectedMsafe}, got ${treasury}`);
    }
    return treasury;
  });

  // Verify performance fee
  await runTest('SUI: Performance fee = 20%', async () => {
    if (!poolState?.content) throw new Error('No pool state');
    const fields = (poolState.content as any).fields;
    const fee = parseInt(fields.performance_fee_bps || '0');
    if (fee !== 2000) throw new Error(`Expected 2000 bps, got ${fee}`);
    return `${fee} bps`;
  });
}

// =============================================================================
// 4. BLUEFIN INTEGRATION
// =============================================================================
async function testBluefinIntegration() {
  console.log('\n' + '═'.repeat(60));
  console.log('   4. BLUEFIN INTEGRATION');
  console.log('═'.repeat(60));

  // Test BlueFin private key is set
  await runTest('BlueFin: Private key configured', async () => {
    const key = process.env.BLUEFIN_PRIVATE_KEY;
    if (!key) throw new Error('BLUEFIN_PRIVATE_KEY not set');
    if (key.length < 60) throw new Error('Key too short');
    return 'Set (hidden)';
  });

  // Test BlueFin service can be imported
  await runTest('BlueFin: Service import', async () => {
    const { BluefinService } = await import('../lib/services/BluefinService');
    if (!BluefinService) throw new Error('BluefinService not found');
    return 'Imported';
  });

  // Test BlueFin service initialization
  await runTest('BlueFin: Service initialization', async () => {
    const { BluefinService } = await import('../lib/services/BluefinService');
    const service = BluefinService.getInstance();
    const privateKey = process.env.BLUEFIN_PRIVATE_KEY;
    if (!privateKey) throw new Error('BLUEFIN_PRIVATE_KEY not set');
    await service.initialize(privateKey, 'testnet');
    return 'Initialized';
  });

  // Test BlueFin can get market data (crucial test)
  await runTest('BlueFin: Market data fetch (BTC-PERP)', async () => {
    const { BluefinService } = await import('../lib/services/BluefinService');
    const service = BluefinService.getInstance();
    
    // Get BTC market data
    const marketData = await service.getMarketData('BTC-PERP');
    if (!marketData) throw new Error('No market data returned for BTC-PERP');
    if (!marketData.price || marketData.price <= 0) throw new Error('Invalid BTC price');
    
    return `BTC-PERP: $${marketData.price.toLocaleString()}`;
  });

  // Test account balance (needs funded account for real trading)
  await runTest('BlueFin: Account accessible', async () => {
    const { BluefinService } = await import('../lib/services/BluefinService');
    const service = BluefinService.getInstance();
    
    try {
      const balance = await service.getBalance();
      return `Balance: ${balance} USDC`;
    } catch (e: any) {
      // Account might not be funded but this is a warning, not failure
      if (e.message?.includes('not found') || e.message?.includes('404') || e.message?.includes('not onboarded')) {
        throw new Error('Account not onboarded on BlueFin testnet');
      }
      throw e;
    }
  });
}

// =============================================================================
// 5. API ENDPOINTS
// =============================================================================
async function testApiEndpoints() {
  console.log('\n' + '═'.repeat(60));
  console.log('   5. API ENDPOINTS (checking for static/mock data)');
  console.log('═'.repeat(60));

  const baseUrl = 'http://localhost:3000';

  // Helper to fetch and parse JSON
  async function fetchApi(path: string): Promise<any> {
    const http = await import('http');
    return new Promise((resolve, reject) => {
      const req = http.get(`${baseUrl}${path}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => reject(new Error('Timeout')));
    });
  }

  // Test SUI pool endpoint
  await runTest('API: /api/sui/community-pool', async () => {
    const data = await fetchApi('/api/sui/community-pool');
    if (!data.success) throw new Error(data.error || 'Request failed');
    if (!data.data) throw new Error('No data returned');
    
    // Check for static data indicators
    const pool = data.data;
    if (pool.totalShares === '1000' || pool.totalShares === '100') {
      throw new Error('STATIC DATA DETECTED: totalShares is round number');
    }
    
    return { shares: pool.totalShares, nav: pool.totalNAV };
  });

  // Test treasury info
  await runTest('API: /api/sui/community-pool?action=treasury-info', async () => {
    const data = await fetchApi('/api/sui/community-pool?action=treasury-info');
    if (!data.success) throw new Error(data.error || 'Request failed');
    
    const treasury = data.data;
    if (treasury.performanceFeeBps !== 2000) {
      throw new Error(`Expected 2000 bps, got ${treasury.performanceFeeBps}`);
    }
    if (!treasury.msafeConfigured) {
      throw new Error('MSafe not configured');
    }
    
    return { fee: treasury.performanceFeeBps, msafe: treasury.msafeConfigured };
  });

  // Test allocation endpoint
  await runTest('API: /api/sui/community-pool?action=allocation', async () => {
    const data = await fetchApi('/api/sui/community-pool?action=allocation');
    if (!data.success) throw new Error(data.error || 'Request failed');
    
    const allocation = data.data;
    // Check it has real asset data
    if (!allocation.assets || allocation.assets.length === 0) {
      throw new Error('No allocation data');
    }
    
    return { assetCount: allocation.assets.length };
  });

  // Test health endpoint
  await runTest('API: /api/health', async () => {
    const data = await fetchApi('/api/health');
    if (data.status !== 'ok' && data.status !== 'healthy') {
      throw new Error(`Unhealthy: ${JSON.stringify(data)}`);
    }
    return data.status;
  });

  // Test prices endpoint (check for real prices, not static)
  await runTest('API: /api/prices (real data check)', async () => {
    const data = await fetchApi('/api/prices?symbols=BTC,ETH,SUI');
    if (!data.success) throw new Error(data.error || 'Request failed');
    if (!data.data || data.data.length === 0) throw new Error('No prices returned');
    
    // Check BTC price is reasonable (not 0, not static 50000)
    const btcData = data.data.find((p: any) => p.symbol === 'BTC' || p.symbol === 'BTCUSD');
    if (!btcData) throw new Error('BTC price not found');
    
    const price = btcData.price;
    if (price === 50000 || price === 100000 || price === 0) {
      throw new Error(`STATIC PRICE DETECTED: BTC=${price}`);
    }
    
    return `BTC: $${price.toLocaleString()}`;
  });
}

// =============================================================================
// 6. CRON JOB SIMULATION
// =============================================================================
async function testCronJob() {
  console.log('\n' + '═'.repeat(60));
  console.log('   6. CRON / QSTASH CONFIGURATION');
  console.log('═'.repeat(60));

  // QStash is the primary auth method
  const qstashCurrentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const qstashNextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  const qstashToken = process.env.QSTASH_TOKEN;
  const cronSecret = process.env.CRON_SECRET;

  await runTest('QStash: Signing keys configured', async () => {
    if (!qstashCurrentKey || !qstashNextKey) {
      // Not a failure - might be using CRON_SECRET for dev
      if (cronSecret) {
        return 'Using CRON_SECRET fallback (dev mode)';
      }
      throw new Error('Neither QStash keys nor CRON_SECRET configured');
    }
    return 'QStash signing keys configured';
  });

  await runTest('QStash: API token configured', async () => {
    if (!qstashToken) {
      return 'Not set (optional for receive-only)';
    }
    return 'Configured';
  });

  // Test cron endpoint directly (uses CRON_SECRET for local dev, QStash signature in production)
  await runTest('Cron: SUI pool rebalance trigger (local auth)', async () => {
    if (!cronSecret) {
      throw new Error('CRON_SECRET not set for local testing');
    }
    
    const http = await import('http');
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/cron/sui-community-pool',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cronSecret}`
        }
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode !== 200) {
              throw new Error(`Status ${res.statusCode}: ${json.error || data}`);
            }
            resolve(json);
          } catch (e: any) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(30000, () => reject(new Error('Timeout')));
      req.end();
    });
  });
}

// =============================================================================
// 7. AUTO-HEDGE FLOW
// =============================================================================
async function testAutoHedge() {
  console.log('\n' + '═'.repeat(60));
  console.log('   7. AUTO-HEDGE SYSTEM');
  console.log('═'.repeat(60));

  // Test auto-hedge storage
  await runTest('AutoHedge: Storage module', async () => {
    const { getAutoHedgeConfigs } = await import('../lib/storage/auto-hedge-storage');
    const configs = await getAutoHedgeConfigs();
    if (!configs || configs.length === 0) throw new Error('No configs');
    return `${configs.length} configs`;
  });

  // Test SUI pool config
  await runTest('AutoHedge: SUI pool config exists', async () => {
    const { getAutoHedgeConfigs } = await import('../lib/storage/auto-hedge-storage');
    const { SUI_COMMUNITY_POOL_PORTFOLIO_ID } = await import('../lib/constants');
    
    const configs = await getAutoHedgeConfigs();
    const suiConfig = configs.find(c => c.portfolioId === SUI_COMMUNITY_POOL_PORTFOLIO_ID);
    
    if (!suiConfig) throw new Error('SUI config not found');
    if (!suiConfig.enabled) throw new Error('SUI config disabled');
    
    return {
      threshold: suiConfig.riskThreshold,
      leverage: suiConfig.maxLeverage,
      assets: suiConfig.allowedAssets
    };
  });

  // Test risk calculation can run
  await runTest('AutoHedge: Risk calculation', async () => {
    // Use API to get allocation
    const http = await import('http');
    const allocation = await new Promise<any>((resolve, reject) => {
      const req = http.get('http://localhost:3000/api/sui/community-pool?action=allocation', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.data || json);
          } catch {
            reject(new Error('Invalid JSON'));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => reject(new Error('Timeout')));
    });
    
    if (!allocation || !allocation.assets) throw new Error('No allocation data');
    
    // Calculate a simple risk score based on deviation from target
    const riskScores = allocation.assets.map((a: any) => {
      const deviation = Math.abs((a.weight || 0) - (a.targetWeight || 25));
      return deviation / 25; // Normalized
    });
    
    const avgRisk = riskScores.reduce((sum: number, r: number) => sum + r, 0) / riskScores.length;
    const riskScore = Math.round(avgRisk * 10); // 0-10 scale
    
    return `Risk Score: ${riskScore}/10`;
  });
}

// =============================================================================
// 8. STATIC DATA DETECTION
// =============================================================================
async function detectStaticData() {
  console.log('\n' + '═'.repeat(60));
  console.log('   8. STATIC/MOCK DATA DETECTION');
  console.log('═'.repeat(60));

  // Check SUI service for hardcoded values
  await runTest('Static Check: SUI service', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('./lib/services/SuiCommunityPoolService.ts', 'utf-8');
    
    // Check for obvious static patterns (but allow sensible defaults like sharePrice: 1.0)
    const staticPatterns = [
      { pattern: /totalShares:\s*['"]?1000['"]?/, desc: 'hardcoded totalShares=1000' },
      { pattern: /return\s*{\s*success:\s*true,\s*totalShares:\s*['"]?\d{4,}['"]?/, desc: 'static response with large totalShares' },
      { pattern: /MOCK_DATA|useMockData|STATIC_DATA/, desc: 'mock/static flags' },
      { pattern: /["']fake["']|["']dummy["']|["']test-data["']/i, desc: 'fake/dummy data strings' }
    ];
    
    for (const { pattern, desc } of staticPatterns) {
      if (pattern.test(content)) {
        throw new Error(`Static pattern found: ${desc}`);
      }
    }
    
    return 'No static data patterns';
  });

  // Check API routes for static responses
  await runTest('Static Check: API routes', async () => {
    const fs = await import('fs');
    const path = await import('path');
    
    const routeFile = './app/api/sui/community-pool/route.ts';
    const content = fs.readFileSync(routeFile, 'utf-8');
    
    // Check for static return statements
    if (/return\s*NextResponse\.json\(\{\s*totalShares:\s*['"]?\d+/.test(content)) {
      throw new Error('Static response in API route');
    }
    
    // Check for mock flags
    if (/useMock\s*=\s*true|MOCK_MODE|isMocking/.test(content)) {
      throw new Error('Mock mode detected');
    }
    
    return 'No static responses';
  });

  // Check environment for dev/mock flags
  await runTest('Static Check: Environment', async () => {
    const mockVars = [
      'USE_MOCK_DATA',
      'MOCK_MODE',
      'STATIC_DATA',
      'SKIP_BLOCKCHAIN'
    ];
    
    for (const varName of mockVars) {
      if (process.env[varName] === 'true' || process.env[varName] === '1') {
        throw new Error(`${varName} is enabled`);
      }
    }
    
    return 'No mock flags';
  });
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  console.log('\n');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' '.repeat(10) + 'COMPREHENSIVE PLATFORM TEST' + ' '.repeat(11) + '║');
  console.log('║' + ' '.repeat(15) + 'Chronos-Vanguard' + ' '.repeat(17) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');
  console.log('\n' + new Date().toISOString());

  const startTime = Date.now();

  try {
    await testEnvironmentVariables();
    await testDatabase();
    await testSuiBlockchain();
    await testBluefinIntegration();
    await testApiEndpoints();
    await testCronJob();
    await testAutoHedge();
    await detectStaticData();
  } catch (error: any) {
    console.error('\n💥 FATAL ERROR:', error.message);
  }

  const duration = Date.now() - startTime;

  // Print summary
  console.log('\n');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' '.repeat(20) + 'TEST SUMMARY' + ' '.repeat(20) + '║');
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log(`║  ✅ Passed:   ${String(totalPassed).padStart(3)}` + ' '.repeat(40) + '║');
  console.log(`║  ❌ Failed:   ${String(totalFailed).padStart(3)}` + ' '.repeat(40) + '║');
  console.log(`║  ⚠️  Warnings: ${String(totalWarnings).padStart(3)}` + ' '.repeat(40) + '║');
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log(`║  Duration: ${(duration / 1000).toFixed(1)}s` + ' '.repeat(42) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');

  // Print failed tests
  if (totalFailed > 0) {
    console.log('\n❌ FAILED TESTS:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`   • ${r.name}: ${r.details}`);
    }
  }

  // Exit code
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(console.error);
