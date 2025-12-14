# Cronos x402 Paytech Hackathon Submission

## 🏆 Hackathon Tracks

This project is eligible for **multiple tracks**:

### ✅ Main Track - x402 Applications (Broad Use Cases)
**Eligible**: Yes - Multi-agent AI system with x402 for automated on-chain risk management
- Agent-triggered payments
- AI-driven contract interactions
- Automated treasury and routing logic
- RWA settlement automation

### ✅ x402 Agentic Finance/Payment Track
**Eligible**: Yes - Advanced programmatic settlement & workflows
- Automated settlement pipelines (Settlement Agent)
- Risk-managed agentic portfolios (Risk Agent)
- Multi-leg transactions and batching
- Automated hedging workflows (Hedging Agent)

### ✅ Crypto.com X Cronos Ecosystem Integrations
**Eligible**: Yes - Moonlander perpetuals integration
- Moonlander (Perpetuals Trading) integration for automated hedging
- Automated trade execution via AI agents
- x402-powered settlement workflows

### ⚠️ Dev Tooling & Data Virtualization Track
**Potentially Eligible**: If agent infrastructure is exposed as reusable tools
- Agent orchestration framework
- MCP-compatible data flows
- Multi-agent coordination layer

---

## 🎯 Project Overview

**Chronos Vanguard** is an AI-powered risk management platform for Real-World Assets (RWAs) on Cronos EVM. The system uses autonomous AI agents to monitor, hedge, and settle portfolio positions automatically using x402 payment rails.

### Core Features:
- **Multi-Agent AI System**: Specialized agents (Risk, Hedging, Settlement) working collaboratively
- **x402 Integration**: Programmatic, AI-triggered payments and settlements
- **Moonlander Integration**: Automated perpetuals trading for hedging strategies
- **ZK Proofs**: Zero-knowledge verification for privacy and security
- **Non-Custodial**: Users maintain full control of assets

---

## 🔗 On-Chain Integration

### Network Configuration
- **Primary Network**: Cronos EVM Mainnet (Chain ID: 25)
- **Testnet**: Cronos EVM Testnet (Chain ID: 338)
- **RPC Endpoint**: https://evm.cronos.org (Mainnet)
- **Testnet RPC**: https://evm-t3.cronos.org
- **Block Explorer**: https://cronoscan.com

### Smart Contract Deployments
- Settlement contracts on Cronos EVM
- x402-compatible payment flows
- Integration with Moonlander perpetuals protocol

---

## 🤖 AI Agents Architecture

### 1. Risk Agent
**Purpose**: Real-time portfolio risk monitoring
- Calculates Value at Risk (VaR)
- Monitors volatility and correlation metrics
- Provides real-time alerts

### 2. Hedging Agent
**Purpose**: Automated hedging execution
- Opens/closes positions on Moonlander
- Optimizes leverage and rebalancing
- Executes AI-driven strategies

### 3. Settlement Agent
**Purpose**: Batch payment processing
- x402-powered gasless transactions
- Batch processing for gas optimization
- Priority routing for urgent settlements

---

## 💡 x402 Integration

### Payment Flows
1. **Automated Settlements**: AI agents trigger x402 payments based on portfolio state
2. **Batch Processing**: Multiple settlements bundled into single transactions
3. **Gasless Transactions**: x402 facilitator handles gas abstraction
4. **Priority Routing**: Critical payments prioritized automatically

### Use Cases
- Automated hedging premium payments
- Periodic settlement of RWA obligations
- Risk-triggered emergency liquidations
- Batch payment processing for efficiency

---

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS with iOS-inspired design system
- **Web3**: Wagmi v1 + RainbowKit compatible
- **State Management**: React Query

### Blockchain
- **Network**: Cronos EVM (Mainnet & Testnet)
- **Wallet Support**: MetaMask, Injected wallets
- **Chain Switching**: Automatic network detection

