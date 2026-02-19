#!/usr/bin/env node
/**
 * Script to set CRON_SECRET in Vercel without whitespace issues
 * Run: node set-cron-secret.js
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

// Generate a clean 32-character alphanumeric secret
const secret = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);

console.log('Generated clean CRON_SECRET:', secret);
console.log('\n⚠️  SAVE THIS SECRET - You\'ll need it for testing!\n');

try {
  // Remove old secret
  console.log('Removing old CRON_SECRET...');
  try {
    execSync('npx vercel env rm CRON_SECRET production --yes', { stdio: 'inherit' });
  } catch (e) {
    console.log('No existing secret to remove (or already removed)');
  }

  // Add new secret - write to stdin properly
  console.log('\nAdding new CRON_SECRET...');
  const { spawn } = require('child_process');
  
  const proc = spawn('npx', ['vercel', 'env', 'add', 'CRON_SECRET', 'production'], {
    stdio: ['pipe', 'inherit', 'inherit']
  });
  
  // Write directly to stdin without newline
  proc.stdin.write(secret);
  proc.stdin.end();
  
  proc.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ CRON_SECRET set successfully!');
      console.log('\nNow deploy with: npx vercel --prod');
    } else {
      console.error('\n❌ Failed to set CRON_SECRET');
      process.exit(1);
    }
  });
  
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
