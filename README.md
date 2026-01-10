# ZkVanguard

**AI-Powered Multi-Agent RWA Risk Management Platform**

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://zkvanguard.vercel.app)
[![Tests](https://img.shields.io/badge/Tests-10%2F10-brightgreen)](./docs/reports/COMPLETE_SYSTEM_TEST_REPORT.md)
[![Cronos](https://img.shields.io/badge/Network-Cronos%20Testnet-blue)](https://cronos.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue)](LICENSE)

---

## Overview

ZkVanguard automates institutional crypto portfolio management through 5 specialized AI agents, zero-knowledge privacy proofs, and gasless transactions.

**Live Demo:** [zkvanguard.vercel.app](https://zkvanguard.vercel.app)

---

## Key Features

| Feature | Description |
|---------|-------------|
| **5 AI Agents** | Lead, Risk, Hedging, Settlement, and Reporting agents working autonomously |
| **ZK-STARK Privacy** | 521-bit post-quantum secure proofs via CUDA-accelerated backend |
| **Gasless Transactions** | x402 protocol enables $0.00 CRO gas fees |
| **Prediction Markets** | Live Polymarket/Delphi integration for predictive risk intelligence |
| **Real-Time Data** | Crypto.com Exchange API at 100 req/s, VVS Finance DEX, Moonlander perpetuals |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Next.js 14)                                  │
│  Dashboard • AI Chat • ZK Proofs • Portfolio Management │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐    ┌─────▼─────┐   ┌─────▼─────┐
    │ 5 AI    │    │ Protocol  │   │ ZK-STARK  │
    │ Agents  │    │ Layer     │   │ Backend   │
    │         │    │           │   │ (Python)  │
    │ • Lead  │    │ • x402    │   │           │
    │ • Risk  │    │ • VVS     │   │ • CUDA    │
    │ • Hedge │    │ • Delphi  │   │ • FastAPI │
    │ • Settle│    │ • Crypto  │   │ • 521-bit │
    │ • Report│    │   .com    │   │           │
    └────┬────┘    └─────┬─────┘   └─────┬─────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
              ┌──────────▼──────────┐
              │  Cronos Testnet     │
              │  Smart Contracts    │
              └─────────────────────┘
```

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/mrarejimmyz/ZkVanguard.git
cd ZkVanguard
npm install

# Start ZK backend (Terminal 1)
cd zkp/api && pip install -r requirements.txt && python server.py

# Start frontend (Terminal 2)
npm run dev

# Run system test (Terminal 3)
npx tsx scripts/complete-system-test.ts
```

---

## Integrations

| Integration | Purpose | Status |
|-------------|---------|--------|
| Crypto.com Exchange API | Real-time market data (100 req/s) | ✅ Live |
| Polymarket API | Prediction market data | ✅ Live |
| VVS Finance SDK | DEX swaps on Cronos | ✅ Live |
| Moonlander | Perpetual futures hedging | ✅ Live |
| x402 Facilitator | Gasless transactions | ✅ Live |

---

## Smart Contracts (Cronos Testnet)

| Contract | Address |
|----------|---------|
| RWAManager | `0x170E8232E9e18eeB1839dB1d939501994f1e272F` |
| ZKVerifier | `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8` |
| PaymentRouter | `0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b` |
| GaslessZKVerifier | `0x44098d0dE36e157b4C1700B48d615285C76fdE47` |

---

## Tech Stack

**Frontend:** Next.js 14, TypeScript, TailwindCSS, wagmi/viem  
**Backend:** Node.js, Python FastAPI, CUDA  
**Blockchain:** Cronos zkEVM, Solidity 0.8.20, Hardhat  
**AI:** Crypto.com AI SDK, Custom multi-agent orchestration

---

## Documentation

| Document | Description |
|----------|-------------|
| [Demo Walkthrough](./DEMO_WALKTHROUGH_GUIDE.md) | Complete demo script with speaking points |
| [Investor Pitch](./INVESTOR_PITCH_DECK.md) | Investment thesis and market opportunity |
| [Architecture](./docs/ARCHITECTURE.md) | System design overview |
| [Setup Guide](./docs/SETUP.md) | Installation and configuration |
| [Test Report](./docs/reports/COMPLETE_SYSTEM_TEST_REPORT.md) | Validation results |

---

## Validation

```bash
# Type check
npm run typecheck

# Unit tests
npm test

# Integration test (10/10 tests)
npx tsx scripts/complete-system-test.ts

# Build
npm run build
```

---

## Project Structure

```
├── app/                    # Next.js pages and API routes
├── agents/                 # 5 AI agent implementations
├── components/             # React components
├── contracts/              # Solidity smart contracts
├── lib/                    # Services and utilities
├── docs/                   # Documentation
├── test/                   # Jest unit tests
├── tests/                  # Integration test scripts
├── zk/                     # ZK-STARK Python backend
└── scripts/                # Deployment and test scripts
```

---

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

---

<div align="center">

**[Live Demo](https://zkvanguard.vercel.app)** • **[Documentation](./docs/)** • **[Demo Guide](./DEMO_WALKTHROUGH_GUIDE.md)**

Built for the Cronos x402 Hackathon

</div>
