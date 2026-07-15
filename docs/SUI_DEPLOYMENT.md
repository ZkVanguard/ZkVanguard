# SUI Deployment

Current SUI mainnet deployment reference. For deploy history and past testnet artifacts, see [`DEPLOY_2026-06-12_v0.2.0.md`](./DEPLOY_2026-06-12_v0.2.0.md). For pre-deploy checks, see [`PRE_DEPLOY_AUDIT_2026-06-12.md`](./PRE_DEPLOY_AUDIT_2026-06-12.md).

## Live mainnet (v0.2.0)

Deployed 2026-06-12 with UpgradeCap v3. Package + state IDs are the canonical mainnet references.

| Item | Value |
|---|---|
| **Package ID** | `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726` |
| **USDC Pool State** | `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a` |
| **Network** | Sui Mainnet (`https://fullnode.mainnet.sui.io:443`) |
| **Explorer** | [Suiscan](https://suiscan.xyz/mainnet/object/0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726) |
| **Perp venue** | BlueFin V2 mainnet (`api.sui-prod.bluefin.io`) |
| **DEX aggregator** | BlueFin 7k SDK — 6 DEXes (Cetus, DeepBook, Turbos, FlowX, Aftermath, BlueFin) |

Prior v0.1.0 package `0x9ccb…cd83e598c88` is dormant; pool state was preserved through the v0.1 → v0.2 upgrade.

## Deployed Move modules (`contracts/sui/sources/`)

| Module | Purpose |
|---|---|
| `community_pool_usdc.move` | USDC vault — deposits, withdraws, NAV, fee accrual |
| `community_pool.move` | Original SUI-denominated pool (kept for reference; production is USDC) |
| `community_pool_timelock.move` | Timelocked admin actions |
| `hedge_executor.move` | Hedge open/close/settle authorization |
| `bluefin_bridge.move` | On-chain BlueFin hedge state |
| `zk_hedge_commitment.move` | Private hedge commitments (ZK) |
| `zk_verifier.move` | On-chain STARK proof verification |
| `zk_proxy_vault.move` | Cross-proxy vault for private portfolios |
| `payment_router.move` | Multi-token payment handling |
| `rwa_manager.move` | RWA portfolio management |
| `rwa_custody_attestor.move` | RWA custody attestations (Institutional tier, Q4 2026 activation) |

## Required env vars

**Network selectors** (both — different consumers):
```
SUI_NETWORK=mainnet                              # server/cron/services
NEXT_PUBLIC_SUI_NETWORK=mainnet                  # frontend only
```

**RPC + deployment object IDs:**
```
SUI_MAINNET_RPC=https://fullnode.mainnet.sui.io:443
NEXT_PUBLIC_SUI_MAINNET_PACKAGE_ID=0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726
NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE=0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a
NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_PACKAGE_ID=<same as PACKAGE_ID above>
NEXT_PUBLIC_SUI_MAINNET_USDC_POOL_STATE=<same as COMMUNITY_POOL_STATE above>
NEXT_PUBLIC_SUI_MAINNET_ADMIN_CAP=<admin cap object id>
NEXT_PUBLIC_SUI_MAINNET_FEE_MANAGER_CAP=<fee manager cap object id — held by MSafe>
```

**Server-only (never log, never hardcode):**
```
SUI_POOL_ADMIN_KEY=<suiprivkey1... or 64-char hex>
SUI_AGENT_CAP_ID=<hedge settle/replenish cap>
SUI_ADMIN_CAP_ID=<admin ops>
SUI_FEE_MANAGER_CAP_ID=<fee collection cap>
SUI_ADMIN_ADDRESS=<treasury address>
SUI_MSAFE_ADDRESS=<MSafe multisig address>
```

**CRLF trap:** Vercel env values often carry trailing `\r\n`. Every SUI env read must `.trim()`. `instrumentation.ts` sanitises on cold start; service code should still trim defensively.

Full env vars reference: [CLAUDE.md](../CLAUDE.md) SUI section.

## Deploy / upgrade runbook

### Prerequisites
1. **Sui CLI installed** — matches or exceeds the mainnet protocol version. Check via `sui client active-env`.
2. **Admin key locally available** — needed for `sui client publish`/`sui client upgrade`. Prefer a fresh terminal with `SUI_POOL_ADMIN_KEY` unset in shell; import via `sui keytool` and forget.
3. **UpgradeCap held** — for v0.2.0 → v0.3.0 (or beyond), the `UpgradeCap` object must be owned by the deploy signer. Check: `sui client object <upgradecap-id>`.

### Build
```bash
cd contracts/sui
sui move build
```

**Move.lock trap:** `sui move build` wipes the `[env]` block every time. Re-append the mainnet env block before `sui client upgrade` — see `PRE_DEPLOY_AUDIT_2026-06-12.md` for the exact template.

### Upgrade (mainnet)
```bash
sui client upgrade \
  --upgrade-capability <upgradecap-id> \
  --gas-budget 700000000            # 0.7 SUI — increased from 0.2 SUI default
```

Gas budget was increased from 0.2 → 0.7 SUI after a pre-deploy audit showed 0.2 was insufficient with the full contract set.

### Post-upgrade validation
```bash
# 1. Confirm on-chain pool state readable
bun run scripts/check-sui-mainnet-readiness.ts

# 2. Confirm signal-alignment (any active positions still make sense)
bun run scripts/check-hedge-signal-alignment.ts

# 3. Confirm PnL diagnostic clean
bun run scripts/analyze-pool-pnl.ts

# 4. Cron heartbeats within cadence
curl -s https://www.zkvanguard.xyz/api/health/production | jq '.cron_heartbeats'
```

**Post-deploy: re-attest external NAV bundle.** The `admin_reset_hedge_state` call deletes external_nav DFs; strict mode then blocks user flow for up to 30 min. Bundle reset + `admin_attest_external_nav` in one PTB. See the `sui-hedge-reconcile` route implementation for reference.

## Contract security (v0.2.0)

Shipped with 15 internal audit phases (Move + off-chain TS) — see [`AUDIT_2026-06-04.md`](./AUDIT_2026-06-04.md) and [`AUDIT_2026-06-12_phase15_offchain.md`](./AUDIT_2026-06-12_phase15_offchain.md).

**Key security features:**
- **Strict mode ON** — `admin_set_external_nav_required(true)`. Deposits/withdrawals revert with `E_EXTERNAL_NAV_STALE` if cron oracle attestation > 2h stale.
- **TVL cap $10K** — `admin_set_tvl_cap` gated; ratchets per `ROADMAP.md`.
- **`close_hedge` funds-verify** — AgentCap must be present; prevents drain scenarios.
- **`zk_proxy_vault`** — cross-proxy PDA + 4 ZK contracts with ed25519 prover attestation.
- **Withdrawals non-custodial** — Move contract computes payouts against on-chain state (including off-chain wBTC/wETH/SUI market value via NAV oracle).

**Fee routing:**
- `50 bps annual mgmt + 10% performance fee` — charged automatically by `community_pool_usdc.move`
- Fees routed to `FeeManagerCap` held on **MSafe multisig** — not the hot admin wallet

## External audit

Pending — deliverable of SUI Foundation grant Tranche 1. Once complete, TVL cap ratchets per [`ROADMAP.md`](./ROADMAP.md).

---

**Last updated:** 2026-07-15
