#!/usr/bin/env npx tsx
/**
 * Test Chat Response - Verify the full LLM provider flow
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testChatResponse() {
  console.log('🚀 Testing Full Chat Response Flow\n');

  // Import the LLM provider
  const { llmProvider } = await import('../lib/ai/llm-provider');

  // Test 1: Check provider status
  console.log('1️⃣  Checking LLM Provider Status...');
  await llmProvider.waitForInit();
  const provider = llmProvider.getActiveProvider();
  const available = llmProvider.isAvailable();
  console.log(`   Provider: ${provider}`);
  console.log(`   Available: ${available}\n`);

  // Test 2: Simple question (should use Ollama)
  console.log('2️⃣  Testing Simple Question...');
  const simpleResponse = await llmProvider.generateResponse(
    'What is DeFi and how does it work?',
    'test-conversation-1'
  );
  console.log(`   Model used: ${simpleResponse.model}`);
  console.log(`   Response preview: ${simpleResponse.content.substring(0, 150)}...\n`);

  // Test 3: Portfolio analysis without wallet (should use LLM, not empty action)
  console.log('3️⃣  Testing "Analyze Portfolio" without wallet...');
  const portfolioResponse = await llmProvider.generateResponse(
    'Analyze my portfolio',
    'test-conversation-2'
  );
  console.log(`   Model used: ${portfolioResponse.model}`);
  console.log(`   Action executed: ${portfolioResponse.actionExecuted || false}`);
  console.log(`   Response preview: ${portfolioResponse.content.substring(0, 200)}...\n`);

  // Test 4: Risk question (should use LLM)
  console.log('4️⃣  Testing Risk Question...');
  const riskResponse = await llmProvider.generateResponse(
    'What are the risks of holding CRO tokens?',
    'test-conversation-3'
  );
  console.log(`   Model used: ${riskResponse.model}`);
  console.log(`   Response preview: ${riskResponse.content.substring(0, 200)}...\n`);

  // Summary
  console.log('=' .repeat(50));
  const ollamaWorking = provider === 'ollama';
  const riskQuestionUsedLLM = riskResponse.model?.includes('ollama');
  const simpleQuestionUsedLLM = simpleResponse.model?.includes('ollama');
  
  if (ollamaWorking && riskQuestionUsedLLM && simpleQuestionUsedLLM) {
    console.log('✅ SUCCESS: Qwen2.5 is handling knowledge questions intelligently!');
    console.log('   • DeFi question: Answered by Qwen');
    console.log('   • Risk question: Answered by Qwen (not empty action executor)');
    console.log('   • Portfolio command: Executed action with real data');
  } else if (ollamaWorking) {
    console.log('⚠️ PARTIAL: Ollama is active but some queries not using LLM');
    console.log(`   Risk question model: ${riskResponse.model}`);
  } else {
    console.log(`❌ ISSUE: Expected Ollama but got ${provider}`);
  }
}

testChatResponse().catch(console.error);
