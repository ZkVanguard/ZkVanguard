/**
 * Chat Health Check API
 * Check if LLM service is available and operational
 */

import { NextResponse } from 'next/server';
import { llmProvider } from '@/lib/ai/llm-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const isAvailable = llmProvider.isAvailable();
  
  return NextResponse.json({
    status: 'operational',
    llmAvailable: isAvailable,
    provider: isAvailable ? 'crypto.com-ai-sdk' : 'intelligent-fallback',
    features: {
      streaming: true,
      contextManagement: true,
      multiAgent: true,
    },
    timestamp: Date.now(),
  });
}
