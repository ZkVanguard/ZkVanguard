/**
 * Env-var flag parser — one shape, everywhere.
 *
 * Root incident: e6a80411 fixed TWO env-gates (`COMMUNITY_POOL_AUTO_REBALANCE`,
 * `PERP_ROUTER_SHADOW`) that silently accepted only `'true'` OR only `'1'`
 * depending on the site — operator sets the value in the "wrong" shape,
 * feature stays quiet, no error surfaces. Silent-fail from convention drift.
 *
 * Rule: `envFlag(name)` accepts any of `1`, `true`, `yes`, `on` (case-
 * insensitive, whitespace-trimmed). Everything else — unset, empty
 * string, `0`, `false`, `no`, `off`, garbage — is falsy.
 *
 * Grep-migrate `(process.env.X ?? '') === '1'` → `envFlag('X')` at every
 * remaining site. Prevents next silent-fail from the same class.
 */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function envFlag(name: string, source: NodeJS.ProcessEnv = process.env): boolean {
  const raw = source[name];
  if (raw == null) return false;
  return TRUTHY.has(String(raw).trim().toLowerCase());
}
