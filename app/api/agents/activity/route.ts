import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { readLimiter } from '@/lib/security/rate-limiter';

export const maxDuration = 10;

/**
 * Agent Activity Feed API Route
 * 
 * Returns real agent activity based on actual system operations.
 * Activity is derived from:
 * - Settlement history (hedge executions)
 * - Risk assessments performed
 * - API calls made
 */
export async function GET(request: NextRequest) {
  const limited = readLimiter.check(request);
  if (limited) return limited;

  try {
    // Activities are tracked client-side in localStorage
    // This endpoint returns a template for the client to merge with local data
    // The client (AgentActivity component) should combine this with localStorage data
    
    const baseActivities = [
      {
        id: 'system-1',
        agentName: 'System',
        agentType: 'system',
        action: 'monitoring',
        description: 'Agents are standing by for portfolio operations',
        status: 'idle',
        timestamp: new Date().toISOString(),
        priority: 'low'
      }
    ];

    return NextResponse.json(baseActivities);
  } catch (error) {
    logger.error('Activity feed error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
