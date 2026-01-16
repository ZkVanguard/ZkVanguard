# 🏗️ ZkVanguard C4 Architecture

A clear, layered view of the system using the C4 model (Context → Containers → Components → Code).

---

## TL;DR – What's Happening

```
User → Dashboard → AI Agents → Smart Decisions → Blockchain
```

**In plain English:**

1. **User opens dashboard** → Connects wallet, views portfolio
2. **Asks AI for help** → "Hedge my BTC exposure" or "What's the risk?"
3. **5 AI agents collaborate** → Lead routes to Risk/Hedging/Settlement/Reporting
4. **Agents fetch real data** → Crypto.com prices, Polymarket predictions
5. **Execute actions** → Swap via VVS, open hedge on Moonlander
6. **Privacy preserved** → ZK-STARK proofs (521-bit quantum-resistant)
7. **Gasless transactions** → User pays $0.01 USDC, contract pays CRO gas

**Key innovation:** AI agents + ZK privacy + gasless UX = institutional-grade DeFi for everyone.

---

## Level 1: System Context

**What it shows:** ZkVanguard and its external dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL WORLD                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │    User      │    │   Wallet     │    │  Investor    │                 │
│   │  (Trader)    │    │ (MetaMask)   │    │  (Viewer)    │                 │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                 │
│          │                   │                   │                          │
│          └───────────────────┼───────────────────┘                          │
│                              ▼                                              │
│                    ┌─────────────────────┐                                  │
│                    │                     │                                  │
│                    │     ZkVanguard      │                                  │
│                    │    ═══════════      │                                  │
│                    │  AI-Powered RWA     │                                  │
│                    │  Risk Management    │                                  │
│                    │                     │                                  │
│                    └──────────┬──────────┘                                  │
│                               │                                             │
│          ┌────────────────────┼────────────────────┐                        │
│          ▼                    ▼                    ▼                        │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                  │
│   │ Crypto.com  │     │  Polymarket │     │   Cronos    │                  │
│   │  Exchange   │     │   + Delphi  │     │ Blockchain  │                  │
│   │   (Prices)  │     │(Predictions)│     │  (Testnet)  │                  │
│   └─────────────┘     └─────────────┘     └─────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**How it's connected:**

1. **Top layer (Users):** Three actors - User, Wallet, Investor - all funnel into one entry point
2. **Center (ZkVanguard):** The platform receives all user requests via a single entry arrow (▼)
3. **Bottom layer (External Services):** ZkVanguard fans out to 3 external systems via branching arrows:
   - **Left arrow → Crypto.com:** Fetches real-time prices (read-only, no user auth needed)
   - **Center arrow → Polymarket/Delphi:** Pulls prediction market data (read-only)
   - **Right arrow → Cronos:** Reads/writes blockchain state (requires wallet signature)

**Data flow direction:** Top-down for requests, bottom-up for responses. Users never touch external APIs directly - ZkVanguard handles all integrations.

**Key relationships:**
| Actor | Interaction |
|-------|-------------|
| User | Manages portfolios, executes swaps, chats with AI agents |
| Wallet | Signs transactions, approves USDC for gasless ops |
| ZkVanguard | Orchestrates risk management with AI + ZK privacy |
| Crypto.com | Provides real-time prices for 400+ assets |
| Polymarket/Delphi | Supplies prediction market insights |
| Cronos | Hosts smart contracts, VVS swaps, hedging positions |

---

## Level 2: Container Diagram

**What it shows:** The major deployable units

