const https = require('https');

const QSTASH_TOKEN = "eyJVc2VySUQiOiJmMzM2MGFiYi01N2FjLTRkMTAtOTZkYS04N2Q5MGFmYzNmYTUiLCJQYXNzd29yZCI6IjYyYWRmMjk3ZTBhYTQyMTVhODRlOGQwZWFiZTI0NDQ0In0=";
const BASE = "https://qstash-us-east-1.upstash.io";
const CRON_SECRET = "cv-cron-7f3a9e2b4d1c8f06";

const schedules = [
  { name: "SUI Community Pool", url: "https://www.zkvanguard.xyz/api/cron/sui-community-pool", cron: "*/30 * * * *", retries: 2 },
  { name: "Pool NAV Monitor", url: "https://www.zkvanguard.xyz/api/cron/pool-nav-monitor", cron: "*/15 * * * *", retries: 1 },
  { name: "Hedge Monitor", url: "https://www.zkvanguard.xyz/api/cron/hedge-monitor", cron: "*/15 * * * *", retries: 1 },
  { name: "Liquidation Guard", url: "https://www.zkvanguard.xyz/api/cron/liquidation-guard", cron: "*/10 * * * *", retries: 1 },
];

function qstashRequest(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { "Authorization": `Bearer ${QSTASH_TOKEN}`, ...headers },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // 1. List existing schedules
  console.log('=== Listing existing schedules ===');
  const existing = await qstashRequest('GET', '/v2/schedules', {});
  if (Array.isArray(existing.data)) {
    for (const s of existing.data) {
      if (s.destination && s.destination.includes('zkvanguard')) {
        console.log(`  Deleting: ${s.scheduleId} -> ${s.destination}`);
        await qstashRequest('DELETE', `/v2/schedules/${s.scheduleId}`, {});
      }
    }
  }
  console.log('  Cleaned up existing schedules\n');

  // 2. Create new schedules with proper auth forwarding
  console.log('=== Creating new schedules ===');
  for (const s of schedules) {
    const result = await qstashRequest('POST', `/v2/schedules/${s.url}`, {
      "Content-Type": "application/json",
      "Upstash-Cron": s.cron,
      "Upstash-Retries": String(s.retries),
      "Upstash-Forward-Authorization": `Bearer ${CRON_SECRET}`,
    }, '{}');
    
    if (result.data?.scheduleId) {
      console.log(`  ✅ ${s.name}: ${result.data.scheduleId} [${s.cron}]`);
    } else {
      console.log(`  ❌ ${s.name}: ${JSON.stringify(result.data)}`);
    }
  }

  // 3. Verify
  console.log('\n=== Verifying schedules ===');
  const final = await qstashRequest('GET', '/v2/schedules', {});
  if (Array.isArray(final.data)) {
    for (const s of final.data) {
      const authHeader = s.header?.Authorization || s.header?.authorization || ['none'];
      const hasAuth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      console.log(`  ${s.cron} -> ${s.destination}`);
      console.log(`    Auth: ${hasAuth.substring(0, 20)}...`);
      console.log(`    Method: ${s.method || 'POST'}`);
    }
  }

  console.log('\n=== Message usage ===');
  console.log('  SUI Pool:         48 msgs/day (every 30 min)');
  console.log('  NAV Monitor:      96 msgs/day (every 15 min)');
  console.log('  Hedge Monitor:    96 msgs/day (every 15 min)');
  console.log('  Liquidation:     144 msgs/day (every 10 min)');
  console.log('  Total:           384 msgs/day (free tier: 500)');
}

main().catch(console.error);
