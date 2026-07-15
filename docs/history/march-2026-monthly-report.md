# Monthly Submission — March 2026

---

## Primary GitHub Repository

**https://github.com/ZkVanguard/ZkVanguard**

---

## GitHub Username (Author)

**MrareJimmy** — all commits authored by `Mrare Jimmy <mrarejimmy@icloud.com>`

175 Sui-related commits out of 451 total commits in March 2026.

---

## Execution Paths

1. **Move smart contracts** — USDC Community Pool, BlueFin Bridge, ZK verifier, hedge executor, timelock governance — all written in Move and deployed to SUI testnet
2. **Application / backend integration (SDK / RPC / Indexer)** — Full-stack Next.js backend with SUI RPC integration, on-chain state queries via `@mysten/sui`, DB-backed caching layer, wallet signing, cron-based pool sync
3. **Integration with Sui ecosystem infrastructure (DeepBook)** — BlueFin Pro perpetual DEX for hedge execution, BlueFin 7k Aggregator (routes via Cetus, DeepBook, Turbos, FlowX, Aftermath), Cetus liquidity pools for multi-asset swap routing

---

## Work Completed This Month

### 1. SUI USDC Community Pool — Move Contract + Full Backend Stack

Built a complete USDC-denominated community pool on SUI from scratch. The Move contract (`community_pool_usdc.move`, ~950 lines) implements an ERC-4626 share model with 6-decimal USDC precision, inflation-protected virtual shares, circuit breakers (max $1M single deposit, 50% daily withdrawal cap, 20% reserve ratio), high-water mark performance fees, and AI-driven 4-asset rebalancing (BTC/ETH/SUI/CRO). Deployed to SUI testnet with supporting contracts: `bluefin_bridge.move` (~400 lines) for on-chain perpetual position tracking with ZK commitment hashing, `community_pool_timelock.move` for governance, `hedge_executor.move` for swap coordination, and `zk_verifier.move` for proof verification.

The backend integration includes:
- **SuiCommunityPoolService** (~1,200 lines) — On-chain pool state reader using `@mysten/sui` SDK with batch `sui_multiGetObjects` for N+1 query elimination and 10-second fetch timeouts
- **SUI Community Pool API** (~1,100 lines) — 18 REST endpoints (deposit, withdraw, swap-quote, dry-run-deposit-swaps, allocation, treasury-info, member list, fee collection, etc.) with rate limiting, address validation, and CDN caching
- **SUI cron route** (~580 lines) — QStash-triggered every 30 minutes: fetches on-chain stats → records NAV snapshot → syncs members → runs AI allocation → triggers auto-hedge → executes rebalance swaps
- **DB schema** — Chain-independent tables (pool_state, nav_history, transactions, user_shares) with `chain='sui'` column, atomic UPSERT for race-condition prevention, tx hash idempotency

Wired the SUI wallet frontend (deposit/withdraw via `@mysten/dapp-kit` wallet signing), gas balance pre-checks with auto-faucet fallback, and explorer links for transaction confirmation.

### 2. BlueFin Perpetual DEX Integration — Hedge Execution + Aggregator Swap Routing

Integrated **BlueFin Pro** for perpetual hedging on SUI and **BlueFin 7k Aggregator** for multi-DEX swap routing:

