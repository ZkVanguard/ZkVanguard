# Weekly Submission — March 30 – April 3, 2026

## 1. What did you work on this week?

### SUI Move Contract Security Fixes & MSafe Treasury Integration

Fixed two critical vulnerabilities in the SUI Move contract (`community_pool_usdc.move`): integer overflow in share calculation that could allow attackers to mint excess shares, and missing positive-amount validation on deposit/withdraw that enabled negative value attacks. Added treasury address validation to prevent zero-address fee drainage. Integrated MSafe multisig treasury (`0x83b9...35f2b`) into the SUI pool — wired fee collection, `set-treasury`, `set-fees`, and `treasury-info` API endpoints, with admin scripts (`set-sui-treasury.cjs`, `set-sui-fees.cjs`) for on-chain configuration. Removed all hardcoded private keys from admin scripts and replaced with `SUI_POOL_ADMIN_KEY` env var.

### SUI Pool Auto-Hedge via BlueFin Perpetuals

Built the complete auto-hedge integration for the SUI community pool. When the AI agent (SuiPoolAgent) allocates to non-swappable assets (e.g., CRO on SUI), the system now automatically opens corresponding hedge positions on BlueFin Pro perpetuals. The pipeline: deposit → AI allocation → identify non-swappable portion → open BlueFin perp hedge with 2x leverage → monitor PnL at 15-second intervals → auto-close on 4% max drawdown threshold. Wired the `SuiAutoHedgingAdapter` into the SUI cron route and tested end-to-end with the community pool.

### SUI Reliability Hardening & Mainnet Readiness

Hardened the SUI RPC layer with automatic retry logic (3 retries with exponential backoff), circuit breaker pattern (5 consecutive failures → 30-second cooldown), and BigInt precision for all on-chain value parsing to prevent floating-point drift. Protected all SUI admin endpoints with `SUI_POOL_ADMIN_KEY` validation and added mainnet config validation (package ID, pool state, admin cap). Patched a critical QStash auth bypass where cron routes accepted unauthenticated requests. Pinned the SUI Move framework to mainnet revision in `Move.toml`.

### Production Security Audit & Platform Hardening

Conducted a comprehensive security audit across the entire platform: removed malicious code injection in a ZK route, fixed SQL injection via parameterized queries, added security headers (CSP, HSTS, X-Frame-Options), replaced all hardcoded testnet RPCs with dynamic `getCronosRpcUrl`/`getCronosChainId`, sanitized error messages in client-facing responses, and bounded all user-supplied `limit` parameters. Deployed distributed rate limiting via Upstash Redis with graceful fallback, connection pooling for PostgreSQL, and request coalescing for duplicate concurrent calls. Added `export const runtime = 'nodejs'` to 42 API routes for Vercel Edge compatibility.

### AI Agent Pipeline Optimization

Optimized the AI Market Intelligence pipeline with enhanced context methods across all agents, LRU cache for repeated queries, multi-chain awareness in the agent consensus voting system, and parallel fetch execution. Added a comprehensive AI pipeline test suite (1,559 lines) validating the full agent → allocation → hedge → rebalance flow.

---

## 2. Code links from this week

- **CRITICAL: Fix integer overflow + treasury validation in SUI Move contract:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/d77b94c71a7756eb71ecd382b3ac0700cd1b97d6

- **CRITICAL: Add positive amount validation to deposit/withdraw (prevent negative value attacks):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/55a43e8

- **Wire MSafe treasury into SUI pool: fee collection, set-treasury, treasury-info endpoints:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/3ec1b0800

- **SUI pool auto-hedge via BlueFin perpetuals:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/6fda21d

- **Complete SUI pool auto-hedge integration:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/5643179

- **SUI reliability hardening — RPC retry, circuit breaker, BigInt precision:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/07307f4

- **Patch critical QStash auth bypass and network mismatch:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/821d544

- **SECURITY: remove malicious code, fix ZK bypass, harden production:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/0c97dca

- **Mainnet security hardening: BigInt precision, rate limiting, circuit breaker, CSP:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/34cac32

- **Refactor: remove 7 duplicate services, extract shared hedge types (-3,427 LOC):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/e59b0d4

---

## 3. Blockers or notes

No blockers. All critical SUI Move contract vulnerabilities have been patched. The MSafe treasury is configured and the auto-hedge pipeline is wired end-to-end. Main focus next week is switching SUI services from testnet to mainnet defaults and deploying BlueFin to mainnet.

---

## 4. Sui Stack Components Used

- **Move smart contracts** — `community_pool_usdc.move` security patches (integer overflow fix, positive amount validation, treasury address validation), Move framework pinned to mainnet revision
- **SUI RPC** — Reliability hardening with retry logic, circuit breaker, BigInt precision, `fetchWithTimeout` on all RPC calls
- **BlueFin perpetuals** — SuiAutoHedgingAdapter integration for auto-hedging non-swappable assets via BlueFin Pro perps on SUI; 2x leverage with 4% max drawdown
- **MSafe multisig** — Treasury configuration (`0x83b9...35f2b`) for fee collection; admin scripts for `set-treasury` and `set-fees` on-chain operations
- **QStash (SUI cron)** — Secured cron route authentication, patched auth bypass vulnerability
