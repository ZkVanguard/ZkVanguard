# Chronos Vanguard - Setup & Quick Start Guide

## Prerequisites

Before starting, ensure you have:

- **Node.js** v18 or higher ([download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **Git** for version control
- **MetaMask** or **Rabby** wallet browser extension
- **Cronos Testnet TCRO** from the [faucet](https://cronos.org/faucet)

## Installation

### 1. Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yourusername/chronos-vanguard.git
cd chronos-vanguard

# Install all dependencies
npm install

# This will install dependencies for all workspaces:
# - Root project
# - Agents
# - Integrations
# - Simulator
# - Frontend
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your values
# Required for basic testing:
# - PRIVATE_KEY (your wallet private key)
# - CRONOS_TESTNET_RPC (default provided)
```

**Important**: Never commit your `.env` file or share your private keys!

### 3. Configure MetaMask for Cronos Testnet

Add Cronos Testnet to MetaMask:

- **Network Name**: Cronos Testnet
- **RPC URL**: `https://evm-t3.cronos.org/`
- **Chain ID**: `338`
- **Currency Symbol**: `TCRO`
- **Block Explorer**: `https://testnet.cronoscan.com/`

Get test TCRO from the [faucet](https://cronos.org/faucet).

## Project Structure Overview

```
chronos-vanguard/
├── contracts/          # Solidity smart contracts
│   ├── core/          # Core contracts (RWAManager, PaymentRouter)
│   ├── verifiers/     # ZK verification contracts
│   └── integrations/  # dApp adapter contracts
├── agents/            # AI agent system
│   ├── core/          # Base agent & orchestration
│   ├── specialized/   # Specialized agents (Risk, Hedging, etc.)
│   └── communication/ # Inter-agent messaging
├── integrations/      # External service integrations
│   ├── mcp/           # MCP Server client
│   ├── x402/          # x402 payment integration
│   ├── cryptocom/     # Crypto.com SDK wrapper
│   └── dapps/         # VVS, Moonlander, Delphi clients
├── zk/                # ZK proof circuits and generators
├── simulator/         # Dev simulator dashboard
│   ├── backend/       # API and virtualizer
│   └── frontend/      # React dashboard
├── frontend/          # Main user interface
├── shared/            # Shared utilities and types
├── scripts/           # Deployment and utility scripts
└── test/              # Test suites
```

## Quick Start

### Step 1: Compile Smart Contracts

```bash
npm run compile
```

This compiles all Solidity contracts and generates TypeScript typings.

### Step 2: Run Tests

```bash
# Run all tests
npm test

# Or run specific test suites:
npm run test:contracts    # Smart contract tests
npm run test:agents       # Agent system tests
npm run test:integration  # Integration tests
```

### Step 3: Deploy to Cronos Testnet

```bash
# Make sure you have TCRO in your wallet
npm run deploy:testnet
```

This will:
1. Deploy all smart contracts to Cronos Testnet
2. Initialize contracts with proper roles
3. Save contract addresses to `deployments/cronos-testnet/addresses.json`

**Expected output:**
```
=== Deployment Summary ===
Network: cronos-testnet (Chain ID: 338)
Deployer: 0x...

Contract Addresses:
  RWAManager: 0x...
  PaymentRouter: 0x...
  ZKVerifier: 0x...
```

### Step 4: Verify Contracts (Optional)

```bash
npm run verify:testnet
```

This verifies your contracts on Cronoscan for transparency.

### Step 5: Start the System

#### Option A: Run Everything (Recommended for Testing)

```bash
npm run dev
```

This starts:
- AI Agent Orchestrator (port 3000)
- Simulator Dashboard (port 3001)
- Frontend UI (port 5173)

#### Option B: Run Components Separately

```bash
# Terminal 1: Start agents
npm run agents:dev

# Terminal 2: Start simulator
npm run simulator:dev

# Terminal 3: Start frontend
npm run frontend:dev
```

### Step 6: Access the Interfaces

- **Main UI**: http://localhost:5173
- **Simulator Dashboard**: http://localhost:3001
- **Agent API**: http://localhost:3000

## Usage Example

### 1. Create a Portfolio

Using the frontend UI or directly via contracts:

```typescript
// Via ethers.js
const rwaManager = await ethers.getContractAt('RWAManager', rwaManagerAddress);
const tx = await rwaManager.createPortfolio(
  800,  // 8% target yield
  60    // 60/100 risk tolerance
);
await tx.wait();
```

### 2. Submit a Strategy (Natural Language)

In the frontend chat interface:

```
"Hedge $10M RWA portfolio against volatility with 8% yield target"
```

The Lead Agent will:
1. Parse the natural language
2. Delegate to specialized agents
3. Execute hedging strategy
4. Generate ZK proof
5. Display results

### 3. Monitor in Simulator

The simulator dashboard shows:
- Real-time agent communication
- Task execution traces
- Performance metrics
- Debug logs

## Development Workflow

### Making Changes to Contracts

```bash
# 1. Edit contracts in contracts/
# 2. Compile
npm run compile

# 3. Run tests
npm run test:contracts

# 4. Deploy to local network for testing
npx hardhat node  # Terminal 1
npm run deploy:testnet  # Terminal 2 (use --network hardhat)
```

### Developing Agents

```bash
# 1. Edit agents in agents/
# 2. Run in dev mode (auto-reload)
npm run agents:dev

# 3. Test specific agent
npm run test:agents -- RiskAgent.test.ts
```

### Frontend Development

```bash
cd frontend
npm run dev

# Frontend will hot-reload on changes
```

## Testing Scenarios

### Scenario 1: Basic Risk Analysis

```bash
# In simulator dashboard
1. Go to "Scenario Simulator"
2. Select "Market Crash Scenario"
3. Click "Run Simulation"
4. Observe agent swarm behavior
```

### Scenario 2: End-to-End Hedging

```bash
# Run E2E test
npm run test:e2e -- hedge-strategy.spec.ts
```

## Troubleshooting

### Issue: "Insufficient funds for gas"

**Solution**: Get more TCRO from the [faucet](https://cronos.org/faucet)

### Issue: "Network connection failed"

**Solution**: Check your RPC URL in `.env`:
```bash
CRONOS_TESTNET_RPC=https://evm-t3.cronos.org/
```

### Issue: "Contract deployment failed"

**Solution**: 
1. Check your gas settings in `hardhat.config.ts`
2. Ensure you have enough TCRO
3. Check network congestion

### Issue: "Agent not responding"

**Solution**:
1. Check agent logs: `npm run logs:agents`
2. Restart agents: `npm run agents:start`
3. Check Redis connection (if using external Redis)

### Issue: "Compilation errors"

**Solution**:
```bash
# Clean and rebuild
npm run clean
npm install
npm run compile
```

## Configuration

### Agent Configuration

Edit `config/agent.config.json`:

```json
{
  "leadAgent": {
    "model": "gpt-4",
    "maxRetries": 3,
    "timeout": 30000
  },
  "riskAgent": {
    "dataSource": "mcp-server",
    "refreshInterval": 10000
  }
}
```

### Network Configuration

Edit `config/network.config.json` to add custom networks.

## Advanced Features

### Using the Simulator

The simulator allows testing without real blockchain transactions:

1. **Virtualized Data Feeds**: Create custom market scenarios
2. **Swarm Testing**: Test multi-agent interactions
3. **Performance Profiling**: Measure agent execution times
4. **Scenario Replay**: Replay historical executions

### ZK Proof Generation

```bash
# Compile ZK circuits
npm run compile:circuits

# This generates proving/verification keys
```

### Gasless Transactions (x402)

In production, configure x402 Facilitator:

```javascript
// integrations/x402/X402Client.ts
const x402Client = new X402Client({
  apiKey: process.env.X402_API_KEY,
  facilitatorUrl: process.env.X402_FACILITATOR_URL
});
```

## Next Steps

1. **Read the Architecture Guide**: [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **Explore Agent System**: [docs/AGENTS.md](./docs/AGENTS.md)
3. **Understand ZK Proofs**: [docs/ZK_SYSTEM.md](./docs/ZK_SYSTEM.md)
4. **Review API Documentation**: [docs/API.md](./docs/API.md)

## Getting Help

- **Issues**: https://github.com/yourusername/chronos-vanguard/issues
- **Cronos Discord**: https://discord.gg/cronos
- **Telegram**: https://t.me/cronoschain

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

**Ready to build?** Start with `npm run dev` and visit http://localhost:5173
