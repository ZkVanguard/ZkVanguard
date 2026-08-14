/**
 * Vercel project configuration.
 *
 * Migrated from vercel.json → vercel.ts on 2026-08-11 per the modern
 * Vercel recommendation (typed config + dynamic logic + env-var access).
 * See https://vercel.com/docs/project-configuration/vercel-ts
 */
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',

  // sin1 keeps the pool's serverless functions co-located with the
  // Aiven PG-17 primary in Bangalore (~50ms same-region vs ~250ms
  // cross-region). All capital-touching crons + reads benefit; the
  // 20-conn plan-wide DB limit makes locality especially important.
  regions: ['sin1'],

  installCommand: 'npm install --legacy-peer-deps',

  build: {
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      // Silence deprecation warnings from transitive web3 deps at build time.
      // Runtime deprecations still surface — this only affects the build log.
      NODE_OPTIONS: '--no-deprecation',
    },
  },

  // Security headers live in next.config.js's headers() block so they're
  // route-aware. Leaving this empty avoids duplication.
  headers: [],
};

export default config;
