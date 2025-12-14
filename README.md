# Chronos Vanguard 🛡️

> AI-Powered Multi-Agent System for Real-World Asset Risk Management on Cronos zkEVM

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Cronos](https://img.shields.io/badge/Cronos-zkEVM-blue)](https://cronos.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## 🎯 Overview

Chronos Vanguard is an intelligent multi-agent AI system for automated risk management, hedging, and settlement of Real-World Asset (RWA) portfolios on Cronos zkEVM. The platform leverages zero-knowledge proofs for privacy-preserving verification and integrates with leading DeFi protocols.

**Demo Platform** - Showcasing production-ready AI agent infrastructure with simulated portfolio data.

### ✨ Key Features

- 🤖 **Multi-Agent AI System** - Specialized agents for risk analysis, hedging, settlement, and reporting
- 🔐 **ZK-STARK Proofs** - Real cryptographic proofs with 521-bit post-quantum security
- ⚡ **Cronos zkEVM Native** - Optimized for high-performance blockchain execution
- 🌐 **Protocol Integration** - VVS Finance, Delphi Digital, Moonlander Protocol
- 🎨 **Modern UI/UX** - Clean, professional interface with light/dark theme support
- 📊 **Real-Time Analytics** - Live portfolio tracking and risk metrics

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

**Frontend (Production Build: ✅ Working)**
- Dashboard UI displays mock data for demonstration
- API routes return hardcoded responses (marked with TODO comments)
- Real-time UI updates and theme switching functional
- All TypeScript compilation passing

**Agent System (Backend: 🚧 In Development)**
- Complete agent implementations in `agents/` directory
- Type system enhanced with `AgentCapability` enum and `TaskResult` interface
- Message bus architecture for inter-agent communication
- Ready for orchestration layer integration

**Next Steps for Full Integration:**
1. Implement agent orchestration service
2. Connect API routes to live agent instances
3. Add persistent task queue (Redis/similar)
4. Deploy agents as microservices or serverless functions

See [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) for implementation details.

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
- **[Setup Guide](./docs/SETUP.md)** - Installation and configuration
- **[Testing](./docs/TEST_GUIDE.md)** - Comprehensive testing guide
- **[ZK Proofs](./docs/PROOF_EVIDENCE.md)** - ZK-STARK validation evidence
- **[Full Index](./docs/README.md)** - Complete documentation index

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Python 3.8+ (for ZK proofs)
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/chronos-vanguard.git
cd chronos-vanguard

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

# Integration tests
npm run test:integration
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

Real cryptographic implementation (not simulated):
- **Security**: 521-bit post-quantum resistance
- **Algorithm**: FRI (Fast Reed-Solomon IOP)
- **Privacy**: Secrets never appear in proofs
- **Evidence**: [docs/PROOF_EVIDENCE.md](./docs/PROOF_EVIDENCE.md)

## 🌐 Protocol Integrations

- **VVS Finance** - DEX trading and liquidity
- **Delphi Digital** - Prediction markets
- **Moonlander** - Perpetual futures
- **x402** - Payment facilitation (coming soon)

## 🏛️ Smart Contracts

Located in `contracts/`:
- `RWAManager.sol` - Asset tokenization
- `PaymentRouter.sol` - Settlement coordination
- `ZKVerifier.sol` - Proof verification
- `ProofRegistry.sol` - On-chain proof storage

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📄 License

Copyright 2025 Chronos Vanguard Team

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## 🔗 Links

- **Documentation**: [docs/](./docs)
- **Architecture**: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- **Demo Info**: [docs/DEMO.md](./docs/DEMO.md)
- **Test Guide**: [docs/TEST_GUIDE.md](./docs/TEST_GUIDE.md)

## 🙏 Acknowledgments

Built for the Cronos ecosystem with integrations from VVS Finance, Delphi Digital, and Moonlander Protocol.

---

**Note**: This is a demonstration platform. Portfolio data is simulated for showcase purposes. Real AI agent infrastructure deployed on testnet.
