# Audit Phase 15 — off-chain TypeScript (2026-06-12)

The on-chain audit shipped at v0.2.0 on 2026-06-09 (release notes in
`docs/RELEASE_NOTES_v0.2.0.md`). v0.2.0 hardens the Move contracts but
leaves the off-chain TypeScript code intact — and that code holds
`SUI_POOL_ADMIN_KEY` + `SUI_AGENT_CAP_ID` + `BLUEFIN_PRIVATE_KEY`, plus
the only writer of the external-NAV oracle that the new share math
depends on. A bug here can drain or mis-account capital even with the
Move contracts bulletproofed.

Phase 15 covers:

- `app/api/cron/sui-community-pool/route.ts` (2 272 lines) — primary
  capital actor: settles hedges, pushes NAV oracle, opens new hedges,
  swaps via DEX
- `app/api/cron/bluefin-db-reconcile/route.ts` — DB ↔ BlueFin drift
  repair
- `lib/services/sui/SuiHedgeReconciler.ts` — on-chain ↔ DB drift repair
- `lib/services/sui/BluefinService.ts` — perp client (invariant
  enforcement)
- `lib/services/market-data/unified-price-provider.ts` — multi-source
  oracle

Not covered (deferred — out of scope for this phase):
- `polymarket-edge-trader` cron — already defends itself well
  (idempotent clientOrderId, kill-switch, daily-loss cap, signal-flip
  exit). Will revisit if a finding here motivates it.
- 7-agent orchestrator + `SafeExecutionGuard`.

## Severity scale (unchanged from prior phases)

- **CRITICAL** — direct fund loss, exploitable today
- **HIGH** — fund-at-risk path or invariant violation, narrow conditions
- **MEDIUM** — degraded semantics, surprising behavior, scaling concern
- **LOW** — code quality, minor info disclosure

## Findings

### HIGH — `settleActiveHedges` writes fake losses when replenishment is incomplete

**Status:** fixed in this commit.

**Path:** `app/api/cron/sui-community-pool/route.ts`. Each tick:

1. `replenishAdminUsdc(network, 1_000_000, prices)` — reverse-swap ALL
   admin-held wBTC/wETH/SUI back to USDC via the BlueFin 7k aggregator
2. `getAdminUsdcBalance(network)` — measure result
3. `if (adminUsdcForSettlement > 0.001) settleActiveHedges(network)` —
   distribute admin USDC proportionally across on-chain `active_hedges`
   and call `close_hedge` on each

**The bug:** step 1 can partially fail (aggregator route missing for
one asset, slippage tripped, RPC hiccup), leaving real value sitting in
unsold wBTC/wETH/SUI. Step 2 reports only the USDC portion. Step 3
proceeds with whatever USDC made it back and frames the deficit as
`is_profit=false, pnl_usdc=collateral-returned`, which the new Move
funds-verify guard (`assert!(funds >= max(0, collateral - pnl))`)
*accepts* because the math is internally consistent.

Result: the hedge is closed at a fake realized loss on the books; the
real value sits idle off-chain until the next tick's replenish (which
may itself fail again). Repeated partial failures bleed analytics state
even though no real capital was lost. Off-chain NAV attestation then
under-reports value, share math under-pays withdrawers — the v0.2.0
fix gets undone from a different angle.

**Fix:** new `getAdminNonUsdcUsdValue()` helper queries admin coin
balances post-replenish and sums residual wBTC/wETH/SUI USD value
(SUI excludes a 1.5 SUI gas reserve). Before invoking
`settleActiveHedges`, the cron now bails when:

```
residualUsd > HEDGE_SETTLE_RESIDUAL_GUARD_USD ($1 default)
  AND adminUsdcForSettlement < totalCollateralNeeded * 0.95
```

Both conditions must hold so that genuine realized losses (asset
depreciated → admin sold for less → no residual remaining) still
settle correctly. Only the partial-failure case is skipped. Discord
WARN fires so operators see the stall.

### HIGH — `SuiHedgeReconciler` mass-closes DB hedges if RPC returns empty fields

**Status:** fixed in this commit.

**Path:** `lib/services/sui/SuiHedgeReconciler.ts`. `readOnChainHedges()`
posts `sui_getObject` to a public Sui RPC node. The node can return a
200 OK with `result.data.content.fields` missing (transient propagation
issue across nodes). Current code returns `[]` in that case. Then the
caller closes every DB row whose `hedge_id_onchain` is not in the
(empty) on-chain set — applying `estimateHedgePnl(...)` with stale
prices and writing `realized_pnl` against rows that are still live
on-chain. Next tick the on-chain marker reappears, but the DB rows are
already closed; the reconciler does not re-open them.

**Fix:** before walking the close loop, check
`onChain.length === 0 && dbWithNotional >= 1` (notional ≥ $1 filters
out the $0.01 operational entries). If true, the read is treated as
transient and the reconciler returns early with an `errors` entry. The
next tick retries.

### HIGH — `bluefin-db-reconcile` mass-closes phantoms if BlueFin returns empty positions

**Status:** fixed in this commit.

**Path:** `app/api/cron/bluefin-db-reconcile/route.ts`. Same shape as
above but for the venue side. BlueFin's `/positions` returned `[]`
during a transient venue issue on 2026-05-30 (root cause of the
closeHedge silent-fail incident — see
`docs/DEPLOY_RUNBOOK.md` appendix Y). On that empty response the
phantom-close loop marks every DB row with `notional ≥ $1` as closed
at `realized_pnl=0`, even though the positions are still live on
BlueFin.

**Fix:** symmetrical guard. Before phantom-close,
`positions.length === 0 && dbNotionalCount > 0` short-circuits with
a Discord WARN and HTTP 200 success=false. Next 15-minute tick retries.

