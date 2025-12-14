#!/usr/bin/env node

/**
 * Sprint 2 Test Runner
 * Comprehensive test execution script for all Sprint 2 components
 */

const { spawn } = require('child_process');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command, args, description) {
  return new Promise((resolve, reject) => {
    log(`\n${'='.repeat(80)}`, 'cyan');
    log(`Running: ${description}`, 'bright');
    log(`Command: ${command} ${args.join(' ')}`, 'blue');
    log('='.repeat(80), 'cyan');

    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..'),
    });

    proc.on('close', (code) => {
      if (code === 0) {
        log(`✓ ${description} completed successfully`, 'green');
        resolve();
      } else {
        log(`✗ ${description} failed with code ${code}`, 'red');
        reject(new Error(`${description} failed`));
      }
    });

    proc.on('error', (error) => {
      log(`✗ ${description} error: ${error.message}`, 'red');
      reject(error);
    });
  });
}

async function runAllTests() {
  const startTime = Date.now();

  try {
    log('\n╔═══════════════════════════════════════════════════════════╗', 'bright');
    log('║      CHRONOS VANGUARD - SPRINT 2 TEST SUITE              ║', 'bright');
    log('╚═══════════════════════════════════════════════════════════╝\n', 'bright');

    const testSuites = [
      {
        command: 'npm',
        args: ['test', '--', 'test/agents/HedgingAgent.test.ts'],
        description: 'HedgingAgent Unit Tests',
      },
      {
        command: 'npm',
        args: ['test', '--', 'test/agents/SettlementAgent.test.ts'],
        description: 'SettlementAgent Unit Tests',
      },
      {
        command: 'npm',
        args: ['test', '--', 'test/agents/ReportingAgent.test.ts'],
        description: 'ReportingAgent Unit Tests',
      },
      {
        command: 'npm',
        args: ['test', '--', 'test/integration/e2e-workflow.test.ts'],
        description: 'End-to-End Integration Tests',
      },
      {
        command: 'npm',
        args: ['test', '--', 'test/integration/zk-stark.test.ts'],
        description: 'ZK-STARK Integration Tests',
      },
    ];

    const results = [];

    for (const suite of testSuites) {
      try {
        await runCommand(suite.command, suite.args, suite.description);
        results.push({ suite: suite.description, passed: true });
      } catch (error) {
        results.push({ suite: suite.description, passed: false, error });
      }
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;

    log('\n╔═══════════════════════════════════════════════════════════╗', 'bright');
    log('║                      TEST SUMMARY                         ║', 'bright');
    log('╚═══════════════════════════════════════════════════════════╝\n', 'bright');

    results.forEach(result => {
      const icon = result.passed ? '✓' : '✗';
      const color = result.passed ? 'green' : 'red';
      log(`  ${icon} ${result.suite}`, color);
    });

    log(`\n${'='.repeat(80)}`, 'cyan');
    log(`Total Duration: ${duration}s`, 'blue');
    log(`Passed: ${passedCount}/${testSuites.length}`, passedCount === testSuites.length ? 'green' : 'yellow');
    log(`Failed: ${failedCount}/${testSuites.length}`, failedCount === 0 ? 'green' : 'red');
    log('='.repeat(80), 'cyan');

    if (failedCount === 0) {
      log('\n🎉 All tests passed! Sprint 2 is ready for production.', 'green');
      process.exit(0);
    } else {
      log('\n⚠️  Some tests failed. Please review the errors above.', 'red');
      process.exit(1);
    }

  } catch (error) {
    log(`\n❌ Test suite execution failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  log('\nChronos Vanguard Sprint 2 Test Runner\n', 'bright');
  log('Usage: npm run test:sprint2 [options]\n', 'cyan');
  log('Options:', 'yellow');
  log('  --help, -h     Show this help message');
  log('  --coverage     Run tests with coverage report');
  log('  --watch        Run tests in watch mode');
  log('  --verbose      Show detailed test output');
  log('\nExamples:', 'yellow');
  log('  npm run test:sprint2');
  log('  npm run test:sprint2 -- --coverage');
  log('  npm run test:sprint2 -- --watch\n');
  process.exit(0);
}

if (args.includes('--coverage')) {
  log('\n📊 Running tests with coverage...', 'cyan');
  runCommand('npm', ['test', '--', '--coverage'], 'All Tests with Coverage')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else if (args.includes('--watch')) {
  log('\n👀 Running tests in watch mode...', 'cyan');
  runCommand('npm', ['test', '--', '--watch'], 'All Tests (Watch Mode)')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  // Run all test suites
  runAllTests();
}
