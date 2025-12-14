# Chronos Vanguard 🛡️

> Verifiable Multi-Agent AI Swarm for Institutional RWA Risk Orchestration on Cronos EVM

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cronos](https://img.shields.io/badge/Cronos-EVM-blue)](https://cronos.org)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-yellow)](https://hardhat.org)

## 🎯 Overview

Chronos Vanguard enables institutions to manage Real-World Asset (RWA) portfolios through natural language commands. A sophisticated AI agent swarm analyzes risk, executes hedging strategies, and settles transactions—all verifiable through zero-knowledge proofs on the Cronos blockchain.

**Built for Cronos x402 Paytech Hackathon** (Multi-Track Submission: Main Track, x402 Agentic Finance, Crypto.com Integrations, Dev Tooling)

### Key Features

- 🤖 **Multi-Agent AI System**: Specialized agents for risk analysis, hedging, settlement, and reporting
- ⛓️ **Cronos EVM Native**: Optimized for Cronos blockchain with full ecosystem integration
- 💸 **Gasless Transactions**: x402 Facilitator API for cost-efficient payments
- 🔐 **Zero-Knowledge Proofs**: Verifiable agent decisions without exposing sensitive data
- 🌉 **CeDeFi Bridge**: Seamless integration between Crypto.com CEX and Cronos DEX
- 🧪 **Dev Simulator**: Virtualized testing environment for agent swarm development
- 📊 **Real-Time Data**: MCP Server integration for market data and predictions

## 🏗️ Architecture

```
User Input → Lead Agent → Specialized Swarm → On-Chain Execution → ZK Verification
                ↓              ↓                    ↓
           Intent Parse   Risk/Hedge/Settle    RWA Contracts
                           ↓                        ↓
                    MCP/x402/dApps          Gasless Payments
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system design.

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.x
- npm or yarn
- MetaMask or Rabby wallet
- Cronos Testnet TCRO (from [faucet](https://cronos.org/faucet))

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/chronos-vanguard.git
cd chronos-vanguard

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your keys

# Compile contracts
npm run compile

# Run tests
npm run test

# Deploy to Cronos Testnet
npm run deploy:testnet
```

### Running the System

```bash
# Start AI agent orchestrator
npm run agents:start

# Start dev simulator dashboard
npm run simulator:dev

# Start frontend
npm run frontend:dev

# Access at http://localhost:3000
```

## 📁 Project Structure

```
chronos-vanguard/
├── contracts/           # Solidity smart contracts
├── agents/             # AI agent orchestration system
├── integrations/       # External service integrations (MCP, x402, dApps)
├── zk/                 # Zero-knowledge proof circuits
├── simulator/          # Developer simulator dashboard
├── frontend/           # User interface
├── shared/             # Shared utilities and types
├── scripts/            # Deployment and utility scripts
├── test/               # Test suites
└── docs/               # Documentation
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed structure.

## 🎮 Usage Example

### Natural Language Strategy Input

```typescript
// User inputs strategy
"Hedge $10M RWA portfolio against volatility with 8% yield target"

// Lead Agent parses and delegates
LeadAgent → RiskAgent: Analyze portfolio risk
         → HedgingAgent: Execute Moonlander perpetuals
         → SettlementAgent: Process via x402
         → ReportingAgent: Generate ZK proof + results

// Output
{
  "status": "executed",
  "hedgePosition": "100 BTC perpetual @ 2x leverage",
  "estimatedYield": "8.2%",
  "zkProof": "0x...",
  "gasCost": "$0.00" // gasless via x402
}
```

## 🔧 Configuration

### Network Configuration (Cronos)

```typescript
// config/network.config.json
{
  "cronos-testnet": {
    "chainId": 338,
    "rpc": "https://evm-t3.cronos.org/",
    "explorer": "https://explorer.cronos.org/testnet"
  },
  "cronos-mainnet": {
    "chainId": 25,
    "rpc": "https://evm.cronos.org/",
    "explorer": "https://explorer.cronos.org/"
  }
}
```

### Agent Configuration

```json
// config/agent.config.json
{
  "leadAgent": {
    "model": "gpt-4",
    "maxRetries": 3
  },
  "riskAgent": {
    "dataSource": "mcp-server",
    "refreshInterval": 10000
  },
  "hedgingAgent": {
    "dapps": ["moonlander", "vvs"],
    "maxSlippage": 0.5
  }
}
```

## 🧪 Testing

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests (requires local testnet)
npm run test:e2e

# Test coverage
npm run test:coverage

# Simulate market crash scenario
npm run simulator:scenario -- crash
```

## 🔐 ZK Proof System

Chronos Vanguard uses Groth16 ZK-SNARKs to verify agent decisions:

```typescript
// Example: Prove risk calculation
const proof = await prover.generateProof({
  circuit: "risk-calculation",
  inputs: {
    portfolioValue: 10000000,
    volatility: 0.15,
    exposures: [...]
  }
});

// Verify on-chain
await zkVerifier.verify(proof.proof, proof.publicSignals);
```

See [docs/ZK_SYSTEM.md](./docs/ZK_SYSTEM.md) for details.

## 🌐 Integrations

### Cronos Ecosystem

- **VVS Finance**: Token swaps and liquidity provision
- **Moonlander**: Perpetual futures for hedging
- **Delphi**: Prediction market data for sentiment analysis

### External Services

- **Crypto.com AI SDK**: Natural language processing
- **x402 Facilitator**: Gasless EIP-3009 transfers
- **MCP Server**: Real-time market data feeds

### CeDeFi Bridge

```typescript
// Transfer from Crypto.com CEX to Cronos DEX
await ceDeFiBridge.transferFromCEX({
  amount: "1000 USDC",
  destination: "cronos",
  dexAction: "swap-to-CRO"
});
```

## 🛠️ Development Tools

### Dev Simulator Dashboard

The simulator allows testing agent swarms without real blockchain transactions:

- **Data Virtualizer**: Mock market feeds with custom scenarios
- **Swarm Scenario Tester**: Simulate complex multi-agent interactions
- **Debug Console**: Step-through agent decision logic
- **Performance Profiler**: Analyze agent execution times

Access at `http://localhost:3001` after running `npm run simulator:dev`

### Debugging

```bash
# Enable debug mode
DEBUG=chronos:* npm run agents:start

# View agent execution traces
npm run logs:agents

# Replay historical scenario
npm run simulator:replay -- <scenario-id>
```

## 📊 Performance

- **Strategy Execution**: < 30 seconds average
- **Gas Cost**: ~$0.00 (via x402 gasless)
- **Agent Response Time**: < 5 seconds
- **ZK Proof Generation**: < 10 seconds
- **Supported Portfolio Size**: Up to $100M

## 🚦 Deployment

### Testnet Deployment

```bash
# Deploy contracts
npm run deploy:testnet

# Verify on explorer
npm run verify:testnet

# Initialize agents
npm run agents:init -- --network testnet
```

### Mainnet Deployment

```bash
# Requires audit and multi-sig setup
npm run deploy:mainnet

# Verify contracts
npm run verify:mainnet
```

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed guide.

## 🏆 Hackathon Submission

### Tracks
1. **Main Track**: Multi-agent RWA orchestration system
2. **x402 Agentic Finance**: Gasless settlement agent with batch processing
3. **Crypto.com Integrations**: AI SDK + CeDeFi bridge
4. **Dev Tooling**: Simulator dashboard for ecosystem builders

### Demo Video
[Watch Demo](https://youtu.be/demo-link) (3 minutes)

### DoraHacks Submission
[Project Page](https://dorahacks.io/chronos-vanguard)

## 📚 Documentation

- [Architecture Guide](./ARCHITECTURE.md)
- [API Reference](./docs/API.md)
- [Agent System](./docs/AGENTS.md)
- [ZK Proof System](./docs/ZK_SYSTEM.md)
- [Testing Guide](./docs/TESTING.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📜 License

MIT License - see [LICENSE](./LICENSE) for details.

## 🔗 Links

- [Cronos Chain](https://cronos.org)
- [x402 Documentation](https://x402.io)
- [Crypto.com AI SDK](https://crypto.com/ai-sdk)
- [MCP Server](https://mcp.io)
- [Project Website](https://chronos-vanguard.io)

## 👥 Team

Built with ❤️ for the Cronos x402 Paytech Hackathon

- Lead Developer: [Your Name]
- Architecture: [Team Member]
- Smart Contracts: [Team Member]

## 🙏 Acknowledgments

- Cronos Labs for ecosystem support
- x402 team for gasless payment infrastructure
- Crypto.com for AI SDK
- Hackathon community for feedback

---

**Status**: 🚧 Under Active Development (Sprint 1/4)  
**Last Updated**: December 13, 2025  
**Version**: 0.1.0-alpha
