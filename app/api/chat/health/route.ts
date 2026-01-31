/**
 * Chat Health Check API
 * Check if LLM service is available and operational
 */

import { NextResponse } from 'next/server';
import { llmProvider } from '@/lib/ai/llm-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Wait for LLM provider to initialize
  await llmProvider.waitForInit();
  
  const isAvailable = llmProvider.isAvailable();
  const provider = llmProvider.getActiveProvider();
  const isOllama = provider.includes('ollama');
  const isASI = provider.includes('asi');
  const isCryptocom = provider.includes('cryptocom');
  
  // Determine the model based on provider
  let model = 'intelligent-fallback';
  if (isOllama) {
    model = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
  } else if (isASI) {
    model = process.env.ASI_MODEL || 'asi1-mini';
  } else if (provider.includes('openai') || isCryptocom) {
    model = 'gpt-4o';
  } else if (provider.includes('anthropic')) {
    model = 'claude-3-haiku';
  }
  
  return NextResponse.json({
    status: 'operational',
    llmAvailable: isAvailable,
    provider: isAvailable ? provider : 'intelligent-fallback',
    ollama: isOllama,
    asi: isASI,
    cryptocom: isCryptocom,
    model,
    features: {
      streaming: true,
      contextManagement: true,
      multiAgent: true,
      localInference: isOllama,
      productionAI: isASI || provider.includes('openai') || provider.includes('anthropic'),
      cryptocomIntegration: isCryptocom,
    },
    timestamp: Date.now(),
  });
}
