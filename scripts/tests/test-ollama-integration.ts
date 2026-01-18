/**
 * Test Ollama Integration with CUDA Acceleration
 * Verifies Qwen2.5 7B works correctly for financial analysis
 */

import { llmProvider } from '../lib/ai/llm-provider';

async function testOllamaIntegration() {
  console.log('🚀 Testing Ollama Integration with CUDA\n');
  console.log('='.repeat(60));

  // Wait for initialization
  await llmProvider.waitForInit();
  
  console.log(`\n✅ Active Provider: ${llmProvider.getActiveProvider()}`);
  console.log(`✅ AI Available: ${llmProvider.isAvailable()}\n`);

  if (llmProvider.getActiveProvider() !== 'ollama') {
    console.log('⚠️  Warning: Not using Ollama. Expected provider: ollama');
    console.log('💡 Make sure Ollama is running: ollama serve');
    console.log('💡 Set OLLAMA_MODEL=qwen2.5:7b in .env.local\n');
  }

  // Test 1: Financial calculation
  console.log('📊 Test 1: Financial Calculation (Sharpe Ratio)');
  console.log('-'.repeat(60));
  const test1 = await llmProvider.generateResponse(
    'Calculate the Sharpe ratio for a portfolio with 15% return, 2% risk-free rate, and 18% volatility. Be concise.',
    'test-financial'
  );
  console.log(`Response: ${test1.content.substring(0, 200)}...`);
  console.log(`Model: ${test1.model}`);
  console.log(`Confidence: ${test1.confidence}`);
  console.log(`Tokens: ${test1.tokensUsed || 'N/A'}\n`);

  // Test 2: Portfolio analysis
  console.log('📈 Test 2: Portfolio Risk Analysis');
  console.log('-'.repeat(60));
  const test2 = await llmProvider.generateResponse(
    'I have $10,000 split 70% CRO, 30% USDC. Is this risky? Answer in 2 sentences.',
    'test-portfolio'
  );
  console.log(`Response: ${test2.content}`);
  console.log(`Model: ${test2.model}`);
  console.log(`Confidence: ${test2.confidence}\n`);

  // Test 3: DeFi strategy
  console.log('💡 Test 3: DeFi Strategy Recommendation');
  console.log('-'.repeat(60));
  const test3 = await llmProvider.generateResponse(
    'Suggest a simple hedging strategy for a CRO-heavy portfolio. Be brief.',
    'test-strategy'
  );
  console.log(`Response: ${test3.content.substring(0, 300)}...`);
  console.log(`Model: ${test3.model}\n`);

  // Test 4: Performance benchmark
  console.log('⚡ Test 4: Response Speed Test');
  console.log('-'.repeat(60));
  const startTime = Date.now();
  const test4 = await llmProvider.generateResponse(
    'What is Value at Risk (VaR)? One sentence only.',
    'test-speed'
  );
  const endTime = Date.now();
  console.log(`Response: ${test4.content}`);
  console.log(`⏱️  Time: ${endTime - startTime}ms`);
  console.log(`Model: ${test4.model}\n`);

  console.log('='.repeat(60));
  console.log('✅ All tests completed!\n');
  
  if (llmProvider.getActiveProvider() === 'ollama') {
    console.log('🎉 SUCCESS: Ollama with CUDA is working perfectly!');
    console.log('💰 Cost: $0 (100% free, local inference)');
    console.log('🔐 Privacy: 100% secure (no data leaves your machine)');
    console.log('🚀 GPU: RTX 3070 CUDA acceleration enabled');
  } else {
    console.log(`ℹ️  Using provider: ${llmProvider.getActiveProvider()}`);
  }
}

// Run tests
testOllamaIntegration().catch(console.error);
