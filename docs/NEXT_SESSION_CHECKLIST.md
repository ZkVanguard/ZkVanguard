# Next Session Checklist

Written 2026-08-02 at end of the v0.4.0 refactor + plugin-optimization session. Everything the next Claude Code session should verify before touching anything.

Delete this file (or move its contents into `CHANGELOG.md`) once all items are checked.

---

## 1. Plugin runtime is loaded

After a fresh Claude Code start, verify 8 plugins are enabled and their tools/MCP servers are live.

```bash
claude plugin list          # expect: 8 enabled, github disabled
claude mcp list             # expect: postgres-aiven ✓ Connected
```

Expected enabled: `ponytail`, `memsearch`, `context7`, `vercel`, `supabase`, `security-guidance`, `pr-review-toolkit`, `commit-commands`. `github` is intentionally disabled (endpoint requires GitHub Copilot; use `gh` CLI).

Ask the model: "list your available tools." It should mention Context7 doc-fetch, Vercel deploy tools, memsearch memory-recall skill, and postgres query tools.

## 2. Postgres MCP replaces the slow-cold-start pattern

Old pattern (this whole session used it): `bun -e "import('./lib/db/postgres').then(...)"` — 2500-3000 ms cold, 285 ms warm.

New pattern: use the `postgres-aiven` MCP `query` tool directly. Sub-100 ms.

Sanity: ask the model to query `cron_state` for `polymarket-edge:stats` via the MCP tool. Confirm no `bun -e` fallback used.

## 3. Trader is running (not halted)

Kill-switch fix landed as `2fd663b4`. Peak-floor now gates consecutive-losses too, so penny-noise no longer halts.

```
polymarket-edge:halted-until   should be 0
polymarket-edge:noedge-streak  low or 0
polymarket-edge:stats          growing normally
```

Quick check:
```bash
curl -s https://www.zkvanguard.xyz/api/health/production | \
  python -c "import json,sys;d=json.load(sys.stdin);print('build:',d['build']['commit']);print('trader age:',d['components']['traderCron']['ageSeconds'],'s');print('bluefin:',d['components']['bluefin']['positionsSummary'])"
```

Expected: `build: 2fd663b4` or newer, trader ageSeconds < 300, `bluefin` shows at least SUI-PERP LONG + ETH-PERP SHORT (pool dual-leg). SOL-PERP position optional (trader-owned, transient).

## 4. Refactored code paths — targeted tests

Prove the session's 8 commits didn't regress anything:

```bash
bun jest test/integration/pool-drawdown-defense.test.ts        # bulletproof, 10/10
bun jest test/unit/kill-switches.test.ts                       # 9/9 incl. new penny-noise regression
bun jest test/unit/trade-quality-gates.test.ts                 # riskGate extraction locked
bun jest test/unit/community-pool-mappers.test.ts              # allocation fallback fix locked
bun jest test/unit/alert-response-loop.test.ts                 # phantom-rate false-positive fix
```

Full suite: `bun jest` → expect `1199 pass / 1207` (6 failures are pre-existing environmental: 5 zk-stark need Python server, 3 wdk suites use `bun:test` runtime).

## 5. Verify GitHub release + tag

```bash
gh release view v0.4.0 --repo ZkVanguard/ZkVanguard | head -3
git tag -l                                                     # expect v0.4.0
```

## 6. Verify DB auto-prune is working

Kill switch for cron_state bloat runs on every `poly-discover` tick.

```bash
# Direct via postgres-aiven MCP (or fallback bun -e):
# SELECT COUNT(*) FROM cron_state WHERE key LIKE 'poly-momentum:history:%';
# Expect: stays roughly stable around 4000-6000, not climbing to 30k+.

# SELECT jsonb_array_length(value) FROM cron_state WHERE key = 'poly-discover:seenBroadSlugs';
# Expect: <= 2000 (cap).
```

## 7. Vercel env vars still in place (do not remove)

```bash
vercel env ls production | grep -E "PORTFOLIO_DRIVER_EXECUTE|STALE_HEDGE_AUTO_CLOSE|ALERT_RESPONSE_EXECUTE|TRADE_MAX_TOTAL_NOTIONAL_PCT|POLYMARKET_EDGE_LEVERAGE"
```

Expected all present. Values (encrypted, not visible via CLI):
- `PORTFOLIO_DRIVER_EXECUTE=1`
- `STALE_HEDGE_AUTO_CLOSE=1`
- `ALERT_RESPONSE_EXECUTE=1`
- `TRADE_MAX_TOTAL_NOTIONAL_PCT=250`
- `POLYMARKET_EDGE_LEVERAGE=5`

Code defaults now match these (via `envFlagOnByDefault`) so removal is safe but adds no value.

## 8. memsearch is auto-capturing

After the first Claude turn in the new session:

```bash
ls -la .memsearch/memory/
cat .memsearch/memory/$(date +%Y-%m-%d).md    # should have a session heading
```

If nothing there after a few turns: check `~/.claude/plugins/cache/memsearch-plugins/memsearch/0.4.17/README.md` §SessionStart for troubleshooting.

## 9. Deferred work (do NOT touch without pairing)

- **`components/dashboard/community-pool/useCommunityPool.ts:720-1347` — `handleDeposit` (627-LOC React callback)** — genuine monster but touches deposit flow across 4 chains. Needs paired browser testing. See memory `project_deferred_use_community_pool_split`.

## 10. Live prod state at handoff

```
build:      2fd663b4  (kill-switch fix)
gates:      3 ON (portfolioDriver, staleHedge, alertResponse) + halt OFF
nav:        ~$30 (fluctuating with pool P&L)
positions:  SUI-PERP LONG + ETH-PERP SHORT (pool dual-leg) ± trader SOL positions
trader:     stats fresh, halted-until=0
tests:      1199/1207 (100% of refactor-touched code)
release:    v0.4.0 tagged + pushed
```

---

**One-liner health check:**
```bash
curl -s https://www.zkvanguard.xyz/api/health/production | python -c "import json,sys;d=json.load(sys.stdin);print(d['build']['commit'],d['status'],d['components']['phantomRate']['status'],d['components']['bluefin']['positionsSummary'])"
```

If that returns `2fd663b4 healthy ok <positions>` → everything from this session is live and working. Move on.
