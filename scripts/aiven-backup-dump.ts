#!/usr/bin/env npx tsx
/**
 * Aiven Postgres logical backup.
 *
 *   bun run scripts/aiven-backup-dump.ts [--out=backups/<file.sql>]
 *
 * Streams pg_dump for every public.* table to a single .sql file. Suitable
 * for offline disaster-recovery: take this file weekly, store off-Aiven
 * (S3 + local), and any future Postgres can ingest it with `psql -f`.
 *
 * Why not rely on Aiven's built-in backups? They DO exist, but they're
 * controlled by Aiven (point-in-time restore window, retention, restore
 * SLA). For an institutional-scale pool you also want an off-provider
 * copy you control. Run this from a workstation or CI weekly.
 *
 * Requires `pg_dump` on PATH (any version >= 12 works against Aiven 17).
 * Install: `winget install PostgreSQL.PostgreSQL.17` (Windows) or
 * `brew install libpq && brew link --force libpq` (mac).
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { dirname } from 'path';

if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

function arg(name: string, fallback: string): string {
  const m = process.argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.slice(name.length + 3) : fallback;
}

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = arg('out', `backups/aiven-${ts}.sql`);
const url = (process.env.DATABASE_URL || '').trim();

if (!url || !url.includes('aivencloud.com')) {
  console.error('DATABASE_URL not set to Aiven — refusing to dump');
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });

// pg_dump can read connection details from a single URL via PGPASSWORD or
// the standard URL form. Aiven needs sslmode=require (default in URL).
// Strip channel_binding which pg_dump's libpq doesn't honor.
const sanitizedUrl = url.replace(/&?channel_binding=[^&]*/g, '').replace('?&', '?');

console.log(`Dumping Aiven Postgres → ${out}`);
try {
  // -F p = plain SQL (portable), -C = include CREATE DATABASE, -O = no owner,
  // -x = no privileges, --schema=public = skip pg_catalog noise.
  // --no-publications --no-subscriptions: avoid extension-replication clutter.
  execSync(
    `pg_dump --dbname="${sanitizedUrl}" --schema=public --no-owner --no-privileges --no-publications --no-subscriptions --file="${out}"`,
    { stdio: 'inherit', timeout: 600_000 },
  );
} catch (e: any) {
  console.error('pg_dump failed:', e?.message || e);
  console.error('\nIs pg_dump installed?  Try:  pg_dump --version');
  process.exit(1);
}

const fs = require('fs') as typeof import('fs');
const size = fs.statSync(out).size;
const sizeKb = (size / 1024).toFixed(1);
console.log(`\n✓ Dump complete: ${out} (${sizeKb} KB)`);
console.log(`\nNext:`);
console.log(`  1. Copy to off-Aiven storage (S3, local drive, etc).`);
console.log(`  2. Verify with: bun run scripts/aiven-restore-verify.ts --backup=${out} --target=<scratch-aiven-url>`);
