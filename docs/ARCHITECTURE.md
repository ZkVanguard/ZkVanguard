# Chronos Vanguard - System Architecture

## Overview
Chronos Vanguard is a verifiable multi-agent AI swarm system for institutional RWA risk orchestration on Cronos EVM. The system enables natural language strategy input and autonomous execution through specialized AI agents.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Chat Interface  │  │ Results Display  │  │ ZK Proof View │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI AGENT ORCHESTRATION                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Lead Agent (Intent Parser & Coordinator)                │  │
│  │  - Natural language processing via Crypto.com AI SDK     │  │
│  │  - Task decomposition and delegation                     │  │
│  │  - Result aggregation and verification                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│  ┌───────────────┬──────────┴──────────┬───────────────┐       │
│  ▼               ▼                      ▼               ▼       │
│ ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌─────────────┐       │
│ │  Risk   │  │ Hedging │  │Settlement│  │  Reporting  │       │
│ │  Agent  │  │  Agent  │  │  Agent   │  │    Agent    │       │
│ └─────────┘  └─────────┘  └──────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA & INTEGRATION LAYER                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │   MCP    │  │ x402 API │  │Crypto.com│  │  dApp APIs   │   │
│  │  Server  │  │ Payments │  │   SDK    │  │(VVS,Moonland)│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN LAYER (Cronos EVM)                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  RWA Manager │  │ ZK Verifier  │  │  Payment Router    │   │
│  │  Contract    │  │  Contract    │  │  (EIP-3009)        │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DEV SIMULATOR DASHBOARD                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │ Data Feed    │  │Swarm Scenario│  │  Debug Logs &      │   │
│  │ Virtualizer  │  │  Simulator   │  │  Observability     │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
chronos-vanguard/
├── contracts/                      # Smart contracts (Solidity)
│   ├── core/
│   │   ├── RWAManager.sol         # Main RWA portfolio management
│   │   ├── PaymentRouter.sol      # EIP-3009 & x402 integration
│   │   └── StrategyExecutor.sol   # On-chain strategy execution
│   ├── verifiers/
│   │   ├── ZKVerifier.sol         # ZK proof verification
│   │   └── ProofRegistry.sol      # Proof storage and retrieval
│   ├── integrations/
│   │   ├── VVSAdapter.sol         # VVS Finance integration
│   │   ├── MoonlanderAdapter.sol  # Moonlander perpetuals
│   │   └── DelphiAdapter.sol      # Delphi predictions
│   └── mocks/                     # Test mocks
│
├── agents/                        # AI Agent system (TypeScript)
│   ├── core/
│   │   ├── BaseAgent.ts           # Abstract agent class
│   │   ├── LeadAgent.ts           # Main orchestrator
│   │   └── AgentRegistry.ts       # Agent discovery & management
│   ├── specialized/
│   │   ├── RiskAgent.ts           # Risk analysis & assessment
│   │   ├── HedgingAgent.ts        # Hedging strategy execution
│   │   ├── SettlementAgent.ts     # Payment settlement via x402
│   │   └── ReportingAgent.ts      # Result compilation
│   ├── communication/
│   │   ├── MessageBus.ts          # Inter-agent messaging
│   │   └── EventEmitter.ts        # Event-driven coordination
│   └── config/
│       └── agent-configs.ts       # Agent configurations
│
├── integrations/                  # External service integrations
│   ├── mcp/
│   │   ├── MCPClient.ts           # MCP Server client
│   │   ├── DataFeedManager.ts     # Real-time data feeds
│   │   └── types.ts               # MCP data types
│   ├── x402/
│   │   ├── X402Client.ts          # x402 Facilitator API
│   │   ├── GaslessTransfer.ts     # Gasless payment logic
│   │   └── BatchProcessor.ts      # Multi-leg batching
│   ├── cryptocom/
│   │   ├── SDKWrapper.ts          # Crypto.com AI SDK wrapper
│   │   ├── WalletManager.ts       # Wallet integrations
│   │   └── CeDeFiBridge.ts        # CEX-DEX bridging
│   ├── dapps/
│   │   ├── VVSClient.ts           # VVS Finance client
│   │   ├── MoonlanderClient.ts    # Moonlander client
│   │   └── DelphiClient.ts        # Delphi predictions client
│   └── blockchain/
│       ├── ContractManager.ts     # Smart contract interactions
│       └── TransactionManager.ts  # Transaction handling
│
├── zk/                            # Zero-knowledge proof system
│   ├── circuits/
│   │   ├── risk-calculation.circom    # Risk score proof
│   │   └── portfolio-valuation.circom # Portfolio proof
│   ├── prover/
│   │   ├── ProofGenerator.ts      # Generate ZK proofs
│   │   └── ProofSerializer.ts     # Proof serialization
│   └── verifier/
│       └── ProofValidator.ts      # Verify proofs off-chain
│
├── simulator/                     # Dev simulator dashboard
│   ├── backend/
│   │   ├── api/
│   │   │   ├── routes/            # API routes
│   │   │   └── controllers/       # Request handlers
│   │   ├── virtualizer/
│   │   │   ├── DataFeedVirtualizer.ts  # Mock data feeds
│   │   │   └── ScenarioEngine.ts       # Scenario simulation
│   │   └── observability/
│   │       ├── Logger.ts          # Structured logging
│   │       └── Tracer.ts          # Agent execution tracing
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── components/        # React components
│   │   │   ├── pages/             # Page components
│   │   │   ├── hooks/             # Custom hooks
│   │   │   └── services/          # API clients
│   │   └── public/
│   └── shared/
│       └── types/                 # Shared TypeScript types
│
├── frontend/                      # Main user interface
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatInterface/     # Natural language input
│   │   │   ├── ResultsDisplay/    # Execution results
│   │   │   └── ZKProofViewer/     # Proof visualization
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx      # Main dashboard
│   │   │   └── Strategy.tsx       # Strategy management
│   │   ├── services/
│   │   │   ├── api.ts             # Backend API client
│   │   │   └── web3.ts            # Blockchain interactions
│   │   └── utils/
│   └── public/
│
├── shared/                        # Shared utilities & types
│   ├── types/
│   │   ├── agent.ts               # Agent interfaces
│   │   ├── strategy.ts            # Strategy types
│   │   └── blockchain.ts          # Blockchain types
│   ├── utils/
│   │   ├── logger.ts              # Logging utility
│   │   ├── config.ts              # Configuration management
│   │   └── errors.ts              # Error definitions
│   └── constants/
│       ├── networks.ts            # Network configurations
│       └── addresses.ts           # Contract addresses
│
├── scripts/                       # Deployment & utility scripts
│   ├── deploy/
│   │   ├── deploy-contracts.ts    # Contract deployment
│   │   └── verify-contracts.ts    # Etherscan verification
│   ├── setup/
│   │   ├── setup-agents.ts        # Initialize agents
│   │   └── fund-wallets.ts        # Test wallet funding
│   └── utils/
│       └── generate-circuits.ts   # Compile ZK circuits
│
├── test/                          # Test suites
│   ├── unit/
│   │   ├── contracts/             # Contract unit tests
│   │   ├── agents/                # Agent unit tests
│   │   └── integrations/          # Integration tests
│   ├── integration/
│   │   └── e2e/                   # End-to-end tests
│   └── fixtures/
│       ├── mock-data.ts           # Test data
│       └── scenarios.ts           # Test scenarios
│
├── config/                        # Configuration files
│   ├── hardhat.config.ts          # Hardhat configuration
│   ├── agent.config.json          # Agent configurations
│   ├── network.config.json        # Network settings
│   └── simulator.config.json      # Simulator settings
│
├── docs/                          # Documentation
│   ├── API.md                     # API documentation
│   ├── AGENTS.md                  # Agent system guide
│   ├── DEPLOYMENT.md              # Deployment guide
│   └── TESTING.md                 # Testing guide
│
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Continuous integration
│       └── deploy.yml             # Deployment workflow
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Component Details

