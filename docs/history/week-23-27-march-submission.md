# Weekly Submission — March 23–27, 2026

## 1. What did you work on this week?

### SUI Community Pool: On-Chain Source of Truth & Production Hardening

Refactored the SUI Community Pool architecture so on-chain state is the single source of truth, with the database serving only as a cache layer. Implemented DB-to-chain sync to prevent data drift — member shares are now validated against the on-chain Move contract, with ghost entries cleaned and discrepancies auto-corrected. Added mainnet sanity checks (NAV ceiling, share price ceiling, division-by-zero guards, NaN/negative guards on all parsed values) to ensure the pool handles production-scale funds safely.

Key SUI-specific work:
- **On-chain reader extraction** — isolated all Sui RPC calls (pool state, member shares, NAV) into a dedicated on-chain reader module for the community pool
- **SUI pool performance optimization** — added 15-second quote caching via CetusAggregatorService to eliminate duplicate API calls, 10-second `fetchWithTimeout` on all Sui RPC calls, batch `sui_multiGetObjects` replacing N+1 member queries, deposit idempotency via `txHashExists`, and parallel quote fetching in the withdraw flow via `Promise.allSettled`
- **Chain-independent pool state** — extended the DB schema (pool_state, nav_history, transactions) with a `chain` column so SUI, Cronos, Hedera, and Sepolia pools all coexist; all SUI cron DB calls tagged with `chain='sui'`
- **Security audit** — removed all mock data, fake transaction hashes, and hardcoded fallback prices from production paths; flipped BlueFin `USE_MOCK` default to `false`; sanitized error messages in 6 client-facing API responses; bounded all user-supplied `limit` parameters

### SUI USDC Pool Infrastructure & Move Contract Integration

Built out the full SUI USDC community pool stack — Move smart contract (edition 2024), SuiPoolAgent for AI-driven 4-asset allocation (BTC/ETH/SUI/CRO), USDC deposit/withdraw API endpoints with SUI address validation, cron route for periodic pool sync, and QStash scheduling. Wired the frontend to the USDC-only deposit/withdraw flow (1 share = 1 USDC model), integrated wallet signing for on-chain SUI transactions, and added gas balance pre-checks with auto-faucet fallback.

---

## 2. Code links from this week

- **SUI pool on-chain source of truth + DB sync + production hardening (52 commits):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/bb5181880d1b52948b3d2ba11d5d7483201448b1

- **SUI pool comprehensive optimization (quote caching, RPC timeouts, batch queries, idempotency):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/c314025093820934846c715af2f598ab762b3070

---

## 3. Blockers or notes

No blockers. The SUI Community Pool is running end-to-end on testnet with the USDC model (deposit → AI allocation → hedge via BlueFin/Cetus → withdraw). E2E test suite passes 25/25 checks with a MAINNET READY verdict. Mainnet deployment is next.

---

## 4. Sui Stack Components Used

- **Move smart contracts** — USDC Community Pool contract (edition 2024), deployed on SUI testnet (package `0xb144...`), handles deposits, withdrawals, share accounting, and AI-driven rebalance
- **DeepBook / Cetus liquidity infrastructure** — CetusAggregatorService for DEX swap quotes and execution across BTC/ETH/SUI/CRO pairs on SUI; quote caching and parallel fetching optimizations
- **BlueFin perpetuals integration** — hedging positions on BlueFin Pro (Sui-native perps DEX) using Ed25519 signing for order placement; `USE_MOCK` disabled for production-path hedging
- **Sui RPC / on-chain reads** — batch `sui_multiGetObjects`, pool state queries, member share validation, NAV calculation — all with timeout guards and retry logic
- **SUI wallet signing** — frontend integration for on-chain deposit/withdraw transactions via user wallet, with gas balance pre-checks and auto-faucet
