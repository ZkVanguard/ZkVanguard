# Week 18 - 22th Submission

## 1. What did you work on this week?

- **Hardening pass on the SUI community pool + autonomous trader: extracted business logic into testable modules and locked it with unit tests.** Pulled pure math/decision logic out of monolithic services and cron routes into dedicated modules — pool NAV / share-price math, auto-hedge sizing, allocation composition, signal classification + daily-cap-reset gating, trade-opportunity (alpha) scoring, Kelly stake sizing, and the auto-hedging risk gate — and removed a dead duplicate allocation engine from the cron route. Added golden money-math tests plus coverage for hedge calibration/Kelly sizing, the `SafeExecutionGuard` trade gate + circuit breaker, env-var CRLF/quote stripping, the safe-error secret-leak boundary, and the ZK hedge-ownership binding. Also fixed a Bluefin perp order-size bug where float step-snapping was undersizing orders.

- **Security: removed an obfuscated malicious payload and added a build-time guard.** Found and stripped an injected obfuscated payload from `next.config.js`, then added a malware guard that fails the build if obfuscated injected code reappears, so the same class of compromise can't ship silently.

## 2. Code links

- SUI pool NAV / share-price math extraction + tests: https://github.com/ZkVanguard/ZkVanguard/commit/bc95a30c
- Malware payload removal + build guard: https://github.com/ZkVanguard/ZkVanguard/commit/01f962f8

## 3. Blockers or notes

- The obfuscated payload in `next.config.js` was the priority interrupt this week — worth flagging to the team so everyone confirms their local checkout / dependencies are clean. The build now fails fast on any reoccurrence.
- This week was mostly internal hardening (refactor + test coverage), so there is little new user-facing surface — the value is in regression safety and a smaller, testable core ahead of further SUI pool work.

## 4. Sui Stack Components Used

- **Move smart contracts** — SUI mainnet community pool: NAV/share-price, allocation, hedge-sizing and signal-gating logic that drives on-chain rebalances and Bluefin V2 perp hedges was the main thing refactored and tested this week.
