# Weekly Submission — April 20–24, 2026

## 1. What did you work on this week?

### Bluefin V2 Margin Bank Auto-Top-Up (Sui-native PTB)

Built `BluefinTreasuryService` to automate USDC top-ups from the operator's Sui spot wallet into the Bluefin V2 Margin Bank so the auto-hedge cron can place real perp orders without any manual UI step. The official `@bluefin-exchange/bluefin-v2-client` SDK is V1-architecture-only and depends on a decommissioned gateway (`dapi.api.sui-prod.bluefin.io` returning 503 "no healthy upstream"), so I bypassed it entirely and built the deposit transaction directly with `@mysten/sui` against Bluefin's V2 mainnet contract — calling `exchange::deposit_to_asset_bank<USDC>(eds, "USDC", account, amount, &mut Coin<USDC>, ctx)` with the verified shared `ExternalDataStore` (`0x740d97...`, initial shared version 510828396) and package `0xe74481...`. Discovered the V2 `&mut Coin<T>` semantics — passing a `splitCoins` result fails with `UnusedValueWithoutDrop`; the entry mutates an existing coin object in place. Added a 1 USDC minimum-deposit guard after decoding abort code 1030 from the Move source.

### SUI → USDC Auto-Swap with DEX Source Fallback

When the operator's spot USDC is below the top-up target, the service now auto-swaps SUI → USDC via the Bluefin 7k aggregator SDK before depositing. To route around paused pools (default route hit `assert_not_pause` at package `0xcf60a4...`), I implemented a fallback chain that re-quotes with progressively-restricted `sources` arrays — `[default → cetus+bluefin+deepbook_v3 → bluefin → cetus → deepbook_v3]` — and only retries pause-style aborts. Verified live: tx `Frk3xPMzDf11fFCT95UatJ1N5TNwpJwVfK83HniravvK` succeeded after the default route was paused. Added env-driven safety knobs: `BLUEFIN_SUI_RESERVE` (gas reserve), `BLUEFIN_MAX_SWAP_SUI` (per-run cap), `BLUEFIN_MIN_MARGIN_USD`, `BLUEFIN_TARGET_MARGIN_USD`.

### Auto-Hedge Cron Hardening — Preflight + On-Chain Reconciler

Hardened the SUI community-pool cron with three new safety layers: (1) a **preflight endpoint** (`/api/admin/bluefin-preflight`) that verifies free collateral, contract config, and Bluefin connectivity before a tick is allowed to place orders; (2) an **on-chain hedge reconciler** (`SuiHedgeReconciler` + `/api/admin/reconcile-sui-hedges`) that cross-references DB hedge rows against on-chain pool state, inserting missing entries and closing stale ones so the AutoHedgePanel UI reflects ground truth; (3) the **auto-top-up hook** wired into the cron path so margin shortfalls are resolved automatically before the `freeCollateral <= 0` abort. Also added `lib/services/hedging/calibration.ts` (deterministic position-sizing math + tests) and a slippage-ladder retry on reverse-swaps so closing hedge legs doesn't fail on a single 1% slippage breach.

### Polymarket Prediction-Signal Gate + On-Chain Hedge Surfacing

Wired the existing Polymarket 5-min prediction signal into the rebalance gate so the cron only opens new directional exposure when the prediction confidence agrees with allocation drift. Surfaced on-chain pool hedges in the AutoHedgePanel by reading directly from the SUI pool object instead of relying solely on DB rows — fixed a stale-cache issue by switching to a 60s on-chain read cache and allowing string IDs in the panel typing. Normalised coin types in the cron's replenish-candidate matcher so USDC variants from different swap routes resolve to the same canonical type.

### NAV Inclusion of Admin Assets + Env Sanitisation

Included admin-held assets in pool NAV calculation so total value reported by the dashboard matches on-chain reality. Added `lib/utils/sanitize-env.ts` and `scripts/clean-vercel-env.ps1` to strip CRLF/whitespace from Vercel-pulled env vars (root cause of recurring `SUI_NETWORK` testnet-fallback bugs); new `instrumentation.ts` runs sanitisation on cold start.

---

## 2. Code links from this week

- **Include admin assets in NAV, retry reverse-swap with slippage ladder, Polymarket prediction-signal gate:**
  https://github.com/ZkVanguard/ZkVanguard/commit/0be6d8e

- **Surface on-chain pool hedges in AutoHedgePanel + on-chain config for SUI cron:**
  https://github.com/ZkVanguard/ZkVanguard/commit/0bbee58

---

## 3. Blockers or notes

The Bluefin V2 mainnet deposit PTB is structurally correct and reaches `bank::deposit_to_asset_bank` cleanly (last dry-run abort was the 1030 minimum-deposit check, not a structural failure), but the operator wallet was drained to ~0.14 SUI / 0.76 USDC by gas during paused-pool retries — a fresh top-up of the operator wallet is needed to confirm the first end-to-end automated deposit on-chain. Bluefin's `dapi.api.sui-prod.bluefin.io` gateway is fully decommissioned, so the official `@bluefin-exchange/bluefin-v2-client@6.5.1` SDK can no longer build deposit PTBs on V2 mainnet — anyone integrating Bluefin V2 should plan to hand-roll the `exchange::deposit_to_asset_bank` PTB the same way. Long-term enhancement: shift top-up funding from the operator's spot wallet to the CommunityPool admin treasury via a privileged `AdminCap` call so the system pulls directly from user deposits instead of operator-held SUI.

---

## 4. Sui Stack Components Used

- **Move smart contracts (mainnet)** — Direct PTB integration with Bluefin V2 mainnet (`exchange::deposit_to_asset_bank<USDC>`) and the ZkVanguard `community_pool_usdc` package; on-chain hedge state read via shared-object inspection.
- **DeepBook + Cetus + Bluefin liquidity** — Multi-source SUI → USDC swap routing via the Bluefin 7k aggregator SDK with explicit `sources` fallback to route around paused pools.
- **Sui transactions / Ed25519 signing** — `@mysten/sui` `Transaction` builder + `Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(...))` for signing the V2 deposit and reverse-swap legs server-side.
