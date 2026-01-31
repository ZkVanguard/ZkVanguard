/**
 * Debug route to diagnose chat API issues
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const debugInfo: any = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    env: {
      hasAsiKey: !!process.env.ASI_API_KEY,
      asiKeyLength: (process.env.ASI_API_KEY || '').trim().length,
      hasCryptocomKey: !!process.env.CRYPTOCOM_DEVELOPER_API_KEY,
      nodeEnv: process.env.NODE_ENV,
    },
    tests: {},
  };

  // Test 1: Can we import the llm-provider?
  try {
    const { llmProvider } = await import('@/lib/ai/llm-provider');
    debugInfo.tests.llmProviderImport = 'success';
    debugInfo.tests.llmProviderType = typeof llmProvider;
  } catch (e: any) {
    debugInfo.tests.llmProviderImport = `error: ${e.message}`;
    debugInfo.tests.llmProviderStack = e.stack?.split('\n').slice(0, 5);
  }

  // Test 2: Can we import logger?
  try {
    const { logger } = await import('@/lib/utils/logger');
    debugInfo.tests.loggerImport = 'success';
  } catch (e: any) {
    debugInfo.tests.loggerImport = `error: ${e.message}`;
  }

  // Test 3: Can we import portfolio-actions?
  try {
    const portfolioActions = await import('@/lib/services/portfolio-actions');
    debugInfo.tests.portfolioActionsImport = 'success';
    debugInfo.tests.portfolioActionsExports = Object.keys(portfolioActions);
  } catch (e: any) {
    debugInfo.tests.portfolioActionsImport = `error: ${e.message}`;
    debugInfo.tests.portfolioActionsStack = e.stack?.split('\n').slice(0, 5);
  }

  // Test 4: Can we import agent-orchestrator?
  try {
    const agentOrchestrator = await import('@/lib/services/agent-orchestrator');
    debugInfo.tests.agentOrchestratorImport = 'success';
  } catch (e: any) {
    debugInfo.tests.agentOrchestratorImport = `error: ${e.message}`;
    debugInfo.tests.agentOrchestratorStack = e.stack?.split('\n').slice(0, 5);
  }

  // Test 5: LLM Provider initialization
  try {
    const { llmProvider } = await import('@/lib/ai/llm-provider');
    await llmProvider.waitForInit();
    debugInfo.tests.llmInit = 'success';
    debugInfo.tests.llmAvailable = llmProvider.isAvailable();
    debugInfo.tests.llmProvider = llmProvider.getActiveProvider();
  } catch (e: any) {
    debugInfo.tests.llmInit = `error: ${e.message}`;
    debugInfo.tests.llmInitStack = e.stack?.split('\n').slice(0, 5);
  }

  // Test 6: Direct ASI API test
  const asiKey = (process.env.ASI_API_KEY || '').trim();
  if (asiKey) {
    try {
      const response = await fetch('https://api.asi1.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${asiKey}`,
        },
        body: JSON.stringify({
          model: 'asi1-mini',
          messages: [{ role: 'user', content: 'Say hi' }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok) {
        const data = await response.json();
        debugInfo.tests.asiDirect = 'success';
        debugInfo.tests.asiResponse = data.choices?.[0]?.message?.content;
      } else {
        debugInfo.tests.asiDirect = `error: ${response.status} ${response.statusText}`;
        const errorBody = await response.text().catch(() => 'no body');
        debugInfo.tests.asiErrorBody = errorBody.slice(0, 200);
      }
    } catch (e: any) {
      debugInfo.tests.asiDirect = `error: ${e.message}`;
    }
  } else {
    debugInfo.tests.asiDirect = 'skipped - no key';
  }

  return NextResponse.json(debugInfo, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function POST() {
  // Simple POST test
  try {
    const { llmProvider } = await import('@/lib/ai/llm-provider');
    await llmProvider.waitForInit();
    
    const response = await llmProvider.generateResponse('Hello, this is a test', 'debug-test');
    
    return NextResponse.json({
      success: true,
      response: response.content,
      model: response.model,
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e.message,
      stack: e.stack?.split('\n').slice(0, 10),
    }, { status: 500 });
  }
}
