# ZkVanguard

**An AI-managed crypto vault that lets anyone ride Polymarket alpha.**

Deposit USDC. Seven AI agents allocate across BTC / ETH / SUI / CRO using prediction-market signals fused from Polymarket, Manifold, BlueFin funding, and Crypto.com momentum. Every position is auto-hedged on BlueFin perpetuals and every decision is ZK-attested on-chain. Live on Sui mainnet today.

[![Sui Mainnet](https://img.shields.io/badge/Sui-Mainnet-4ca3ff)](https://suiscan.xyz/mainnet/object/0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726)
[![Live](https://img.shields.io/badge/Live-zkvanguard.xyz-brightgreen)](https://www.zkvanguard.xyz)
[![Health](https://img.shields.io/badge/Health-API-blue)](https://www.zkvanguard.xyz/api/health/production)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)

---

## Live mainnet

| What | Where |
|---|---|
| Sui mainnet package (v0.2.0) | [`0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726`](https://suiscan.xyz/mainnet/object/0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726) |
| USDC Pool state object | `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a` |
| Live signal pipeline | [`/api/predictions/per-asset`](https://www.zkvanguard.xyz/api/predictions/per-asset) |
| Live system health | [`/api/health/production`](https://www.zkvanguard.xyz/api/health/production) |
| Frontend (12 locales) | [zkvanguard.xyz](https://www.zkvanguard.xyz) |

> **Deliberate constraint:** the live USDC pool is capped at $10K TVL with strict NAV-oracle mode `ON` in `community_pool_usdc.move` until external audit completes. The capped state is intentional — operational proof, not a TVL claim.

---

## How it works

```
Polymarket binaries + 9 other signal sources
        ↓
Per-asset signal fusion (BTC/ETH/SOL/XRP/DOGE)
        ↓
7 AI agents → 2/3 consensus on trades > $100K
        ↓
USDC vault tilts (BTC / ETH / SUI / CRO)
        ↓
Auto-hedged on BlueFin perpetuals
        ↓
ZK-attested decisions, on-chain reconciliation
```

**Signal pipeline.** Polymarket 5-min binaries + Polymarket category markets + Manifold + Crypto.com 24h tickers + BlueFin funding rates + multi-asset cross-alignment → fused into a single per-asset prediction. A synthetic-STRONG layer upgrades single-binary signals using cross-asset dominance on quiet days. Visible live at [`/api/predictions/per-asset`](https://www.zkvanguard.xyz/api/predictions/per-asset).

**Vault.** A USDC ERC-4626-style pool on Sui that AI-allocates across BTC / ETH / SUI / CRO. Spot legs swap via the BlueFin Aggregator (7 protocols: Cetus, DeepBook, Turbos, FlowX, Aftermath, BlueFin, NAVI). Direction-dependent perp legs open on BlueFin V2 — net delta-neutral on BEARISH/NEUTRAL signals, amplified on BULLISH.

**Safety guard.** Every trade flows through `SafeExecutionGuard`: position caps, slippage limits, 2/3 agent consensus for trades > $100K, ZK proof attestation for any notional > $1M, drawdown halt at 10% from peak NAV, and a circuit breaker that trips after 3 consecutive failures.

---

## Architecture

```
app/                          Next.js 14 frontend + API routes
  api/cron/                   Live cron handlers (10 scheduled on QStash)
agents/                       7-agent orchestrator + SafeExecutionGuard + MessageBus
contracts/sui/sources/        10 Move contracts (deployed to Sui mainnet)
  community_pool_usdc.move    The USDC vault (with strict-mode NAV oracle)
  community_pool.move         Original SUI-native pool (dormant)
  hedge_executor.move         On-chain hedge state + agent caps
  bluefin_bridge.move         BlueFin perp settlement
  zk_hedge_commitment.move    Confidential hedge attestation
  zk_proxy_vault.move         Confidential portfolio primitive
  zk_verifier.move            On-chain ZK proof verification
  payment_router.move         Multi-currency routing
  rwa_manager.move            Tokenized-asset portfolio primitive
  community_pool_timelock.move
contracts/core/               Solidity contracts (multi-chain deployment ready)
lib/services/sui/             Sui pool + BlueFin aggregator + hedge reconciler
lib/services/market-data/     Signal services (Polymarket / Delphi / aggregator)
lib/db/                       PostgreSQL helpers (Aiven)
lib/security/                 Production guards, rate limits, price circuit breakers
lib/ai/llm-provider.ts        Unified LLM router (Crypto.com → ASI → OpenAI → Claude → Ollama)
zk/                           TypeScript ZK-proof client
zkp/                          Python FastAPI ZK-STARK prover (NIST P-521)
scripts/                      ~150 ops scripts (analyze-pool-pnl.ts, e2e tests, etc.)
i18n/, messages/              12-locale next-intl translations
```

### Seven agents

| Agent | Role |
|---|---|
| Lead | Parses intent via LLM, delegates, drives consensus, enforces SafeExecutionGuard |
| Risk | Multi-timeframe streak / correlation / cascade analysis |
| Hedging | BlueFin perp hedging (BTC-PERP / ETH-PERP / SUI-PERP), SL/TP |
| Settlement | x402 gasless settlement, batch processing |
| Reporting | Audit + compliance, embeds ZK proof references |
| PriceMonitor | Threshold price watcher with 5-min ticker subscription |
| SuiPool | 4-asset allocation, drives BlueFin Aggregator swaps |

---

## Verify in 60 seconds

Read-only commands that hit the live system:

```bash
# Reproduce pool PnL — hits Sui mainnet RPC + Aiven read replica
bun run scripts/analyze-pool-pnl.ts

# Check hedge ↔ prediction-signal alignment for active positions
bun run scripts/check-hedge-signal-alignment.ts

# Sanity-check mainnet config + cron heartbeats
bun run scripts/check-sui-mainnet-readiness.ts
```

Or skip the clone and hit live endpoints:

- [`/api/health/production`](https://www.zkvanguard.xyz/api/health/production) — cron heartbeats, BlueFin balance, NAV freshness
- [`/api/predictions/per-asset`](https://www.zkvanguard.xyz/api/predictions/per-asset) — current fused signals across the tracked universe

---

## Quick start

Prereqs: Node 20+, Bun, Python 3.11+ (for the ZK prover), PostgreSQL connection string.

```bash
git clone https://github.com/ZkVanguard/ZkVanguard.git
cd ZkVanguard
bun install --legacy-peer-deps

# Terminal 1 — Python ZK-STARK prover (FastAPI on :8000)
python -m pip install -r zkp/requirements.txt
python zkp/api/server.py

# Terminal 2 — Next.js dev server (:3000)
bun run dev

# Optional — typecheck + lint before commits
bun run typecheck
bun run lint
```

Required env (see `lib/config/` for the full set):

```
SUI_NETWORK=mainnet
SUI_MAINNET_RPC=https://fullnode.mainnet.sui.io:443
NEXT_PUBLIC_SUI_MAINNET_PACKAGE_ID=0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726
NEXT_PUBLIC_SUI_MAINNET_COMMUNITY_POOL_STATE=0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a
DB_V2_DATABASE_URL=...                # Aiven PostgreSQL
QSTASH_TOKEN=...                      # Upstash QStash for cron
QSTASH_URL=...
CRON_SECRET=...
DISCORD_WEBHOOK_URL=...                # optional, for ops alerts
BLUEFIN_PRIVATE_KEY=...                # Sui keypair, server-only
CRYPTOCOM_DEVELOPER_API_KEY=...        # preferred LLM provider
```

> Never log or hardcode private keys. See `CLAUDE.md` for the complete env reference and CRLF-trim conventions.

---

## Cron schedule (production)

All crons are scheduled on Upstash QStash and hit `app/api/cron/*` routes. Each route verifies the QStash signature (or `CRON_SECRET` fallback) and idempotency-claims a slot in `cron_state` before acting.

| Route | Cadence | Purpose |
|---|---|---|
| `polymarket-edge-trader` | every 5 min | Autonomous BlueFin perp trader (Kelly-fractional sizing, 24h kill switch) |
| `bluefin-health` | every 5 min | 3-strike venue de-risk → close-all on degradation |
| `liquidation-guard` | every 10 min | Liquidation-distance alerts + emergency close |
| `health-monitor` | every 10 min | Hits `/api/health/production`, Discord on degradation |
| `pool-nav-monitor` | every 15 min | NAV snapshot independent of allocation logic |
| `hedge-monitor` | every 15 min | Hedge-state monitoring |
| `bluefin-db-reconcile` | every 15 min | DB ↔ BlueFin drift repair |
| `sui-community-pool` | every 30 min | NAV, AI allocation, rebalance swaps, auto-hedge trigger |
| `sui-hedge-reconcile` | hourly | On-chain Move ↔ BlueFin reconcile |
| `sui-collect-fees` | daily | Management + performance fee sweep to treasury |

---

## Tech stack

- **Frontend / API:** Next.js 14 (App Router), TypeScript, TailwindCSS, next-intl (12 locales)
- **Blockchain:** Sui (Move) on mainnet; Solidity for Cronos / Oasis / Hedera / Sepolia / Ethereum (configured, EVM expansion is a deployment step)
- **Zero-knowledge:** Python FastAPI server running a STARK system over NIST P-521, no trusted setup, CUDA-accelerated when available
- **Database:** PostgreSQL on Aiven (migrated from Neon in May 2026)
- **Cron / cache / locks:** Upstash QStash + Redis
- **Trading venue:** BlueFin V2 mainnet perps + BlueFin Aggregator (7 DEXes on Sui)
- **AI providers:** Unified router (Crypto.com Intelligent SDK → ASI → OpenAI → Anthropic → Ollama)
- **Deploy:** Vercel (region `sin1`)

---

## Deployed contracts

### Sui mainnet (production)

| Module | Object ID |
|---|---|
| **Package (v0.2.0)** | `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726` |
| `community_pool_usdc` state | `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a` |

Prior v0.1.0 package `0x9ccb…cd83e598c88` is dormant (state preserved through upgrade). See [`docs/DEPLOY_2026-06-12_v0.2.0.md`](./docs/DEPLOY_2026-06-12_v0.2.0.md) for the deploy record.

### EVM (testnet — deployment ready, not the live product)

EVM Solidity stack is written and configured for Cronos · Oasis Emerald · Oasis Sapphire · Hedera · Sepolia · Ethereum (see `hardhat.config.cjs`). The flagship product is the Sui mainnet vault; EVM deployments are testnet today and expand post-PMF.

---

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — exhaustive repo guide (architecture, env vars, all gotchas, BlueFin invariants, reconciliation topology)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/SUI_DEPLOYMENT.md`](./docs/SUI_DEPLOYMENT.md), [`docs/MAINNET_READINESS.md`](./docs/MAINNET_READINESS.md)
- [`docs/DEPLOY_RUNBOOK.md`](./docs/DEPLOY_RUNBOOK.md) — incident response, env presets, BlueFin invariants, admin endpoints
- [`docs/DEPLOY_2026-06-12_v0.2.0.md`](./docs/DEPLOY_2026-06-12_v0.2.0.md) — v0.2.0 mainnet deploy record

---

## Tests

```bash
bun run test                     # Full Jest suite (30s timeout, 70% coverage gate)
bun run test:agents              # Agent system
bun run test:integration         # ZK STARK + signal pipeline (start Python server first)
bun run test:contracts           # Hardhat / Solidity
bun run scripts/test-sui-services-e2e.ts          # 9 SUI service suites
bun run test-bulletproof-e2e.ts                   # 13 sections / 28 checks
```

---

## License

[Apache 2.0](./LICENSE)
