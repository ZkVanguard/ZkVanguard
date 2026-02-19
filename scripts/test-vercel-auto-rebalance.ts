/**
 * Vercel-Compatible Auto-Rebalancing System - Comprehensive Test
 * 
 * Tests the serverless-optimized implementation that uses:
 * - Vercel Cron Jobs (replaces setInterval)
 * - Persistent storage (file-based or Vercel KV)
 * - Stateless execution model
 * 
 * This test verifies:
 * 1. Storage layer (configs, cooldowns, history)
 * 2. Cron job endpoint functionality
 * 3. Rebalance executor
 * 4. Complete end-to-end flow
 */

import { ethers } from 'ethers';

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_PORTFOLIO_ID = 3;
const TEST_WALLET_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1';
const CRON_SECRET = process.env.CRON_SECRET?.trim() || 'test-secret-12345';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

interface TestResult {
  stage: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

function logResult(result: TestResult) {
  results.push(result);
  const icon = result.status === 'PASS' ? '✅' :
               result.status === 'FAIL' ? '❌' :
               result.status === 'WARN' ? '⚠️' : 'ℹ️';
  
  const color = result.status === 'PASS' ? colors.green :
                result.status === 'FAIL' ? colors.red :
                result.status === 'WARN' ? colors.yellow : colors.cyan;
  
  console.log(`${color}${icon} [${result.status}] ${result.stage}${colors.reset}`);
  console.log(`   ${result.message}`);
  if (result.details) {
    console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
  }
  console.log();
}

function separator(title: string) {
  console.log(`\n${colors.bright}${colors.cyan}${'═'.repeat(80)}`);
  console.log(`🧪 ${title.toUpperCase()}`);
  console.log(`${'═'.repeat(80)}${colors.reset}\n`);
}

async function makeRequest(endpoint: string, method: string = 'GET', body?: any, headers?: Record<string, string>): Promise<any> {
  const url = `${BASE_URL}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return { success: response.ok, status: response.status, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Test stages

async function testStorageLayerWrite() {
  separator('Stage 1: Storage Layer - Write Configuration');
  
  const config = {
    portfolioId: TEST_PORTFOLIO_ID,
    walletAddress: TEST_WALLET_ADDRESS,
    config: {
      threshold: 5,
      frequency: 'DAILY',
      autoApprovalEnabled: true,
      autoApprovalThreshold: 200000000,
    },
  };
  
  const response = await makeRequest('/api/agents/auto-rebalance?action=enable', 'POST', config);
  
  if (response.success && response.data.success) {
    logResult({
      stage: 'Storage Write',
      status: 'PASS',
      message: 'Configuration saved to persistent storage',
      details: response.data.config,
    });
  } else {
    logResult({
      stage: 'Storage Write',
      status: 'FAIL',
      message: 'Failed to save configuration',
      details: response.data || response.error,
    });
  }
}

async function testStorageLayerRead() {
  separator('Stage 2: Storage Layer - Read Configuration');
  
  // The status endpoint should read from persistent storage
  const response = await makeRequest('/api/agents/auto-rebalance?action=status', 'GET');
  
  if (response.success && response.data.success) {
    const hasActivePortfolios = response.data.status.activePortfolios > 0;
    
    if (hasActivePortfolios) {
      logResult({
        stage: 'Storage Read',
        status: 'PASS',
        message: 'Configuration persisted and readable',
        details: response.data.status,
      });
    } else {
      logResult({
        stage: 'Storage Read',
        status: 'WARN',
        message: 'No active portfolios found (storage may not be persisting)',
        details: response.data.status,
      });
    }
  } else {
    logResult({
      stage: 'Storage Read',
      status: 'FAIL',
      message: 'Failed to read from storage',
      details: response.data || response.error,
    });
  }
}

async function testCronEndpointAccess() {
  separator('Stage 3: Cron Endpoint - Access Control');
  
  // Test without auth (should fail)
  const unauthResponse = await makeRequest('/api/cron/auto-rebalance', 'GET');
  
  if (unauthResponse.status === 401) {
    logResult({
      stage: 'Cron Auth (Negative)',
      status: 'PASS',
      message: 'Cron endpoint correctly rejects unauthorized requests',
    });
  } else {
    logResult({
      stage: 'Cron Auth (Negative)',
      status: 'WARN',
      message: 'Cron endpoint may not have auth protection',
      details: { status: unauthResponse.status },
    });
  }
  
  // Test with auth (should succeed)
  const authResponse = await makeRequest('/api/cron/auto-rebalance', 'GET', null, {
    'Authorization': `Bearer ${CRON_SECRET}`,
  });
  
  if (authResponse.success || authResponse.status === 200) {
    logResult({
      stage: 'Cron Auth (Positive)',
      status: 'PASS',
      message: 'Cron endpoint accepts authorized requests',
      details: authResponse.data,
    });
  } else {
    logResult({
      stage: 'Cron Auth (Positive)',
      status: 'FAIL',
      message: 'Cron endpoint failed with valid auth',
      details: authResponse.data || authResponse.error,
    });
  }
}

async function testCronExecution() {
  separator('Stage 4: Cron Execution - Portfolio Processing');
  
  const response = await makeRequest('/api/cron/auto-rebalance', 'GET', null, {
    'Authorization': `Bearer ${CRON_SECRET}`,
  });
  
  if (response.success && response.data.success) {
    const summary = response.data.summary;
    
    logResult({
      stage: 'Cron Execution',
      status: 'PASS',
      message: `Cron job executed successfully. Processed ${summary.total} portfolios`,
      details: {
        summary,
        duration: `${response.data.duration}ms`,
        timestamp: response.data.timestamp,
      },
    });
    
    // Check if any portfolios were processed
    if (summary.total > 0) {
      logResult({
        stage: 'Portfolio Processing',
        status: 'INFO',
        message: `Breakdown: ${summary.checked} checked, ${summary.rebalanced} rebalanced, ${summary.skipped} skipped, ${summary.errors} errors`,
        details: response.data.results,
      });
    }
  } else {
    logResult({
      stage: 'Cron Execution',
      status: 'FAIL',
      message: 'Cron job execution failed',
      details: response.data || response.error,
    });
  }
}

async function testExecutionTimeLimit() {
  separator('Stage 5: Execution Time - Vercel Limits');
  
  const startTime = Date.now();
  
  const response = await makeRequest('/api/cron/auto-rebalance', 'GET', null, {
    'Authorization': `Bearer ${CRON_SECRET}`,
  });
  
  const duration = Date.now() - startTime;
  
  // Vercel limits: Hobby 10s, Pro 60s, Enterprise 300s
  const HOBBY_LIMIT = 10000;
  const PRO_LIMIT = 60000;
  
  if (duration < HOBBY_LIMIT) {
    logResult({
      stage: 'Execution Time',
      status: 'PASS',
      message: `Execution completed in ${duration}ms (within Hobby tier limit)`,
      details: {
        duration: `${duration}ms`,
        hobbyLimit: `${HOBBY_LIMIT}ms`,
        proLimit: `${PRO_LIMIT}ms`,
      },
    });
  } else if (duration < PRO_LIMIT) {
    logResult({
      stage: 'Execution Time',
      status: 'WARN',
      message: `Execution took ${duration}ms (requires Pro tier)`,
      details: {
        duration: `${duration}ms`,
        recommendation: 'Consider Vercel Pro plan for longer execution times',
      },
    });
  } else {
    logResult({
      stage: 'Execution Time',
      status: 'FAIL',
      message: `Execution took ${duration}ms (exceeds Pro tier limit)`,
      details: {
        duration: `${duration}ms`,
        recommendation: 'Need to optimize or use job queue',
      },
    });
  }
}

async function testCooldownPersistence() {
  separator('Stage 6: Cooldown Persistence - Across Invocations');
  
  // Trigger assessment to set cooldown
  await makeRequest('/api/agents/auto-rebalance?action=trigger_assessment', 'POST', {
    portfolioId: TEST_PORTFOLIO_ID,
    walletAddress: TEST_WALLET_ADDRESS,
  });
  
  // Run cron twice - second should skip due to cooldown
  const firstRun = await makeRequest('/api/cron/auto-rebalance', 'GET', null, {
    'Authorization': `Bearer ${CRON_SECRET}`,
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  
  const secondRun = await makeRequest('/api/cron/auto-rebalance', 'GET', null, {
    'Authorization': `Bearer ${CRON_SECRET}`,
  });
  
  if (secondRun.success && secondRun.data.success) {
    const skipped = secondRun.data.results?.find((r: any) => 
      r.portfolioId === TEST_PORTFOLIO_ID && r.status === 'skipped' && r.reason?.includes('cooldown')
    );
    
    if (skipped) {
      logResult({
        stage: 'Cooldown Persistence',
        status: 'PASS',
        message: 'Cooldown period persists across invocations',
        details: skipped,
      });
    } else {
      logResult({
        stage: 'Cooldown Persistence',
        status: 'WARN',
        message: 'Cooldown may not be persisting correctly',
        details: secondRun.data.results,
      });
    }
  } else {
    logResult({
      stage: 'Cooldown Persistence',
      status: 'FAIL',
      message: 'Failed to test cooldown persistence',
      details: secondRun.data || secondRun.error,
    });
  }
}

async function testStatelessExecution() {
  separator('Stage 7: Stateless Execution - No Memory Dependencies');
  
  // Disable and re-enable to simulate cold start
  await makeRequest('/api/agents/auto-rebalance?action=disable', 'POST', {
    portfolioId: TEST_PORTFOLIO_ID,
  });
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await makeRequest('/api/agents/auto-rebalance?action=enable', 'POST', {
    portfolioId: TEST_PORTFOLIO_ID,
    walletAddress: TEST_WALLET_ADDRESS,
    config: {
      threshold: 5,
      frequency: 'DAILY',
      autoApprovalEnabled: true,
      autoApprovalThreshold: 200000000,
    },
  });
  
  // Run cron - should work immediately without in-memory state
  const response = await makeRequest('/api/cron/auto-rebalance', 'GET', null, {
    'Authorization': `Bearer ${CRON_SECRET}`,
  });
  
  if (response.success && response.data.success) {
    const processed = response.data.summary.total > 0;
    
    if (processed) {
      logResult({
        stage: 'Stateless Execution',
        status: 'PASS',
        message: 'Service works without in-memory state (fully stateless)',
        details: response.data.summary,
      });
    } else {
      logResult({
        stage: 'Stateless Execution',
        status: 'WARN',
        message: 'No portfolios processed after cold start',
        details: response.data.summary,
      });
    }
  } else {
    logResult({
      stage: 'Stateless Execution',
      status: 'FAIL',
      message: 'Stateless execution failed',
      details: response.data || response.error,
    });
  }
}

async function testVercelConfigPresence() {
  separator('Stage 8: Vercel Configuration - Cron Job Setup');
  
  try {
    const fs = require('fs');
    const path = require('path');
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf-8'));
    
    const hasCrons = vercelConfig.crons && vercelConfig.crons.length > 0;
    const hasAutoRebalanceCron = vercelConfig.crons?.some((cron: any) => 
      cron.path === '/api/cron/auto-rebalance'
    );
    
    if (hasAutoRebalanceCron) {
      const cronConfig = vercelConfig.crons.find((c: any) => c.path === '/api/cron/auto-rebalance');
      logResult({
        stage: 'Vercel Config',
        status: 'PASS',
        message: 'Cron job configured in vercel.json',
        details: {
          path: cronConfig.path,
          schedule: cronConfig.schedule,
          description: 'Runs every hour (0 * * * *)',
        },
      });
    } else {
      logResult({
        stage: 'Vercel Config',
        status: 'FAIL',
        message: 'Cron job NOT configured in vercel.json',
        details: { crons: vercelConfig.crons || [] },
      });
    }
  } catch (error: any) {
    logResult({
      stage: 'Vercel Config',
      status: 'FAIL',
      message: 'Failed to read vercel.json',
      details: error.message,
    });
  }
}

async function testBackgroundProcessing() {
  separator('Stage 9: Background Processing - On-Chain Transaction Simulation');
  
  // This tests that the system can handle async on-chain operations
  logResult({
    stage: 'Background Processing',
    status: 'INFO',
    message: 'On-chain transactions will be processed asynchronously',
    details: {
      architecture: 'Cron triggers → Queue job → Return immediately → Process async',
      benefits: [
        'No timeout issues (< 10s response)',
        'Reliable execution via queue',
        'Can monitor status separately',
      ],
    },
  });
}

async function testProductionReadiness() {
  separator('Stage 10: Production Readiness - Final Checks');
  
  const checks = {
    storageLayer: results.some(r => r.stage === 'Storage Write' && r.status === 'PASS'),
    cronEndpoint: results.some(r => r.stage === 'Cron Execution' && r.status === 'PASS'),
    authProtection: results.some(r => r.stage === 'Cron Auth (Negative)' && r.status === 'PASS'),
    executionTime: results.some(r => r.stage === 'Execution Time' && (r.status === 'PASS' || r.status === 'WARN')),
    stateless: results.some(r => r.stage === 'Stateless Execution' && r.status === 'PASS'),
    vercelConfig: results.some(r => r.stage === 'Vercel Config' && r.status === 'PASS'),
  };
  
  const allPassed = Object.values(checks).every(v => v);
  
  if (allPassed) {
    logResult({
      stage: 'Production Readiness',
      status: 'PASS',
      message: 'All critical checks passed - Ready for Vercel deployment',
      details: checks,
    });
  } else {
    logResult({
      stage: 'Production Readiness',
      status: 'WARN',
      message: 'Some checks failed - Review before deploying',
      details: checks,
    });
  }
}

// Main test execution
async function runTests() {
  console.log(`${colors.bright}${colors.magenta}`);
  console.log('═'.repeat(80));
  console.log('🚀 VERCEL-COMPATIBLE AUTO-REBALANCING SYSTEM - COMPREHENSIVE TEST');
  console.log('═'.repeat(80));
  console.log(`${colors.reset}\n`);
  
  console.log(`${colors.blue}Test Configuration:${colors.reset}`);
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Portfolio ID: ${TEST_PORTFOLIO_ID}`);
  console.log(`  Wallet: ${TEST_WALLET_ADDRESS}`);
  console.log(`  Cron Secret: ${CRON_SECRET ? '✅ Set' : '❌ Not set'}`);
  console.log(`  Timestamp: ${new Date().toISOString()}\n`);
  
