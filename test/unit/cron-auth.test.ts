/**
 * Golden tests for the cron-auth decision boundary (lib/security/cron-auth.ts).
 * This guards money-moving cron routes; a regression here once left the
 * auto-hedge POST unauthenticated (6700b492). Both predicates must fail closed.
 */
import { describe, it, expect } from '@jest/globals';
import { cronSecretMatches, classifyUnauthedOutcome } from '@/lib/security/cron-auth';

describe('cronSecretMatches', () => {
  const SECRET = 's3cr3t-cron-value';

  it('accepts the exact Bearer <secret> header', () => {
    expect(cronSecretMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('rejects a wrong secret of the same length', () => {
    const wrong = 'X'.repeat(SECRET.length);
    expect(cronSecretMatches(`Bearer ${wrong}`, SECRET)).toBe(false);
  });

  it('rejects a header missing the Bearer prefix', () => {
    expect(cronSecretMatches(SECRET, SECRET)).toBe(false);
  });

  it('rejects different-length headers without throwing', () => {
    expect(cronSecretMatches(`Bearer ${SECRET}extra`, SECRET)).toBe(false);
    expect(cronSecretMatches('Bearer short', SECRET)).toBe(false);
  });

  it('returns false for any missing input (never throws)', () => {
    expect(cronSecretMatches(null, SECRET)).toBe(false);
    expect(cronSecretMatches(undefined, SECRET)).toBe(false);
    expect(cronSecretMatches(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(cronSecretMatches(`Bearer ${SECRET}`, null)).toBe(false);
    expect(cronSecretMatches('', '')).toBe(false);
  });
});

describe('classifyUnauthedOutcome', () => {
  it('allows only when no auth is configured AND in development', () => {
    expect(classifyUnauthedOutcome({ hasSignature: false, hasCronSecret: false, isDevelopment: true }))
      .toBe('allow-dev');
  });

  it('fails closed (misconfig) when no auth is configured in production', () => {
    expect(classifyUnauthedOutcome({ hasSignature: false, hasCronSecret: false, isDevelopment: false }))
      .toBe('misconfig');
  });

  it('returns unauthorized when an auth method was present but did not validate', () => {
    // a secret is configured but the Bearer check already failed upstream
    expect(classifyUnauthedOutcome({ hasSignature: false, hasCronSecret: true, isDevelopment: false }))
      .toBe('unauthorized');
    expect(classifyUnauthedOutcome({ hasSignature: false, hasCronSecret: true, isDevelopment: true }))
      .toBe('unauthorized');
    // a signature was present but invalid → never falls through to dev-allow
    expect(classifyUnauthedOutcome({ hasSignature: true, hasCronSecret: false, isDevelopment: true }))
      .toBe('unauthorized');
    expect(classifyUnauthedOutcome({ hasSignature: true, hasCronSecret: true, isDevelopment: false }))
      .toBe('unauthorized');
  });

  it('never allows in production no matter the inputs', () => {
    const prod = (hasSignature: boolean, hasCronSecret: boolean) =>
      classifyUnauthedOutcome({ hasSignature, hasCronSecret, isDevelopment: false });
    expect([prod(false, false), prod(true, false), prod(false, true), prod(true, true)])
      .not.toContain('allow-dev');
  });
});
