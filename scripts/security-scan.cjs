#!/usr/bin/env node
/**
 * Repo malware guard. Scans tracked JS/TS source for the obfuscated-loader
 * signatures and appended-payload anomalies that infected next.config.js
 * (introduced by 9b6711ce, re-added by 6ea125ea, removed in 01f962f8).
 *
 * Wired as `prebuild` so an infected tree can never be built/deployed, and
 * runnable directly: `bun run security:scan`. Exits non-zero on any hit.
 */
const { execSync } = require('child_process');
const fs = require('fs');

// Long single lines are the most reliable tell of an appended obfuscated payload
// hidden behind whitespace. Real source in this repo stays well under this.
const MAX_LINE = 2000;

// Obfuscated-loader fingerprints observed in the next.config.js payload.
const SIGNATURES = [
  /global\.i\s*=/,                       // loader bootstrap
  /_\$_[0-9a-f]{4}/,                     // mangled identifier scheme
  /String\.fromCharCode\(127\)/,         // delimiter trick used by the deobfuscator
  /\)\s*=\s*lyR\(/,                      // string-shuffle deobfuscator call
  /global\[[^\]]{1,40}\]\s*=\s*require\b/, // require() hijack
];

let files;
try {
  files = execSync('git ls-files "*.js" "*.ts" "*.jsx" "*.tsx" "*.cjs" "*.mjs"', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('node_modules/') && !f.includes('/.next/') && !f.startsWith('.next/') && !f.startsWith('dist/'));
} catch (e) {
  console.error('[security-scan] could not list tracked files:', e.message);
  process.exit(2);
}

const hits = [];
for (const f of files) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.length > MAX_LINE) hits.push(`${f}:${i + 1}  suspicious long line (${ln.length} chars)`);
    for (const sig of SIGNATURES) {
      if (sig.test(ln)) hits.push(`${f}:${i + 1}  matches malware signature ${sig}`);
    }
  }
}

if (hits.length) {
  console.error('\n[31m✗ SECURITY SCAN FAILED — possible injected/obfuscated code:[0m');
  for (const h of hits) console.error('  ' + h);
  console.error('\nBuild aborted. Investigate before deploying. (See scripts/security-scan.cjs)\n');
  process.exit(1);
}
console.log(`[32m✓ security scan clean[0m (${files.length} tracked source files)`);
