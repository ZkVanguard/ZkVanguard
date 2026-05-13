/**
 * Cron Routes Root
 * 
 * This endpoint exists solely for e2e verification to test cron auth.
 * All actual cron jobs are in subdirectories.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/qstash';

export async function GET(request: NextRequest) {
  // Require cron auth
  const auth = await verifyCronRequest(request, 'CronAuthTest');
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({ message: 'Cron auth successful' });
}