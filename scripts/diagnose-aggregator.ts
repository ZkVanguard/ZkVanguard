/**
 * Compare quote routes: default vs steamm/springsui excluded.
 * SDK itself warns STEAMM "state can shift between simulation and execution" —
 * this is the source of the on-chain silent-zero.
 */
import { getQuote, DEFAULT_SOURCES } from '@bluefin-exchange/bluefin7k-aggregator-sdk';
import { MAINNET_COIN_TYPES } from '@/lib/types/bluefin-types';

const RISKY = ['steamm', 'steamm_oracle_quoter', 'steamm_oracle_quoter_v2', 'springsui'];
const SAFE_SOURCES = DEFAULT_SOURCES.filter((s) => !RISKY.includes(s));

async function compare(from: string, to: string, amt: string, label: string) {
  const [def, safe] = await Promise.all([
    getQuote({ tokenIn: MAINNET_COIN_TYPES[from], tokenOut: MAINNET_COIN_TYPES[to], amountIn: amt }) as Promise<any>,
    getQuote({ tokenIn: MAINNET_COIN_TYPES[from], tokenOut: MAINNET_COIN_TYPES[to], amountIn: amt, sources: SAFE_SOURCES }) as Promise<any>,
  ]);
  const defOut = def?.returnAmount || '0';
  const safeOut = safe?.returnAmount || '0';
  const defRoute = def?.routes?.[0]?.hops?.map((h: any) => h.pool.type).join('→') || 'none';
  const safeRoute = safe?.routes?.[0]?.hops?.map((h: any) => h.pool.type).join('→') || 'none';
  const defRisky = RISKY.some(r => defRoute.includes(r));
  const outDelta = ((Number(safeOut) - Number(defOut)) / Number(defOut) * 100).toFixed(2);
  console.log(`  ${label.padEnd(28)}`);
  console.log(`    default: out=${defOut.padStart(12)}  ${defRisky ? '⚠ RISKY' : '✓ safe'}  ${defRoute}`);
  console.log(`    filter:  out=${safeOut.padStart(12)}  Δ=${outDelta}%  ${safeRoute}`);
}

(async () => {
  console.log('Compare default routes vs steamm/springsui-excluded routes\n');

  console.log('── WBTC → USDC ─');
  await compare('WBTC', 'USDC', Math.floor(0.0000125 * 1e8).toString(), '0.0000125 BTC ($0.79)');
  await compare('WBTC', 'USDC', Math.floor(0.0001    * 1e8).toString(), '0.0001 BTC ($6.3)');

  console.log('\n── WETH → USDC ─');
  await compare('WETH', 'USDC', Math.floor(0.00477 * 1e8).toString(), '0.00477 ETH ($8.98)');
  await compare('WETH', 'USDC', Math.floor(0.01    * 1e8).toString(), '0.01 ETH ($18.8)');

  console.log('\n── SUI → USDC ─');
  await compare('SUI', 'USDC', Math.floor(1.27 * 1e9).toString(), '1.27 SUI ($1.52)');
  await compare('SUI', 'USDC', Math.floor(10   * 1e9).toString(), '10 SUI ($12)');

  console.log('\nIf Δ% is near 0%, filter is a free win.');
  console.log('If Δ% is meaningfully negative on some rows, safe filter costs a bit of price but cures silent-zero.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
