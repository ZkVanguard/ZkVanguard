# 🔍 ZkVanguard Mock/Test Dependencies Inventory

**Generated:** February 22, 2026  
**Purpose:** Comprehensive inventory of ALL mock/test dependencies that MUST be replaced for mainnet  
**Status:** 🔴 NOT MAINNET READY

---

## Quick Reference: Critical Files to Update

| Priority | Category | Count | Effort |
|----------|----------|-------|--------|
| 🔴 Critical | Mock Contracts | 3 | High |
| 🔴 Critical | Hardcoded Addresses | 15+ | Medium |
| 🟠 High | API Routes | 5 | Medium |
| 🟠 High | ZK Mock Proofs | 3 | Low |
| 🟡 Medium | Deployment Configs | 5 | Low |
| 🟢 Low | Frontend Mocks | 3 | Low |

---

## 📦 SECTION 1: MOCK CONTRACTS

### 1.1 MockMoonlander.sol
**File:** `contracts/mocks/MockMoonlander.sol`  
**Testnet Address:** `0xFF2041C4e80E86Ec91cd821659063eEE5CC16c71`  
**Priority:** 🔴 CRITICAL

**Dangerous Functions (must NOT be called in production):**
```solidity
function setMockPrice(uint256 pairIndex, uint256 price) external  // Line ~varies
function mint(address to, uint256 amount) external                // MockUSDC inside
```

**Referenced in:**
| File | Line | Context |
|------|------|---------|
| `lib/price-sync.ts` | 12 | `const MOCK_MOONLANDER = '0x22E2F...'` |
| `lib/price-sync.ts` | 84-110 | Syncs CDC prices to MockMoonlander |
| `lib/services/OnChainPortfolioManager.ts` | 8,30,216 | Hardcoded address |
| `scripts/deploy/deploy-hedge-executor-v2.js` | 59 | Deployment uses MockMoonlander |
| `scripts/deploy/deploy-fixed-mock-moonlander.js` | ALL | Entire script for mock |
| `scripts/test/test-high-leverage-v2.js` | 18,37-39,63 | Test references |
| `scripts/test/debug-hedge-executor-v2.js` | 12,22,44-65 | Debug references |
| `deployments/cronos-testnet.json` | 20 | Deployment record |
| `deployments/hedge-executor-v2-testnet.json` | 12 | moonlanderRouter |

**Mainnet Replacement:**
```typescript
// Real Moonlander Diamond (same on testnet & mainnet)
const MOONLANDER = '0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9';
```

---

### 1.2 MockUSDC (in MockMoonlander.sol)
**Testnet Address:** `0x28217DAddC55e3C4831b4A48A00Ce04880786967`  
**Priority:** 🔴 CRITICAL

**Dangerous Functions:**
```solidity
function mint(address to, uint256 amount) external  // PERMISSIONLESS MINT!
```

**Referenced in:**
| File | Line | Context |
|------|------|---------|
| `lib/price-sync.ts` | 13 | `const MOCK_USDC = '0x28217...'` |
| `lib/price-sync.ts` | 172-197 | `ensureMoonlanderFunded()` mints USDC |
| `lib/services/OnChainPortfolioManager.ts` | 7,29,204,215 | Multiple references |
| `components/dashboard/PositionsList.tsx` | 728 | Symbol lookup |
| `deployments/cronos-testnet.json` | 24 | Deployment record |
| `scripts/deploy/deploy-fixed-mock-moonlander.js` | 16-29 | Deployment |

**Mainnet Replacement:**
```typescript
// Real USDC on Cronos Mainnet
const USDC = '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59';
// devUSDC on Cronos Testnet (if testing)
const DEV_USDC = '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0';
```

---

### 1.3 MockGroth16Verifier
**Testnet Address:** `0x1dDb2A6b64beF9E9435be251c78C84ACaEd94953`  
**Priority:** 🟡 MEDIUM

**Found in:**
| File | Line | Context |
|------|------|---------|
| `deployments/cronos-testnet.json` | 11 | `"MockGroth16Verifier": "0x1dDb..."` |

**Note:** System primarily uses ZK-STARK (not Groth16). Can be skipped if STARKs are used.

---

