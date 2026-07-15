# Weekly Submission — April 13–17, 2026

## 1. What did you work on this week?

### SUI Mainnet Contract Deployment

Deployed the SUI USDC Community Pool Move contracts to mainnet (package `0x900bca6461ad24c86b83c974788b457cb76c3f6f4fd7b061c5b58cb40d974bab`). This included the full contract suite: `community_pool_usdc.move`, `bluefin_bridge.move`, `hedge_executor.move`, `zk_verifier.move`, and governance contracts. Updated all frontend and backend references to use mainnet — explorer URLs switched from `suiscan.xyz/testnet` to `suiscan.xyz/mainnet`, pool configuration pointed to mainnet object IDs, wallet providers defaulted to mainnet network, and the SUI community pool dashboard removed all remaining testnet hardcodes. Validated mainnet config requires SUI-native pool configuration and correct admin capabilities.

### SUI Sponsored Transactions — Admin Pays Gas for Users

Built a sponsored transaction system so users can deposit/withdraw from the SUI pool without holding any SUI for gas. The flow: (1) client builds transaction and serializes (not `.build()` since user has no SUI for gas resolution), (2) sends serialized bytes to `/api/sui-pool/sponsor-gas`, (3) admin wallet co-signs with explicit gas budget and payment, (4) combined signature executed on-chain. Fixed 15+ issues during implementation: `Transaction` type mismatches, `SuiClient` cast requirements, sender not set before build, CRLF trailing characters in Vercel env vars (`SUI_NETWORK`, `SUI_POOL_ADMIN_KEY`), dry-run failures from missing gas budget, and wallet-signed bytes not passing through correctly. Added `.trim()` to all SUI env var reads across the swap/hedge execution path to prevent CRLF-caused testnet fallback.

### SUI Pool Swap & Hedge Execution Fixes

Fixed the live cron swap execution pipeline with multiple corrections: cron was reading the wrong pool (SUI-native instead of USDC) — fixed to use USDC pool config. After pool transfer, the system now re-plans swaps with the actual available USDC budget rather than the pre-transfer estimate. Capped `open_hedge` transfer at contract limits (50% hedge ratio + 20% reserve). Added daily hedge cap enforcement (15% of NAV). Normalized oracle vs DEX output units in price deviation checks to prevent false swap rejections. Used sender address as commission partner in BlueFin 7k `buildTx`. Added per-swap error diagnostics for debugging failed aggregator trades. Included hedged value in pool NAV calculation and persisted hedge positions to DB for tracking.

### SUI Pool Auto-Hedge Sizing & Chain-Aware API

Fixed auto-hedge position sizing to correctly calculate the hedge notional from the AI agent's target allocation. Made the auto-hedge API chain-aware so risk metrics filter by chain (SUI positions don't pollute Cronos risk scores and vice versa). Adjusted Vercel cron schedule — initially increased to 30-minute intervals, then reverted to daily due to Vercel Hobby plan limits.

### Slush Mobile Wallet Deep Link Integration

Fixed mobile wallet connectivity for Slush (formerly Sui Wallet) — replaced "wallet not installed" error with deep link redirect using `my.slush.app/browse/` universal link, enabling mobile users to connect directly to the SUI pool dashboard from their phone browser.

### Cache Busting & Frontend UX

Added server-side cache clearing and CDN bypass (`Cache-Control: no-store`) after deposit/withdraw operations so the dashboard immediately reflects updated pool state. Improved SUI gas error messages to show wallet balance and instructions. Reconstructed `Transaction` objects from server JSON before wallet signing to fix type serialization issues.

---

## 2. Code links from this week

- **Deploy SUI contracts to mainnet (0x900bca64):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/ef1e1ab

- **SUI UI mainnet support — explorer URLs, pool config, treasury API:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/959c9cf

- **SUI sponsored transactions — admin pays gas for users:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/b80b164

- **2-step sponsored tx — wallet builds, admin co-signs same bytes:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/cb8b30d

- **Fix cron reads wrong pool (SUI-native→USDC) + CRLF .trim():**  
  https://github.com/ZkVanguard/ZkVanguard/commit/916c649

- **Cap open_hedge transfer at contract limits (50% hedge ratio + 20% reserve):**  
  https://github.com/ZkVanguard/ZkVanguard/commit/dd5a458

- **Re-plan swaps with actual available USDC budget after pool transfer:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/07f74c7

- **Include hedged value in pool NAV + persist hedges to DB:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/f48adc6

- **Chain-aware auto-hedge API + risk metrics filtering:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/b494694

- **Pool transfer cap calculation + swap bailout + version delays:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/4859ad5

- **Slush mobile deep link — use my.slush.app/browse/ universal link:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/2b57dd5

- **Use USDC deposits on SUI mainnet:**  
  https://github.com/ZkVanguard/ZkVanguard/commit/13bf592

---

## 3. Blockers or notes

SUI contracts are live on mainnet. Sponsored transactions work end-to-end — users don't need SUI gas tokens. Vercel Hobby plan limits cron frequency to daily, which limits how often NAV snapshots and rebalance cycles run. Considering upgrading to Pro plan for 30-minute intervals. The original mainnet package (`0x900bca64`) was later upgraded to a v2 package due to capability management improvements.

---

## 4. Sui Stack Components Used

- **Move smart contracts (mainnet)** — Deployed full contract suite to SUI mainnet: `community_pool_usdc.move`, `bluefin_bridge.move`, `hedge_executor.move`, `zk_verifier.move`, governance contracts
- **SUI sponsored transactions** — Admin wallet co-signs user transactions via `@mysten/sui` `Transaction.from()` deserialization, explicit gas budget/payment, and combined multi-sig execution
- **BlueFin 7k Aggregator** — Live swap execution through aggregated DEX routing on mainnet; commission partner set to sender address; oracle vs DEX unit normalization
- **BlueFin Pro perpetuals** — Hedge position sizing, daily cap enforcement (15% NAV), contract limit compliance (50% hedge ratio, 20% reserve)
- **Slush wallet** — Mobile deep link integration via `my.slush.app/browse/` universal link for iOS/Android
- **SUI RPC (mainnet)** — Pool state queries, NAV calculation, member sync; `.trim()` on all env vars to prevent CRLF-caused network mismatch
