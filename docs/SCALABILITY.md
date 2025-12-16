# Scalability Architecture Guide

## Overview

This document outlines the organized, scalable architecture of ZkVanguard, designed for easy expansion and maintenance.

## Directory Structure

### 📁 Core Application (`app/`)

```
app/
├── layout.tsx              # Root layout
├── page.tsx                # Landing page
├── providers.tsx           # Global providers
├── api-interceptor.ts      # API middleware
├── agents/                 # Agent management UI
├── api/                    # API routes
├── dashboard/              # Main dashboard
├── docs/                   # Documentation pages
└── zk-proof/              # ZK proof demo
```

**Scalability Notes:**
- Each feature has its own directory
- API routes follow RESTful patterns
- Shared layouts for consistency

### 🤖 AI Agents (`agents/`)

```
agents/
├── core/                   # Base agent classes
│   ├── BaseAgent.ts       # Abstract base
│   └── AgentOrchestrator.ts
├── specialized/            # Domain agents
│   ├── RiskAgent.ts
│   ├── HedgingAgent.ts
│   ├── SettlementAgent.ts
│   └── ReportingAgent.ts
└── communication/          # Message bus
    └── MessageBus.ts
```

**Scalability Pattern:**
```typescript
// Add new specialized agent
class NewAgent extends BaseAgent {
  constructor(config: AgentConfig, messageBus: MessageBus) {
    super('new-agent', 'NEW', config, messageBus);
  }
  
  async execute(task: Task): Promise<TaskResult> {
    // Implementation
  }
}
```

### 🎨 Components (`components/`)

```
components/
├── [Feature]Component.tsx  # Landing page components
└── dashboard/              # Dashboard-specific
    ├── MetricsCard.tsx
    ├── AgentStatus.tsx
    └── ZKProofDemo.tsx
```

**Organization Strategy:**
- Root level: Landing page components
- `dashboard/`: Feature-specific components
- Shared components in `shared/` (create if needed)

### 📜 Smart Contracts (`contracts/`)

```
contracts/
├── core/                   # Production contracts
│   ├── GaslessZKCommitmentVerifier.sol  ⭐ PRODUCTION
│   ├── ZKCommitmentVerifier.sol
│   ├── RWAManager.sol
│   └── PaymentRouter.sol
├── verifiers/              # Verification contracts
│   ├── ZKVerifier.sol
│   └── ProofRegistry.sol
├── abi/                    # Generated ABIs
└── archive/                # Legacy contracts
    ├── GaslessZKVerifier.sol
    ├── MetaTxVerifier.sol
    ├── UniversalRelayer.sol
    └── ZKPaymaster.sol
```

**Adding New Contracts:**
1. Create in appropriate directory (`core/` or `verifiers/`)
2. Add deployment script in `scripts/deploy/`
3. Update `lib/contracts/addresses.ts`
4. Generate types: `npx hardhat compile`

### 🔧 Library (`lib/`)

```
lib/
├── api/                    # API utilities
│   ├── agents.ts          # Agent API
│   ├── blockchain.ts      # Blockchain API
│   ├── moonlander.ts      # Moonlander integration
│   ├── onchain-gasless.ts # Gasless transactions ⭐
│   └── zk.ts              # ZK proof API
├── contracts/              # Contract utilities
│   ├── abis.ts            # ABI definitions
│   ├── addresses.ts       # Contract addresses
│   ├── hooks.ts           # React hooks
│   ├── utils.ts           # Utilities
│   ├── zkCommitmentVerifier.ts
│   └── zkVerification.ts
├── hooks/                  # Custom React hooks
└── chains.ts              # Chain configurations
```

**Adding New Features:**
1. **New API**: Create in `lib/api/[feature].ts`
2. **New Contract Integration**: Add to `lib/contracts/`
3. **New Hook**: Add to `lib/hooks/`

### 🧪 Testing (`tests/` and `test/`)

