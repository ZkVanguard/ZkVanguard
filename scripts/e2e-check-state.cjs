const https = require('https');

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request('https://fullnode.mainnet.sui.io:443', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const POOL = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
  const ADMIN = '0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93';
  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const WBTC_TYPE = '0x27792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242e33f37d::coin::COIN';
  const WETH_TYPE = '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN';

  // Pool state
  const poolObj = await rpc('sui_getObject', [POOL, { showContent: true }]);
  const f = poolObj.result?.data?.content?.fields;
  const balance = Number(typeof f.balance === 'string' ? f.balance : (f.balance?.fields?.value || 0)) / 1e6;
  const shares = Number(f.total_shares || 0) / 1e6;
  const hedged = Number(f.hedge_state?.fields?.total_hedged_value || 0) / 1e6;
  const hedges = f.hedge_state?.fields?.active_hedges || [];
  const cfg = f.hedge_state?.fields?.auto_hedge_config?.fields;
  const dailyTotal = Number(f.hedge_state?.fields?.daily_hedge_total || 0) / 1e6;
  const hedgeDay = Number(f.hedge_state?.fields?.current_hedge_day || 0);
  const lastHedgeTime = Number(cfg?.last_hedge_time || 0);
  const cooldownMs = Number(cfg?.cooldown_ms || 0);
  const now = Date.now();
  const currentDay = Math.floor(now / 86400000);

  console.log('=== POOL STATE ===');
  console.log('Balance:', balance.toFixed(6), 'USDC');
  console.log('Hedged:', hedged.toFixed(6));
  console.log('NAV:', (balance + hedged).toFixed(6));
  console.log('Shares:', shares.toFixed(6));
  console.log('Active hedges:', hedges.length);
  if (hedges.length > 0) {
    hedges.forEach((h, i) => {
      const hf = h.fields || h;
      console.log(`  Hedge ${i}: ${(Number(hf.collateral_usdc || 0) / 1e6).toFixed(6)} USDC`);
    });
  }
  console.log('');
  console.log('=== HEDGE LIMITS ===');
  console.log('Daily hedge total:', dailyTotal.toFixed(6));
  console.log('Hedge day:', hedgeDay, '| Current day:', currentDay, hedgeDay < currentDay ? '(RESET!)' : '(same day)');
  console.log('Last hedge:', new Date(lastHedgeTime).toISOString());
  console.log('Cooldown:', cooldownMs / 1000, 'seconds');
  console.log('Time since last hedge:', ((now - lastHedgeTime) / 1000).toFixed(0), 'seconds');
  console.log('Cooldown clear:', now - lastHedgeTime > cooldownMs ? 'YES' : `NO (${((cooldownMs - (now - lastHedgeTime)) / 1000).toFixed(0)}s remaining)`);
  console.log('Daily cap clear:', hedgeDay < currentDay ? 'YES (new day)' : `Used ${dailyTotal.toFixed(2)} of ${((balance + hedged) * 0.5).toFixed(2)} cap`);

  // Admin balances
  const [usdcBal, suiBal, btcCoins, ethCoins] = await Promise.all([
    rpc('suix_getBalance', [ADMIN, USDC_TYPE]),
    rpc('suix_getBalance', [ADMIN, '0x2::sui::SUI']),
    rpc('suix_getCoins', [ADMIN, WBTC_TYPE]),
    rpc('suix_getCoins', [ADMIN, WETH_TYPE]),
  ]);

  const adminUsdc = Number(usdcBal.result?.totalBalance || 0) / 1e6;
  const adminSui = Number(suiBal.result?.totalBalance || 0) / 1e9;
  const adminBtc = (btcCoins.result?.data || []).reduce((s, c) => s + Number(c.balance), 0);
  const adminEth = (ethCoins.result?.data || []).reduce((s, c) => s + Number(c.balance), 0);

  console.log('');
  console.log('=== ADMIN WALLET ===');
  console.log('USDC:', adminUsdc.toFixed(6));
  console.log('SUI:', adminSui.toFixed(4));
  console.log('wBTC raw:', adminBtc);
  console.log('wETH raw:', adminEth);
  
  console.log('');
  console.log('=== READY FOR E2E? ===');
  const ready = (now - lastHedgeTime > cooldownMs) && (hedgeDay < currentDay || dailyTotal < (balance + hedged) * 0.4);
  console.log(ready ? 'YES - can open_hedge and swap' : 'NO - blocked by cooldown or daily cap');
}

main().catch(console.error);
