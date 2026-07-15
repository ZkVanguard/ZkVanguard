# Week 11 - 15th Submission

## 1. What did you work on this week?

- **Hardened SUI community-pool hedge reconciliation and PnL data integrity.** Consolidated SUI hedge sync onto the canonical `SuiHedgeReconciler` (removed ~40 lines of divergent inline logic in the pool API route), made the reconciler self-heal hedges written with the wrong `portfolio_id`, stopped a Bluefin-staleness check from wrongly firing on SUI hedges, and made the reconciler estimate realized PnL on close. Also fixed `current_pnl`/`realized_pnl` so they stay consistent across all five hedge close paths (previously closed rows carried stale or garbage PnL snapshots).

- **Built read-only diagnostics for the SUI pool.** Added `analyze-pool-pnl.ts` (full NAV decomposition: idle USDC vs Bluefin collateral vs admin assets, capital-flow PnL, share-price return, realized vs unrealized hedge PnL, fees) and `check-hedge-signal-alignment.ts` (compares open on-chain + DB hedges against the live Polymarket 5-min signal direction), then corrected their on-chain field reads and member query. Also added a deep regression suite for the Polymarket edge trader.

## 2. Code links

- Reconciler + PnL fix: https://github.com/ZkVanguard/ZkVanguard/commit/746d3837
- SUI pool diagnostics: https://github.com/ZkVanguard/ZkVanguard/commit/32dbe276

## 3. Blockers or notes

- Most SUI hedge closes are reconciler-driven (the on-chain entry just disappears), so the reconciler can't recover exact settled PnL for those — it estimates. `realized_pnl=0` on many closed rows reflects that limitation, not an actual zero.
- The on-chain `active_hedges` set still mixes real risk hedges with $0.01 operational "transport" hedges; analytics must keep filtering by collateral ≥ 1 USDC to avoid false misalignment signals.

## 4. Sui Stack Components Used

- **Move smart contracts** — SUI mainnet community pool (`community_pool` / `hedge_executor`) on-chain hedge state read via `sui_getObject` for reconciliation; Bluefin V2 perps as the hedging venue.