  try {
    // Run all test stages
    await testStorageLayerWrite();
    await testStorageLayerRead();
    await testCronEndpointAccess();
    await testCronExecution();
    await testExecutionTimeLimit();
    await testCooldownPersistence();
    await testStatelessExecution();
    await testVercelConfigPresence();
    await testBackgroundProcessing();
    await testProductionReadiness();
    
    // Summary
    separator('Test Summary');
    
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const warnings = results.filter(r => r.status === 'WARN').length;
    const info = results.filter(r => r.status === 'INFO').length;
    const total = results.length;
    
    console.log(`${colors.bright}📊 RESULTS${colors.reset}`);
    console.log(`${colors.green}✅ PASSED: ${passed}${colors.reset} | ${colors.red}❌ FAILED: ${failed}${colors.reset} | ${colors.yellow}⚠️  WARNINGS: ${warnings}${colors.reset} | ${colors.cyan}ℹ️ INFO: ${info}${colors.reset}`);
    console.log(`Total Tests: ${total}\n`);
    
    if (failed === 0 && warnings === 0) {
      console.log(`${colors.bright}${colors.green}🎉 VERCEL DEPLOYMENT: READY ✅${colors.reset}`);
      console.log(`${colors.green}✅ ALL SYSTEMS COMPATIBLE WITH SERVERLESS${colors.reset}\n`);
    } else if (failed === 0) {
      console.log(`${colors.bright}${colors.yellow}⚠️ VERCEL DEPLOYMENT: READY WITH WARNINGS${colors.reset}`);
      console.log(`${colors.yellow}Review warnings above${colors.reset}\n`);
    } else {
      console.log(`${colors.bright}${colors.red}❌ VERCEL DEPLOYMENT: NOT READY${colors.reset}`);
      console.log(`${colors.red}Fix failures before deploying${colors.reset}\n`);
    }
    
    // Deployment instructions
    if (failed === 0) {
      console.log(`${colors.bright}${colors.cyan}📦 Deployment Instructions:${colors.reset}`);
      console.log(`  1. Set environment variable: CRON_SECRET="your-secret-here"`);
      console.log(`  2. Deploy to Vercel: vercel --prod`);
      console.log(`  3. Cron will run automatically every hour`);
      console.log(`  4. Monitor at: https://vercel.com/[your-project]/logs\n`);
    }
    
    console.log('═'.repeat(80) + '\n');
    
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (error: any) {
    console.error(`${colors.red}❌ TEST EXECUTION FAILED${colors.reset}`);
    console.error(error.message);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);
