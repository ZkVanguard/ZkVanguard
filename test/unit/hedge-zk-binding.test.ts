/**
 * Golden tests for the ZK hedge-ownership binding (lib/db/hedges.ts pure crypto
 * helpers). These cryptographically bind a hedge to its owner wallet so funds
 * return to the owner even via a proxy — a security boundary worth locking.
 */
import { describe, it, expect } from '@jest/globals';
import {
  generateWalletBindingHash,
  generateOwnerCommitment,
  verifyZKOwnership,
} from '@/lib/db/hedges';

const W = '0xABCdef0000000000000000000000000000000001';
const HEDGE = 'order-123';

describe('generateWalletBindingHash', () => {
  it('is a deterministic 64-char hex sha256', () => {
    const h = generateWalletBindingHash(W, HEDGE);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(generateWalletBindingHash(W, HEDGE)).toBe(h); // deterministic
  });
  it('is case-insensitive on the wallet address', () => {
    expect(generateWalletBindingHash(W.toLowerCase(), HEDGE)).toBe(generateWalletBindingHash(W.toUpperCase(), HEDGE));
  });
  it('changes with hedgeId and with the secret', () => {
    expect(generateWalletBindingHash(W, 'other')).not.toBe(generateWalletBindingHash(W, HEDGE));
    expect(generateWalletBindingHash(W, HEDGE, 'sekret')).not.toBe(generateWalletBindingHash(W, HEDGE));
  });
});

describe('generateOwnerCommitment', () => {
  it('is deterministic, case-insensitive, and timestamp-bound', () => {
    expect(generateOwnerCommitment(W, 1000)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateOwnerCommitment(W.toUpperCase(), 1000)).toBe(generateOwnerCommitment(W.toLowerCase(), 1000));
    expect(generateOwnerCommitment(W, 2000)).not.toBe(generateOwnerCommitment(W, 1000));
  });
});

describe('verifyZKOwnership', () => {
  it('accepts a binding the owner can recompute', () => {
    const binding = generateWalletBindingHash(W, HEDGE);
    expect(verifyZKOwnership(W, HEDGE, binding)).toBe(true);
    expect(verifyZKOwnership(W.toUpperCase(), HEDGE, binding)).toBe(true); // case-insensitive
  });
  it('rejects a different wallet, hedge, binding, or secret', () => {
    const binding = generateWalletBindingHash(W, HEDGE, 'sekret');
    expect(verifyZKOwnership('0x0000000000000000000000000000000000000002', HEDGE, binding, 'sekret')).toBe(false);
    expect(verifyZKOwnership(W, 'other', binding, 'sekret')).toBe(false);
    expect(verifyZKOwnership(W, HEDGE, 'deadbeef', 'sekret')).toBe(false);
    expect(verifyZKOwnership(W, HEDGE, binding)).toBe(false); // missing secret → mismatch
  });
});
