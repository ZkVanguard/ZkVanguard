/**
 * Sanitize `process.env` in place.
 *
 * Strips trailing `\r`, `\n`, `\t`, and matched surrounding single/double quotes
 * from every value. This is a no-op for already-clean values.
 *
 * Why: env values can pick up CRLF on Windows when uploaded via PowerShell
 * pipes (`echo $val | vercel env add ...`), copy-paste from documents, or
 * misconfigured CI pipelines. Trailing CRLF silently breaks string equality,
 * Bearer-token auth, address comparisons, and JSON parses.
 *
 * Idempotent. Safe to call multiple times.
 *
 * @returns Number of env vars that were modified.
 */
export function sanitizeProcessEnv(): number {
  if (typeof process === 'undefined' || !process.env) return 0;
  let changed = 0;
  for (const key of Object.keys(process.env)) {
    const raw = process.env[key];
    if (raw === undefined) continue;
    let v = raw;

    // Strip control whitespace (CR, LF, tabs, NBSP) anywhere
    if (/[\r\n\t\u00A0]/.test(v)) {
      v = v.replace(/[\r\n\t\u00A0]+/g, '');
    }

    // Strip a single matched pair of surrounding quotes
    if (v.length >= 2) {
      const first = v.charCodeAt(0);
      const last = v.charCodeAt(v.length - 1);
      // 34 = ", 39 = '
      if ((first === 34 || first === 39) && first === last) {
        v = v.slice(1, -1);
      }
    }

    // Trim ASCII whitespace
    const trimmed = v.replace(/^[\x20]+|[\x20]+$/g, '');
    if (trimmed !== raw) {
      process.env[key] = trimmed;
      changed++;
    }
  }
  return changed;
}
