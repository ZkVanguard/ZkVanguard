/**
 * Contract lock for deploy-watchdog decideAlert state machine.
 *
 * The whole point of this cron is to catch silent Vercel deploy failures
 * (root cause: tsconfig types drift lost 2 days of prod code, 2026-07-20
 * → 07-22). If the state machine ever gets refactored to something that
 * skips WARN on first drift or forgets to escalate to KILL after 60min,
 * we're back to silent-fail regime. These 6 cases anchor the contract.
 */
import { describe, it, expect } from '@jest/globals';
import { decideAlert, DRIFT_GRACE_MS, KILL_ESCALATE_MS } from '@/lib/services/deploy-watchdog/decide';

const NOW = 1_800_000_000_000;

describe('deploy-watchdog decideAlert', () => {
  it('no drift + no prior drift → silent', () => {
    const d = decideAlert({
      runningSha: 'abc123', originSha: 'abc123',
      originAgeMs: 60_000, prevDriftSha: null, lastAlertMs: 0, now: NOW,
    });
    expect(d.alertLevel).toBeNull();
  });

  it('no drift + prevDrift set → INFO recovery', () => {
    const d = decideAlert({
      runningSha: 'abc123', originSha: 'abc123',
      originAgeMs: 60_000, prevDriftSha: 'olderi', lastAlertMs: NOW - 3600_000, now: NOW,
    });
    expect(d.alertLevel).toBe('INFO');
    expect(d.alertMsg).toContain('caught up');
    expect(d.nextDriftSha).toBeNull();
    expect(d.nextLastAlert).toBe(0);
  });

  it('drift + fresh push (< grace) → silent (allow normal deploy time)', () => {
    const d = decideAlert({
      runningSha: 'abc123', originSha: 'xyz789',
      originAgeMs: DRIFT_GRACE_MS - 60_000, prevDriftSha: null, lastAlertMs: 0, now: NOW,
    });
    expect(d.alertLevel).toBeNull();
  });

  it('drift + stale push + new drift sha → WARN, records sha', () => {
    const d = decideAlert({
      runningSha: 'abc123', originSha: 'xyz789',
      originAgeMs: DRIFT_GRACE_MS + 60_000, prevDriftSha: null, lastAlertMs: 0, now: NOW,
    });
    expect(d.alertLevel).toBe('WARN');
    expect(d.alertMsg).toContain('xyz789');
    expect(d.nextDriftSha).toBe('xyz789');
    expect(d.nextLastAlert).toBe(NOW);
  });

  it('same drift + < 60min since WARN → silent (no repeat spam)', () => {
    const d = decideAlert({
      runningSha: 'abc123', originSha: 'xyz789',
      originAgeMs: 30 * 60_000, prevDriftSha: 'xyz789',
      lastAlertMs: NOW - 30 * 60_000, now: NOW,
    });
    expect(d.alertLevel).toBeNull();
  });

  it('same drift + >= 60min since last alert → KILL escalation', () => {
    const d = decideAlert({
      runningSha: 'abc123', originSha: 'xyz789',
      originAgeMs: 90 * 60_000, prevDriftSha: 'xyz789',
      lastAlertMs: NOW - KILL_ESCALATE_MS - 60_000, now: NOW,
    });
    expect(d.alertLevel).toBe('KILL');
    expect(d.alertMsg).toContain('STUCK');
    expect(d.nextLastAlert).toBe(NOW); // reset clock so next KILL is 60min from now
  });

  it('drift sha changes while still drifted → fresh WARN (not KILL)', () => {
    // Someone pushed a new commit while the previous one was still stuck.
    // Reset drift-clock so operator sees the new sha explicitly.
    const d = decideAlert({
      runningSha: 'abc123', originSha: 'newsha1',
      originAgeMs: DRIFT_GRACE_MS + 60_000, prevDriftSha: 'oldsha1',
      lastAlertMs: NOW - KILL_ESCALATE_MS - 60_000, now: NOW,
    });
    expect(d.alertLevel).toBe('WARN');
    expect(d.nextDriftSha).toBe('newsha1');
  });
});
