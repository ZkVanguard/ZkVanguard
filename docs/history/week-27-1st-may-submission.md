# Weekly Submission — Week 27 (Apr 27 – May 1, 2026)

## 1. What did you work on this week?

1. **Bullet-proof three-layer hedge sync on Sui mainnet** — Hardened the synchronization between Postgres (`hedges` table), the on-chain `community_pool_usdc` Move contract, and the Bluefin Pro perp account. Added atomic DB helpers (`getHedgeByOnchainId`, `closeHedgeByOnchainId`, `recordSuiOnchainHedge`), a Postgres-backed distributed decision lock (`tryAcquireHedgeDecisionLock`) so overlapping cron invocations cannot double-open hedges, and an orphan-adoption reconciler that pulls live Bluefin perp positions back into the DB. End-to-end verifiers (`scripts/verify-bluefin-hedges.mjs`, `scripts/test-hedge-sync-e2e.mjs`, `scripts/verify-qstash-sync.mjs`) now PASS against mainnet.

2. **Bluefin Pro mainnet integration fix + capital-efficiency overhaul** — Fixed `BluefinService` to parse Bluefin Pro's E9 number format (`avgEntryPriceE9`, `markPriceE9`, `leverageE9`, `unrealizedPnlE9`, `marginAvailableE9` / `1e9`) and derive position size from `initialMargin × leverage / entry` (Bluefin omits `quantity`). This restored visibility of a live SUI-PERP SHORT (3.81 SUI @ $0.953, +$0.178 unrealized PnL) that was invisible to the cron. Then unlocked auto-hedging for small pools (`navUsd ≥ $30` instead of `≥ $1000`), lowered the default risk-trigger from 8 to 5, added profit-protection on stale-perp force-close, and made the cost-benefit gate scale with NAV — eliminating the 8 wasteful 0-PnL cycles/day observed in production on the live `$51` mainnet pool.

## 2. Code links

- `eb1ba5e0` — fix(sui-cron): bullet-proof three-layer hedge sync (DB ↔ on-chain ↔ Bluefin) — https://github.com/ZkVanguard/ZkVanguard/commit/eb1ba5e0
- `87e62f43` — fix(bluefin): correct E9 field parsing + reconcile orphan perps — https://github.com/ZkVanguard/ZkVanguard/commit/87e62f43
- `05639231` — feat(cron): unlock auto-hedge for small pools, protect profitable stale perps — https://github.com/ZkVanguard/ZkVanguard/commit/05639231

## 3. Blockers or notes

- **No blockers.** All verifiers PASS on mainnet at submission time.
- The cron previously exhibited 8 zero-PnL hedge cycles per day. Root cause turned out to be (a) Bluefin Pro's E9 format made positions look empty so `close_hedge` was firing on `$0.10` orphan-USDC dust, and (b) the auto-hedge path was gated at `navUsd ≥ $1000` while the live pool is `$51` — auto-hedge could never trigger. Both addressed; production cron is now expected to either run a proper hedge cycle (with non-zero PnL recorded on-chain via `record_pnl`) or skip cleanly.
- Bluefin operator wallet `0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93` currently runs with `$0.354` free collateral; the new auto-top-up path (commit `5d82e779`) will pull from spot when needed.
- Live Sui mainnet artifacts:
  - Move package `0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88`
  - Pool state `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a`
  - USDC type `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`

## 4. Sui Stack Components Used

- **Move smart contracts** — `community_pool_usdc` module on Sui mainnet (`open_hedge` / `close_hedge` / `record_pnl`, on-chain `max_hedge_ratio_bps` enforcement, daily hedge cap)
- **Sui SDK / RPC** — `@mysten/sui` Transaction builder, event indexing for `UsdcHedgeOpened` / `UsdcHedgeClosed`, sponsored-tx flow for user deposits/withdraws
- **Bluefin Pro** — Sui-native perpetual DEX, used for protective SHORT hedges (live SUI-PERP position currently held)
- **7k Aggregator** — Sui DEX aggregator, used for pool rebalancing swaps between USDC ↔ SUI/BTC/ETH
