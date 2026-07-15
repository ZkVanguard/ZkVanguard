# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-15

### Added — 8-gate autonomy defense system
Shipped after a real drawdown revealed that existing autonomy layers (profit-lock, hedgeability clamp, drift-close) were prescriptive — they gated future rebalances but never actively reshaped existing holdings. Each gate defends a specific failure mode; the full stack is verified by `test/integration/pool-drawdown-defense.test.ts` (10/10 green).

- **PortfolioDriver** (`lib/services/sui/PortfolioDriver.ts`) — corrective unwind actions on existing spot/perp holdings; emits `SELL_SPOT_TO_USDC` / `BUY_SPOT_FROM_USDC` / `OPEN_HEDGE` / `CLOSE_HEDGE` given current state + signal + drawdown
- **HedgeFillVerifier** (`lib/services/sui/HedgeFillVerifier.ts`) — post-open `getPositions()` cross-check to catch BlueFin silent-rejects
- **applyHedgeabilityClamp** (`lib/services/sui/cron/allocation.ts`) — spot cap → 0% when perp min-qty unopenable at NAV
- **Symmetric sell trigger** (in PortfolioDriver) — mirror of the buy trigger; opposing signal ≥ 65% reduces allocation
- **StaleHedgeDetector** (`lib/services/sui/StaleHedgeDetector.ts`) — age > 7d + ≥ 2 signal flips + contradicted side → force-close candidate
- **Signal-flip drift-close for spot** (in `app/api/cron/agent-signal-tick/route.ts`) — spot leg unwind on direction flip
- **regret-tracker** (`lib/services/ai/regret-tracker.ts`) — confidence-weighted rolling outcome; scales stake by [0.25, 1.0]
- **alert-response-loop** (`lib/services/alerting/alert-response-loop.ts` + `/api/cron/alert-response-loop`) — 3 KILL/hr → shrink; 24h profit-lock → unwind; phantom rate > 1% → halt

### Env gates
All destructive actions ship behind env flags (default OFF) so operators can log-observe first:
- `PORTFOLIO_DRIVER_EXECUTE=1` — actual SELL/BUY/OPEN/CLOSE actions
- `STALE_HEDGE_AUTO_CLOSE=1` — force-close stale hedges
- `ALERT_RESPONSE_EXECUTE=1` — auto-response actions
- `ALERT_RESPONSE_EXECUTE_HALT=1` — HALT_TRADER / HALT_AUTOHEDGE responses
- `REGRET_TRACKER_DISABLE=1` — default ON in polymarket-edge-trader stake calc

### Changed
- `notifyDiscord` now appends KILL/ERROR/WARN alerts to `cron_state` ring buffer key `alert-log:ring-buffer` (200-entry cap) for alert-response-loop consumption
- `polymarket-edge-trader` stake sizing composes regret multiplier with existing signal-strength multiplier
- `sui-hedge-reconcile` cron runs stale-hedge detection each tick (log-only by default)
- `sui-community-pool` cron invokes PortfolioDriver after profit-lock decision

### New QStash schedule required
The `/api/cron/alert-response-loop` route needs an Upstash schedule (every 15 min) — see [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) for the `curl` snippet.

### Tests
- New: `test/integration/pool-drawdown-defense.test.ts` — 10 tests, live-read/sandbox-write drawdown replay
- Regression: 412 pre-existing tests still green

---

## [0.2.0] - 2026-06-12

### Added — SUI Mainnet USDC Community Pool
- Package `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726` deployed (UpgradeCap v3)
- USDC pool state `0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a`
- External NAV oracle — fixes prior share-math underpayment (per-share $1.91 vs $0.045 pre-fix)
- Strict mode ON (`admin_set_external_nav_required(true)`) — deposits/withdrawals revert with `E_EXTERNAL_NAV_STALE` if cron oracle attestation > 2h stale
- TVL cap $10K (`admin_set_tvl_cap`) — phased ratchet planned
- `close_hedge` funds-verify — drain prevention via AgentCap
- `zk_proxy_vault` cross-proxy + 4 ZK contracts with ed25519 prover attestation
- 15 internal audit phases (14 Move + 1 off-chain TS)
- 7-agent orchestrator (Lead / Risk / Hedging / Settlement / Reporting / PriceMonitor / SuiPool)
- SafeExecutionGuard — 2-of-3 consensus > $100K, position/slippage caps, circuit breaker
- BluefinAggregatorService — 6 DEXes on Sui (Cetus / DeepBook / Turbos / FlowX / Aftermath / BlueFin) via `@bluefin-exchange/bluefin7k-aggregator-sdk`
- Prediction-market signal pipeline (`PredictionAggregatorService`) — Polymarket 5-min + Delphi/Polymarket + Manifold + Crypto.com + BlueFin funding
- Autonomous perp trader (`polymarket-edge-trader` cron, 5-min cadence)
- 10 production crons on Upstash QStash with heartbeats + idempotency claims

### Changed
- Migrated database: Neon → Aiven PostgreSQL (Bangalore PG17)
- BlueFin `openHedge` uses `isIsolated: true` (fixes silent-reject bug from ISOLATED-only exchange support)
- `closeHedge` snaps to per-symbol stepSize (fixes prior silent-reject class)
- Move contract read-through: `max_hedge_ratio_bps` from chain (never hardcode)