- **BluefinService** (~980 lines) — Full REST API client for BlueFin Pro: BCS-encoded Ed25519 wallet signature auth (no API keys), MARKET/LIMIT order placement for 8 perpetual pairs (BTC-PERP, ETH-PERP, SUI-PERP, SOL-PERP, APT-PERP, ARB-PERP, DOGE-PERP, PEPE-PERP), up to 50x leverage, position management (open/close/modify), PnL tracking with exponential backoff retry. Signing uses `@mysten/sui` keypairs with `JSON.stringify(val, null, 2)` pretty-print and `"Bluefin Pro Order"` intent type. All mock code removed — production-only execution paths.
- **BluefinAggregatorService** (~1,130 lines) — Multi-DEX aggregator routing via `@bluefin-exchange/bluefin7k-aggregator-sdk` across BlueFin, Cetus, DeepBook, Turbos, FlowX, and Aftermath. 15-second quote caching, parallel quote fetching via `Promise.allSettled`, mainnet coin-type routing (wBTC `0x0277...`, wETH `0xaf8c...`, USDC, SUI), pre-flight rate limiting.
- **SuiPoolAgent** (~530 lines) — AI-driven agent analyzing BTC/ETH/SUI/CRO market conditions via multi-timeframe streak analysis, cross-market correlation, and risk cascade detection. Generates target allocations, plans rebalance swaps through the aggregator, and hedges non-swappable assets (CRO) via BlueFin perpetuals.
- **SuiAutoHedgingAdapter** (~500 lines) — Auto-hedging bridge to BlueFin Pro with 15-second PnL updates, 90-second risk assessments, 4% max drawdown threshold, 2x default leverage, and stop-loss/take-profit automation.
- **SUI pool auto-hedge integration** — Full pipeline: deposit → AI allocation → hedge non-swappable assets via BlueFin perps → monitor PnL → auto-close on threshold.
- **MSafe multisig treasury** — Configured SUI MSafe treasury for fee collection, with admin scripts for `set-treasury` and `set-fees` operations.

### 3. Production Hardening — On-Chain Source of Truth, Security Audit, Mainnet Readiness

Refactored the entire SUI pool architecture so on-chain state is the single source of truth with DB as cache only. Fixed critical issues including:

- **Move contract security** — Fixed integer overflow vulnerabilities, added positive amount validation against negative value attacks, added treasury address validation
- **On-chain sync** — DB-to-chain member share sync prevents data drift; ghost entries auto-cleaned; discrepancies auto-corrected from on-chain state
- **Mainnet sanity checks** — NAV ceiling ($10B), share price ceiling ($1M), division-by-zero guards, NaN/negative guards on all parsed values
- **Security audit** — Removed all mock data, fake tx hashes, hardcoded prices from production paths; sanitized error messages in client-facing API responses; bounded user-supplied limit parameters; added parseInt radix 10 to ~50 calls; removed all `as any` type casts
- **Mainnet architecture** — Environment-driven network switching (testnet/mainnet), deployment maps in SuiAutoHedgingAdapter, explorer URL configuration, mainnet readiness assessment (72 E2E tests across 9 test suites passing)
- **E2E result** — 72 passed, 0 failed, 0 skipped — **MAINNET READY** verdict

---

## Sui Stack Components Used

- **Move smart contracts** — `community_pool_usdc.move`, `bluefin_bridge.move`, `community_pool_timelock.move`, `hedge_executor.move`, `zk_verifier.move`, `zk_proxy_vault.move`, `zk_hedge_commitment.move`, `rwa_manager.move`, `payment_router.move`
- **DeepBook** — Liquidity routing via BlueFin 7k Aggregator (aggregates DeepBook, Cetus, Turbos, FlowX, Aftermath pools for optimal swap pricing)

---

## Integration Description

**Move contracts managing a USDC community pool with AI-driven 4-asset allocation, hedged via BlueFin perpetuals and swapped through DeepBook/Cetus aggregated liquidity.**

The SUI Move contract (`community_pool_usdc.move`) holds user USDC deposits and tracks share accounting on-chain. An AI agent (SuiPoolAgent) analyzes BTC/ETH/SUI/CRO market conditions and generates target allocations. The BlueFin 7k Aggregator SDK routes swaps across DeepBook, Cetus, and other SUI DEXes for optimal pricing. Non-swappable assets (CRO on SUI) are hedged via BlueFin Pro perpetuals using Ed25519-signed orders through `@mysten/sui` keypairs. A QStash-triggered cron reads on-chain pool state via `sui_multiGetObjects` RPC batch calls, syncs to a PostgreSQL cache with chain-tagged rows, runs risk assessment, and auto-executes rebalance/hedge operations. The frontend uses `@mysten/dapp-kit` for SUI wallet signing of deposit/withdraw transactions.

---

## Verifiable Technical Evidence

### GitHub Commits (Sui-specific, substantive)