## 📍 SECTION 2: HARDCODED TESTNET ADDRESSES

### 2.1 lib/contracts/addresses.ts
**Priority:** 🔴 CRITICAL

**Testnet addresses (need mainnet equivalents):**
| Contract | Testnet Address | Mainnet Env Var | Line |
|----------|-----------------|-----------------|------|
| zkVerifier | `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8` | `NEXT_PUBLIC_MAINNET_ZKVERIFIER_ADDRESS` | 14 |
| rwaManager | `0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189` | `NEXT_PUBLIC_MAINNET_RWAMANAGER_ADDRESS` | 15 |
| paymentRouter | `0xe40AbC51A100Fa19B5CddEea637647008Eb0eA0b` | `NEXT_PUBLIC_MAINNET_PAYMENT_ROUTER_ADDRESS` | 16 |
| universalRelayer | `0x9E5512b683d92290ccD20F483D20699658bcb9f3` | `NEXT_PUBLIC_MAINNET_RELAYER_CONTRACT` | 17 |
| gaslessZKVerifier | `0x7747e2D3e8fc092A0bd0d6060Ec8d56294A5b73F` | `NEXT_PUBLIC_MAINNET_GASLESS_ZK_VERIFIER` | 18 |
| gaslessZKCommitmentVerifier | `0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9` | `NEXT_PUBLIC_MAINNET_GASLESS_COMMITMENT_VERIFIER` | 20 |
| x402GaslessVerifier | `0x44098d0dE36e157b4C1700B48d615285C76fdE47` | `NEXT_PUBLIC_MAINNET_X402_GASLESS_VERIFIER` | 22 |
| hedgeExecutor | `0x090b6221137690EbB37667E4644287487CE462B9` | `NEXT_PUBLIC_MAINNET_HEDGE_EXECUTOR_ADDRESS` | 26 |

**Mainnet addresses (ALREADY CORRECT):**
| Contract | Address | Line |
|----------|---------|------|
| usdcToken | `0xc21223249CA28397B4B6541dfFaEcC539BfF0c59` | 40 |
| moonlanderRouter | `0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9` | 42 |

---

### 2.2 lib/price-sync.ts
**Priority:** 🔴 CRITICAL

**Lines 12-13:**
```typescript
const MOCK_MOONLANDER = '0x22E2F34a0637b0e959C2F10D2A0Ec7742B9956D7';  // WRONG
const MOCK_USDC = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';       // WRONG
```

**Mainnet Fix:**
```typescript
import { getMoonlanderAddress, getUsdcAddress } from './utils/network';
const moonlanderAddress = getMoonlanderAddress(); // Dynamic based on chain
const usdcAddress = getUsdcAddress();             // Dynamic based on chain
```

---

### 2.3 lib/services/OnChainPortfolioManager.ts
**Priority:** 🔴 CRITICAL

| Line | Issue |
|------|-------|
| 7-9 | Comments reference mock addresses |
| 29-30 | `MockUSDC`, `MockMoonlander` in interface |
| 204-220 | Hardcoded fallback addresses |
| 249 | Hardcoded deployer: `'0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c'` |

---

### 2.4 Hardcoded Deployer Address
**Address:** `0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c`  
**Priority:** 🟠 HIGH

**Found in:**
| File | Line | Context |
|------|------|---------|
| `lib/services/OnChainPortfolioManager.ts` | 249 | Default wallet fallback |
| `lib/services/AutoHedgingService.ts` | 120,124 | Hardcoded wallet |
| `app/api/agents/hedging/onchain/route.ts` | 29 | `const DEPLOYER = '...'` |
| `scripts/sync-onchain-hedges.js` | 102 | Deployer wallet |
| `scripts/database/seed-onchain-hedges.js` | 10 | `const DEPLOYER = '...'` |
| `scripts/fix-hedge-ownership.js` | 6 | `const USER_WALLET = '...'` |
| `deployments/cronos-testnet.json` | 5 | `"deployer": "..."` |

---

### 2.5 lib/utils/network.ts
**Priority:** 🟢 READY (just needs env var)

**Line 43-44:** Defaults to testnet if `NEXT_PUBLIC_CHAIN_ID` not set
```typescript
// Default to testnet
return CHAIN_IDS.CRONOS_TESTNET;
```

