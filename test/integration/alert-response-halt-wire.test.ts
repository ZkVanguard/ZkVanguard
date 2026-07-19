/**
 * End-to-end HALT wire test for alert-response-loop cron.
 *
 * Would have caught the two silent-signal bugs shipped with v0.3.0 and
 * fixed 2026-07-18:
 *   1. HALT_TRADER wrote `polymarket-edge-trader:halt = now`. Trader
 *      reads `polymarket-edge:halted-until` as a FUTURE timestamp
 *      (route.ts:705). Wrong key AND wrong value shape.
 *   2. HALT_AUTOHEDGE wrote via raw setCronState on the wrong key.
 *      sui-community-pool reads via getCronHalt() → cron:haltUntil:<id>.
 *
 * The unit test file (alert-response-loop.test.ts) only exercises the
 * pure `evaluateAutoResponse` decision function. This file asserts the
 * ROUTE-HANDLER wire: given a synthetic KILL wave + in-flight phantom,
 * the correct writes hit cron_state with correct keys + shapes.
 *
 * Regression guard: any future rename or refactor of the halt keys
 * breaks this test.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ─── Mock cron_state — capture writes ──────────────────────────────────────
const setCronStateSpy = jest.fn(async (_key: string, _value: unknown) => {});
const setCronHaltSpy = jest.fn(async (_cronId: string, _untilMs: number, _reason: string) => {});
const tryClaimCronRunSpy = jest.fn(async () => true);

jest.mock('@/lib/db/cron-state', () => ({
  setCronState: setCronStateSpy,
  setCronHalt: setCronHaltSpy,
  tryClaimCronRun: tryClaimCronRunSpy,
  getCronState: jest.fn(async () => undefined),
  CronKeys: {
    polymarketEdgeHaltedUntil: 'polymarket-edge:halted-until' as const,
  },
}));

// ─── Mock QStash auth ──────────────────────────────────────────────────────
jest.mock('@/lib/qstash', () => ({
  verifyCronRequest: jest.fn(async () => true),
}));

// ─── Mock DB — return hedge rows that trigger both in-flight phantom AND
//     closed-rate signals so we cover the full HALT path.
const queryMock = jest.fn(async (sql: string) => {
  if (sql.includes("status='closed'")) {
    return [{ total: '10', phantoms: '2' }]; // 20% closed-phantom rate → HALT
  }
  if (sql.includes("status='active'")) {
    return [{ open_phantoms: '2' }]; // 2 in-flight phantoms → HALT
  }
  return [];
});
jest.mock('@/lib/db/postgres', () => ({
  query: queryMock,
}));

// ─── Mock Discord — capture alert-log reads + no-op notifications ─────────
const readAlertLogMock = jest.fn(async () => [
  { at: Date.now() - 45 * 60_000, level: 'KILL' as const, message: 'test1' },
  { at: Date.now() - 20 * 60_000, level: 'KILL' as const, message: 'test2' },
  { at: Date.now() - 5 * 60_000, level: 'KILL' as const, message: 'test3' },
]);
jest.mock('@/lib/utils/discord-notify', () => ({
  readAlertLog: readAlertLogMock,
  notifyDiscord: jest.fn(async () => {}),
}));

// Re-import after mocks. The route handler dynamic-imports getCronState
// separately, which is why the mock above returns undefined by default.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require('@/app/api/cron/alert-response-loop/route');

function fakeRequest(): { headers: { get: (n: string) => string | null } } {
  return {
    headers: { get: (n: string) => (n.toLowerCase() === 'authorization' ? 'Bearer test' : null) },
  } as unknown as { headers: { get: (n: string) => string | null } };
}

describe('alert-response-loop route — HALT wire', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    setCronStateSpy.mockClear();
    setCronHaltSpy.mockClear();
    tryClaimCronRunSpy.mockClear();
    tryClaimCronRunSpy.mockImplementation(async () => true);
    // Restore env
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, ORIGINAL_ENV);
    // Enable execution paths (default OFF in prod for safe rollout)
    process.env.ALERT_RESPONSE_EXECUTE = '1';
    process.env.ALERT_RESPONSE_EXECUTE_HALT = '1';
  });

  it('writes HALT_TRADER to polymarket-edge:halted-until with future timestamp', async () => {
    const before = Date.now();
    const res = await GET(fakeRequest());
    expect(res.status ?? 200).toBe(200);

    // Find the setCronState call for the halt-until key.
    const traderCall = setCronStateSpy.mock.calls.find(
      ([key]) => key === 'polymarket-edge:halted-until',
    );
    expect(traderCall).toBeDefined();
    const [, value] = traderCall!;
    expect(typeof value).toBe('number');
    // Must be a FUTURE timestamp — the prior bug wrote `now` (0 ms halt).
    expect(value as number).toBeGreaterThan(before);
    // 24h halt window — allow a few seconds of test-execution slack.
    expect(value as number).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
    expect(value as number).toBeLessThan(before + 25 * 60 * 60 * 1000);
  });

  it('writes HALT_AUTOHEDGE via setCronHalt with correct cronId + future untilMs', async () => {
    const before = Date.now();
    await GET(fakeRequest());

    expect(setCronHaltSpy).toHaveBeenCalled();
    // Prior bug wrote to `sui-community-pool:autohedge:halt` via raw
    // setCronState — that would show up here as ZERO setCronHalt calls
    // and a bogus setCronState call. Both are asserted separately.
    const autohedgeCall = setCronHaltSpy.mock.calls.find(
      ([cronId]) => cronId === 'sui-community-pool:autohedge',
    );
    expect(autohedgeCall).toBeDefined();
    const [, untilMs, reason] = autohedgeCall!;
    expect(untilMs).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
    expect(untilMs).toBeLessThan(before + 25 * 60 * 60 * 1000);
    expect(typeof reason).toBe('string');
    expect((reason as string).length).toBeGreaterThan(0);
  });

  it('does NOT write to the historical wrong keys (regression guard)', async () => {
    await GET(fakeRequest());

    const wrongTraderKey = setCronStateSpy.mock.calls.find(
      ([key]) => key === 'polymarket-edge-trader:halt',
    );
    expect(wrongTraderKey).toBeUndefined();

    const wrongAutohedgeKey = setCronStateSpy.mock.calls.find(
      ([key]) => key === 'sui-community-pool:autohedge:halt',
    );
    expect(wrongAutohedgeKey).toBeUndefined();
  });

  it('no HALT writes when ALERT_RESPONSE_EXECUTE_HALT is unset (log-only)', async () => {
    delete process.env.ALERT_RESPONSE_EXECUTE_HALT;
    await GET(fakeRequest());

    const traderCall = setCronStateSpy.mock.calls.find(
      ([key]) => key === 'polymarket-edge:halted-until',
    );
    expect(traderCall).toBeUndefined();
    expect(setCronHaltSpy).not.toHaveBeenCalled();
  });

  it('SHRINK_SPOT still fires (3 KILL alerts) even when HALT gates are off', async () => {
    delete process.env.ALERT_RESPONSE_EXECUTE_HALT;
    await GET(fakeRequest());
    // SHRINK writes to `alert-response:spot-target-risk-cap` via setCronState.
    const shrinkCall = setCronStateSpy.mock.calls.find(
      ([key]) => key === 'alert-response:spot-target-risk-cap',
    );
    expect(shrinkCall).toBeDefined();
    const [, value] = shrinkCall!;
    expect(value).toMatchObject({ capPct: expect.any(Number) as unknown as number });
  });
});