```
tests/                      # Python tests
├── integration/            # Integration tests ⭐
│   ├── test_complete_integration.py
│   ├── test_complete_verification.py
│   ├── test_extensive_verification.py
│   └── test_onchain_commitment.py
├── zk-proofs/             # ZK proof tests ⭐
│   ├── test_verification.py
│   ├── test_production_ready.py
│   ├── test_statement_hash.py
│   └── test_privacy_enh.py
└── archive/               # Legacy tests

test/                      # TypeScript tests
├── setup.ts
├── agents/               # Agent tests
└── integration/          # Integration tests
```

**Test Organization:**
- **Integration**: End-to-end system tests
- **ZK Proofs**: Cryptographic verification
- **Archive**: Old/redundant tests (keep for reference)

### 📝 Scripts (`scripts/`)

```
scripts/
├── deploy/                 # Deployment utilities
│   └── deploy-commitment-verifier.js
├── deploy-gasless-verifier.js  ⭐ Production deployment
├── deploy-gasless.ts
├── deploy-testnet.ts
├── fund-gasless-contract.js    ⭐ Contract funding
├── test-gasless-complete.js    ⭐ Comprehensive tests
└── verify-gasless-frontend.js  ⭐ Frontend verification
```

**Script Categories:**
- **Deploy**: Contract deployment
- **Test**: System validation
- **Fund**: Contract funding
- **Verify**: Integration verification

### 🔌 Integrations (`integrations/`)

```
integrations/
├── delphi/                # Delphi Digital
├── mcp/                   # Model Context Protocol
├── moonlander/            # Moonlander Protocol
├── vvs/                   # VVS Finance
└── x402/                  # x402 Payments
```

**Adding New Integrations:**
1. Create directory: `integrations/[protocol]/`
2. Add API wrapper: `[protocol]/api.ts`
3. Add types: `[protocol]/types.ts`
4. Add tests: `[protocol]/tests/`

### 📚 Documentation (`docs/`)

```
docs/
├── README.md                          # Documentation index
├── ARCHITECTURE.md                    # System architecture
├── SETUP.md                           # Setup guide
├── TEST_GUIDE.md                      # Testing guide
├── DEPLOYMENT.md                      # Deployment guide
├── KNOWN_ISSUES.md                    # Current limitations
├── GASLESS_FINAL_SOLUTION.md         # Gasless system ⭐
├── FRONTEND_GASLESS_INTEGRATION.md   # Frontend integration ⭐
├── ZK_CRYPTOGRAPHIC_PROOF.md         # ZK proof system
├── WORKING_FEATURES.md                # Feature status
└── PITCH_DECK.md                      # Project pitch
```

## Scalability Patterns

### 1. Feature Modules

Each major feature should be self-contained:

```
feature-name/
├── components/           # UI components
├── api/                 # API routes
├── hooks/               # React hooks
├── types/               # TypeScript types
├── utils/               # Utilities
└── tests/               # Tests
```

**Example: Adding a new "Portfolio Analysis" feature:**

```
app/portfolio-analysis/
  ├── page.tsx                    # Main page
  ├── layout.tsx                  # Feature layout
  └── components/
      ├── AnalysisChart.tsx
      └── RiskMetrics.tsx

lib/api/portfolio-analysis.ts     # API utilities
lib/hooks/usePortfolioAnalysis.ts # React hook
test/portfolio-analysis/          # Tests
```

### 2. Agent System Expansion

**Adding a New Agent:**

```typescript
// agents/specialized/NewAgent.ts
import { BaseAgent } from '../core/BaseAgent';
import { MessageBus } from '../communication/MessageBus';

export class NewAgent extends BaseAgent {
  constructor(config: AgentConfig, messageBus: MessageBus) {
    super('new-agent', 'NEW', config, messageBus);
    this.capabilities = ['capability1', 'capability2'];
  }

  async execute(task: Task): Promise<TaskResult> {
    // 1. Validate task
    if (!this.canExecute(task)) {
      throw new Error('Cannot execute task');
    }

    // 2. Execute logic
    const result = await this.performWork(task);

    // 3. Emit event
    this.messageBus.emit('task.completed', {
      agent: this.id,
      task: task.id,
      result
    });

    return result;
  }

  private async performWork(task: Task): Promise<any> {
    // Implementation
  }
}
```

