/**
 * ZK Proof Backend Health Check
 * Checks the Python CUDA-accelerated ZK-STARK backend
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ZK_BACKEND_URL = process.env.ZK_BACKEND_URL || 'http://localhost:8000';

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${ZK_BACKEND_URL}/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        status: 'healthy',
        backend: ZK_BACKEND_URL,
        cuda_available: data.cuda_available || false,
        cuda_enabled: data.cuda_enabled || false,
        system_info: data.system_info || {},
        timestamp: Date.now(),
      });
    }
    
    return NextResponse.json({
      status: 'unhealthy',
      backend: ZK_BACKEND_URL,
      error: `Backend returned ${res.status}`,
      timestamp: Date.now(),
    }, { status: 503 });
    
  } catch (error) {
    return NextResponse.json({
      status: 'unavailable',
      backend: ZK_BACKEND_URL,
      error: error instanceof Error ? error.message : 'Connection failed',
      timestamp: Date.now(),
    }, { status: 503 });
  }
}
