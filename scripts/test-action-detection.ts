#!/usr/bin/env npx tsx
/**
 * Quick test for action detection logic
 */

import { parseActionIntent } from '../lib/services/portfolio-actions';

const testCases = [
  'Analyze my portfolio',
  'What are the risks of holding CRO tokens?',
  'What is DeFi?',
  'Show me my risk assessment',
  'How does hedging work?',
  'Buy 100 CRO',
];

console.log('Testing parseActionIntent:\n');

for (const test of testCases) {
  const result = parseActionIntent(test);
  console.log(`"${test}"`);
  console.log(`  -> ${result ? `ACTION: ${result.type}` : 'No action (LLM will respond)'}`);
  console.log();
}

// Now test the full logic
console.log('=' .repeat(50));
console.log('\nTesting full action bypass logic:\n');

const analysisActions = ['analyze', 'assess-risk', 'get-hedges'];
const portfolioContext = ''; // Empty - no portfolio data

for (const test of testCases) {
  let actionIntent = parseActionIntent(test);
  
  if (actionIntent) {
    const isAnalysisAction = analysisActions.includes(actionIntent.type);
    const hasPortfolioData = portfolioContext.length > 50 && portfolioContext.includes('Total Value');
    
    console.log(`"${test}"`);
    console.log(`  Action: ${actionIntent.type}`);
    console.log(`  isAnalysisAction: ${isAnalysisAction}`);
    console.log(`  hasPortfolioData: ${hasPortfolioData}`);
    
    if (isAnalysisAction && !hasPortfolioData) {
      console.log(`  ✅ BYPASS -> Qwen will respond intelligently`);
      actionIntent = null;
    } else {
      console.log(`  ❌ EXECUTE -> Action will run`);
    }
  } else {
    console.log(`"${test}"`);
    console.log(`  ✅ No action -> Qwen will respond`);
  }
  console.log();
}
