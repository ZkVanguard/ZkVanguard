#!/usr/bin/env npx tsx
/**
 * Smoke-test the Discord webhook by sending one INFO ping.
 * Confirms DISCORD_WEBHOOK_URL is valid + channel is reachable.
 * Run: bun run scripts/test-discord-webhook.ts
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
if (existsSync('.env.local')) loadDotenv({ path: '.env.local', override: true });

async function main() {
  const { notifyDiscord } = await import('../lib/utils/discord-notify');
  const url = (process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!url) {
    console.error('DISCORD_WEBHOOK_URL not set in .env.local');
    process.exit(1);
  }
  console.log('Sending test ping to webhook:', url.slice(0, 60) + '...');

  await notifyDiscord(
    'Webhook smoke test — Zk-Vanguard alerting wired and live.',
    'INFO',
    { source: 'scripts/test-discord-webhook.ts', timestamp: new Date().toISOString() },
  );

  console.log('Ping sent. Check the Discord channel.');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
