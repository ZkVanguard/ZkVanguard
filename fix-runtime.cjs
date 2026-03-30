/**
 * Script to add `export const runtime = 'nodejs';` to all API routes that need it.
 * Scans for routes missing the declaration that use Node.js-only imports.
 */
const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, 'app', 'api');
const nodePatterns = [
  /from\s+['"]ethers['"]/,
  /from\s+['"]crypto['"]/,
  /import\s+crypto/,
  /require\(['"]crypto['"]\)/,
  /from\s+['"]@\/lib\/db/,
  /from\s+['"]@\/lib\/services\/agent-orchestrator/,
  /from\s+['"]@\/agents\//,
  /from\s+['"]@\/lib\/storage/,
  /from\s+['"]@\/integrations/,
  /from\s+['"]@\/lib\/ai/,
  /from\s+['"]@\/lib\/throttled-provider/,
  /from\s+['"]@\/lib\/services\/RealMarketData/,
  /from\s+['"]@\/lib\/services\/community-pool/,
  /from\s+['"]@\/lib\/services\/background/,
  /from\s+['"]@\/lib\/security\/production-guard/,
  /from\s+['"]@\/lib\/config/,
  /from\s+['"]pg['"]/,
  /process\.env\./,
];

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (entry.name === 'route.ts') results.push(full);
  }
  return results;
}

let fixed = 0;
for (const file of walk(apiDir)) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes("export const runtime")) continue;
  
  // Check if uses Node.js imports
  const needsNodejs = nodePatterns.some(p => p.test(content));
  if (!needsNodejs) continue;
  
  // Find first import line
  const lines = content.split('\n');
  let lastImportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ') || lines[i].startsWith('import{')) {
      lastImportLine = i;
    }
    // Stop after we pass imports section
    if (i > 0 && !lines[i].startsWith('import') && !lines[i].startsWith('//') && !lines[i].startsWith(' ') && !lines[i].trim() === '' && lastImportLine >= 0 && i > lastImportLine + 3) {
      break;
    }
  }
  
  if (lastImportLine >= 0) {
    lines.splice(lastImportLine + 1, 0, '', "export const runtime = 'nodejs';");
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    fixed++;
    const rel = path.relative(__dirname, file);
    console.log(`  Fixed: ${rel}`);
  }
}
console.log(`\nTotal: ${fixed} routes fixed`);