**Fix:** Set `NEXT_PUBLIC_CHAIN_ID=25` in production.

---

## 🌐 SECTION 3: API ROUTES USING TESTNET

### 3.1 app/api/zk-proof/verify-onchain/route.ts
**Priority:** 🟠 HIGH

| Line | Issue |
|------|-------|
| 3 | `import { CronosTestnet } from '@/lib/chains'` |
| 7 | Hardcoded: `const GASLESS_VERIFIER_ADDRESS = '0xC81C1c09533f75Bc92a00eb4081909975e73Fd27'` |
| 48 | `chain: CronosTestnet` |
| 133 | `blockchain: 'Cronos Testnet'` |

**Fix:**
```typescript
import { getCurrentChain } from '@/lib/utils/network';
import { getGaslessVerifierAddress } from '@/lib/contracts/addresses';
// Use dynamic chain and address
```

---

### 3.2 app/api/demo/moonlander-hedge/route.ts
**Priority:** 🟠 HIGH

| Line | Issue |
|------|-------|
| 56-76 | Returns fake demo data on error |
| 68 | `demoMode: true` in fallback response |

**Fix:** Remove fallback demo data or gate with explicit feature flag.

---

### 3.3 app/api/portfolio/simulated/route.ts
**Priority:** 🟡 MEDIUM

**Lines 1-114:** Entire endpoint uses `SimulatedPortfolioManager` for demos.

**Fix:** Either remove from production or clearly mark as demo endpoint.

---

### 3.4 app/api/agents/hedging/onchain/route.ts
**Priority:** 🟠 HIGH

| Line | Issue |
|------|-------|
| 29 | `const DEPLOYER = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c'` |

---

### 3.5 app/api/zk/verify-ownership/route.ts
**Priority:** 🟡 MEDIUM

| Line | Issue |
|------|-------|
| 261-266 | `mockRequest` pattern |

---

## 🔐 SECTION 4: ZK MOCK PROOFS

### 4.1 zk/prover/ProofGenerator.ts
**Priority:** 🟠 HIGH

| Line | Issue |
|------|-------|
| 255 | `* Generate mock proof for development/testing` |
| 257 | `private generateMockProof()` |
| 261 | `logger.warn('Using mock ZK proof for development', { proofType })` |
| 264 | `version: 'STARK-1.0-MOCK'` |
| 278 | `protocol: 'ZK-STARK-MOCK'` |
| 281 | `proof_system: 'AIR + FRI (Mock)'` |
| 291 | `protocol: 'ZK-STARK-MOCK'` |

**Good:** Real Python prover is called by default. Mock is fallback only.

**Fix:** Add production guard:
```typescript
if (process.env.NODE_ENV === 'production') {
  throw new Error('Mock proofs not allowed in production');
}
```

---

### 4.2 zk/verifier/ProofValidator.ts
**Priority:** 🟠 HIGH

| Line | Issue |
|------|-------|
| 93 | `const isTestMode = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined` |
| 95 | `// Mock validation - check structure more thoroughly` |
| 99 | Comment about mock format: `// execution_trace_length (real) or trace_length (mock)` |
| 184-186 | Comments reference mock proof formats |
| 227 | `// Handle both mock and real proof formats` |

**Fix:** Ensure `NODE_ENV=production` rejects mock proof formats.

---

## 📁 SECTION 5: DEPLOYMENT CONFIGS

### 5.1 deployments/cronos-testnet.json
**Priority:** 🟡 MEDIUM

All addresses are testnet. Need equivalent `cronos-mainnet.json` after deployment.

**Key fields:**
```json
{
  "network": "cronos-testnet",
  "chainId": 338,
  "MockMoonlander": "0xFF2041C4e80E86Ec91cd821659063eEE5CC16c71",
  "MockUSDC": "0x28217DAddC55e3C4831b4A48A00Ce04880786967",
  "HedgeExecutor": "0x090b6221137690EbB37667E4644287487CE462B9"
}
```

---

### 5.2 deployments/hedge-executor-v2-testnet.json
**Priority:** 🟡 MEDIUM

