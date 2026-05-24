/**
 * Golden tests for the shared error-handling primitives (lib/utils/error-handler.ts):
 * message/name extraction, sync/async wrappers (fallback vs rethrow), retrying
 * safeApiCall, validateRequired, and AppError.
 */
import { describe, it, expect } from '@jest/globals';
import {
  errMsg,
  errName,
  withErrorHandling,
  withErrorHandlingSync,
  safeApiCall,
  validateRequired,
  AppError,
} from '@/lib/utils/error-handler';

describe('errMsg / errName', () => {
  it('extracts from Error and stringifies non-Errors', () => {
    expect(errMsg(new Error('boom'))).toBe('boom');
    expect(errMsg('plain')).toBe('plain');
    expect(errMsg(42)).toBe('42');
    expect(errName(new TypeError('x'))).toBe('TypeError');
    expect(errName('nope')).toBe('Error');
  });
});

describe('withErrorHandlingSync', () => {
  it('returns the value on success', () => {
    expect(withErrorHandlingSync(() => 7, { context: 'c' })).toBe(7);
  });
  it('returns fallback on throw (default null)', () => {
    expect(withErrorHandlingSync(() => { throw new Error('x'); }, { context: 'c', logError: false })).toBeNull();
    expect(withErrorHandlingSync(() => { throw new Error('x'); }, { context: 'c', logError: false, fallbackValue: 'fb' })).toBe('fb');
  });
  it('rethrows when rethrow=true', () => {
    expect(() => withErrorHandlingSync(() => { throw new Error('x'); }, { context: 'c', logError: false, rethrow: true })).toThrow('x');
  });
});

describe('withErrorHandling (async)', () => {
  it('returns value / fallback / rethrows', async () => {
    await expect(withErrorHandling(async () => 9, { context: 'c' })).resolves.toBe(9);
    await expect(withErrorHandling(async () => { throw new Error('x'); }, { context: 'c', logError: false, fallbackValue: 'fb' })).resolves.toBe('fb');
    await expect(withErrorHandling(async () => { throw new Error('x'); }, { context: 'c', logError: false, rethrow: true })).rejects.toThrow('x');
  });
});

describe('safeApiCall', () => {
  it('returns on first success', async () => {
    let calls = 0;
    const r = await safeApiCall(async () => { calls++; return 'ok'; }, { context: 'c' });
    expect(r).toBe('ok');
    expect(calls).toBe(1);
  });
  it('retries then returns fallback', async () => {
    let calls = 0;
    const r = await safeApiCall(async () => { calls++; throw new Error('fail'); }, { context: 'c', maxRetries: 2, retryDelay: 0, fallbackValue: 'fb' });
    expect(r).toBe('fb');
    expect(calls).toBe(3); // initial + 2 retries
  });
  it('throws last error when no fallback', async () => {
    await expect(safeApiCall(async () => { throw new Error('boom'); }, { context: 'c', maxRetries: 0, retryDelay: 0 })).rejects.toThrow('boom');
  });
});

describe('validateRequired', () => {
  it('returns present values (including falsy non-nullish)', () => {
    expect(validateRequired(0, 'n')).toBe(0);
    expect(validateRequired('', 's')).toBe('');
    expect(validateRequired(false, 'b')).toBe(false);
  });
  it('throws on null/undefined', () => {
    expect(() => validateRequired(null, 'wallet')).toThrow(/wallet is required/);
    expect(() => validateRequired(undefined, 'amount')).toThrow(/amount is required/);
  });
});

describe('AppError', () => {
  it('carries code + context and is named', () => {
    const e = new AppError('nope', 'E_NOPE', { id: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('nope');
    expect(e.code).toBe('E_NOPE');
    expect(e.context).toEqual({ id: 1 });
    expect(e.name).toBe('AppError');
  });
});
