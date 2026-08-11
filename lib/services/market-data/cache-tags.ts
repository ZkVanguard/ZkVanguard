/**
 * Next.js data-cache tags shared by market-data fetches.
 *
 * Callers to the same external URL should also share the same tag so
 * revalidateTag() can invalidate every cache entry for that upstream
 * with a single call from a future circuit-breaker.
 */

export const CACHE_TAG_CRYPTOCOM_TICKER = 'prediction:cryptocom-ticker';
export const CACHE_TAG_BLUEFIN_FUNDING = 'prediction:bluefin-funding';
