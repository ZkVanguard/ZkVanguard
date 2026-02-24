# CommunityPool V2 Mainnet Deployment Checklist

## Pre-Deployment Verification

### Environment Setup
- [ ] `.env` file contains `PRIVATE_KEY` for mainnet deployer
- [ ] Deployer wallet has sufficient CRO (recommend 20+ CRO for deployment + operations)
- [ ] Deployer wallet is secure (hardware wallet recommended for production)

### Contract Configuration
- [ ] Review `scripts/deploy/deploy-community-pool-mainnet.cjs` for correct addresses:
  - Pyth Oracle: `0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B`
  - USDC: `0xc21223249CA28397B4B6541dfFaEcc539BfF0c59` (Circle USDC)
- [ ] Fee structure is finalized:
  - Management Fee: 0.5% (50 bps)
  - Performance Fee: 10% (1000 bps)
- [ ] Pool parameters reviewed:
  - Min deposit: 10 USDC
  - Max capacity: 10M USDC

### Code Audit
- [ ] Smart contract code reviewed
- [ ] No critical vulnerabilities in `CommunityPool.sol`
- [ ] UUPS upgrade pattern implemented correctly
- [ ] Access control roles properly assigned
- [ ] Slippage protection on withdrawals

---

## Deployment Steps

### 1. Deploy Contract
```powershell
npx hardhat run scripts/deploy/deploy-community-pool-mainnet.cjs --network cronos-mainnet
```

Expected output:
- Proxy address
- Implementation address
- Deployment saved to `deployments/community-pool-mainnet.json`

### 2. Verify Contract on Cronoscan
```powershell
npx hardhat verify --network cronos-mainnet <IMPLEMENTATION_ADDRESS>
```

### 3. Push Initial Prices
```powershell
npx hardhat run scripts/update-pyth-prices-mainnet.cjs --network cronos-mainnet
```

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