**Register in Orchestrator:**

```typescript
// agents/core/AgentOrchestrator.ts
import { NewAgent } from '../specialized/NewAgent';

class AgentOrchestrator {
  registerAgents() {
    this.agents.set('new-agent', new NewAgent(config, messageBus));
  }
}
```

### 3. Smart Contract Integration

**Adding New Contract:**

1. **Create Contract:**
```solidity
// contracts/core/NewContract.sol
pragma solidity ^0.8.20;

contract NewContract {
  // Implementation
}
```

2. **Add Deployment Script:**
```javascript
// scripts/deploy-new-contract.js
const hre = require('hardhat');

async function main() {
  const Contract = await hre.ethers.getContractFactory('NewContract');
  const contract = await Contract.deploy(/* args */);
  await contract.waitForDeployment();
  
  console.log('Deployed:', await contract.getAddress());
}

main().catch(console.error);
```

3. **Update Addresses:**
```typescript
// lib/contracts/addresses.ts
export const CONTRACT_ADDRESSES = {
  [cronosTestnet.id]: {
    // ... existing
    newContract: '0x...' as `0x${string}`,
  }
};
```

4. **Create TypeScript Wrapper:**
```typescript
// lib/contracts/newContract.ts
import { CONTRACT_ADDRESSES } from './addresses';
import { useContractWrite } from 'wagmi';

export function useNewContract() {
  const { writeAsync } = useContractWrite({
    address: CONTRACT_ADDRESSES[cronosTestnet.id].newContract,
    abi: NewContractABI,
  });

  return { writeAsync };
}
```

### 4. API Route Patterns

**RESTful API Routes:**

```
app/api/
├── agents/
│   ├── route.ts           # GET /api/agents
│   └── [id]/
│       ├── route.ts       # GET /api/agents/:id
│       └── tasks/
│           └── route.ts   # POST /api/agents/:id/tasks
├── commitments/
│   ├── route.ts           # GET /api/commitments
│   └── [hash]/
│       └── route.ts       # GET /api/commitments/:hash
└── portfolio/
    ├── route.ts           # GET /api/portfolio
    └── metrics/
        └── route.ts       # GET /api/portfolio/metrics
```

**Standard Response Format:**

```typescript
// lib/api/types.ts
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// In route handler
export async function GET(request: Request) {
  try {
    const data = await fetchData();
    return Response.json({
      success: true,
      data,
      timestamp: Date.now()
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
      timestamp: Date.now()
    }, { status: 500 });
  }
}
```

### 5. State Management

**Using React Context for Global State:**

```typescript
// contexts/AgentContext.tsx
import { createContext, useContext, useState } from 'react';

interface AgentState {
  agents: Agent[];
  activeAgent: string | null;
  setActiveAgent: (id: string) => void;
}

const AgentContext = createContext<AgentState | undefined>(undefined);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);

  return (
    <AgentContext.Provider value={{ agents, activeAgent, setActiveAgent }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgents() {
  const context = useContext(AgentContext);
  if (!context) throw new Error('useAgents must be used within AgentProvider');
  return context;
}
```

## Environment Configuration

### Development
```bash
NODE_ENV=development
NEXT_PUBLIC_ENABLE_MOCK_DATA=true
```

### Staging
```bash
NODE_ENV=production
NEXT_PUBLIC_CRONOS_NETWORK=testnet
NEXT_PUBLIC_ENABLE_ANALYTICS=true
```

### Production
```bash
NODE_ENV=production
NEXT_PUBLIC_CRONOS_NETWORK=mainnet
NEXT_PUBLIC_ENABLE_ANALYTICS=true
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn
```

## Performance Optimization

### 1. Code Splitting
```typescript
// Lazy load heavy components
const ZKProofDemo = dynamic(() => import('@/components/dashboard/ZKProofDemo'), {
  loading: () => <Skeleton />,
  ssr: false
});
```

