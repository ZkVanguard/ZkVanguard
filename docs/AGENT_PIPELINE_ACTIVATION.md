# AI Agent Pipeline Activation — runbook for operator

> What this document is: the operational checklist for making the 7-agent
> system actually run in production. Code changes are in commits AG1-AG8;
> the items below are what the **operator** must do to turn them on.

## TL;DR

All seven agents are now wired into the trading path (was 1/7 before).
Two production deployments are needed:

1. Schedule the new `/api/cron/agent-signal-tick` cron in QStash (~2 min)
2. Redeploy and verify (~5 min)

That's it. No new env vars are mandatory; existing trades pick up agent
gating automatically on next deploy.

## What changed (code)

| Gate | File | What it does |
|---|---|---|
| AG1 | `app/api/cron/sui-community-pool/route.ts` | Every `bluefin.openHedge` consults `checkBeforeTrade` first; HedgingAgent HOLD or HIGH-confidence side mismatch blocks the trade. |
| AG2 | `lib/services/agents/agent-trade-guard.ts` | SafeExecutionGuard now enforced on every cron trade. Position cap + slippage + cooldown + circuit breaker all active. |
| AG3 | `app/api/cron/agent-signal-tick/route.ts` | New cron — refreshes agent directives when Polymarket 5-min signal flips. Restores proactive serverless reactivity. |
| AG4 | `app/api/cron/polymarket-edge-trader/route.ts` | Inline risk gate replaced with the same `checkBeforeTrade`. Both crons now share one authoritative gate. |
| AG5 | `lib/db/agent-decisions.ts` | New `agent_decisions` table. Every recommendation recorded; outcomes settled via `settleAgentDecision`. |
| AG6 | `lib/services/agent-orchestrator.ts` | SettlementAgent only included in cycles when chain is Cronos (x402-only). No more wasted LLM latency on SUI. |
| AG7 | `app/api/platform/risk-overview/route.ts` | `/dashboard/risk` now surfaces live agent cycle + directives + 7-day scorecard. |
| AG8 | `scripts/test-agent-pipeline-e2e.ts` | 10/10 E2E verification of the whole pipeline. |

## What the operator must do

### Step 1 — Schedule the agent-signal-tick cron in QStash

```bash
curl -X POST -H "Authorization: Bearer $QSTASH_TOKEN" \
  -H "Upstash-Cron: */2 * * * *" \
  -H "Upstash-Method: POST" \
  -H "Upstash-Forward-Authorization: Bearer $CRON_SECRET" \
  -H "Upstash-Retries: 2" \
  -d '{}' \
  "$QSTASH_URL/v2/schedules/https://www.zkvanguard.xyz/api/cron/agent-signal-tick"
```

Cadence: every 2 min. The route is a no-op when nothing's changed (<50ms),
so the cost is essentially zero except on actual signal flips (~3-6/day).

### Step 2 — Verify with the live API

After Vercel redeploys, check the risk overview endpoint:

```bash
curl -s https://www.zkvanguard.xyz/api/platform/risk-overview \
  | python -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['agents'], indent=2))"
```

Expected output:
- `cycle.ageMinutes`: under 35 (refreshed every 30 min by sui-community-pool)
- `directives`: 3 entries (BTC, ETH, SUI) each with `recommendedSide`, `confidence`, `shouldHedge`
- `scorecard`: rows starting from the first cron tick after deploy

If `directives` is empty or `cycle.ageMinutes` is null, the orchestrator
hasn't run yet — wait for the next sui-community-pool tick (max 30 min).

### Step 3 — Optional env tuning

