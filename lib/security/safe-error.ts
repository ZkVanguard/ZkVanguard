/**
 * Safe Error Response Helper
 * 
 * Never leaks internal error details (stack traces, SQL errors, RPC endpoints)
 * to API consumers. Logs full details server-side only.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';

/**
 * Return a safe error response that never leaks internal details.
 * In production, only returns a generic message + error code.
 * In development, includes the actual error message for debugging.
 */
export function safeErrorResponse(
  error: unknown,
  context: string,
  statusCode: number = 500
): NextResponse {
  const message = error instanceof Error ? error.message : 'Unknown error';

  // Always log full details server-side
  logger.error(`[${context}] ${message}`, error instanceof Error ? error : undefined);

  // In production, never expose internal error details
  const isProduction = process.env.NODE_ENV === 'production';

  return NextResponse.json(
    {
      success: false,
      error: isProduction ? 'Internal server error' : message,
      ...(isProduction ? {} : { context }),
    },
    { status: statusCode }
  );
}
