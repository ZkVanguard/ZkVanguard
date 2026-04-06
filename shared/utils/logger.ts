/**
 * @fileoverview Shared logger — re-exports the canonical logger from lib/utils/logger.
 * Eliminates the winston dependency; all logging is now console-based and zero-alloc
 * for suppressed levels (production-optimized).
 *
 * All 21+ importers of `@shared/utils/logger` continue to work unchanged.
 * @module shared/utils/logger
 */

import { logger } from '../../lib/utils/logger';

export { logger };
export default logger;

// Stubs retained for API compatibility (no known importers)
export function createChildLogger(_context: Record<string, unknown>) {
  return logger;
}

export const agentLogger = logger;
export const contractLogger = logger;
export const integrationLogger = logger;
