/**
 * Golden tests for the safe error boundary (lib/security/safe-error.ts).
 * Locks the security guarantee: production responses never leak the real error
 * message / context (stack, SQL, RPC URLs); dev responses include detail.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { safeErrorResponse } from '@/lib/security/safe-error';

const realEnv = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = realEnv; });

describe('safeErrorResponse', () => {
  it('in production hides the real message + context', async () => {
    process.env.NODE_ENV = 'production';
    const res = safeErrorResponse(new Error('DB at postgres://user:secret@host'), 'NAV');
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('NAV');
  });

  it('in development surfaces the message + context for debugging', async () => {
    process.env.NODE_ENV = 'development';
    const res = safeErrorResponse(new Error('boom'), 'NAV');
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('boom');
    expect(body.context).toBe('NAV');
  });

  it('honors a custom status code', async () => {
    process.env.NODE_ENV = 'production';
    const res = safeErrorResponse(new Error('bad input'), 'deposit', 400);
    expect(res.status).toBe(400);
  });

  it('handles non-Error inputs', async () => {
    process.env.NODE_ENV = 'development';
    const res = safeErrorResponse('a string', 'ctx');
    const body = await res.json();
    expect(body.error).toBe('Unknown error');
  });
});