| Variable | Default | What it controls |
|---|---|---|
| `HEDGE_AGENT_RISK_CEILING` | 80 | RiskAgent score above this halts all new positions |
| `HEDGE_AGENT_SIDE_BLOCK_CONFIDENCE` | 70 | HedgingAgent confidence above this blocks side-mismatched trades |
| `SAFE_GUARD_MAX_POSITION_USD` | 10,000,000 | Single position cap |
| `SAFE_GUARD_MAX_LEVERAGE` | 4 | Leverage cap (agent-trade-guard doesn't pass leverage by default — caller opts in) |
| `SAFE_GUARD_COOLDOWN_MS` | 5000 | Inter-trade cooldown |

None are required for the new system to function. Defaults are sensible.

## Operational behavior changes

### What happens BEFORE the change

```
Cron tick (30min) → inline sentiment check → bluefin.openHedge → done
                    ↑
                    Hedging/Risk/Settlement/Reporting Agents observed in
                    parallel but their recommendations were thrown away.
```

### What happens AFTER

```
Cron tick (30min) ─→ checkBeforeTrade
                       ├─ HedgingAgent directive ──→ HOLD ⇒ skip + Discord
                       ├─ RiskAgent score ──→ risk>80 ⇒ halt all
                       └─ SafeExecutionGuard ──→ position cap / cap breach
                       ↓
                     bluefin.openHedge (only if all 3 cleared)
                       ↓
                     completeTrade → records to agent_decisions
                                   → settles SafeGuard counter
```

Plus on top of the 30min cycle:

```
Polymarket 5-min ticker (signal) → /api/cron/agent-signal-tick (every 2min)
                                    ├─ direction flip OR strong emerged?
                                    ├─ NO → done in 50ms
                                    └─ YES → re-run LeadAgent cycle
                                            → fresh directives published
                                            → Discord WARN/INFO
```

The 30-min cron then picks up the fresh directives on its next tick.

## Monitoring

### Discord events you'll see

- `🛡️ Agent guard blocked X-PERP Y ($Z): reason` — a trade was prevented
- `🔄 Signal FLIP UP → DOWN (conf X%) — agent directives refreshed` — proactive flip
- `📈 STRONG signal X emerged (conf Y%, up from Z%)` — strong-signal kick

### DB queries for accuracy review

```sql
-- 7-day agent scorecard
SELECT agent, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE was_acted_on) AS acted_on,
       COUNT(*) FILTER (WHERE outcome_pnl_usd > 0) AS wins,
       ROUND(SUM(outcome_pnl_usd) FILTER (WHERE was_acted_on)::numeric, 2) AS net_pnl
  FROM agent_decisions
 WHERE chain = 'sui' AND created_at > NOW() - INTERVAL '7 days'
 GROUP BY agent;

-- Recent blocks (what did the agents prevent?)
SELECT created_at, agent, asset, intended_side, agent_reason
  FROM agent_decisions
 WHERE NOT agent_approved
 ORDER BY created_at DESC
 LIMIT 20;
```

## E2E verification before/after deploy

```bash
# Local — 10 checks against the in-memory pipeline + Aiven DB
bun run scripts/test-agent-pipeline-e2e.ts
# Expected: 10/10 ✅
```

## Rollback

The agent gate is **fail-OPEN** at the agent layer (no cache, no LLM) but
**fail-CLOSED** at SafeExecutionGuard (hard limits always enforced). So:

- Disable AG3 only: delete the `/api/cron/agent-signal-tick` QStash schedule
- Disable AG1+AG4 (back to inline decisions): the agent gate will fail-open
  if `agent-directives:by-asset` cache is cleared — run
  `setCronState('agent-directives:by-asset', null)` from any TS console.
- Disable AG2: set `SAFE_GUARD_MAX_POSITION_USD=999999999` (effectively unlimited)

All three are reversible without code change. None require redeploy.

## Reference

- E2E test: `scripts/test-agent-pipeline-e2e.ts` (10/10 must pass before deploy)
- Trade guard: `lib/services/agents/agent-trade-guard.ts`
- DB schema: `lib/db/agent-decisions.ts` (auto-creates table on first call)
- Orchestrator: `lib/services/agent-orchestrator.ts:runAutonomousCycle` (extended)
- Signal-tick cron: `app/api/cron/agent-signal-tick/route.ts`
- Risk overview API: `/api/platform/risk-overview` → `agents` section
