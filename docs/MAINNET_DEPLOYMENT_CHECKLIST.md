# CommunityPool V3 Mainnet Deployment Checklist

## ✅ Pre-Deployment Verification Complete

### Contract Readiness

| Check | Status | Notes |
|-------|--------|-------|
| Contract size | ✅ | 23.478 KiB (under 24KB limit) |
| Optimizer runs | ✅ | 1 (minimum bytecode) |
| All tests passing | ✅ | 62 tests (35 base + 27 security) |
| Circuit breakers configurable | ✅ | Admin can adjust limits |
| ABI exported for frontend | ✅ | `contracts/abi/CommunityPool.json` |

### Security Features Tested

| Feature | Test Coverage | Status |
|---------|---------------|--------|
| Max single deposit limit | `should enforce max single deposit limit` | ✅ |
| Max single withdrawal BPS | `should enforce max single withdrawal BPS` | ✅ |
| Daily withdrawal cap | `should enforce daily withdrawal cap` | ✅ |
| Daily cap reset | `should reset daily withdrawal cap at midnight UTC` | ✅ |
| Circuit breaker trip/reset | Multiple tests | ✅ |
| Access control (admin/agent/upgrader) | Multiple tests | ✅ |
| Inflation attack prevention | `should prevent inflation attack via virtual shares` | ✅ |
| Donation attack mitigation | `should prevent donation attack` | ✅ |
| Sandwich attack protection | `should prevent sandwich attack on deposits` | ✅ |
| Emergency withdraw | `should allow withdrawal when paused (via emergency withdraw)` | ✅ |
| Timelock admin transfer | `should transfer admin role correctly` | ✅ |

### Gas Verification

| Operation | Gas Used | Limit | Status |
|-----------|----------|-------|--------|
| First deposit | 320,976 | 350,000 | ✅ |
| Withdrawal | 181,936 | 200,000 | ✅ |

---

## Manual Steps Required

### 1. Create Gnosis Safe Multisig