1. **SUI USDC Community Pool infrastructure — Move contract, SuiPoolAgent, cron, QStash schedule**  
   https://github.com/ZkVanguard/ZkVanguard/commit/498ba900357f53781bde205c7d972aa4a747da41

2. **SUI CommunityPool.move contract creation**  
   https://github.com/ZkVanguard/ZkVanguard/commit/6596748606eaeab181a088cd1968b5ebf896e01d

3. **SUI mainnet-ready architecture — testnet/mainnet deployment map, 72 E2E tests across 9 suites passing**  
   https://github.com/ZkVanguard/ZkVanguard/commit/5b51c870bd540e906425c48da856638c19e5bf1d

4. **SUI pool comprehensive optimization — quote caching, RPC timeouts, batch queries, atomic UPSERT, idempotency**  
   https://github.com/ZkVanguard/ZkVanguard/commit/c314025093820934846c715af2f598ab762b3070

5. **CRITICAL: Fix integer overflow + treasury validation in SUI Move contract**  
   https://github.com/ZkVanguard/ZkVanguard/commit/d77b94c71a7756eb71ecd382b3ac0700cd1b97d6

6. **Enable BlueFin hedging on SUI — deploy USDC pool, swap quotes, hedge execution**  
   https://github.com/ZkVanguard/ZkVanguard/commit/f50dc69ba0f85d92c17b27e907dbf8ecf06d2e18

7. **Production hardening — bulletproof community pool for production-scale funds**  
   https://github.com/ZkVanguard/ZkVanguard/commit/bb5181880d1b52948b3d2ba11d5d7483201448b1

8. **On-chain as source of truth — DB is cache only**  
   https://github.com/ZkVanguard/ZkVanguard/commit/95efb35aabc7c22790a9acb7e5519333eadc8135

9. **MSafe multisig treasury for SUI pool fee collection**  
   https://github.com/ZkVanguard/ZkVanguard/commit/ee5b735f81bb30efbb8f2ba41405e364efa94bab

10. **SUI pool auto-hedge via BlueFin perpetuals**  
    https://github.com/ZkVanguard/ZkVanguard/commit/6fda21d62302b2af494f15dd35fac885deee8f61

11. **On-chain SUI deposit and withdraw execution with wallet signing**  
    https://github.com/ZkVanguard/ZkVanguard/commit/85c3f0c853aaebda0285cd455824f934a9eefd34

12. **Security audit — remove all mock data, fake hashes, hardcoded prices; removed USE_MOCK flag entirely**  
    https://github.com/ZkVanguard/ZkVanguard/commit/ab73fa8d2f8d08018b899e084a58985b118d1803

---

## Deployment / Integration Proof (Testnet)

| Component | Network | Address |
|-----------|---------|---------|
| Community Pool Package | SUI Testnet | `0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c` |
| Community Pool State | SUI Testnet | `0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56` |
| USDC Pool Package (4-asset) | SUI Testnet | `0xcac1e7de082a92ec3db4a4f0766f1a73e9f8c22e50a3dafed6d81dc043bd0ac9` |
| USDC Pool State | SUI Testnet | `0x9f77819f91d75833f86259025068da493bb1c7215ed84f39d5ad0f5bc1b40971` |
| RWA Manager State | SUI Testnet | `0x65638c3c5a5af66c33bf06f57230f8d9972d3a5507138974dce11b1e46e85c97` |
| Hedge Executor | SUI Testnet | `0xb6432f1ecc1f55a1f3f3c8c09d110c4bda9ed6536bd9ea4c9cb5e739c41cb41e` |
| V2 Package | SUI Testnet | `0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a` |

**SUI Testnet Explorer links:**
- USDC Pool Package: https://testnet.suivision.xyz/package/0xcac1e7de082a92ec3db4a4f0766f1a73e9f8c22e50a3dafed6d81dc043bd0ac9
- Community Pool Package: https://testnet.suivision.xyz/package/0xcb37e4ea0109e5c91096c0733821e4b603a5ef8faa995cfcf6c47aa2e325b70c
- V2 Package: https://testnet.suivision.xyz/package/0xb1442796d8593b552c7c27a072043639e3e6615a79ba11b87666d31b42fa283a