### 2. API Caching
```typescript
// lib/api/cache.ts
const cache = new Map<string, { data: any; timestamp: number }>();

export function getCached<T>(key: string, ttl: number = 60000): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  return null;
}

export function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}
```

### 3. Database Indexing (Future)
```typescript
// When adding database layer
// shared/db/schema.ts
export const commitments = pgTable('commitments', {
  hash: varchar('hash', { length: 66 }).primaryKey(),
  timestamp: timestamp('timestamp').notNull().index(), // Indexed
  userId: varchar('user_id', { length: 42 }).index(), // Indexed
});
```

## Monitoring & Observability

### 1. Logging
```typescript
// shared/utils/logger.ts
export const logger = {
  info: (message: string, meta?: any) => {
    console.log(`[INFO] ${message}`, meta);
    // Send to monitoring service
  },
  error: (message: string, error: Error) => {
    console.error(`[ERROR] ${message}`, error);
    // Send to error tracking (Sentry, etc.)
  }
};
```

### 2. Metrics
```typescript
// lib/api/metrics.ts
export function trackGaslessTransaction(success: boolean, gasUsed: bigint) {
  // Track metrics
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'gasless_transaction', {
      success,
      gas_used: gasUsed.toString()
    });
  }
}
```

## Security Best Practices

### 1. Input Validation
```typescript
// lib/validation/schemas.ts
import { z } from 'zod';

export const ProofSchema = z.object({
  commitment: z.string().length(66).startsWith('0x'),
  timestamp: z.number().positive(),
  signature: z.string()
});
```

### 2. Rate Limiting
```typescript
// middleware.ts
import { Ratelimit } from '@upstash/ratelimit';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 m'),
});

export async function middleware(request: Request) {
  const { success } = await ratelimit.limit(
    request.headers.get('x-forwarded-for') || 'anonymous'
  );
  
  if (!success) {
    return new Response('Too Many Requests', { status: 429 });
  }
}
```

## Deployment Strategy

### 1. Staging Environment
```bash
# Deploy to Vercel staging
vercel --prod=false

# Deploy contracts to testnet
npx hardhat run scripts/deploy-gasless-verifier.js --network cronos-testnet
```

### 2. Production Deployment
```bash
# Build and test
npm run build
npm run test

# Deploy frontend
vercel --prod

# Deploy contracts to mainnet
npx hardhat run scripts/deploy-gasless-verifier.js --network cronos-mainnet

# Verify contracts
npx hardhat verify --network cronos-mainnet <address>
```

## Maintenance Guidelines

### Regular Tasks
- [ ] Monitor contract balances (weekly)
- [ ] Review error logs (daily)
- [ ] Update dependencies (monthly)
- [ ] Backup database (if applicable, daily)
- [ ] Security audit (quarterly)

### Scaling Checklist
- [ ] Optimize API response times (<200ms)
- [ ] Add caching layer
- [ ] Implement database connection pooling
- [ ] Set up CDN for static assets
- [ ] Add horizontal scaling (multiple instances)
- [ ] Implement queue system for heavy tasks

## Future Enhancements

### Phase 1: Current (Q1 2025)
- ✅ Gasless transaction system
- ✅ ZK proof generation and storage
- ✅ Basic dashboard UI
- 🚧 AI agent orchestration

### Phase 2: Near-term (Q2 2025)
- [ ] Full protocol integrations (VVS, Delphi, Moonlander)
- [ ] Advanced portfolio analytics
- [ ] Real-time agent collaboration
- [ ] Mobile responsive improvements

### Phase 3: Long-term (Q3-Q4 2025)
- [ ] Mainnet deployment
- [ ] Multi-chain support
- [ ] Advanced AI models
- [ ] DAO governance

## Resources

- **Documentation**: `/docs`
- **API Reference**: `/docs/API.md` (to be created)
- **Contributing Guide**: `/CONTRIBUTING.md` (to be created)
- **Architecture Diagrams**: `/docs/diagrams/` (to be created)

---

**Last Updated**: December 2025
**Version**: 1.0.0
**Maintained By**: ZkVanguard Team
