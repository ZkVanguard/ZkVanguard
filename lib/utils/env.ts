/**
 * Centralized env-var helpers.
 *
 * All readers strip CRLF/quotes defensively, even though `instrumentation.ts`
 * already sanitizes `process.env` on boot. This belt-and-braces approach
 * means new code is safe even in non-Next contexts (scripts, tests, edge
 * runtimes that don't run instrumentation).
 *
 * Prefer these helpers over raw `process.env.X` for any new code.
 */

function clean(raw: string | undefined): string {
  if (!raw) return '';
  let v = raw.replace(/[\r\n\t\u00A0]+/g, '');
  if (v.length >= 2) {
    const f = v.charCodeAt(0);
    const l = v.charCodeAt(v.length - 1);
    if ((f === 34 || f === 39) && f === l) v = v.slice(1, -1);
  }
  return v.trim();
}

/** Read an env var with optional fallback. Returns '' if unset. */
export function env(name: string, fallback = ''): string {
  const v = clean(process.env[name]);
  return v || fallback;
}

/** Like env(), but throws if the var is unset/empty. */
export function requireEnv(name: string): string {
  const v = clean(process.env[name]);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Read a boolean env var. 'true','1','yes','on' (case-insensitive) → true. */
export function envBool(name: string, fallback = false): boolean {
  const v = clean(process.env[name]).toLowerCase();
  if (!v) return fallback;
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return fallback;
}

/** Read a numeric env var. Returns fallback for unset / NaN. */
export function envNum(name: string, fallback = 0): number {
  const v = clean(process.env[name]);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the first set var from a list of names (alias chain).
 * Useful for legacy/new env-var pairs.
 */
export function envFirst(names: string[], fallback = ''): string {
  for (const n of names) {
    const v = clean(process.env[n]);
    if (v) return v;
  }
  return fallback;
}
