const https = require('https');
const fs = require('fs');
const envContent = fs.readFileSync('.env.vercel-test', 'utf-8');
const match = envContent.match(/^CRON_SECRET="?([^"\r\n]+)"?/m);
const secret = match ? match[1].replace(/\\r\\n/g, '').trim() : '';
console.log('Secret:', JSON.stringify(secret), 'length:', secret.length);

const options = {
  hostname: 'www.zkvanguard.xyz',
  path: '/api/cron/sui-community-pool',
  method: 'GET',
  headers: { 'Authorization': 'Bearer ' + secret },
  timeout: 120000,
};
const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try { 
      const j = JSON.parse(data);
      console.log(JSON.stringify(j, null, 2).substring(0, 10000));
    } catch(e) { console.log(data.substring(0, 8000)); }
  });
});
req.on('error', console.error);
req.end();
