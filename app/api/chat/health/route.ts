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
  
  return NextResponse.json({
    status: 'operational',
    llmAvailable: isAvailable,
    provider: isAvailable ? provider : 'intelligent-fallback',
    ollama: isOllama,
    model: isOllama ? 'qwen2.5:7b' : 'gpt-4o',
    features: {
      streaming: true,
      contextManagement: true,
      multiAgent: true,
      localInference: isOllama,
    },
    timestamp: Date.now(),
  });
}