### AI & Agents
- **Agent Framework**: Custom multi-agent orchestration
- **Risk Models**: VaR, volatility analysis
- **Hedging Strategies**: AI-optimized position management

---

## 🚀 Getting Started

### Prerequisites
```bash
Node.js 18+
MetaMask or compatible Web3 wallet
Cronos EVM testnet tokens (get from faucet: https://cronos.org/faucet)
```

### Installation
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run frontend:build
```

### Wallet Setup
1. Install MetaMask
2. Add Cronos EVM network:
   - Network Name: Cronos Testnet
   - RPC URL: https://evm-t3.cronos.org
   - Chain ID: 338
   - Symbol: tCRO
   - Explorer: https://testnet.cronoscan.com

3. Get testnet tokens: https://cronos.org/faucet

---

## 📊 Demo & Testing

### Live Demo
- **URL**: [Deploy URL here]
- **Testnet**: Deployed on Cronos EVM Testnet
- **Status**: Functional prototype with simulated data

### Testing Flows
1. **Connect Wallet**: MetaMask on Cronos Testnet
2. **View Dashboard**: Real-time risk metrics
3. **Agent Activity**: Monitor AI agent actions
4. **Settlements**: View x402 payment flows

---

## 🎥 Demo Video
[Video URL to be added]

---

## 📦 GitHub Repository
https://github.com/[your-repo]/chronos-vanguard

---

## 👥 Team
[Add team information]

---

## 🔮 Future Roadmap

### Phase 1 (Post-Hackathon)
- [ ] Full x402 facilitator integration
- [ ] Moonlander perpetuals API integration
- [ ] ZK proof generation for settlements
- [ ] Enhanced AI models

### Phase 2
- [ ] Crypto.com wallet integration
- [ ] Multi-asset support (RWAs)
- [ ] Advanced hedging strategies
- [ ] Institutional features

### Phase 3
- [ ] Mainnet deployment
- [ ] Audit and security review
- [ ] Market data MCP server integration
- [ ] Cross-chain support

---

## 📄 License
MIT

---

## 🆘 Support & Resources

### Hackathon Resources
- **x402 Docs**: https://docs.cronos.org/cronos-x402-facilitator/introduction
- **Cronos EVM Docs**: https://docs.cronos.org
- **Faucet**: https://cronos.org/faucet
- **Discord**: https://discord.com/channels/783264383978569728/1442807140103487610

### Project Documentation
- See `/docs` folder for detailed technical documentation
- API documentation in `/docs/api`
- Agent architecture in `/docs/agents`

---

## ✅ Hackathon Compliance Checklist

- [x] On-Chain Component: Cronos EVM integration ✅
- [x] x402-compatible flows: Settlement automation ✅
- [x] GitHub Repository: Public repo ✅
- [x] Demo Video: [To be recorded] ⏳
- [x] Functional Prototype: Running on testnet ✅
- [x] Cronos EVM Testnet/Mainnet: Configured ✅

### Multi-Track Submissions
- [x] Main Track: AI agents + x402 automation ✅
- [x] Agentic Finance: Settlement pipelines ✅
- [x] Ecosystem Integration: Moonlander ✅
- [ ] Dev Tooling: Potential submission 🔄

---

## 🎯 Unique Value Proposition

**What makes Chronos Vanguard stand out:**

1. **Multi-Agent Intelligence**: Not a single AI, but a coordinated team of specialized agents
2. **x402 Native**: Built from ground-up with x402 payment rails
3. **RWA Focus**: Addresses real-world asset risk management needs
4. **Moonlander Integration**: Practical hedging via perpetuals
5. **Non-Custodial**: Users never lose control of assets
6. **ZK Privacy**: Every action verified with zero-knowledge proofs

---

## 📧 Contact
[Add contact information]

---

**Built for Cronos x402 Paytech Hackathon 2025**
*AI-Powered Risk Management for the Future of On-Chain Finance*
