/**
 * Next.js instrumentation hook.
 * Runs once on server cold start (Node + Edge runtimes).
 *
 * We use this as a single chokepoint to sanitize `process.env` so that
 * trailing CRLF, surrounding quotes, or stray whitespace from upstream
 * upload tooling can never reach business logic. Idempotent and safe.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { sanitizeProcessEnv } = await import('./lib/utils/sanitize-env');
    const changed = sanitizeProcessEnv();
    if (changed > 0) {
      // eslint-disable-next-line no-console
      console.log(`[instrumentation] Sanitized ${changed} env var(s) (stripped CRLF/quotes)`);
    }
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    const { sanitizeProcessEnv } = await import('./lib/utils/sanitize-env');
    sanitizeProcessEnv();
  }
}
