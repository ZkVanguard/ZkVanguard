/**
 * SUI coin-type normalization utilities.
 *
 * Move addresses can be represented either as short-form (`0x2::sui::SUI`)
 * or padded 64-char (`0x000...002::sui::SUI`). Object comparisons — coin
 * matching, balance summation, allocation drift — depend on both forms
 * mapping to the same canonical string. This module centralizes that
 * normalization so any caller (route handlers, services, tests) uses
 * the same rules.
 */

/**
 * Return the canonical form of a fully-qualified SUI coin type.
 *   Input:  `0x2::sui::SUI` OR `0x000...002::sui::SUI`
 *   Output: `0x000...002::sui::SUI` (address zero-padded to 64 hex chars)
 *
 * Pure. Returns the input unchanged if it's not a valid 3-part type
 * (e.g. an empty string or arbitrary text passed by mistake).
 */
export function canonicalizeCoinType(t: string): string {
  if (!t) return t;
  const parts = t.split('::');
  if (parts.length !== 3) return t;
  let addr = parts[0].replace(/^0x/, '').toLowerCase();
  if (addr.length < 64) addr = addr.padStart(64, '0');
  return `0x${addr}::${parts[1]}::${parts[2]}`;
}