### HIGH — multi-source oracle is single-source in practice (Crypto.com only)

**Status:** documented; fix is roadmap T4-D (Pyth integration). Out of
scope for this phase because it requires a new external integration,
not just a code change.

**Path:** `lib/services/market-data/unified-price-provider.ts`,
`getMultiSourceValidatedPrice`. Three "independent" price sources:

1. `crypto.com` — `UnifiedPriceProvider` WebSocket/REST
2. `mcp-market` — `RealMarketDataService` which is documented in its own
   header as *"Aggregates real-time market data from Crypto.com sources
   only"*
3. `crypto.com-direct` — direct fetch to `api.crypto.com/exchange/v1`

All three are Crypto.com. If Crypto.com's API returns stale or
manipulated prices, the median agrees with itself, the deviation check
passes, the cron pushes those prices into:

- `attestExternalNav(navUsdTotal)` — sets the on-chain oracle that the
  v0.2.0 share math depends on
- `hedgeValueUsd(navUsd, allocation%, hedgeRatio)` — sizes new hedges
- `replenishAdminUsdc` USD value rankings — drives which asset is sold
  first

The Move oracle has a 30%-per-update delta guard so any single tick's
damage is bounded. But a compromised feed sustained over multiple ticks
can drift NAV materially.

**Mitigation paths:**

1. Add a truly independent source (Pyth on-chain pull oracle on Sui,
   Chainlink, CoinGecko, Binance) and require ≥ 2 *distinct provider
   families* (not 2 same-provider endpoints) for the deviation check
2. Until then, treat the existing `minSources: 2` check as theatre and
   tighten `BLUEFIN_MAX_FUNDING_RATE` + `BLUEFIN_MAX_OI_PCT` to
   compensate
3. T4-D explicit: ship Pyth integration before raising the TVL cap above
   $100k (v0.2.0 release notes already gate this milestone)

### MEDIUM — `replenishAdminUsdc(amount=1_000_000)` reverse-swaps everything every tick

**Status:** documented; design-level, not bug. No code change in this
phase.

**Path:** `app/api/cron/sui-community-pool/route.ts:1324`. Step 6.5 of
each cron tick:

```ts
const replenishment = await replenishAdminUsdc(network, 1_000_000, pricesUSD);
```

The `$1M` target is intentional — comment: *"Use a large target so ALL
assets are converted (not just shortfall)"*. Every tick sells the
admin's wBTC/wETH/SUI for USDC, then step 7 re-buys the same allocation.
At stable allocations this is a wash semantically but eats real slippage:

- Reverse-swap slippage tolerance: 2 % (line 483:
  `aggregator.executeSwap(reverseQuote, 0.02)`)
- Forward rebalance slippage tolerance: 1.5 % (line 1665:
  `aggregator.executeRebalance(swapPlan, 0.015)`)

Round-trip cost ≈ 3.5 % per tick × 48 ticks/day = ~170 % nominal
annualised slippage cost if executed naively at every tick on the full
position.

In practice `executeRebalance` skips swaps below ~$0.10 and the
aggregator quotes will reject high-slippage routes, so the bleed is
smaller — but the *design* is wasteful. Two paths forward:

1. **Settle only when allocation changes** — track last-applied
   allocation; only reverse-swap if AI allocation drift > 3 % AND the
   current asset mix differs from the desired one
2. **Settle only at end-of-day / after risk events** — operational
   micro-hedges (the $0.01 transport entries) don't need a corresponding
   round-trip; only real hedges (collateral ≥ $1) need to be closed

This is the largest single optimisation opportunity in the off-chain
stack, but the right design depends on operator preference and is not a
safety bug. Capturing as a tracked item for the next release.

### MEDIUM — `bluefin-db-reconcile` orphan auto-recovery uses markPrice as entry

**Status:** documented; analytics impact, not a safety bug.

**Path:** `app/api/cron/bluefin-db-reconcile/route.ts:200-214`. When an
orphan BlueFin position is auto-recovered into the DB, `entryPrice =
markPrice` — the price at recovery time, not the original open. PnL
calculations from that point forward exclude the price move between
the actual open and the recovery. The row is tagged
`reason: 'Orphan auto-recovered…'` so analytics can identify it, but
historical PnL is permanently lossy on that hedge.

Acceptable trade-off for the operator (alternative is to never
auto-recover and require manual intervention).

## Coverage table

| File | LOC | Pass depth |
|---|---|---|
| `sui-community-pool/route.ts` | 2 272 → 2 326 | full read |
| `bluefin-db-reconcile/route.ts` | 272 → 295 | full read |
| `sui-hedge-reconcile/route.ts` | 318 | spot read (delegates to SuiHedgeReconciler) |
| `SuiHedgeReconciler.ts` | 424 → 442 | full read |
| `BluefinService.ts` | 1 671 | targeted read (invariants enforcement — confirmed solid) |
| `unified-price-provider.ts` | 889 | targeted read (multi-source path) |
| `polymarket-edge-trader/route.ts` | — | deferred |

## Audit chain (commits)

```
6a58ff22  docs(deploy): BlueFin verification step before unpause
d9b21b58  audit(2026-06-09, phase 14 + v0.2.0): version bump + final edge cases + release notes
…
(this)    audit(2026-06-12, phase 15): off-chain TS — 3 HIGH fixes + 1 documented oracle gap
```

## Phase 15 vs v0.2.0

v0.2.0 made the Move contracts safe against bad inputs. Phase 15 makes
the off-chain code that produces those inputs safe against transient
infrastructure failures (RPC blip, venue API blip, partial swap
failure). The combined system still has a single-provider oracle gap
(Crypto.com) that requires an external integration to close — flagged
for T4-D in the roadmap, not in scope for this phase.
