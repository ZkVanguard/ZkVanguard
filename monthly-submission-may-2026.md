# Sui Monthly Submission — May 2026

## 1. Primary GitHub Repository

**https://github.com/ZkVanguard/ZkVanguard**

(Mirrors: https://github.com/ZkVanguard/ai-agents, https://github.com/ZkVanguard/contracts-sui)

## 2. GitHub Username (Author)

**`Mrare Jimmy`** (`mrarejimmy@icloud.com`)

All 125 commits landed in May 2026 are authored by this account.

## 3. Execution Path

- ☑ **Move smart contracts** — `contracts/sui/sources/community_pool_usdc.move` invariants enforced from clients (`max_hedge_ratio_bps`, daily-cap, 20% reserve, u64 safe-math via `lib/services/sui/safe-bigint.ts`)
- ☑ **Application / backend integration (SDK / RPC / Indexer)** — `@mysten/sui` SDK, Sui RPC, Bluefin Pro perp DEX SDK, 7k aggregator SDK, distributed cron orchestrator
- ☑ **Integration with Sui ecosystem infrastructure** — Bluefin Pro (perp DEX on Sui), 7k Aggregator (DEX aggregator on Sui, routes through Cetus / DeepBook / Turbos / FlowX / Aftermath), MSafe (multisig custody of `FeeManagerCap`)

## 4. Work Completed This Month

1. **Autonomous prediction-market perp trader on Bluefin Pro (Sui).**
   Built and shipped the `polymarket-edge-trader` cron — a 5-minute autonomous trader that fuses a Polymarket 5-min BTC binary, a broader Delphi/Polymarket scanner, Crypto.com 24h tickers and Bluefin funding rates into a single weighted signal, then opens BTC/ETH perps on **Bluefin Pro** with Kelly-fractional compounding, a 30 bps post-fill slippage gate, a 5-strike / 30%-drawdown / daily-PnL 24h kill switch, signal-flip early-exit, persistent peak tracking across cold starts, and wire-level idempotency via `clientOrderId = polyedge_${asset}_${tickEpoch}`. Every state change emits a Discord alert. The trader is live on mainnet on a `*/5 * * * *` QStash schedule.

2. **Bluefin invariants hardening — eliminated the silent-reject bug class.**
   Diagnosed and fixed every code path where Bluefin Pro returns an `orderHash` but the matching engine silently drops the order. Five root causes shipped: (a) quantity must be snapped to per-symbol step size before signing (SUI=1, ETH=0.01, BTC=0.001) — `lib/services/sui/BluefinService.ts:snapToStepSize`; (b) `closeHedge` must use the position's actual leverage, not 1×; (c) the deprecated `reduceOnly` flag is now refused by the API and must be dropped; (d) `openHedge` and `closeHedge` must poll `getPositions()` for fill verification, not trust `orderHash` alone; (e) per-trade `BLUEFIN_PAIRS` config now ground-truths step/min for SUI-PERP / BTC-PERP / ETH-PERP. Added `/api/admin/bluefin-debug` (read-only) and `/api/admin/close-bluefin-positions` (flatten everything) as operator-side ground-truth probes. Documented as Appendix Y in `docs/DEPLOY_RUNBOOK.md`.

3. **Three-cron reconciliation topology + composite health probe + drawdown halt.**
   Added three independent reconcilers that together close every drift surface between the on-chain Move pool, Bluefin Pro perps, and the Postgres `hedges` table: `sui-hedge-reconcile` (hourly, on-chain ↔ Bluefin), `bluefin-db-reconcile` (15-min, Bluefin ↔ DB, auto-recovers orphan BlueFin positions into the DB), and the in-service `SuiHedgeReconciler.reconcileSuiHedges()` (on-demand, on-chain ↔ DB). Added `bluefin-health` cron (5-min, 3-strike venue de-risk → flatten all positions), a 10-min `health-monitor` that hits `/api/health/production` and Discord-alerts on degradation, and a 10%-from-peak-NAV drawdown halt that disables auto-hedge until UTC midnight. Composite probe surfaces Bluefin positions, margin, collateral floor and per-cron freshness in one endpoint.

4. **Scale-readiness toolkit (T1–T5) — code-side walls cleared up to mid-eight-figures NAV.**
   Shipped a numbered set of scaling guards documented in CLAUDE.md: T1-A hedgeability clamp drops assets whose allocation can't clear Bluefin per-symbol minQty and (in `ef1b9ec6`) also drops assets that fail the T3-B OI cap; T1-C max-hold force-close; T3-A env-overridable scale limits with NAV-ceiling pre-warn (replaces hardcoded $10M / $100M caps); T3-B pre-trade open-interest guard on `openHedge`; T3-C `executeSplitSwap` for large USDC → asset swaps that would otherwise spike aggregator slippage; T5-A Phase 1 multi-venue OI compare (Hyperliquid read-only) so the hedge router can see when SUI Bluefin OI is the binding constraint. Companion `1a530eb8` — diagnosed that Bluefin's `openInterestE9` is a USD value, not `base × 1e9`, and corrected the parser.

5. **AI signal wired into the SUI Community Pool cron — daily-cap reset + signal-driven small-NAV hedging.**
   The SUI cron now reads the live Polymarket 5-min signal at UTC midnight and adjusts `MAX_DAILY_HEDGE_CAP` ±20% on STRONG bull/bear (`b17bfb48`); rebalances are gated on the signal not opposing the AI allocation (`8a293887`); at small NAV the cron now opens signal-driven BTC/ETH/SUI perps with 10× leverage so BTC notional can clear Bluefin's minQty floor (`529eb2e2`, `25e344f4`); and auto-funds Bluefin margin from idle pool USDC (with SUI fallback via 7k aggregator swap) so the trader can't stall on collateral (`a6988ceb`).

## 5. Sui Stack Components Used

- **Sui Move smart contracts** (custom `community_pool_usdc` module on Sui mainnet)
- **Sui SDK / RPC** (`@mysten/sui` Transaction builder, sponsored-tx flow, `sui_getObject` for on-chain reconciliation)
- **Bluefin Pro** (Sui-native perpetual DEX — BTC-PERP / ETH-PERP / SUI-PERP, USDC collateral, autonomous trader + auto-hedge)
- **7k Aggregator** (Sui DEX aggregator — pool rebalance swaps + collateral top-up swaps; routes across Cetus, DeepBook, Turbos, FlowX, Aftermath, Bluefin)
- **MSafe** (Sui multisig — holds `FeeManagerCap` per `d4dfe9d0`)
- **zkLogin / Slush wallet** (universal-link onboarding for mobile depositors)

## 6. Integration Description

The Sui mainnet pool is the system's primary product. A fleet of QStash-driven crons read NAV and pool state from the `community_pool_usdc` Move contract and execute capital actions through Bluefin Pro and the 7k aggregator:

1. **Autonomous trader (`polymarket-edge-trader`, 5-min)** — reads a fused Polymarket + Delphi + ticker + funding signal, opens BTC/ETH perps on **Bluefin Pro** sized by Kelly-fractional compounding, exits on signal-flip or hold-expiry, and persists realized PnL + peak NAV to Postgres `cron_state` for the 24h kill switch.
2. **Auto-hedge (`sui-community-pool`, 30-min)** — reads on-chain `max_hedge_ratio_bps` + daily cap, calls `open_hedge` on the Move contract to transfer USDC from the pool capability to the admin wallet, opens a directional perp on **Bluefin Pro** on the AI side, and on the next cycle calls `close_hedge` + `record_pnl` to settle on-chain.
3. **Rebalance** — when AI confidence ≥ 65% and the live Polymarket 5-min signal isn't opposing, drift-driven spot swaps are routed through the **7k Aggregator**.
4. **Three-source reconciliation** — every cron tick the on-chain pool state, Bluefin Pro account, and Postgres `hedges` table are cross-checked by three independent reconcilers (1h on-chain↔Bluefin, 15min Bluefin↔DB, on-demand on-chain↔DB); orphan Bluefin positions are auto-adopted into the DB.
5. **ZK attestations** — every hedge >$1M notional carries a STARK proof hash anchored on Sui via the `zk_hedge_commitment` / `zk_verifier` Move modules (P-521, no trusted setup; Python FastAPI prover called over HTTP from TypeScript).

## 7. Verifiable Technical Evidence

### Autonomous Bluefin Pro perp trader (new product, shipped this month)
- `41c833ee` — feat(crons): polymarket-edge-trader — high-confidence binary signals → BTC perp w/ Kelly-fractional compounding & 24h kill switch — https://github.com/ZkVanguard/ZkVanguard/commit/41c833ee
- `9381dd93` — feat(polymarket-edge): trade aggregated multi-source signal (Polymarket + Delphi + 24h momentum + funding) with BTC/ETH routing and consensus-gated entries — https://github.com/ZkVanguard/ZkVanguard/commit/9381dd93
- `9b399c0a` — feat(prediction-aggregator): per-asset multi-market scanner; cron now picks best of BTC/ETH each tick — https://github.com/ZkVanguard/ZkVanguard/commit/9b399c0a
- `51dfed85` — feat(polymarket-edge): bulletproof — real funding source, signal-flip stop, slippage gate, daily PnL cap, Discord alerts, persistent peak, accuracy fix — https://github.com/ZkVanguard/ZkVanguard/commit/51dfed85
- `353fb791` — feat(bluefin): wire `clientOrderId` for wire-level order idempotency — https://github.com/ZkVanguard/ZkVanguard/commit/353fb791

### Bluefin Pro invariants — silent-reject bug class eliminated
- `445e859c` — fix(bluefin): closeHedge snaps to per-symbol step size — https://github.com/ZkVanguard/ZkVanguard/commit/445e859c
- `276a5dc1` — fix(bluefin): closeHedge uses position's leverage, not 1x — https://github.com/ZkVanguard/ZkVanguard/commit/276a5dc1
- `d8fa1d9e` — fix(bluefin): drop deprecated reduceOnly flag in closeHedge — https://github.com/ZkVanguard/ZkVanguard/commit/d8fa1d9e
- `95b78d94` — fix(bluefin): closeHedge verifies actual fill, not just orderHash — https://github.com/ZkVanguard/ZkVanguard/commit/95b78d94
- `148a6dab` — fix(bluefin): openHedge verifies actual fill, symmetric to closeHedge — https://github.com/ZkVanguard/ZkVanguard/commit/148a6dab
- `b88eae4d` — fix(bluefin): correct float undersizing of perp order step-snapping — https://github.com/ZkVanguard/ZkVanguard/commit/b88eae4d
- `434cd19e` — feat(admin): bluefin-debug read-only route — positions + open orders + balance — https://github.com/ZkVanguard/ZkVanguard/commit/434cd19e
- `a3363832` — feat(admin): close-bluefin-positions replaces cancel-bluefin-orders — https://github.com/ZkVanguard/ZkVanguard/commit/a3363832
- `8a609453` — docs(runbook): BlueFin invariants + reconcile topology + admin endpoints — https://github.com/ZkVanguard/ZkVanguard/commit/8a609453

### Three-cron reconciliation topology + health + drawdown
- `f56eb58d` — feat(safety): three guard crons for -scale operational bulletproofing (`bluefin-health`, `sui-hedge-reconcile`, `sui-collect-fees`) — https://github.com/ZkVanguard/ZkVanguard/commit/f56eb58d
- `db4845f6` — feat(cron): BlueFin ↔ DB hedges reconciler (15min) — https://github.com/ZkVanguard/ZkVanguard/commit/db4845f6
- `dcd97b3a` — feat(reconcile): auto-recover orphan BlueFin positions into DB — https://github.com/ZkVanguard/ZkVanguard/commit/dcd97b3a
- `cc78adf1` — feat(health): add `/api/health/production` composite liveness probe — https://github.com/ZkVanguard/ZkVanguard/commit/cc78adf1
- `c34638a4` — feat(cron): proactive health-monitor → Discord (10min) — https://github.com/ZkVanguard/ZkVanguard/commit/c34638a4
- `675fd262` — feat(cron): auto-hedge drawdown halt (10% from peak NAV, until UTC midnight) — https://github.com/ZkVanguard/ZkVanguard/commit/675fd262
- `a3c7b543` — fix(cron): auto-hedge closes opposite-side position on direction flip — https://github.com/ZkVanguard/ZkVanguard/commit/a3c7b543

### Scale-readiness toolkit (T1–T5)
- `8376022b` — feat(scale): T1-A hedgeability clamp + T1-C max-hold force-close — https://github.com/ZkVanguard/ZkVanguard/commit/8376022b
- `221cba90` — feat(scale): T3-A env-overridable scale limits + NAV ceiling pre-warn — https://github.com/ZkVanguard/ZkVanguard/commit/221cba90
- `68197f71` — feat(bluefin): T3-B open-interest pre-trade guard on openHedge — https://github.com/ZkVanguard/ZkVanguard/commit/68197f71
- `3aa3ad35` — feat(scale): T3-C executeSplitSwap for large USDC → asset swaps — https://github.com/ZkVanguard/ZkVanguard/commit/3aa3ad35
- `351abbfc` — feat(perps): T5-A Phase 1 — Hyperliquid read-only + multi-venue OI compare — https://github.com/ZkVanguard/ZkVanguard/commit/351abbfc
- `1a530eb8` — fix(bluefin): openInterestE9 is USD value, not base × 1e9 — https://github.com/ZkVanguard/ZkVanguard/commit/1a530eb8
- `ef1b9ec6` — feat(scale): T1-A clamp also drops assets that fail T3-B OI cap — https://github.com/ZkVanguard/ZkVanguard/commit/ef1b9ec6
- `0e0dca70` — test+docs: T1-A hedgeable-allocation golden tests + scale-tier env doc — https://github.com/ZkVanguard/ZkVanguard/commit/0e0dca70

### AI signal wired into the SUI Community Pool cron
- `b17bfb48` — feat(sui-cron): AI-driven daily-cap reset using prediction-market signal — https://github.com/ZkVanguard/ZkVanguard/commit/b17bfb48
- `529eb2e2` — feat(sui-cron): signal-driven BTC/ETH/SUI perp hedging at small NAV — https://github.com/ZkVanguard/ZkVanguard/commit/529eb2e2
- `25e344f4` — fix(sui-cron): bump auto-hedge leverage to 10x at small NAV so BTC clears minQty — https://github.com/ZkVanguard/ZkVanguard/commit/25e344f4
- `a6988ceb` — feat(sui-cron): auto-fund BlueFin margin from pool USDC + SUI fallback — https://github.com/ZkVanguard/ZkVanguard/commit/a6988ceb
- `0f23a53c` — feat(sui-cron): add safe-bigint u64 guards + distributed cron-state CAS/halt — https://github.com/ZkVanguard/ZkVanguard/commit/0f23a53c

### NAV correctness + dashboard truth
- `4c5f4800` — fix(nav): include BlueFin balances + WBTC canonical-form match + reconcile stale hedge rows — https://github.com/ZkVanguard/ZkVanguard/commit/4c5f4800
- `9a0eb3eb` — feat(community-pool): show total return % and total profit $ on SUI pool dashboard — https://github.com/ZkVanguard/ZkVanguard/commit/9a0eb3eb
- `96b8c96e` — fix(dashboard): show real share price + self-healing hedge reconciler — https://github.com/ZkVanguard/ZkVanguard/commit/96b8c96e
- `e14babfb` — fix(ui): show real pool composition instead of hardcoded SUI 100% — https://github.com/ZkVanguard/ZkVanguard/commit/e14babfb
- `746d3837` — fix(reconciler): estimate realized PnL on close + fix garbage current_pnl formula — https://github.com/ZkVanguard/ZkVanguard/commit/746d3837
- `f46b5289` — fix(hedges): keep `current_pnl` consistent with `realized_pnl` across all close paths — https://github.com/ZkVanguard/ZkVanguard/commit/f46b5289

### MSafe multisig + treasury custody
- `d4dfe9d0` — scripts(sui): MSafe multisig — FeeManagerCap moved + AdminCap script ready — https://github.com/ZkVanguard/ZkVanguard/commit/d4dfe9d0
- `e95e3064` — fix(sui): revert treasury to operator wallet — autonomous hedging restored — https://github.com/ZkVanguard/ZkVanguard/commit/e95e3064
- `1ee61a8d` — scripts(sui): set mainnet pool treasury to MSafe multisig — https://github.com/ZkVanguard/ZkVanguard/commit/1ee61a8d

### Test + refactor coverage (extracted modules with golden tests)
- `afb89250` — test(stage-0): golden tests for money-math + extract hedge PnL helper — https://github.com/ZkVanguard/ZkVanguard/commit/afb89250
- `bf515ed8` — refactor(stage-2): extract + test auto-hedge sizing math — https://github.com/ZkVanguard/ZkVanguard/commit/bf515ed8
- `bc95a30c` — refactor(stage-3): extract + test pool NAV / share-price math — https://github.com/ZkVanguard/ZkVanguard/commit/bc95a30c
- `1dc6b841` — refactor(stage-3): extract + test pool allocation composition — https://github.com/ZkVanguard/ZkVanguard/commit/1dc6b841
- `7abd2204` — test(stage-5): lock hedge calibration & Kelly sizing — https://github.com/ZkVanguard/ZkVanguard/commit/7abd2204
- `2a3f0403` — test(stage-5): lock the SafeExecutionGuard trade gate — https://github.com/ZkVanguard/ZkVanguard/commit/2a3f0403
- `e03bdc00` — test(stage-5): cover SafeExecutionGuard circuit breaker — https://github.com/ZkVanguard/ZkVanguard/commit/e03bdc00
- `d6a78ed0` — test(stage-3): lock ZK hedge-ownership binding — https://github.com/ZkVanguard/ZkVanguard/commit/d6a78ed0

## 8. Deployment / Integration Proof (mainnet)

- **Sui Move package** (live):
  `0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88`
  https://suiscan.xyz/mainnet/object/0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88
- **Pool state object**:
  https://suiscan.xyz/mainnet/object/0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a
- **USDC type used by pool**:
  `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`
- **Bluefin Pro operator wallet** (autonomous trader + auto-hedge):
  `0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93`
- **MSafe multisig** (holds `FeeManagerCap` after `d4dfe9d0`):
  set via `SUI_MSAFE_ADDRESS`
- **Live application**: https://www.zkvanguard.xyz

### Live QStash schedules (snapshot 2026-05-31; all SUCCESS)

| Route | Cron | Status |
|---|---|---|
| `polymarket-edge-trader` | `*/5 * * * *` | SUCCESS (new this month) |
| `bluefin-health` | `*/5 * * * *` | SUCCESS (added 2026-05-29) |
| `liquidation-guard` | `*/10 * * * *` | SUCCESS |
| `health-monitor` | `*/10 * * * *` | SUCCESS (added 2026-05-31) |
| `pool-nav-monitor` | `*/15 * * * *` | SUCCESS |
| `hedge-monitor` | `*/15 * * * *` | SUCCESS |
| `bluefin-db-reconcile` | `*/15 * * * *` | SUCCESS (added 2026-05-31) |
| `sui-community-pool` | `*/30 * * * *` | SUCCESS |
| `sui-hedge-reconcile` | `0 * * * *` | SUCCESS (added 2026-05-29) |
| `sui-collect-fees` | `0 12 * * *` | SUCCESS (added 2026-05-29) |

### Numbers

- **125 commits** authored by `Mrare Jimmy` between 2026-05-02 and 2026-06-01
- **5 new production cron routes** added and scheduled on QStash
- **2 new operator admin endpoints** (`/api/admin/bluefin-debug`, `/api/admin/close-bluefin-positions`)
- **1 new composite health probe** (`/api/health/production`)
- **5 distinct Bluefin Pro silent-reject root causes** diagnosed and patched
