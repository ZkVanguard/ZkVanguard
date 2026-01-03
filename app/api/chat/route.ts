/**
 * Chat API Route - LLM-powered conversational interface
 * Supports both standard and streaming responses
 */

import { NextRequest, NextResponse } from 'next/server';
import { llmProvider } from '@/lib/ai/llm-provider';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat
 * Generate LLM response for user message
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId = 'default', context, stream = false } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    // Handle streaming response
    if (stream) {
      const encoder = new TextEncoder();
      
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of llmProvider.streamResponse(message, conversationId, context)) {
              const data = JSON.stringify(chunk);
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            logger.error('Streaming error:', error);
            controller.error(error);
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Handle standard response
    const response = await llmProvider.generateResponse(message, conversationId, context);

    return NextResponse.json({
      success: true,
      response: response.content,
      metadata: {
        model: response.model,
        tokensUsed: response.tokensUsed,
        confidence: response.confidence,
        isRealAI: llmProvider.isAvailable(),
        actionExecuted: response.actionExecuted || false,
        actionResult: response.actionResult,
        zkProof: response.zkProof, // Include ZK proof in API response
      },
    });
  } catch (error) {
    logger.error('Chat API error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process chat request',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chat
 * Clear conversation history
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId') || 'default';

    llmProvider.clearHistory(conversationId);

    return NextResponse.json({
      success: true,
      message: 'Conversation history cleared',
    });
  } catch (error) {
    logger.error('Chat clear error:', error);
    return NextResponse.json(
      { error: 'Failed to clear conversation' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat/history
 * Get conversation history
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId') || 'default';

    const history = llmProvider.getHistory(conversationId);

    return NextResponse.json({
      success: true,
      history,
      count: history.length,
    });
  } catch (error) {
    logger.error('Chat history error:', error);
    return NextResponse.json(
      { error: 'Failed to get conversation history' },
      { status: 500 }
    );
  }
}