1. Go to [Gnosis Safe on Cronos](https://safe.cronos.org) or [safe.global](https://app.safe.global)
2. Connect wallet to **Cronos Mainnet (Chain ID: 25)**
3. Create new Safe with:
   - **Name**: `Chronos-Vanguard-Multisig`
   - **Owners**: Add 3-5 trusted team member addresses
   - **Threshold**: 2 of 3 (recommended) or 3 of 5 for higher security
4. **Copy the Safe address** once deployed

### 2. Configure `mainnet-config.json`

Edit `deployments/mainnet-config.json`:

```json
{
  "multisig": "0x... (paste your Gnosis Safe address here)",
  "treasury": "0x... (paste treasury address - can be same as multisig)"
}
```

### 3. Verify Environment

```bash
# Check private key is set (deployer wallet)
npx hardhat vars get MAINNET_PRIVATE_KEY
```

### 4. Fund Deployer Wallet

Ensure deployer wallet has **50+ CRO** for deployment gas.

---

## Deployment Steps

### Step 1: Run Preflight Check

```bash
npx hardhat run scripts/deploy/mainnet-preflight.cjs --network cronos-mainnet
```

All checks must pass before proceeding.

### Step 2: Deploy Contracts

```bash
npx hardhat run scripts/deploy/deploy-mainnet-full.cjs --network cronos-mainnet
```

This deploys:
1. CommunityPoolTimelock (48-hour delay)
2. CommunityPool Proxy (UUPS upgradeable)
3. Configures Pyth oracle, price feed IDs
4. Sets circuit breaker defaults
5. Transfers admin to Timelock

### Step 3: Verify Deployment

```bash
npx hardhat run scripts/deploy/mainnet-verify.cjs --network cronos-mainnet
```

### Step 4: Verify on Cronoscan

```bash
# Verify Timelock
npx hardhat verify --network cronos-mainnet <TIMELOCK_ADDRESS> 48 "['<MULTISIG>']" "['<MULTISIG>']" "0x0000000000000000000000000000000000000000"

# Verify CommunityPool implementation
npx hardhat verify --network cronos-mainnet <IMPLEMENTATION_ADDRESS>
```

---

## Post-Deployment Configuration (via Timelock - 48h delay)

1. **Set DEX Router** (for rebalancing): `setDexRouter(address)`
2. **Grant Agent Role** (for AI rebalancing): `grantRole(AGENT_ROLE, agentAddress)`
3. **Adjust Circuit Breakers** (if needed)

### Default Configuration Applied

| Setting | Value |
|---------|-------|
| Max Single Deposit | $100,000 USDC |
| Max Single Withdrawal | 25% of balance |
| Daily Withdrawal Cap | 50% of TVL |
| Management Fee | 0.5% annually |
| Performance Fee | 10% on profits |
| Rebalance Cooldown | 1 hour |

---

## Emergency Procedures

- **Trip Circuit Breaker**: `tripCircuitBreaker("reason")` - stops all non-emergency operations
- **Enable Emergency Withdrawals**: `setEmergencyWithdraw(true)`
- **Pause Contract**: `pause()` - full pause

---

## Files Reference

| File | Purpose |
|------|---------|
| `deployments/mainnet-config.json` | Mainnet configuration |
| `scripts/deploy/mainnet-preflight.cjs` | Pre-deployment checks |
| `scripts/deploy/deploy-mainnet-full.cjs` | Full deployment script |
| `scripts/deploy/mainnet-verify.cjs` | Post-deployment verification |
| `test/CommunityPool.test.cjs` | Core functionality tests (35) |
| `test/CommunityPool.security.test.cjs` | Security hardening tests (27) |
| `contracts/abi/CommunityPool.json` | Frontend ABI |

---

## Cronos Mainnet Addresses

| Contract | Address |
|----------|---------|
| USDC | `0xc21223249CA28397B4B6541dffaEcc539BfF0c59` |
| Pyth Oracle | `0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B` |
| wBTC | `0x062E66477Faf219F25D27dCED647BF57C3107d52` |
| wETH | `0xe44Fd7fCb2b1581822D0c862B68222998a0c299a` |
| wCRO | `0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23` |

### 4. Verify Oracle Health
Create a quick check script or use console:
```javascript
const pool = await ethers.getContractAt("CommunityPool", "<PROXY_ADDRESS>");
const health = await pool.checkOracleHealth();
console.log("Oracle healthy:", health.healthy);
console.log("All feeds working:", health.working.every(w => w));
console.log("All feeds fresh:", health.fresh.every(f => f));
```

---

## Post-Deployment Checklist

### Immediate Actions
- [ ] Verify contract on Cronoscan (both proxy and implementation)
- [ ] Test oracle health check
- [ ] Update treasury address if different from deployer
- [ ] Configure any additional admin roles

### Testing (Small Amounts First)
- [ ] Deposit small test amount (e.g., 10 USDC)
- [ ] Verify NAV calculation
- [ ] Withdraw portion
- [ ] Verify fee deduction
- [ ] Check withdrawal slippage protection

### Security
- [ ] Confirm admin roles are correctly assigned
- [ ] Set up multisig for admin functions (optional but recommended)
- [ ] Document emergency procedures
- [ ] Plan for regular Pyth price updates (cron job or keeper)

### Monitoring
- [ ] Set up Cronoscan monitoring alerts
- [ ] Configure logging for deposits/withdrawals
- [ ] Monitor Pyth price staleness
- [ ] Track pool TVL

---

## Key Addresses (Cronos Mainnet)

| Contract | Address |
|----------|---------|
| Pyth Oracle | `0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B` |
| Circle USDC | `0xc21223249CA28397B4B6541dfFaEcc539BfF0c59` |
| CommunityPool Proxy | _TBD after deployment_ |
| CommunityPool Impl | _TBD after deployment_ |

---

## Pyth Price Feed IDs (Universal)

| Asset | Price ID |
|-------|----------|
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
| ETH/USD | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| SUI/USD | `0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744` |
| CRO/USD | `0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe` |

---

## Emergency Procedures

### Pause Deposits/Withdrawals
```javascript
await pool.setDepositPaused(true);  // Pause deposits
await pool.setWithdrawPaused(true); // Pause withdrawals
```

### Update Oracle
```javascript
await pool.setPythOracle(newPythAddress);
```

### Upgrade Contract (UUPS)
```javascript
const CommunityPoolV3 = await ethers.getContractFactory("CommunityPoolV3");
await upgrades.upgradeProxy(proxyAddress, CommunityPoolV3);
```

---

## Testnet Validation ✅

Completed on Cronos Testnet (2024):

- **Proxy**: `0x97F77f8A4A625B68BDDc23Bb7783Bbd7cf5cb21B`
- **Implementation**: `0x69cB31a63fdD23bd34E307Db985551b5ce28F8D8`
- **Tests Passed**: 25/25 (100%)

Test coverage:
- ✅ Oracle health verification
- ✅ Price retrieval (BTC, ETH, SUI, CRO)
- ✅ Deposit flow with NAV calculation
- ✅ Withdrawal flow with slippage protection
- ✅ Member position tracking
- ✅ Admin role verification
- ✅ Fee configuration
