# Week 2 - 5th Submission

**Date:** March 11, 2026

---

## 1. What did you work on this week? (Required)

### Centralized Auto-Hedging System
Implemented a comprehensive CentralizedHedgeManager (~900 lines) that batches market data fetching and performs parallel portfolio risk assessment. Key features:
- `fetchMarketSnapshot()`: Single batch API call for BTC/ETH/CRO/SUI prices
- `gatherAllPortfolioContexts()`: Parallel context gathering with Promise.allSettled
- `assessPortfolioRisk()`: Pure computation risk assessment (no I/O blocking)
- Full E2E test suite with 101 tests passing

### Security Hardening & Mainnet Readiness
Completed multiple security audit passes:
- Deep audit pass 2: Hardened 57 files
- Critical mainnet hardening: 28 files, 9 vulnerability classes fixed
- Added production safety module with mainnet readiness tests
- Rescue functions and fee withdrawal logic security fixes

---

## 2. Code Links (Optional)

1. **Centralized Auto-Hedging Feature**
   https://github.com/ZkVanguard/ZkVanguard/commit/6cf1556

2. **Security: Critical Mainnet Hardening**
   https://github.com/ZkVanguard/ZkVanguard/commit/0d163d1

---

## 3. Blockers or Notes (Optional)

- Migrated Community Pool to use reserved `portfolio_id=-1` to avoid collisions with RWAManager portfolio 0
- Replaced Vercel cron jobs (limited to 2x/day on Hobby plan) with Upstash QStash (now runs every 5 minutes — 144x more frequent)
- Added EIP-712 typed data signing for gasless hedge execution
- All 326 tests passing across 13 suites with ZK server active

---

## 4. Sui Stack Components Used (Optional)

This week's work did not directly involve Sui-specific components, but the infrastructure supports future Sui integration:

- **Move smart contracts**: Existing Sui contract infrastructure in `contracts/sui/` maintained
- **Multi-chain architecture**: Auto-hedging system designed to support Sui alongside EVM chains

---

### Commit Summary (Past Week)

| Commit | Description |
|--------|-------------|
| `d2259d1` | Fix: Sanitize WalletConnect projectId and env files |
| `7701f3a` | Fix: Import api-interceptor in providers |
| `2d2461b` | Fix: Add BigInt serialization polyfill |
| `c8b7dea` | Refactor: Use on-chain contract as source of truth for NAV |
| `ebe6a21` | Feat: Add EIP-712 signing to ManualHedgeModal |
| `ebc2747` | Feat: Add production safety module with mainnet tests |
| `5e7a131` | Security: Deep audit pass 2 — harden 57 files |
| `0d163d1` | Security: Critical mainnet hardening — 28 files |
| `6d117fe` | Remove ALL mocks from ALL tests — real services E2E |
| `b26fb11` | Feat: Replace Vercel cron jobs with Upstash QStash |
| `6cf1556` | Feat: Centralized auto-hedging with batch market data |
| `0e05332` | Feat: Comprehensive E2E test + fix SQL type bug |
| `636625d` | Fix: Add COMMUNITY_POOL_PORTFOLIO_ID=-1 constant |
