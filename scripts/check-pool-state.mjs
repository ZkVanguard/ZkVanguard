const POOL = '0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a';
fetch('https://fullnode.mainnet.sui.io', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_getObject', params: [POOL, { showContent: true }] }),
}).then(r => r.json()).then(j => {
  const f = j.result?.data?.content?.fields;
  if (!f) { console.log('NO FIELDS'); return; }
  const hs = f.hedge_state?.fields || {};
  const cfg = hs.auto_hedge_config?.fields || {};
  const active = Array.isArray(hs.active_hedges) ? hs.active_hedges : [];
  console.log('=== ON-CHAIN POOL STATE ===');
  console.log('Pool NAV (USDC raw):', f.total_nav_usdc);
  console.log('Pool USDC vault:', f.usdc_vault?.fields?.balance);
  console.log('Total shares:', f.total_shares);
  console.log('Members:', f.member_count);
  console.log('--- Hedge config (on-chain) ---');
  console.log('enabled:', cfg.enabled, ' pair_index:', cfg.pair_index, ' risk_threshold:', cfg.risk_threshold);
  console.log('max_leverage:', cfg.max_leverage, ' allowed_pairs:', cfg.allowed_pairs);
  console.log('daily_hedge_total:', hs.daily_hedge_total, ' last_reset:', hs.last_daily_reset);
  console.log('--- Active hedges:', active.length, '---');
  active.forEach((h, i) => {
    const x = h.fields;
    console.log(`  #${i} pair=${x.pair_index} side=${x.is_long ? 'LONG' : 'SHORT'} collateral_raw=${x.collateral_usdc} entry=${x.entry_price} leverage=${x.leverage}`);
  });
}).catch(e => console.error('ERR', e.message));