### 1. Smart Contracts Layer

**RWAManager.sol**
- Portfolio tokenization and management
- Asset allocation tracking
- Rebalancing logic
- Event emission for agent tracking

**PaymentRouter.sol**
- EIP-3009 transferWithAuthorization implementation
- x402 Facilitator integration
- Gasless transaction routing
- Multi-signature support

**ZKVerifier.sol**
- Groth16 proof verification
- Proof registry integration
- Decision validation

### 2. AI Agent Orchestration

**Lead Agent**
- Receives natural language strategy input
- Parses intent using Crypto.com AI SDK
- Decomposes into sub-tasks
- Delegates to specialized agents
- Aggregates results and generates reports

**Specialized Agents**
- **Risk Agent**: Analyzes portfolio risk using MCP data and Delphi predictions
- **Hedging Agent**: Executes hedging strategies via Moonlander perpetuals
- **Settlement Agent**: Processes payments through x402 API
- **Reporting Agent**: Compiles results with ZK proofs

**Communication Layer**
- Event-driven message bus for agent coordination
- Asynchronous task queue
- State synchronization

### 3. Integration Layer

**MCP Integration**
- Real-time market data feeds
- Price oracle functionality
- Trend analysis data

**x402 Integration**
- Gasless EIP-3009 transfers
- Batch payment processing
- Transaction status tracking

**Crypto.com SDK**
- Wallet balance queries
- CEX-DEX bridging
- IBC transfers for CeDeFi flows

**dApp Integrations**
- VVS Finance: Token swaps and liquidity
- Moonlander: Perpetual futures hedging
- Delphi: Prediction market data

### 4. ZK Proof System

**Proof Generation**
- Circom circuits for risk calculations
- Witness generation from agent decisions
- Groth16 proof creation

**Proof Verification**
- On-chain verification via ZKVerifier contract
- Off-chain validation for testing
- Proof registry for audit trail

