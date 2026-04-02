# ZK Vanguard - Mainnet Readiness Documentation

## Executive Summary

This document outlines the mainnet deployment readiness status for the ZK Vanguard Community Pool system. The smart contracts and infrastructure have passed all 50 critical mainnet readiness tests and are ready for production deployment pending operational setup tasks.

---

## ✅ Test Results Summary

| Test Suite | Status | Tests |
|------------|--------|-------|
| ProductionGuard Enforcement | ✅ PASS | 10/10 |
| Financial Amount Validation | ✅ PASS | 6/6 |
| Address & Transaction Validation | ✅ PASS | 4/4 |
| Leverage & Percentage Validation | ✅ PASS | 5/5 |
| Share Validation | ✅ PASS | 3/3 |
| Live Price Fetching | ✅ PASS | 3/3 |
| Circuit Breaker Functionality | ✅ PASS | 3/3 |
| Audit Logging | ✅ PASS | 2/2 |
| Production Mode Flag | ✅ PASS | 2/2 |
| Financial Calculations | ✅ PASS | 5/5 |
| Agent Orchestrator | ✅ PASS | 2/2 |
| Hedge Manager Validation | ✅ PASS | 1/1 |
| Security Tests | ✅ PASS | 4/4 |
| **TOTAL** | **✅ PASS** | **50/50** |

---

## Smart Contract Security Features

### OpenZeppelin Upgradeable Contracts
- `AccessControlUpgradeable` - Role-based permissions
- `ReentrancyGuardUpgradeable` - Reentrancy attack protection
- `PausableUpgradeable` - Emergency pause capability
- `UUPSUpgradeable` - Secure upgrade pattern

### Circuit Breakers (Configured)
| Parameter | Value | Description |
|-----------|-------|-------------|
| Max Single Deposit | $100,000 | Prevents whale manipulation |
| Max Single Withdrawal | 25% of pool | Prevents bank run |
| Daily Withdrawal Cap | 50% of pool | Limits daily outflow |
| Whale Threshold | 10% ownership | Triggers extra checks |

### Price Validation Ranges
| Asset | Min Price | Max Price |
|-------|-----------|-----------|
| BTC | $1,000 | $1,000,000 |
| ETH | $100 | $100,000 |
| USDC/USDT | $0.95 | $1.05 |
| CRO | $0.001 | $10 |

---

## Token Configuration

### Tether WDK Integration (USDT)

Mainnet uses official Tether USDT via WDK integration:

| Chain | Address | Verified |
|-------|---------|----------|
| Cronos Mainnet | `0x66e428c3f67a68878562e79A0234c1F83c208770` | ✅ |
| Hedera Mainnet | `0x0000000000000000000000000000000000000000` | ❌ (not yet deployed) |

### Testnet Tokens (Testnet USDC)

| Chain | Address | Purpose |
|-------|---------|---------|
| Cronos Testnet | `0x28217DAddC55e3C4831b4A48A00Ce04880786967` | Testing |
| Hedera Testnet | `0x0000000000000000000000000000000000000000` | Testing |

---

## Oracle Configuration

### Pyth Network Price Feeds

| Network | Oracle Address |
|---------|----------------|
| Cronos Mainnet | `0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B` |
| Cronos Testnet | `0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320` |
| Hedera Mainnet | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |
| Hedera Testnet | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` |

### Price Feed IDs
```
BTC: 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
ETH: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
SUI: 0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744
CRO: 0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe
```

---

## x402 Gasless Payment System

### Overview
Users pay $0.00 in native gas - all transactions are sponsored via x402 protocol.

### How It Works
1. User approves USDT via x402 (gasless EIP-3009)
2. x402 Facilitator verifies payment signature
3. Smart contract receives USDT, executes operation
4. Contract pays CRO/ETH gas from its sponsored pool

### Cost Per Operation
| Operation | Gas Units | Cronos Cost | Hedera Cost |
|-----------|-----------|-------------|---------------|
| Deposit | ~132,500 | ~$0.00007 | ~$0.05 |
| Withdraw | ~150,000 | ~$0.00008 | ~$0.05 |
| ZK Commitment | ~65,000 | ~$0.00003 | ~$0.02 |

### Recommended Gas Sponsorship Fund
| Chain | Amount | Supports |
|-------|--------|----------|
| Cronos | 50 CRO (~$5) | ~75,000 txs |
| Hedera | 100 HBAR (~$10) | ~10,000 txs |
| x402 Pool | $100 USDC | Payment flow |
| **Total** | **~$455** | MVP launch |

---

## Deployment Checklist

### ❌ Pre-Deployment Tasks (Must Complete)

| Task | Status | Notes |
|------|--------|-------|
| Create Gnosis Safe Multisig | ❌ | https://safe.cronos.org |
| Set Treasury Address | ❌ | Multisig-controlled |
| Obtain Moonlander Router | ❌ | Contact Moonlander team |
| Fund Deployer Wallet | ❌ | Need ~10 CRO |
| Deploy Timelock (48h) | ❌ | Security requirement |
| Deploy CommunityPool Proxy | ❌ | Via Hardhat |
| Transfer Admin to Timelock | ❌ | Critical security step |
| Verify on Explorer | ❌ | Cronoscan verification |
| Test Deposit on Mainnet | ❌ | Small amount test |

### ✅ Completed Tasks

| Task | Status |
|------|--------|
| Smart Contract Development | ✅ |
| Security Features (ReentrancyGuard, Pausable) | ✅ |
| Circuit Breaker Implementation | ✅ |
| Pyth Oracle Integration | ✅ |
| WDK USDT Configuration | ✅ |
| x402 Gasless Integration | ✅ |
| ProductionGuard Implementation | ✅ |
| Mainnet Readiness Tests (50/50) | ✅ |
| Testnet Deployment & Testing | ✅ |

---

## Deployment Commands

### 1. Deploy Timelock
```bash
npx hardhat run scripts/deploy/deploy-timelock.js --network cronos-mainnet
```

### 2. Deploy CommunityPool
```bash
npx hardhat run scripts/deploy/deploy-community-pool.js --network cronos-mainnet
```

### 3. Verify Contracts
```bash
npx hardhat verify --network cronos-mainnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### 4. Fund Gas Sponsorship
```javascript
// Send CRO to contract for gas sponsorship
const fundAmount = ethers.parseEther("50"); // 50 CRO
await deployer.sendTransaction({
  to: poolAddress,
  value: fundAmount,
});
```

