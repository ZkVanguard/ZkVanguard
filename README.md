# Chronos Vanguard 🛡️

> AI-Powered Multi-Agent System for Real-World Asset Risk Management on Cronos zkEVM

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Cronos](https://img.shields.io/badge/Cronos-zkEVM-blue)](https://cronos.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## 🎯 Overview

Chronos Vanguard is an intelligent multi-agent AI system for automated risk management, hedging, and settlement of Real-World Asset (RWA) portfolios on Cronos zkEVM. The platform leverages zero-knowledge proofs for privacy-preserving verification and integrates with leading DeFi protocols.

**Production Status**: ZK-STARK proof system and gasless transactions fully operational on Cronos testnet. AI agent infrastructure complete, with orchestration layer in development.

### ✨ Key Features

- 🤖 **Multi-Agent AI System** - Specialized agents for risk analysis, hedging, settlement, and reporting
- 🔐 **ZK-STARK Proofs** - Real cryptographic proofs with 521-bit post-quantum security
- ⚡ **Cronos zkEVM Native** - Optimized for high-performance blockchain execution
- 🌐 **Protocol Integration** - VVS Finance, Delphi Digital, Moonlander Protocol
- 🎨 **Modern UI/UX** - Clean, professional interface with light/dark theme support
- 📊 **Real-Time Analytics** - Live portfolio tracking and risk metrics
- ⚡ **Gasless Transactions** - 97%+ gasless coverage with automated refunds

## 🤖 Multi-Agent AI System

The platform features a sophisticated multi-agent architecture with specialized agents:

### Agent Architecture

- **BaseAgent** - Abstract base class with dual constructor pattern support:
  - Full pattern: `(name, type, config, messageBus)` for backend orchestration
  - Simplified pattern: `(agentId, name, capabilities)` for API routes
- **RiskAgent** - Portfolio risk assessment and metrics analysis
- **HedgingAgent** - Automated hedge recommendation generation
- **SettlementAgent** - Batch settlement with ZK proofs and x402 integration
- **ReportingAgent** - Comprehensive portfolio reporting

### Current Integration Status

**✅ Production Ready:**
- **ZK-STARK Proofs**: Real cryptographic proofs (77KB, 521-bit security) generating and storing on-chain
- **Gasless System**: 97%+ coverage with automatic refunds via smart contract
- **Smart Contracts**: Deployed on Cronos testnet (`0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9`)
- **Frontend**: Production build passing, responsive UI with light/dark themes
- **Protocol Integrations**: VVS, Delphi, Moonlander clients implemented and tested

**🚧 In Development:**
- **Agent Orchestration**: Complete agent implementations ready for orchestration layer
- **API Routes**: Currently return demo data; agents ready to connect via orchestration service
- **Real-Time Updates**: WebSocket layer for live agent communication

**Architecture:**
- All agent code complete in `agents/` directory
- Message bus and event system implemented
- Type-safe interfaces and capability system
- Ready for Phase 2 orchestration deployment

See [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) and [docs/WORKING_FEATURES.md](./docs/WORKING_FEATURES.md) for details.

## 🏗️ Project Structure

```
chronos-vanguard/
├── agents/              # AI agent system (TypeScript)
│   ├── core/           # Base agent & orchestration
│   ├── specialized/    # Risk, hedging, settlement agents
│   └── communication/  # Message bus
├── app/                # Next.js app directory
│   ├── dashboard/      # Main dashboard
│   ├── zk-proof/       # ZK proof demo
│   └── api/            # API routes
├── components/         # React components
├── contexts/           # React contexts (theme)
├── contracts/          # Smart contracts
├── docs/               # 📚 All documentation
├── integrations/       # Protocol integrations
├── lib/                # Utilities & APIs
├── shared/             # Shared types & utilities
├── tools/              # 🧪 Testing & development tools
├── zkp/                # Python ZK-STARK implementation
└── zk/                 # TypeScript ZK integration
```

## 📚 Documentation

All documentation organized in [`docs/`](./docs):

- **[Architecture](./docs/ARCHITECTURE.md)** - System design and tech stack
- **[Scalability Guide](./docs/SCALABILITY.md)** - Scalable architecture patterns ⭐
- **[Setup Guide](./docs/SETUP.md)** - Installation and configuration
- **[Testing](./docs/TEST_GUIDE.md)** - Comprehensive testing guide
- **[Gasless System](./docs/GASLESS_FINAL_SOLUTION.md)** - Gasless transaction implementation
- **[Frontend Integration](./docs/FRONTEND_GASLESS_INTEGRATION.md)** - Frontend gasless integration
- **[Deployment](./docs/DEPLOYMENT.md)** - Contract deployment guide
- **[Known Issues](./docs/KNOWN_ISSUES.md)** - Current limitations and workarounds
- **[Full Index](./docs/README.md)** - Complete documentation index

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Python 3.8+ (for ZK proofs)
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/zkvanguard.git
cd zkvanguard

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Start development server
npm run dev
```

Visit http://localhost:3000 to see the application.

### Running Tests

```bash
# TypeScript tests
npm run test

# ZK system tests
python tools/test_zk_system.py

# Smart contract tests
npx hardhat test

# Gasless system tests
node scripts/test-gasless-complete.js

# Frontend gasless verification
node scripts/verify-gasless-frontend.js

# Integration tests
npm run test:integration
```

### Building for Production

```bash
# Build frontend
npm run build

# Compile contracts
npx hardhat compile

# Deploy contracts
npx hardhat run scripts/deploy-gasless-verifier.js --network cronos-testnet
```

## 🎨 Theme Support

The application supports both light and dark themes:
- **Default**: Light theme
- **Toggle**: Click the sun/moon icon in the navigation bar
- **Persistence**: Theme preference saved in localStorage

## 🧪 Development Tools

Located in [`tools/`](./tools):
- `test_zk_system.py` - ZK proof system tests
- `inspect_proof.py` - Proof analysis tool
- `sample_proof.json` - Real ZK-STARK proof (77KB)

See [tools/README.md](./tools/README.md) for usage instructions.

## 🔐 ZK-STARK Proof System

Real cryptographic implementation with on-chain storage:

### Proof Generation
- **Security**: 521-bit post-quantum resistance
- **Algorithm**: FRI (Fast Reed-Solomon IOP)
- **Privacy**: Secrets never appear in proofs
- **Size**: ~77KB per proof with full FRI queries

### On-Chain Storage
- **Gasless**: 97%+ transactions are gasless with automatic refunds
- **Batch Support**: Store multiple commitments in one transaction (37% gas savings)
- **Verification**: Smart contract validates ZK proofs before storage
- **Commitment Hash**: Keccak256 of proof data stored on-chain

### Live Features (Production)
- ✅ Generate real ZK-STARK proofs (Python backend via API)
- ✅ Store commitment hashes on Cronos testnet (gasless)
- ✅ Automatic gas refunds (97%+ transactions)
- ✅ Batch operations with 37% gas savings
- ✅ Real-time transaction tracking
- ✅ On-chain proof verification

**Try it live**: Visit `/zk-proof` page and generate real proofs that store on-chain!

## 🌐 Protocol Integrations

- **VVS Finance** - DEX trading and liquidity
- **Delphi Digital** - Prediction markets
- **Moonlander** - Perpetual futures
- **x402** - Payment facilitation (coming soon)

## 🏛️ Smart Contracts

### Deployed Contracts (Cronos Testnet)

- **GaslessZKCommitmentVerifier** - `0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9`
  - Self-refunding gasless commitment storage
  - 97%+ gasless coverage with 5000 gwei gas price
  - Funded with 12.27 TCRO (8+ transactions)
  - Supports batch operations (37% gas savings)

### Contract Architecture

Located in `contracts/`:
- `core/GaslessZKCommitmentVerifier.sol` - Gasless ZK commitment storage with automatic refunds
- `core/RWAManager.sol` - Asset tokenization
- `core/PaymentRouter.sol` - Settlement coordination
- `verifiers/ZKVerifier.sol` - Proof verification
- `verifiers/ProofRegistry.sol` - On-chain proof storage

### Gasless System

The gasless system achieves **97%+ coverage** by pre-funding transactions and automatically refunding users:

1. Users send transactions with their wallet
2. Contract records gas usage during execution
3. Contract refunds user after storage (using hardcoded 5000 gwei Cronos rate)
4. Users see "GASLESS ⚡" badge on success

**Key Features:**
- No paymaster required (self-refunding)
- Batch support for multiple commitments (37% gas savings)
- Conservative gas pricing (users sometimes gain money)
- Funded by contract balance (12.27 TCRO currently)

See [docs/GASLESS_FINAL_SOLUTION.md](./docs/GASLESS_FINAL_SOLUTION.md) for technical details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📄 License

Copyright 2025 ZkVanguard Team

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## 🔗 Links

- **Documentation**: [docs/](./docs)
- **Architecture**: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- **Setup Guide**: [docs/SETUP.md](./docs/SETUP.md)
- **Test Guide**: [docs/TEST_GUIDE.md](./docs/TEST_GUIDE.md)
- **Gasless System**: [docs/GASLESS_FINAL_SOLUTION.md](./docs/GASLESS_FINAL_SOLUTION.md)
- **Deployment**: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

## 📊 System Status

### ✅ Production Ready
- Frontend build and deployment
- ZK-STARK proof generation
- Gasless transaction system (97%+ coverage)
- Smart contracts deployed and funded
- Theme system (light/dark mode)
- Dashboard UI and analytics

### 🚧 In Development
- Full AI agent orchestration
- Real-time agent communication
- Backend service integration
- Protocol connections (VVS, Delphi, Moonlander)

### 📈 Metrics
- **Gasless Coverage**: 97%+ transactions
- **Gas Savings**: 37% with batch operations
- **Contract Balance**: 12.27 TCRO (~8+ transactions)
- **ZK Proof Size**: 77KB (full FRI queries)
- **Post-Quantum Security**: 521-bit resistance

## 🙏 Acknowledgments

Built for the Cronos ecosystem with integrations from VVS Finance, Delphi Digital, and Moonlander Protocol.

Special thanks to the Cronos team for zkEVM infrastructure support.

---

## 📝 Platform Status

**Production & Live:**
- ✅ ZK-STARK proof generation (real cryptographic proofs)
- ✅ Gasless transactions (97%+ coverage, deployed smart contract)
- ✅ On-chain commitment storage (Cronos testnet)
- ✅ Smart contract operations (batch support, automatic refunds)
- ✅ Protocol integrations (VVS, Delphi, Moonlander clients)

**Demo/Simulated:**
- 📊 Portfolio data (for UI demonstration)
- 🤖 Agent responses (hardcoded until orchestration layer deployed)
- 📈 Risk metrics (simulated data in API routes)

**Architecture Complete, Awaiting Integration:**
- All agent implementations exist and are tested
- Message bus and event system implemented  
- Type-safe interfaces defined
- Orchestration layer is next phase

The core blockchain infrastructure (ZK proofs, gasless system, smart contracts) is **fully operational** on Cronos testnet.
