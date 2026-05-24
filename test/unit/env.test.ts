/**
 * Golden tests for the env-var helpers (lib/utils/env.ts).
 *
 * Locks the CRLF/quote-stripping that multiple past production bugs traced to
 * (Vercel env values carrying trailing \r\n). Pure functions; we drive them by
 * setting/clearing process.env around each case.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { env, requireEnv, envBool, envNum, envFirst } from '@/lib/utils/env';

const KEYS = ['__T_A', '__T_B', '__T_C'];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe('env', () => {
  it('returns "" / fallback when unset', () => {
    expect(env('__T_A')).toBe('');
    expect(env('__T_A', 'fallback')).toBe('fallback');
  });
  it('strips trailing CRLF (the classic Vercel trap)', () => {
    process.env.__T_A = 'mainnet\r\n';
    expect(env('__T_A')).toBe('mainnet');
  });
  it('strips surrounding double and single quotes', () => {
    process.env.__T_A = '"0xABC"';
    expect(env('__T_A')).toBe('0xABC');
    process.env.__T_B = "'suiprivkey1xyz'";
    expect(env('__T_B')).toBe('suiprivkey1xyz');
  });
  it('strips tabs / non-breaking spaces and trims', () => {
    process.env.__T_A = 'a\tb';
    expect(env('__T_A')).toBe('ab');
    process.env.__T_B = '  spaced  ';
    expect(env('__T_B')).toBe('spaced');
  });
});

describe('requireEnv', () => {
  it('returns the cleaned value', () => {
    process.env.__T_A = ' value \r\n';
    expect(requireEnv('__T_A')).toBe('value');
  });
  it('throws when unset/empty', () => {
    expect(() => requireEnv('__T_A')).toThrow(/Missing required env var: __T_A/);
    process.env.__T_A = '   ';
    expect(() => requireEnv('__T_A')).toThrow();
  });
});

describe('envBool', () => {
  it('parses truthy/falsey tokens case-insensitively', () => {
    for (const t of ['true', '1', 'yes', 'on', 'TRUE', 'On']) {
      process.env.__T_A = t;
      expect(envBool('__T_A')).toBe(true);
    }
    for (const f of ['false', '0', 'no', 'off', 'OFF']) {
      process.env.__T_A = f;
      expect(envBool('__T_A')).toBe(false);
    }
  });
  it('returns fallback for unset or unrecognized', () => {
    expect(envBool('__T_A')).toBe(false);
    expect(envBool('__T_A', true)).toBe(true);
    process.env.__T_A = 'maybe';
    expect(envBool('__T_A', true)).toBe(true);
  });
});

describe('envNum', () => {
  it('parses numbers, including CRLF-wrapped', () => {
    process.env.__T_A = '42';
    expect(envNum('__T_A')).toBe(42);
    process.env.__T_B = '  3.5\r\n';
    expect(envNum('__T_B')).toBe(3.5);
  });
  it('returns fallback for unset / NaN', () => {
    expect(envNum('__T_A', 7)).toBe(7);
    process.env.__T_A = 'abc';
    expect(envNum('__T_A', 7)).toBe(7);
  });
});

describe('envFirst', () => {
  it('returns the first set var in the alias chain', () => {
    process.env.__T_B = 'second';
    expect(envFirst(['__T_A', '__T_B', '__T_C'])).toBe('second');
  });
  it('cleans the chosen value and falls back when all unset', () => {
    process.env.__T_C = '"x"\r\n';
    expect(envFirst(['__T_A', '__T_C'])).toBe('x');
    expect(envFirst(['__T_A', '__T_B'], 'fb')).toBe('fb');
  });
});
