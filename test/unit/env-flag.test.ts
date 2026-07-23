/**
 * Contract lock for envFlag — this whole helper exists BECAUSE
 * e6a80411 fixed two sites that silently accepted only '1' or only
 * 'true'. If someone ever "simplifies" this back to strict equality,
 * we're straight back to the same silent-fail class.
 */
import { describe, it, expect } from '@jest/globals';
import { envFlag } from '@/lib/utils/env-flag';

const src = (v?: string) => ({ FLAG: v as string }) as unknown as NodeJS.ProcessEnv;

describe('envFlag — accepts common truthy shapes, rejects everything else', () => {
  it.each(['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON', ' 1 ', ' true '])(
    'truthy: %s',
    (v) => expect(envFlag('FLAG', src(v))).toBe(true),
  );
  it.each(['0', 'false', 'no', 'off', 'FALSE', '', ' ', 'garbage', '2', 'null'])(
    'falsy: %s',
    (v) => expect(envFlag('FLAG', src(v))).toBe(false),
  );
  it('returns false when key is unset', () => {
    expect(envFlag('FLAG', {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
