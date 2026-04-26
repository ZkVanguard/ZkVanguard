# Weekly Submission — April 27 – May 1, 2026

## 1. What did you work on this week?

### SUI Mainnet Contract Upgrade (v2 Redeployment)

Upgraded the SUI USDC Community Pool contract to v2 on mainnet. The original package (`0x900bca64...`) had capability objects sent to an incorrect address (`0x7e73...`), making admin operations impossible. Redeployed as a fresh package (`0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88`) with correct capability assignment. Applied a critical protocol lesson: SUI mainnet protocol v120 enforces a maximum of 32 fields per struct. Refactored the Move contracts to use nested sub-structs with `has store` ability — `community_pool.move` went from 41→27 fields (4 sub-structs) and `community_pool_usdc.move` from 35→24 fields (2 sub-structs). Updated all backend service files to use the upgraded package ID (published-at in `Published.toml`), not the original-id.

Key new mainnet objects:
- Pool State: `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a`
- AdminCap: `0x8109e15aec55e5ad22e0f91641eda16398b6541d0c0472b113f35b1b59431d78`
- RebalancerCap: `0xa44d8b3c42a462de7abaf2f7db13d8d384f2a2c331f9d40ae5621f62877e722b`
- AgentCap: `0xdeecf4483ba7729f91c1a4349a5c6b9a5b776981726b1c0136e5cf788889d46d`

### SUI Pool Production Stabilization

Continuing production monitoring and stabilization of the live mainnet pool. Verifying that the daily cron cycle correctly reads on-chain state from the v2 contract, records NAV snapshots, syncs member shares, runs AI allocation, and triggers auto-hedge operations through BlueFin Pro. Monitoring hedge state reconciliation between on-chain records and BlueFin exchange positions using the debugging infrastructure built in the previous week.

### April Monthly Report Compilation

Compiled the comprehensive April 2026 monthly report documenting all SUI-specific work: Move contract deployment and upgrade, BlueFin mainnet integration, sponsored transactions, auto-hedge pipeline, monitoring infrastructure, and production hardening across 100+ commits.

---

## 2. Code links from this week

- **SUI mainnet contract v2 upgrade (nested sub-structs for 32-field limit):**  
  See deployment record at `deployments/sui-mainnet-deployment.md`

- **All April 2026 SUI commits (full history):**  
  https://github.com/ZkVanguard/ZkVanguard/commits/main

---

## 3. Blockers or notes

The v2 contract upgrade resolved the capability loss issue from the original deployment. The 32-field struct limit was an unexpected mainnet protocol constraint not present on testnet — documented for future reference. The ~$20 USDC locked in the original pool (`0xf712...`) is unrecoverable since admin capabilities were sent to the wrong address. The v2 pool is now fully operational with correct admin control.

---

## 4. Sui Stack Components Used

- **Move smart contracts (mainnet v2)** — Contract upgrade via `sui client upgrade`, nested sub-structs to comply with mainnet protocol v120's 32-field limit, correct capability assignment
- **SUI protocol** — Learned and documented that `sui client upgrade` requires using the new package address (from `Published.toml`), not the `original-id`, to avoid constant values from v1 being used
- **SUI RPC (mainnet)** — Ongoing pool state monitoring, NAV snapshots, member sync via v2 contract objects
- **BlueFin Pro** — Continued hedge position monitoring and reconciliation on mainnet
