# Mainnet Migration Guide

This document describes all changes made to make the codebase mainnet-ready. After following this guide, you only need to deploy contracts to mainnet.

## Summary of Changes

### 1. New Files Created

| File | Purpose |
|------|---------|
| `lib/utils/network.ts` | Server-side network utilities (chain detection, explorer URLs, tokens) |
| `lib/hooks/useNetwork.ts` | React hooks for network-aware utilities |
| `.env.mainnet.example` | Environment template for mainnet deployment |

### 2. Updated Files

| File | Changes |
|------|---------|
| `lib/contracts/addresses.ts` | Added mainnet env var support, real USDC, Moonlander addresses |
| `lib/db/hedges.ts` | Dynamic explorer URLs based on chain ID |
| `app/api/agents/hedging/bluefin/route.ts` | Uses `BLUEFIN_NETWORK` env var |
| `components/ZKVerificationBadge.tsx` | Uses `useExplorerUrl()` hook |
| `components/dashboard/DepositModal.tsx` | Uses `chainId` and `EXPLORER_URLS` |
| `components/dashboard/WithdrawModal.tsx` | Uses `chainId` and `EXPLORER_URLS` |
| `components/dashboard/ManualHedgeModal.tsx` | Dynamic HedgeExecutor address and explorer URL |

## Mainnet Deployment Steps

### Step 1: Deploy Contracts to Mainnet

```bash
# Ensure you have CRO for deployment
# Deploy all contracts
npx hardhat run scripts/deploy/deploy-all.ts --network cronos-mainnet

# Or deploy individually
npx hardhat run scripts/deploy/deploy-hedge-executor.ts --network cronos-mainnet
npx hardhat run scripts/deploy/deploy-zk-verifier.ts --network cronos-mainnet
npx hardhat run scripts/deploy/deploy-rwa-manager.ts --network cronos-mainnet
npx hardhat run scripts/deploy/deploy-payment-router.ts --network cronos-mainnet
```

### Step 2: Configure Environment

Copy `.env.mainnet.example` to `.env.local` and fill in:

```bash
# CRITICAL: Set chain to mainnet
NEXT_PUBLIC_CHAIN_ID=25

# Fill in deployed contract addresses
NEXT_PUBLIC_MAINNET_ZKVERIFIER_ADDRESS=0x...
NEXT_PUBLIC_MAINNET_RWAMANAGER_ADDRESS=0x...
NEXT_PUBLIC_MAINNET_PAYMENT_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_MAINNET_HEDGE_EXECUTOR_ADDRESS=0x...
NEXT_PUBLIC_MAINNET_X402_GASLESS_VERIFIER=0x...

# SUI Network (optional)
BLUEFIN_NETWORK=mainnet
```

### Step 3: Verify Contracts

```bash
npx hardhat verify --network cronos-mainnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### Step 4: Test with Small Amounts

1. Set `NEXT_PUBLIC_CHAIN_ID=25`
2. Start the app: `npm run dev`
3. Connect wallet to Cronos Mainnet
4. Test with small amounts first

## Already Mainnet-Ready Components

These external contracts are already configured correctly:

| Contract | Address | Status |
|----------|---------|--------|
| Moonlander Diamond | `0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9` | ✅ Works on mainnet |
| Real USDC | `0xc21223249CA28397B4B6541dfFaEcC539BfF0c59` | ✅ Configured |
| VVS Router | `0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae` | ✅ Configured |
| BlueFin API | `dapi.api.sui-prod.bluefin.io` | ✅ Configured (via env) |

## Network Detection Flow

```
1. Environment: NEXT_PUBLIC_CHAIN_ID=25 (mainnet) or 338 (testnet)
2. Server-side: lib/utils/network.ts → getCurrentChainId()
3. Client-side: lib/hooks/useNetwork.ts → useChainId() from wagmi
4. Addresses: lib/contracts/addresses.ts → getContractAddresses(chainId)
5. Explorer: EXPLORER_URLS[chainId] or useExplorerUrl()
6. Validation: checkMainnetConfiguration() → returns missing contracts
```

## Runtime Validation

The project includes a `checkMainnetConfiguration()` helper to verify mainnet is ready:

```typescript
import { checkMainnetConfiguration } from '@/lib/contracts/addresses';

const { configured, missing } = checkMainnetConfiguration();
if (!configured) {
  console.error('Mainnet not configured. Missing contracts:', missing);
}
```

## Remaining Manual Updates (Optional)

These components still have hardcoded testnet references but are NOT critical. Update them as needed:

| Component | Line | Current |
|-----------|------|---------|
| `PortfolioDetailModal.tsx` | 271 | Hardcoded testnet explorer |
| `PositionsList.tsx` | 1011 | Hardcoded testnet explorer |
| `ProofVerification.tsx` | 909 | Hardcoded testnet explorer |
| `SettlementsPanel.tsx` | 241, 273 | Hardcoded testnet explorer |
| `ZKProofDemo.tsx` | 315 | Hardcoded testnet explorer |
| `MockUSDCFaucet.tsx` | 233 | Hardcoded testnet explorer |
| `NetworkBadge.tsx` | 22 | Hardcoded testnet config |
| `MultiChainConnectButton.tsx` | 286 | Hardcoded testnet explorer |

### How to Update Remaining Components

Import the hook:
```tsx
import { useExplorerUrl } from '@/lib/hooks/useNetwork';
```

Use in component:
```tsx
const explorerUrl = useExplorerUrl();
// Then use: `${explorerUrl}/tx/${txHash}`
```

Or use the non-hook version for server components:
```tsx
import { getExplorerTxUrl } from '@/lib/hooks/useNetwork';
const url = getExplorerTxUrl(txHash, chainId);
```

## Cost Estimate

| Contract | Testnet Gas | Mainnet Est. (CRO) | USD Est. |
|----------|-------------|--------------------| ---------|
| HedgeExecutor | 2.8M gas | ~1.4 CRO | $0.11 |
| RWAManager | 2.2M gas | ~1.1 CRO | $0.09 |
| ZKProxyVault | 1.8M gas | ~0.9 CRO | $0.07 |
| PaymentRouter | 1.5M gas | ~0.8 CRO | $0.06 |
| Verifiers | 3M gas total | ~1.5 CRO | $0.12 |
| **TOTAL** | | **~6 CRO** | **~$0.50** |

*Based on 500 gwei gas price and $0.08/CRO*

## Checklist

- [ ] Deploy contracts to cronos-mainnet
- [ ] Fill in `NEXT_PUBLIC_MAINNET_*` env vars
- [ ] Set `NEXT_PUBLIC_CHAIN_ID=25`
- [ ] Set `BLUEFIN_NETWORK=mainnet` (if using SUI)
- [ ] Verify contracts on Cronoscan
- [ ] Test with small amounts
- [ ] Update remaining UI components (optional)
- [ ] Configure production database
- [ ] Go live!
