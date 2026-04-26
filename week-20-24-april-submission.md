# Weekly Submission — April 20–24, 2026

## 1. What did you work on this week?

### SUI Mainnet Pool Debugging & Monitoring Infrastructure

Built comprehensive debugging and monitoring endpoints for the live SUI mainnet pool. Created a `/api/sui-pool-status` endpoint that returns real-time pool state from on-chain data — total USDC balance, share supply, member count, NAV, admin wallet balance, and network detection. Added on-chain hedge state detail reporting showing active hedge positions, BlueFin perpetual positions (open/closed), and hedge-to-NAV ratios. Made the status endpoint publicly accessible for monitoring without authentication. Added admin wallet balance checks to catch low-gas conditions before cron failures.

### SUI Hedge State Management & Reset

Added an admin endpoint and corresponding Move contract function for resetting hedge state on-chain. This allows recovery from stuck hedge positions where the on-chain state diverges from BlueFin's actual position state (e.g., if a hedge was closed on BlueFin but the contract still shows it as active). The reset function clears the hedge record in the Move contract and syncs the database, enabling the next cron cycle to re-evaluate and open fresh hedges based on current market conditions.

### BlueFin Service Reliability

Fixed `BluefinService` singleton pattern — the service was creating multiple instances across different import paths, causing duplicate WebSocket connections and inconsistent position tracking. Consolidated to a single shared instance with proper initialization guards and connection reuse. Added detailed logging for active hedges vs BlueFin positions to diagnose discrepancies between local hedge state and exchange-reported positions.

### SUI Network Detection & UX Improvements

Added debug logging across 22 files for SUI network detection to trace why some requests were falling back to testnet despite mainnet configuration. Fixed environment variable propagation so `SUI_NETWORK=mainnet` is correctly read in all server-side contexts (API routes, cron jobs, wallet providers). Improved user-facing error messages with actionable instructions when operations fail.

### Cron Frequency Optimization

Adjusted SUI pool cron scheduling — initially increased from daily to 30-minute intervals for more frequent NAV snapshots and rebalance cycles, then reverted to daily due to Vercel Hobby plan invocation limits. Added debug endpoints to manually trigger cron operations for testing and diagnostics between scheduled runs.

---

## 2. Code links from this week

- **Add admin reset hedge state endpoint + contract function:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/7333637

- **Debug: add active hedges and BlueFin positions monitoring:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/37e29bd

- **Debug: add on-chain hedge state details:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/e24f455

- **Debug: add SUI pool status endpoint:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/887f251

- **Fix: BluefinService singleton usage:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/94146f8

- **Fix(sui): add debug logging for network detection + improve UX (22 files):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/8790e66

- **Debug: add admin wallet balance check:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/a1e0f37

---

## 3. Blockers or notes

The SUI mainnet pool is live and accepting deposits. Primary focus this week was observability — building the monitoring and debugging infrastructure needed to operate a production pool. Identified and fixed BlueFin singleton issues causing duplicate connections. Vercel Hobby plan limits constrain cron to daily frequency; evaluating Pro plan upgrade for production-grade 30-minute intervals. The hedge state reset capability unblocks recovery from any stuck positions without redeploying contracts.

---

## 4. Sui Stack Components Used

- **Move smart contracts (mainnet)** — Added `reset_hedge_state` function to `community_pool_usdc.move` for admin-controlled hedge recovery on the live mainnet contract
- **SUI RPC (mainnet)** — On-chain pool state reads for monitoring dashboard, hedge state queries, admin wallet balance checks via `suiClient.getBalance()`
- **BlueFin Pro** — Position reconciliation between on-chain hedge state and BlueFin exchange positions; singleton service pattern for connection reuse
- **@mysten/sui SDK** — Network detection debugging across 22 files, environment-driven mainnet/testnet switching
- **Vercel cron / QStash** — Frequency tuning and manual trigger endpoints for production pool operations