### 5. Dev Simulator Dashboard

**Data Virtualizer**
- Mock market data generation
- Historical data replay
- Stress scenario creation

**Swarm Simulator**
- Virtual agent execution
- Scenario testing (market crash, volatility spike)
- Performance benchmarking

**Observability**
- Real-time agent execution logs
- Decision tree visualization
- Performance metrics dashboard

## Data Flow

### Strategy Execution Flow

```
1. User Input
   ↓
2. Lead Agent (Intent Parsing)
   ↓
3. Task Decomposition
   ↓
4. Parallel Agent Execution
   ├── Risk Agent → MCP/Delphi → Risk Analysis
   ├── Hedging Agent → Moonlander → Execute Hedge
   └── Settlement Agent → x402 → Batch Payments
   ↓
5. ZK Proof Generation (Risk Calculation)
   ↓
6. On-Chain Execution
   ├── Update RWA Portfolio
   ├── Verify ZK Proof
   └── Process Payments
   ↓
7. Result Aggregation
   ↓
8. Display Results + ZK Proof to User
```

### CeDeFi Flow

```
1. User has funds on Crypto.com CEX
   ↓
2. Agent initiates bridge via IBC
   ↓
3. Funds arrive on Cronos (CRO/ATOM)
   ↓
4. Execute DEX operations (VVS swaps)
   ↓
5. Settlement via x402 gasless transfers
   ↓
6. Optional: Bridge back to CEX
```

## Technology Stack

### Blockchain
- **Network**: Cronos EVM (Mainnet: Chain ID 25, Testnet: 338)
- **Framework**: Hardhat with TypeScript
- **Libraries**: ethers.js v6, OpenZeppelin contracts
- **Standards**: EIP-3009, ERC-20, ERC-721 (for RWA tokens)

### AI Agents
- **Framework**: Custom orchestration on Crypto.com AI SDK
- **Language**: TypeScript/Node.js
- **Patterns**: Event-driven, microservices-style agents

### ZK Proofs
- **Circuit Language**: Circom
- **Proof System**: Groth16
- **Libraries**: snarkjs, circomlib

### Frontend
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Web3**: ethers.js, wagmi

### Backend/APIs
- **Runtime**: Node.js 18+
- **API Framework**: Express.js
- **Database**: PostgreSQL (for logs/history)
- **Caching**: Redis

### Dev Tools
- **Testing**: Hardhat (contracts), Jest (TypeScript), Playwright (E2E)
- **Linting**: ESLint, Prettier
- **CI/CD**: GitHub Actions

## Scalability Considerations

1. **Horizontal Agent Scaling**: Agent instances can be replicated across multiple processes/containers
2. **Message Queue**: Redis-based message bus for high-throughput agent communication
3. **Database Sharding**: Partition logs by time/strategy for query performance
4. **Caching**: Redis cache for frequently accessed data (prices, portfolio states)
5. **Load Balancing**: Nginx for frontend/API load distribution

## Security Considerations

1. **Private Key Management**: Hardware wallet support, encrypted key storage
2. **ZK Privacy**: Sensitive calculations proven without revealing inputs
3. **Access Control**: Role-based permissions for agent actions
4. **Audit Logging**: Immutable logs for all agent decisions
5. **Rate Limiting**: API rate limits to prevent abuse

## Debugging & Observability

1. **Structured Logging**: JSON logs with correlation IDs
2. **Distributed Tracing**: Track requests across agents and services
3. **Metrics Dashboard**: Prometheus + Grafana for monitoring
4. **Debug Mode**: Verbose logging and step-by-step execution in simulator
5. **Replay Capability**: Replay historical scenarios from logs

## Deployment Strategy

### Testnet Deployment (Cronos Testnet - Chain ID 338)
1. Deploy contracts to testnet
2. Configure agents with testnet RPC
3. Test with TCRO from faucet
4. Validate x402 gasless transfers
5. Run E2E test scenarios

### Mainnet Deployment (Cronos Mainnet - Chain ID 25)
1. Audit contracts (community review)
2. Deploy with multi-sig ownership
3. Gradual rollout with limited strategies
4. Monitor for 48 hours
5. Full launch with documentation

## Future Enhancements

1. **Multi-chain support**: Expand to Ethereum, Polygon
2. **Advanced ZK**: Recursive proofs, batch verification
3. **ML Models**: Train models on historical strategy performance
4. **DAO Governance**: Community-driven strategy approval
5. **Mobile App**: iOS/Android for portfolio monitoring

## Success Metrics

1. **Performance**: Strategy execution < 30 seconds
2. **Reliability**: 99.9% uptime for agent swarm
3. **Cost Efficiency**: Average gas < $0.10 per strategy (via x402)
4. **Verifiability**: 100% of critical decisions have ZK proofs
5. **Developer Experience**: < 5 minutes to set up simulator

---

**Last Updated**: December 13, 2025  
**Version**: 1.0.0  
**Maintainers**: Chronos Vanguard Team
