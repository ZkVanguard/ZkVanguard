/**
 * Smoke test: PriceMonitorAgent.tick() should fetch prices, process
 * alerts, and return a structured summary — all in one shot, with no
 * setInterval persisting. Validates the serverless one-shot pathway
 * that the autonomous LeadAgent cycle now relies on.
 */
import { PriceMonitorAgent } from '../agents/specialized/PriceMonitorAgent';

async function main() {
  console.log('▶ Creating agent (no start, no polling loop)');
  const agent = new PriceMonitorAgent({ pollingIntervalMs: 10_000, enableX402Settlement: false });

  const alertId = agent.addAlert({
    symbol: 'BTC',
    type: 'change_percent',
    threshold: 999,
    action: 'alert',
    active: true,
  });
  console.log(`  alert added: ${alertId}`);

  console.log('▶ Calling tick() once');
  const t0 = Date.now();
  const result = await agent.tick();
  const ms = Date.now() - t0;

  console.log(`  durationMs: ${ms}`);
  console.log(`  result:`, JSON.stringify(result, null, 2));

  const btc = agent.getCurrentPrice('BTC');
  const eth = agent.getCurrentPrice('ETH');
  console.log(`  BTC: ${btc?.price} from ${btc?.source}`);
  console.log(`  ETH: ${eth?.price} from ${eth?.source}`);

  const failures: string[] = [];
  if (result.pricesFetched < 1) failures.push('expected at least 1 price');
  if (result.alertsChecked !== 1) failures.push(`expected 1 alert checked, got ${result.alertsChecked}`);
  if (result.alertsTriggered !== 0) failures.push(`unreachable threshold should not trigger, got ${result.alertsTriggered}`);
  if (!btc || btc.price <= 0) failures.push('BTC price not populated');

  if (failures.length > 0) {
    console.error('\n✗ FAILURES:');
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('\n✓ PriceMonitorAgent.tick() works as one-shot in serverless-style call');

  const status = agent.getStatus();
  if (status.isRunning) {
    console.error('✗ Agent should not be marked running after tick() (no start() called)');
    process.exit(1);
  }
  console.log(`✓ Agent isRunning=false (no setInterval persisting after tick)`);
  process.exit(0);
}

main().catch(e => {
  console.error('UNHANDLED', e);
  process.exit(1);
});