```json
{
  "network": "Cronos Testnet",
  "chainId": 338,
  "contracts": {
    "collateralToken": "0x28217DAddC55e3C4831b4A48A00Ce04880786967", // MockUSDC
    "moonlanderRouter": "0xFF2041C4e80E86Ec91cd821659063eEE5CC16c71" // MockMoonlander
  }
}
```

---

### 5.3 shared/utils/config.ts
**Priority:** 🟡 MEDIUM

| Line | Issue |
|------|-------|
| 22 | `chainId: 338` as default for cronos-testnet |
| 209 | `chainId: parseInt(process.env.VITE_CHAIN_ID || '338')` |

---

## 🖥️ SECTION 6: FRONTEND MOCK DATA

### 6.1 components/dashboard/PositionsList.tsx
**Priority:** 🟢 LOW

| Line | Issue |
|------|-------|
| 716-721 | Special handling for "institutional portfolios with MockUSDC" |
| 728 | `if (addr === '0x28217daddc55e3c4831b4a48a00ce04880786967') return 'MockUSDC'` |

---

### 6.2 components/FeeDisplay.tsx
**Priority:** 🟢 LOW

| Line | Issue |
|------|-------|
| 19 | `isTestnet = true` as default parameter |

---

### 6.3 components/dashboard/ZKProofDemo.tsx
**Priority:** 🟢 LOW

Demo component - can remain for demonstration purposes but should be clearly marked.

---

## ✅ SECTION 7: ENVIRONMENT-AWARE CODE (WORKING)

These patterns are **correctly implemented** and will work on mainnet:

| File | Function/Pattern | Status |
|------|------------------|--------|
| `lib/utils/network.ts` | `isMainnet()`, `isTestnet()` | ✅ |
| `lib/utils/network.ts` | `getUsdcAddress()`, `getMoonlanderAddress()` | ✅ |
| `lib/contracts/addresses.ts` | `CRONOS_CONTRACT_ADDRESSES.mainnet` | ✅ |
| `lib/chains.ts` | Both `CronosMainnet` and `CronosTestnet` defined | ✅ |
| `lib/utils/fees.ts` | `isTestnet` parameter for fee calculation | ✅ |

---

## 🚀 MAINNET MIGRATION CHECKLIST

### Phase 1: Environment Setup
- [ ] Set `NEXT_PUBLIC_CHAIN_ID=25`
- [ ] Set `NODE_ENV=production`
- [ ] Configure mainnet RPC: `CRONOS_MAINNET_RPC=https://evm.cronos.org`

### Phase 2: Contract Deployment
- [ ] Deploy ZKVerifier to mainnet
- [ ] Deploy RWAManager to mainnet
- [ ] Deploy PaymentRouter to mainnet
- [ ] Deploy HedgeExecutor to mainnet
- [ ] Deploy X402GaslessVerifier to mainnet
- [ ] Create `deployments/cronos-mainnet.json`

### Phase 3: Configuration
- [ ] Set all `NEXT_PUBLIC_MAINNET_*` env vars
- [ ] Remove/update hardcoded deployer addresses
- [ ] Update `lib/price-sync.ts` to use dynamic addresses
- [ ] Update `OnChainPortfolioManager` to not use mock fallbacks

### Phase 4: Code Cleanup
- [ ] Remove MockMoonlander from HedgeExecutor initialization
- [ ] Remove MockUSDC mint calls
- [ ] Add production guards to mock ZK proof generation
- [ ] Update API routes to use dynamic chain selection

### Phase 5: Testing
- [ ] Test hedge execution with real USDC
- [ ] Test ZK proof generation (should use Python backend)
- [ ] Test gasless transactions
- [ ] Verify contract interactions on mainnet

---

## 📊 Impact Assessment

| Risk Level | Description | Count |
|------------|-------------|-------|
| 🔴 Critical | System won't work without fixing | 11+ |
| 🟠 High | Features degraded without fixing | 9 |
| 🟡 Medium | Technical debt / maintainability | 8 |
| 🟢 Low | Polish / best practices | 3 |

**Estimated Total Effort:** 3-5 days
- Contract deployment: 1-2 days
- Configuration updates: 1 day  
- Code cleanup: 1 day
- Testing: 1 day

---

*Inventory generated by comprehensive codebase analysis on February 22, 2026*