---

## Environment Variables (.env)

```bash
# PRODUCTION MODE - SET TO true FOR MAINNET
PRODUCTION_MODE=true
ENFORCE_PRODUCTION_SAFETY=true

# Network
NETWORK=cronos-mainnet
CRONOS_MAINNET_RPC=https://evm.cronos.org

# Addresses (Fill after deployment)
NEXT_PUBLIC_COMMUNITY_POOL_ADDRESS=<DEPLOYED_ADDRESS>
NEXT_PUBLIC_TIMELOCK_ADDRESS=<TIMELOCK_ADDRESS>

# Multisig
ADMIN_MULTISIG=<GNOSIS_SAFE_ADDRESS>
TREASURY_ADDRESS=<TREASURY_SAFE_ADDRESS>

# Oracle
PYTH_ORACLE_ADDRESS=0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B

# Token (USDT on mainnet)
DEPOSIT_TOKEN_ADDRESS=0x66e428c3f67a68878562e79A0234c1F83c208770

# x402 Facilitator
X402_FACILITATOR_URL=https://facilitator.x402.network
```

---

## Risk Assessment

### Mitigated Risks
| Risk | Mitigation |
|------|------------|
| Reentrancy Attack | OpenZeppelin ReentrancyGuard |
| Price Manipulation | Pyth Oracle + sanity checks |
| Whale Domination | 10% whale threshold + limits |
| Bank Run | Daily withdrawal cap (50%) |
| Admin Key Compromise | Timelock (48h) + Multisig |
| Contract Upgrade Attack | UUPS + Timelock delay |
| Stale Price Data | 60-second freshness check |

### Residual Risks
| Risk | Severity | Notes |
|------|----------|-------|
| Smart Contract Bug | Medium | Mitigated by testing, auditable code |
| Oracle Failure | Low | Multiple price sources available |
| Network Congestion | Low | x402 handles gas spikes |
| Regulatory | Unknown | Legal review recommended |

---

## Monitoring & Alerts

### Recommended Monitoring
- [ ] Contract balance below threshold
- [ ] Large deposits (>$50K)
- [ ] Large withdrawals (>10% of pool)
- [ ] Circuit breaker triggered
- [ ] Failed transactions
- [ ] Oracle price deviations >5%

### Alert Channels
- Telegram bot for critical alerts
- Email for daily summaries
- Dashboard for real-time monitoring

---

## Emergency Procedures

### Circuit Breaker Triggered
1. Investigate cause immediately
2. Check for malicious activity
3. If false positive: Admin can reset via multisig
4. If attack: Keep circuit breaker active

### Pause Contract
```javascript
// Requires PAUSER_ROLE
await communityPool.pause();
```

### Emergency Withdrawal
```javascript
// Enable emergency withdrawals (bypasses circuit breaker)
await communityPool.setEmergencyWithdraw(true);
```

### Contract Upgrade
1. Develop fix
2. Deploy new implementation
3. Submit upgrade proposal to Timelock
4. Wait 48 hours
5. Execute upgrade

---

## Testnet Verification Results

### Cronos Testnet
- Contract: `0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30`
- Status: ✅ Live and operational
- Total Value: ~$15,000 (test funds)
- Deposits: ✅ Working
- Withdrawals: ✅ Working

### Hedera Testnet
- Contract: `0xCF434F24eBA5ECeD1ffd0e69F1b1F4cDed1AB2a6`
- Status: ✅ Live and operational
- Total Value: ~$210 (test funds)
- Deposits: ✅ Working
- Withdrawals: ✅ Working

---

## Approval & Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Lead Developer | | | |
| Security Reviewer | | | |
| Operations Lead | | | |
| Project Owner | | | |

---

## Appendix A: Contract ABIs

See `contracts/abi/CommunityPool.json` for full ABI.

## Appendix B: Test Execution

```bash
# Run all mainnet readiness tests
npx jest test/mainnet-readiness.test.ts --no-coverage

# Expected: 50/50 tests passing
```

## Appendix C: Related Documentation

- [WDK Integration Guide](./integrations/tether-wdk.md)
- [x402 Gasless Setup](./integrations/x402-gasless.md)
- [Security Architecture](./SECURITY.md)
- [API Documentation](./API.md)

---

*Document Version: 1.0*  
*Last Updated: March 18, 2026*  
*Status: Ready for Mainnet Deployment (Pending Operational Tasks)*
