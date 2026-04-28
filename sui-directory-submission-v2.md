# Sui Directory Submission — ZkVanguard (Sui-Focused)

> Scope: **Sui-only** narrative. USDC Community Pool · Sui Services · 7 AI Agents · Crowd-sourced Prediction Markets.

---

## Application Type
**[X] New Application**

---

## Project Basics

**Project Name:** ZkVanguard

**Project Logo:** `public/logo.png` (1000×600 recommended)

**Short Description (≤200 chars):**
> AI-managed USDC community pool on Sui. 7 autonomous agents auto-rebalance and hedge using crowd-sourced prediction-market signals for high-accuracy, predictive risk defense.

(196 characters)

**Long Description:**
> ZkVanguard is a Sui-native AI risk-management platform built around a **USDC Community Pool**. Users deposit USDC and receive shares (1 share = 1 USDC); seven autonomous AI agents then allocate the pool across BTC (30%), ETH (30%), SUI (25%), and CRO (15%), executing atomic swaps through the **Cetus aggregator** (Cetus, DeepBook, Turbos, BlueFin, FlowX, Aftermath). Rebalancing triggers automatically on 5% drift or 75%+ AI confidence; sponsored transactions keep the UX gasless.
>
> The platform's edge is **predictive, crowd-sourced intelligence**. Instead of reacting after a crash, ZkVanguard streams live odds from **Polymarket** and other prediction markets — wisdom-of-crowds signals with measurably high directional accuracy on macro and asset-specific events — into the **Delphi correlation engine**. Delphi maps each signal to the pool's current 4-asset composition and emits `HEDGE` / `MONITOR` / `IGNORE` decisions, which the Hedging Agent executes through Sui-native perpetuals and on-chain commitments before adverse moves materialize.
>
> Seven specialized agents — **Lead** (orchestrator), **Risk** (VaR / Sharpe / liquidation), **Hedging** (prediction-driven strategy), **Settlement** (gasless on-chain execution), **Reporting** (audit + compliance), **PriceMonitor** (threshold alerts), and **SuiPool** (NAV + rebalancing) — coordinate via a typed message bus with safe-execution guards.
>
> Sui services shipped: `SuiCommunityPoolService` (deposit/withdraw, NAV, members), `BluefinAggregatorService` (multi-DEX quotes & rebalance planner), `SuiOnChainHedgeService` (commitment hedges), `SuiPrivateHedgeService` (stealth addresses + ZK commitments), `SuiAutoHedgingAdapter`, `SuiPortfolioManager`, and `SuiExplorerService`. The Sui mainnet contract is live, capability-gated (AdminCap / FeeManagerCap / RebalancerCap / AgentCap), and covered by a 9-suite, 72/72 E2E test pass.
>
> Live: https://zkvanguard.xyz

---

## Categories

**Primary Category:** Risk Management
**Secondary (up to 2):**
1. AI / Agents
2. DeFi / Asset Management

---

## Links

| Field | Value |
|-------|-------|
| Project Website | https://zkvanguard.xyz |
| Project Email | [contact@zkvanguard.xyz — confirm] |
| Project Github | https://github.com/ZkVanguard/ZkVanguard |
| Project Twitter | [https://twitter.com/ZkVanguard — confirm] |
| Project Telegram | [confirm or N/A] |
| Project Discord | [confirm or N/A] |
| Company LinkedIn | [confirm or N/A] |

**Project Phase:** Mainnet — Live
**Opt in to Sui Foundation updates?:** Yes

---

## Sui Mainnet Object IDs

**Submit this in the "Mainnet Sui Object ID" field (the user-facing on-chain product):**
`0xe814e0948e29d9c10b73a0e6fb23c9997ccc373bed223657ab65ff544742fb3a`
*(USDC Community Pool — shared object on Sui mainnet)*

**Supporting on-chain identifiers:**

| Object | ID |
|--------|----|
| Active Package (v2) | `0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88` |
| Original Package | `0x8f2534a77f1f0baf8c2bc44cf1cc5ada72ffd6be515f54f8f073dc434e1a3ca2` |
| Publish Tx | `36AfAeurX1HMBdA4AkojgADRcREYSW3CJfBrdQjRhVLR` |
| AdminCap | `0x8109e15aec55e5ad22e0f91641eda16398b6541d0c0472b113f35b1b59431d78` |
| FeeManagerCap | `0x03aa81ae087977475241f2ec9315a74f46d2c450a8728fabeb9d7475a5e690d1` |
| RebalancerCap | `0xa44d8b3c42a462de7abaf2f7db13d8d384f2a2c331f9d40ae5621f62877e722b` |
| AgentCap | `0xdeecf4483ba7729f91c1a4349a5c6b9a5b776981726b1c0136e5cf788889d46d` |
| UpgradeCap | `0xf1b0425073f68527495f8e530b8e55899518d9b040e3b6be377a25e1291a63a2` |
| Deployer | `0x99a3aa83fd72bc6cf6c5ae6e29ec7e8bf6e2c41e5dfc4e0cf3e8a1e5e7adac93` |

---

## KYC

**[X] Yes — the Project Contact will complete verification.**

---

## Contact Information *(not public)*

| Field | Value |
|-------|-------|
| Primary Contact Name | [Your full legal name] |
| Primary Contact Email | [your email] |
| LinkedIn | [https://linkedin.com/in/…] |
| Telegram | [https://t.me/…] |
| Project Primary Location (Country) | [Your country] |

---

## Team Information

### Team Member 1
- **Name:** [Full name]
- **Twitter:** https://twitter.com/[handle]
- **LinkedIn:** https://www.linkedin.com/in/[handle]
- **Role:** Founder & Lead Engineer
- **Background:**
  > [e.g. "Full-stack and Move engineer. Built ZkVanguard's Sui USDC community pool, the 7-agent AI orchestration layer, the Cetus aggregator integration, and the Delphi prediction-market correlation engine. Previously [prior roles]."]

### Team Member 2
- **Name:** [Full name or `N/A`]
- **Twitter:** https://twitter.com/[handle] (or `N/A`)
- **LinkedIn:** https://www.linkedin.com/in/[handle]
- **Role:** [e.g. AI / Risk Engineering]
- **Background:** [Short summary]

**Past projects:** [Optional — prior shipped products, hackathon wins, grants]

---

## Parent Brand / Company
**[ ] Yes  [X] No** *(toggle if applicable)*

---

## References

**Reference 1**
- Name: [Reference name]
- Contact: [Twitter / Discord / LinkedIn / Email]
- Relationship: [e.g. Sui ecosystem advisor]

**Reference 2**
- Name: [Reference name]
- Contact: [Twitter / Discord / LinkedIn / Email]
- Relationship: [e.g. Cetus / Bluefin integration partner]

---

## Agree To Terms
**[X] Yes, I agree.**

---

## Internal Notes (do not submit)

Sui-only positioning hits four pillars the directory cares about:
1. **USDC Community Pool** — live shared object, capability-gated, 4-asset auto-allocation.
2. **Sui Services** — Cetus aggregator, Bluefin, on-chain + private hedges, portfolio manager, explorer.
3. **7 AI Agents** — Lead, Risk, Hedging, Settlement, Reporting, PriceMonitor, SuiPool.
4. **Crowd-sourced Prediction Markets** — Polymarket + Delphi correlation → predictive hedging with documented directional accuracy.

If the long description is rejected for length, trim to the first two paragraphs (keeps Pool + Prediction-Market story intact).