### Deprecated
- v0.1.0 package `0x9ccb…cd83e598c88` — dormant; pool state preserved through upgrade
- MSafe treasury (reverted for autonomous hedging; MSafe still holds `FeeManagerCap`)

### Fixed
- Withdrawal underpayment (2026-06-03) — pool `calculate_assets_for_shares` now includes off-chain wBTC/wETH/SUI market value
- CRLF trap on Vercel env values — `.trim()` on every SUI env read + `instrumentation.ts` sanitises on cold start
- u64 overflow guard (`lib/services/sui/safe-bigint.ts`) — NAV up to `NAV_SAFETY_CEILING_USDC=500_000_000`

### Security
- 15 internal audit phases completed (see [`AUDIT_2026-06-04.md`](./AUDIT_2026-06-04.md), [`AUDIT_2026-06-12_phase15_offchain.md`](./AUDIT_2026-06-12_phase15_offchain.md))
- OFAC geo-block middleware (KP, IR, SY, CU, RU, BY)
- Strict NAV-oracle mode ON

---

## [0.1.0] - 2026-01-02

### Added
- 🤖 **5 Specialized AI Agents**
  - Lead Agent: Orchestration and strategy coordination
  - Risk Agent: Portfolio risk analysis (VaR, volatility, Sharpe ratio)
  - Hedging Agent: Optimal hedge strategy generation
  - Settlement Agent: Gasless transaction execution with x402
  - Reporting Agent: Comprehensive analytics and insights

- 🔐 **ZK-STARK Privacy Layer**
  - Real cryptographic proof generation (521-bit NIST P-521)
  - CUDA GPU acceleration (12ms proof generation)
  - On-chain verification with ZKVerifier contract
  - Privacy-preserving portfolio analytics

- ⚡ **x402 Gasless Protocol Integration**
  - Zero gas fees for settlements ($0.00 CRO)
  - USDC-based payment routing
  - 97.4% test coverage
  - GaslessZKVerifier smart contract

- 🎨 **Modern Dashboard UI**
  - Real-time portfolio monitoring
  - Interactive risk metrics visualization
  - Agent activity tracking with ZK proof verification
  - Wallet connection with WDK (self-custodial EVM wallet)
  - Dark/Light theme support

- 📊 **Smart Contract Suite**
  - RWAManager: Portfolio and asset management
  - ZKVerifier: Zero-knowledge proof verification
  - PaymentRouter: Multi-token payment handling
  - GaslessZKVerifier: Gasless transaction processing
  - All contracts deployed on Cronos testnet (ChainID 338)

- 🧪 **Comprehensive Testing**
  - 70/70 tests passing (100% success rate)
  - 10/10 E2E integration tests
  - 41/41 on-chain smart contract tests
  - 19/19 AI agent tests
  - Live API testing (CoinGecko, Cronos RPC)

- 📚 **Documentation**
  - Architecture overview
  - Deployment guide
  - Test guide
  - API documentation
  - Setup instructions
  - Security policy

### Technical Stack
- **Frontend**: Next.js 14, React 18, TypeScript, TailwindCSS
- **Smart Contracts**: Solidity 0.8.22, Hardhat, OpenZeppelin
- **Blockchain**: Cronos EVM Testnet (ChainID 338)
- **AI/ML**: Crypto.com AI Agent SDK, OpenAI GPT-4
- **Privacy**: ZK-STARK proofs, CUDA acceleration, Python FastAPI
- **Payments**: x402 Facilitator, USDC settlements
- **Testing**: Jest, Hardhat, TypeScript

### Deployed Contracts (Cronos Testnet)
- RWAManager: `0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189` (Updated Jan 16, 2026 - with transaction events)
- ZKVerifier: `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8`
- PaymentRouter: `0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b`
- GaslessZKVerifier: `0x44098d0dE36e157b4C1700B48d615285C76fdE47`
- USDC Token: `0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0`

### Security
- All contracts inherit from OpenZeppelin battle-tested implementations
- Access control with Ownable pattern
- Reentrancy guards on sensitive functions
- Integer overflow protection (Solidity 0.8+)
- Comprehensive input validation

---

## [Unreleased]

### Planned
- Mainnet deployment on Cronos zkEVM
- Additional AI models for portfolio optimization
- Multi-chain support (Ethereum, Hedera)
- Advanced hedging strategies (options, perpetuals)
- Historical performance analytics
- Mobile app (React Native)

---

## Release Notes Format

### Types of Changes
- `Added` for new features
- `Changed` for changes in existing functionality
- `Deprecated` for soon-to-be removed features
- `Removed` for now removed features
- `Fixed` for any bug fixes
- `Security` for vulnerability fixes

### Semantic Versioning
- **MAJOR** version: Incompatible API changes
- **MINOR** version: Backwards-compatible new features
- **PATCH** version: Backwards-compatible bug fixes

---

**Note**: This project is currently in beta (0.x.x versions). Breaking changes may occur between minor versions until 1.0.0 release.