```
┌────────────────────────────────────────────────────────────────────────────┐
│                            ZkVanguard System                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        FRONTEND (Next.js)                            │  │
│  │                        Vercel Deployment                             │  │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐        │  │
│  │  │ Dashboard │  │  AI Chat  │  │  Swap UI  │  │  ZK Demo  │        │  │
│  │  │   Page    │  │ Interface │  │   Modal   │  │   Page    │        │  │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘        │  │
│  └─────────────────────────────┬───────────────────────────────────────┘  │
│                                │                                           │
│                                ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        API LAYER (Next.js API Routes)                │  │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐        │  │
│  │  │ /api/chat │  │/api/prices│  │/api/proof │  │ /api/swap │        │  │
│  │  │  (Agents) │  │(Crypto.com)│ │ (ZK-STARK)│  │   (VVS)   │        │  │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘        │  │
│  └─────────────────────────────┬───────────────────────────────────────┘  │
│                                │                                           │
│         ┌──────────────────────┼──────────────────────┐                   │
│         ▼                      ▼                      ▼                   │
│  ┌─────────────┐      ┌─────────────────┐     ┌─────────────────┐        │
│  │  AI Agent   │      │   ZK Backend    │     │ Smart Contracts │        │
│  │   System    │      │  (Python/CUDA)  │     │ (Solidity/EVM)  │        │
│  │  (5 agents) │      │  localhost:8001 │     │  Cronos Testnet │        │
│  └─────────────┘      └─────────────────┘     └─────────────────┘        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**How it's connected:**

1. **Frontend → API Layer:** Vertical arrow (▼) shows all UI components call the same API layer. The dashboard, chat, swap UI, and ZK demo all make HTTP requests to `/api/*` routes.

2. **API Layer → Three Backends:** The API layer branches into 3 separate systems:
   - **Left: AI Agents** - TypeScript classes called directly (same process)
   - **Center: ZK Backend** - HTTP call to Python server on `localhost:8001`
   - **Right: Smart Contracts** - RPC calls to Cronos testnet via ethers.js

3. **Why 3 backends?**
   - AI Agents need fast in-memory state (TypeScript)
   - ZK proofs need CUDA/GPU (Python)
   - Blockchain needs EVM (Solidity)

**Deployment:** Frontend + API on Vercel (serverless). ZK Backend runs locally or on GPU cloud. Contracts live on Cronos testnet.

**Container descriptions:**

| Container | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | Next.js 14 + React | User interface, dashboard, interactive components |
| **API Layer** | Next.js API Routes | Backend logic, external API integration |
| **AI Agents** | TypeScript classes | 5 specialized agents for decision-making |
| **ZK Backend** | Python + CUDA | ZK-STARK proof generation (521-bit security) |
| **Smart Contracts** | Solidity 0.8.22 | On-chain portfolio, hedging, gasless payments |

---

## Level 3: Component Diagram

**What it shows:** Internal structure of key containers

### 3A. AI Agent System

```
┌────────────────────────────────────────────────────────────────────────┐
│                         AI AGENT SYSTEM                                 │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                    ┌─────────────────────┐                             │
│                    │    LEAD AGENT       │                             │
│                    │  ───────────────    │                             │
│                    │  Orchestrates all   │                             │
│                    │  decisions, routes  │                             │
│                    │  to specialists     │                             │
│                    └──────────┬──────────┘                             │
│                               │                                        │
│           ┌───────────────────┼───────────────────┐                    │
│           ▼                   ▼                   ▼                    │
│    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│    │    RISK     │    │   HEDGING   │    │ SETTLEMENT  │              │
│    │   AGENT     │    │    AGENT    │    │   AGENT     │              │
│    │  ─────────  │    │  ─────────  │    │  ─────────  │              │
│    │ VaR, Sharpe │    │ Moonlander  │    │   x402      │              │
│    │ volatility  │    │ perpetuals  │    │  gasless    │              │
│    └─────────────┘    └─────────────┘    └─────────────┘              │
│                                                                        │
│                       ┌─────────────┐                                  │
│                       │  REPORTING  │                                  │
│                       │    AGENT    │                                  │
│                       │  ─────────  │                                  │
│                       │ Summaries,  │                                  │
│                       │ analytics   │                                  │
│                       └─────────────┘                                  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**How it's connected:**

1. **Lead Agent (top center):** Single entry point. ALL user requests go here first. It's the "manager."

2. **Lead → Specialists (branching arrows):** Lead Agent analyzes the request and routes to 1-3 specialists:
   - **Risk Agent:** Called when user asks about exposure, VaR, volatility
   - **Hedging Agent:** Called when user wants to open/close hedge positions
   - **Settlement Agent:** Called when executing transactions (handles x402 gasless)

3. **Reporting Agent (bottom):** Called at the end to summarize what happened. Gets data from all other agents.

4. **Communication pattern:**
   - Lead → Specialist: "Analyze this portfolio's risk"
   - Specialist → Lead: Returns structured JSON response
   - Lead → Reporting: "Summarize these results"
   - Lead → User: Final formatted response

**Example flow:** "Hedge my BTC" → Lead → Risk (get exposure) → Hedging (calculate position) → Settlement (execute) → Reporting (summarize) → User sees result.

### 3A-2. How Agents Use Prediction Data

```
┌────────────────────────────────────────────────────────────────────────┐
│                 PREDICTION DATA → AGENT DECISIONS                       │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────┐         ┌─────────────────┐                      │
│  │   POLYMARKET    │         │     DELPHI      │                      │
│  │  ─────────────  │         │  ─────────────  │                      │
│  │ "BTC > $100k?"  │         │ "ETH ETF approved│                     │
│  │  Yes: 72%       │         │  by March?"     │                      │
│  │  No:  28%       │         │  Yes: 85%       │                      │
│  └────────┬────────┘         └────────┬────────┘                      │
│           │                           │                                │
│           └───────────┬───────────────┘                                │
│                       ▼                                                │
│           ┌───────────────────────┐                                    │
│           │   /api/polymarket     │                                    │
│           │   DelphiMarketService │                                    │
│           │   ─────────────────── │                                    │
│           │   Aggregates events,  │                                    │
│           │   normalizes format   │                                    │
│           └───────────┬───────────┘                                    │
│                       │                                                │
│     ┌─────────────────┼─────────────────┐                              │
│     ▼                 ▼                 ▼                              │
│ ┌─────────┐     ┌───────────┐    ┌───────────┐                        │
│ │  RISK   │     │  HEDGING  │    │ REPORTING │                        │
│ │  AGENT  │     │   AGENT   │    │   AGENT   │                        │
│ └────┬────┘     └─────┬─────┘    └─────┬─────┘                        │
│      │                │                │                               │
│      ▼                ▼                ▼                               │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │                        AGENT DECISIONS                          │   │
│ │  ───────────────────────────────────────────────────────────    │   │
│ │  • Risk: "BTC 72% bullish → reduce hedge ratio from 50% to 30%" │   │
│ │  • Hedging: "ETH 85% approval → go long ETH perp on Moonlander" │   │
│ │  • Reporting: "Predictions suggest bullish Q1, recommend..."    │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**How it's connected:**

1. **Data Sources (top):** Polymarket and Delphi provide prediction market probabilities
   - Polymarket: General crypto/macro events (BTC price, ETF approvals, etc.)
   - Delphi: Cronos-specific predictions (DeFi events, protocol launches)

2. **Aggregation Layer (middle):** 
   - `/api/polymarket` route fetches and caches Polymarket data
   - `DelphiMarketService` handles Delphi integration
   - Both normalize to common format: `{ event, probability, volume, endDate }`

3. **Agent Consumption (bottom):** Each agent uses predictions differently:

   | Agent | How It Uses Predictions | Example |
   |-------|------------------------|---------|
   | **Risk Agent** | Adjusts risk scores based on market sentiment | 72% bullish → lower risk weight |
   | **Hedging Agent** | Sizes positions based on probability | 85% ETH approval → larger long |
   | **Reporting Agent** | Includes predictions in summaries | "Market expects X with Y% confidence" |

4. **Decision Output:** Agents combine predictions with:
   - Current portfolio state
   - Real-time prices from Crypto.com
   - User risk preferences
   
   → Produce actionable recommendations

**Real example flow:**
```
User: "Should I hedge my ETH?"

1. Lead Agent receives request
2. Risk Agent fetches predictions:
   - Polymarket: "ETH > $4k by Feb" = 68%
   - Delphi: "Cronos DEX volume up" = 74%
3. Risk Agent calculates: Bullish sentiment → lower hedge need
4. Hedging Agent recommends: "Hedge 20% instead of 50%"
5. Response: "Based on 68% bullish prediction, reduce hedge to 20%"
```

### 3B. Smart Contract Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    SMART CONTRACTS (Cronos Testnet)                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                    X402GaslessZKCommitmentVerifier                │ │
│  │                    ─────────────────────────────                  │ │
│  │  • Stores ZK proof commitments                                    │ │
│  │  • Collects $0.01 USDC per tx                                    │ │
│  │  • Sponsors all CRO gas from contract balance                    │ │
│  │  • Address: 0x44098d0dE36e157b4C1700B48d615285C76fdE47           │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─────────────────────┐    ┌─────────────────────┐                   │
│  │     RWAManager      │    │    PaymentRouter    │                   │
│  │  ─────────────────  │    │  ─────────────────  │                   │
│  │  RWA token mgmt     │    │  Payment routing    │                   │
│  │  Asset allocation   │    │  Multi-path swaps   │                   │
│  └─────────────────────┘    └─────────────────────┘                   │
│                                                                        │
│  ┌─────────────────────┐    ┌─────────────────────┐                   │
│  │GaslessZKCommitment  │    │    ZKVerifier       │                   │
│  │     Verifier        │    │  ─────────────────  │                   │
│  │  ─────────────────  │    │  On-chain proof     │                   │
│  │  Alt gasless impl   │    │  verification       │                   │
│  └─────────────────────┘    └─────────────────────┘                   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**How it's connected:**

1. **X402GaslessZKCommitmentVerifier (main box):** The primary contract users interact with.
   - User calls `storeCommitmentWithUSDC()` 
   - Contract pulls $0.01 USDC from user via `transferFrom`
   - Contract pays CRO gas from its own balance
   - Stores ZK proof commitment on-chain

2. **Supporting contracts (2x2 grid below):**
   - **RWAManager ↔ PaymentRouter:** RWAManager tracks assets, PaymentRouter handles multi-path token swaps
   - **GaslessZKVerifier ↔ ZKVerifier:** Alternative implementations for different verification needs

3. **Contract interactions:**
   ```
   User → X402Verifier → stores commitment
                       → emits events
                       → tracks gas sponsored
   
   User → PaymentRouter → swaps tokens via VVS
                        → routes to best path
   ```

4. **All contracts share:** Same USDC token address, same Cronos testnet (chain 338), same deployer/owner.

### 3C. Data Flow Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          DATA FLOW                                      │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  EXTERNAL DATA                PROCESSING                   OUTPUT      │
│  ─────────────               ───────────                  ─────────    │
│                                                                        │
│  ┌─────────────┐            ┌─────────────┐           ┌─────────────┐ │
│  │ Crypto.com  │───prices──▶│   Price     │──────────▶│  Portfolio  │ │
│  │    API      │            │  Aggregator │           │   Values    │ │
│  └─────────────┘            └─────────────┘           └─────────────┘ │
│                                    │                                   │
│  ┌─────────────┐                   │                  ┌─────────────┐ │
│  │ Polymarket  │───events──▶┌─────────────┐──────────▶│ Prediction  │ │
│  │   + Delphi  │            │  AI Agents  │           │  Insights   │ │
│  └─────────────┘            │  (Analysis) │           └─────────────┘ │
│                             └──────┬──────┘                            │
│  ┌─────────────┐                   │                  ┌─────────────┐ │
│  │   Wallet    │───sign────▶┌─────────────┐──────────▶│ On-chain    │ │
│  │  (MetaMask) │            │  X402 Svc   │           │   State     │ │
│  └─────────────┘            │  (Gasless)  │           └─────────────┘ │
│                             └─────────────┘                            │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**How it's connected:**

1. **Three parallel streams (left to right):**

   | Stream | Source | Processor | Output |
   |--------|--------|-----------|--------|
   | **Prices** | Crypto.com API | Price Aggregator | Portfolio Values |
   | **Predictions** | Polymarket + Delphi | AI Agents | Prediction Insights |
   | **Transactions** | Wallet (MetaMask) | X402 Service | On-chain State |

2. **How streams connect:**
   - Price stream feeds into AI Agents (they need prices for risk calculations)
   - AI Agents output goes to both Insights AND can trigger X402 ("execute this hedge")
   - X402 updates on-chain state, which reflects back in Portfolio Values

3. **Arrows meaning:**
   - `───prices──▶` = HTTP GET, cached 30 seconds
   - `───events──▶` = HTTP GET, real-time polling
   - `───sign────▶` = User signature via MetaMask popup

4. **Feedback loop:** On-chain State changes → triggers price re-fetch → updates Portfolio Values → user sees updated dashboard.

---

## Level 4: Code (Key Files)

| Layer | File | Purpose |
|-------|------|---------|
| **Frontend** | `app/dashboard/page.tsx` | Main dashboard UI |
| **Frontend** | `components/dashboard/ChatInterface.tsx` | Chat with agents |
| **API** | `app/api/chat/route.ts` | Agent orchestration endpoint |
| **API** | `app/api/prices/route.ts` | Crypto.com price fetcher |
| **Agents** | `agents/core/LeadAgent.ts` | Decision orchestrator |
| **Agents** | `agents/specialized/RiskAgent.ts` | Risk calculations |
| **Agents** | `agents/specialized/HedgingAgent.ts` | Perp recommendations |
| **Services** | `lib/services/X402GaslessService.ts` | Gasless txs |
| **Services** | `lib/services/VVSSwapSDKService.ts` | DEX integration |
| **ZK** | `zk/python/zk_system.py` | CUDA-accelerated proofs |
| **Contracts** | `contracts/core/X402GaslessZKCommitmentVerifier.sol` | Gasless verifier |

---

## Quick Summary (Elevator Pitch)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   USER  ──▶  NEXT.JS APP  ──▶  5 AI AGENTS  ──▶  DECISIONS     │
│                  │                                              │
│                  ├──▶  Crypto.com API  (prices)                │
│                  ├──▶  Polymarket/Delphi  (predictions)        │
│                  ├──▶  VVS Finance  (swaps)                    │
│                  ├──▶  Moonlander  (hedging)                   │
│                  ├──▶  ZK-STARK Backend  (privacy)             │
│                  └──▶  X402 Gasless  ($0.01 USDC, no CRO)      │
│                                                                 │
│   All on Cronos Testnet  •  521-bit quantum-resistant proofs   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack Summary

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14, React 18, TypeScript, TailwindCSS |
| **Backend** | Next.js API Routes, Node.js |
| **AI Agents** | Custom TypeScript classes, multi-agent orchestration |
| **ZK Proofs** | Python 3.11, CUDA 12.x, ZK-STARK (521-bit NIST P-521) |
| **Blockchain** | Cronos Testnet, Solidity 0.8.22, Hardhat |
| **DEX** | VVS Finance SmartRouter SDK |
| **Derivatives** | Moonlander perpetuals integration |
| **Gasless** | x402 protocol + USDC micropayments |
| **Hosting** | Vercel (frontend), Local/Cloud (ZK backend) |

---

## Deployed Contract Addresses (Cronos Testnet)

| Contract | Address | Verified |
|----------|---------|----------|
| **X402GaslessZKCommitmentVerifier** | `0x44098d0dE36e157b4C1700B48d615285C76fdE47` | ✅ |
| ZKVerifier | `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8` | ✅ |
| RWAManager | `0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189` | ✅ | Updated Jan 16, 2026 with Deposited/Withdrawn/Rebalanced events |
| PaymentRouter | `0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b` | ✅ |
| GaslessZKVerifier | `0x7747e2D3e8fc092A0bd0d6060Ec8d56294A5b73F` | ✅ |
| zkPaymaster | `0x81E2d8d860847Ca1b3ADd950dBeED6191be23D87` | ✅ |
| USDC (DevUSDCe) | `0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0` | ✅ |

---

## API Routes Summary

| Category | Routes | Count |
|----------|--------|-------|
| **Chat/AI** | `/api/chat`, `/api/chat/health` | 2 |
| **Prices** | `/api/prices`, `/api/market-data` | 2 |
| **Portfolio** | `/api/portfolio/*` | 5 |
| **ZK Proofs** | `/api/zk-proof/*` | 6 |
| **Agents** | `/api/agents/*` | 9 |
| **Demo** | `/api/demo/*` | 2 |
| **Other** | `/api/health`, `/api/polymarket`, `/api/cronos-explorer` | 3 |
| **Total** | | **29** |
