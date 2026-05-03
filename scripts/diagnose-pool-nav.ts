/**
 * Quick NAV diagnostic — prints every component of pool NAV so we can
 * see where the dashboard's $28.72 number comes from vs the real wealth.
 */

import { getSuiUsdcPoolService } from '../lib/services/sui/SuiCommunityPoolService';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { MAINNET_COIN_TYPES } from '../lib/types/bluefin-types';

async function main() {
  const network = 'mainnet' as const;
  const c = new SuiClient({ url: getFullnodeUrl(network) });
  const poolStateId = process.env.NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE!;

  console.log('═'.repeat(64));
  console.log(' SUI POOL NAV DIAGNOSTIC');
  console.log('═'.repeat(64));

  // 1. Raw pool state
  const obj = await c.getObject({ id: poolStateId, options: { showContent: true } });
  const f = (obj.data as any)?.content?.fields ?? {};
  const balanceRaw = typeof f.balance === 'string' ? f.balance : (f.balance?.fields?.value || f.balance?.value || '0');
  const balanceUsdc = Number(balanceRaw) / 1e6;
  const totalShares = Number(f.total_shares || 0) / 1e6;
  const memberCount = Number(f.member_count || 0);
  const navHwm = Number(f.all_time_high_nav_per_share || 1e9) / 1e9;
  const hedgedRaw = f.hedge_state?.fields?.total_hedged_value || '0';
  const hedgedUsdc = Number(hedgedRaw) / 1e6;

  console.log('\n1. POOL CONTRACT (state.balance) ───────────────────');
  console.log('   Pool USDC balance:', balanceUsdc.toFixed(4));
  console.log('   Total shares:     ', totalShares.toFixed(4));
  console.log('   Member count:     ', memberCount);
  console.log('   ATH NAV/share:    ', navHwm.toFixed(6));
  console.log('   hedge_state.total_hedged_value:', hedgedUsdc.toFixed(4), '(cost basis)');

  // 2. Operator wallet
  const adminKey = (process.env.SUI_POOL_ADMIN_KEY || '').trim();
  if (!adminKey) throw new Error('No admin key');
  const kp = adminKey.startsWith('suiprivkey')
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(adminKey).secretKey)
    : Ed25519Keypair.fromSecretKey(Buffer.from(adminKey.replace(/^0x/, ''), 'hex'));
  const operator = kp.toSuiAddress();
  console.log('\n2. OPERATOR WALLET (' + operator.slice(0, 10) + '…) ──');

  const allBal = await c.getAllBalances({ owner: operator });
  let opUsdc = 0, opSui = 0, opOther = 0;
  for (const b of allBal) {
    const raw = Number(b.totalBalance);
    if (raw <= 0) continue;
    if (b.coinType === MAINNET_COIN_TYPES.USDC) {
      opUsdc = raw / 1e6;
      console.log('   USDC :', opUsdc.toFixed(4));
    } else if (b.coinType === '0x2::sui::SUI') {
      opSui = raw / 1e9;
      console.log('   SUI  :', opSui.toFixed(4));
    } else {
      console.log('   ???  :', b.coinType, raw);
      opOther += 1;
    }
  }

  // 3. BlueFin perp positions + margin
  console.log('\n3. BLUEFIN MAINNET ─────────────────────────────────');
  try {
    const { BluefinService } = await import('../lib/services/sui/BluefinService');
    const bf = BluefinService.getInstance();
    const bfKey = (process.env.BLUEFIN_PRIVATE_KEY || adminKey).trim();
    await bf.initialize(bfKey, 'mainnet');
    const positions = await bf.getPositions();
    let totalMargin = 0, totalUpnl = 0;
    for (const p of positions) {
      const margin = Number(p.margin || 0);
      const upnl = Number(p.unrealizedProfit || p.uPnL || 0);
      totalMargin += margin;
      totalUpnl += upnl;
      console.log(`   ${p.symbol} ${p.side} qty=${p.quantity} entry=${p.avgEntryPrice} mark=${p.markPrice} margin=$${margin.toFixed(2)} uPnL=$${upnl.toFixed(2)}`);
    }
    console.log('   Σ margin :', totalMargin.toFixed(2));
    console.log('   Σ uPnL   :', totalUpnl.toFixed(2));

    // Try to fetch margin bank balance
    try {
      const bal = await (bf as any).getMarginBankBalance?.();
      if (bal !== undefined) console.log('   Margin bank free :', bal);
    } catch {}
  } catch (e) {
    console.log('   (BlueFin read failed):', (e as Error).message);
  }

  // 4. What the dashboard is reading via getPoolStats
  console.log('\n4. DASHBOARD VIEW (getPoolStats) ───────────────────');
  const svc = getSuiUsdcPoolService(network);
  const stats = await svc.getPoolStats();
  console.log('   totalNAV     :', stats.totalNAV.toFixed(4));
  console.log('   totalNAVUsd  :', stats.totalNAVUsd.toFixed(4));
  console.log('   sharePrice   :', stats.sharePrice.toFixed(6));
  console.log('   totalShares  :', stats.totalShares.toFixed(4));

  // 5. Reconciliation
  console.log('\n5. RECONCILIATION ──────────────────────────────────');
  console.log('   On-chain pool balance     : $' + balanceUsdc.toFixed(2));
  console.log('   + Operator USDC (idle)    : $' + opUsdc.toFixed(2));
  console.log('   + BlueFin margin (locked) : computed above');
  console.log('   + BlueFin uPnL            : computed above');
  console.log('   = TRUE wealth');
  console.log();
  console.log('   Dashboard shows:        $' + stats.totalNAVUsd.toFixed(2));
  console.log('   Recorded hedged_value:  $' + hedgedUsdc.toFixed(2));
  console.log();
  console.log('   If the operator USDC is ~0 because all funds are on BlueFin,');
  console.log('   then `adminUsdcInWallet + adminAssetValueUsdc` collapses to ~0,');
  console.log('   and the dashboard shows balance + recorded_hedged but MISSES');
  console.log('   the BlueFin margin + uPnL.');
}

main().catch((e) => { console.error(e); process.exit(1); });
