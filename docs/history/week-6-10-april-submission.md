# Weekly Submission — April 6–10, 2026

## 1. What did you work on this week?

### SUI Services Testnet → Mainnet Migration

Switched all 9 SUI service files from testnet to mainnet defaults — `SuiCommunityPoolService`, `BluefinService`, `BluefinAggregatorService`, `SuiAutoHedgingAdapter`, `SuiPoolAgent`, SUI cron route, and wallet providers. Fixed 102 SUI chain-specific optimization issues including hardcoded testnet RPC endpoints, incorrect coin-type addresses, missing mainnet deployment maps, and stale testnet object IDs. Updated `SUI_NETWORK` default from `testnet` to `mainnet` across all configuration entry points.

### BlueFin Mainnet Switch & API Hardening

Switched BlueFin from testnet (`dapi.api.sui-staging.bluefin.io`) to mainnet (`trade.bluefin.io`). Updated all API paths from deprecated `/api/v1/*` to new `/v1/exchange/*` endpoints (old paths returned 503). Added critical service hardening: exponential backoff retry (3 attempts), 10-second request timeouts, account onboarding verification, response caching for exchange info, and RPC health checks. Synced `BLUEFIN_PAIRS` with live exchange info and added minimum order size validation. Cleaned up 645 lines of dead BlueFin code from duplicate service files.

### SUI Cron: Live Swap Execution & BlueFin Perp Hedging

Enabled real swap execution in the SUI cron route — when the pool has value, the cron now always plans and executes rebalance swaps through the BlueFin 7k Aggregator (Cetus, DeepBook, Turbos, FlowX, Aftermath routing). Also enabled BlueFin perpetual hedging in the cron cycle: after swaps, non-swappable asset allocations trigger hedge positions on BlueFin Pro. Wired up actual swap execution for both Cronos and SUI community pools. Completed SUI pool-admin capability transfer to the correct admin address.

### Codebase Architecture Refactoring

Reorganized 38 service files into chain-specific folders (`lib/services/sui/`, `lib/services/cronos/`, `lib/services/hedera/`, `lib/services/wdk/`) for clear separation of concerns across the multi-chain architecture. Extracted types and configs from 5 large files (>500 lines each) into dedicated type modules. Extracted risk math functions from `AutoHedgingService` (1,316→1,129 lines), reducers and chain params from `useCommunityPool` hook, and type interfaces from `PositionsList` component. Removed 6 dead files and consolidated duplicate loggers (-1,266 LOC). Removed 7 duplicate services and extracted shared hedge types (-3,427 LOC combined with previous week's cleanup).

### Platform Security Audit

Conducted platform-wide security audit: migrated all secret comparisons to timing-safe `crypto.timingSafeEqual`, added input validation with strict type checking on all mutation endpoints, upgraded rate limiting across 13 heavy/mutation routes to distributed enforcement via Upstash Redis, and migrated remaining `console.log` calls to structured logger.

---

## 2. Code links from this week

- **Fix 102 SUI chain optimization issues across 9 service files:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/f450338

- **Switch all SUI services from testnet to mainnet defaults:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/d6eaadd

- **Critical BlueFin service hardening — retry, timeout, onboard, cache, RPC health:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/26dfefe

- **Switch BlueFin to mainnet (trade.bluefin.io):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/b21e3ef

- **Update BlueFin API paths to /v1/exchange/* (old paths deprecated):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/e801823

- **SUI cron: enable BlueFin perp hedging and always execute swaps:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/d80c2e9

- **Wire up actual swap execution for Cronos and SUI community pools:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/2325d18

- **Organize 38 services into chain-specific folders:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/aab8082

- **Security: platform audit — timing-safe auth, input validation, rate limiting:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/99959c6

- **Deep audit — rate limiting, input validation, HMAC binding, timing-safe secrets:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/4e45051

---

## 3. Blockers or notes

No blockers. All SUI services are now configured for mainnet by default. BlueFin is pointing to mainnet with hardened retry logic. The cron route is executing real swaps and hedge positions. Next step is the actual SUI mainnet contract deployment.

---

## 4. Sui Stack Components Used

- **SUI RPC / mainnet configuration** — Switched 9 service files to mainnet RPC endpoints, updated coin-type addresses for mainnet wBTC (`0x0277...`), wETH (`0xaf8c...`), USDC, SUI
- **BlueFin Pro (mainnet)** — Switched to `trade.bluefin.io`, updated API paths to `/v1/exchange/*`, added retry/timeout/cache, synced pairs with live exchange
- **BlueFin 7k Aggregator** — SUI cron now executes real swaps through aggregated DEX routing (Cetus, DeepBook, Turbos, FlowX, Aftermath)
- **SUI cron (QStash)** — Enabled live swap execution and BlueFin perp hedging in cron cycle; pool-admin capability transfer completed
- **@mysten/sui SDK** — Chain-specific service organization under `lib/services/sui/`
