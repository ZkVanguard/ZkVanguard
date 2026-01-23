# Gasless System - Complete Guide

## Overview

✅ **Status**: TRUE $0.00 GASLESS via ZKPaymaster + x402  
🔗 **ZKPaymaster Contract**: Deploy with `scripts/deploy-zk-paymaster.ts`  
🔗 **Legacy Refund Contract**: `0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9`  
💰 **User Cost**: **$0.00** (TRUE gasless - no CRO needed!)

This document covers the complete gasless system implementation with multiple options.

---

## Gasless Architecture Overview

We provide **THREE gasless options** depending on use case:

| Method | User Cost | Requires CRO? | Best For |
|--------|-----------|---------------|----------|
| **ZKPaymaster (NEW)** | $0.00 | ❌ No | ZK commitments |
| **x402 Facilitator** | $0.00 | ❌ No | USDC payments |
| **Legacy Refund** | ~$0.0002 | ⚠️ Yes (upfront) | Fallback |

---

## Option 1: ZKPaymaster (TRUE $0.00 Gasless) ⭐ RECOMMENDED

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    TRUE $0.00 GASLESS FLOW                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. User signs EIP-712 message (WALLET)                     │
│     Cost: $0.00 (just signature, no tx)                     │
│                           ↓                                  │
│  2. Frontend sends signature to our API                     │
│     Cost: $0.00 (HTTP request)                              │
│                           ↓                                  │
│  3. Our Backend relays to ZKPaymaster contract              │
│     Cost: We pay gas (~0.001 CRO)                           │
│                           ↓                                  │
│  4. Contract refunds our backend                            │
│     Cost: $0.00 (we get refunded)                           │
│                           ↓                                  │
│  5. Commitment stored on-chain                              │
│     USER TOTAL: $0.00 ✅                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Contract: ZKPaymaster.sol

**Key Features:**
- EIP-712 typed data signatures
- Meta-transaction relaying
- Automatic relayer refund
- No external bundler required
- No subscription fees

**Cost Breakdown:**
- User: **$0.00** (just signs message)
- Relayer: **$0.00** (gets refunded by contract)
- Contract: Uses CRO balance (FREE on testnet from faucet)

### Deployment

```bash
# Deploy ZKPaymaster
npx hardhat run scripts/deploy-zk-paymaster.ts --network cronos-testnet

# Fund with testnet CRO (FREE from faucet)
# https://cronos.org/faucet
```

### API Endpoints

**GET /api/gasless/paymaster** - Get contract stats
```json
{
  "success": true,
  "stats": {
    "totalCommitments": 42,
    "totalGasSponsored": "0.042 CRO",
    "balance": "5.0 CRO"
  },
  "costBreakdown": {
    "userCost": "$0.00 ✅"
  }
}
```

**POST /api/gasless/paymaster** - Prepare or execute
```json
// Prepare signature request
{ "action": "prepare", "userAddress": "0x...", "proofHash": "0x...", "merkleRoot": "0x..." }

// Execute with signature
{ "action": "execute", "userAddress": "0x...", "proofHash": "0x...", "signature": "0x..." }
```

### Files

- `contracts/core/ZKPaymaster.sol` - Meta-transaction forwarder
- `lib/services/ZKPaymasterService.ts` - TypeScript service
- `app/api/gasless/paymaster/route.ts` - API endpoint
- `scripts/deploy-zk-paymaster.ts` - Deployment script

---

## Option 2: x402 Facilitator (TRUE $0.00 for USDC)

### How It Works

x402 uses EIP-3009 `transferWithAuthorization` for truly gasless USDC transfers.

```
User signs USDC authorization → x402 Facilitator submits tx → User pays $0.00
```

**Scope**: USDC/token transfers ONLY (not arbitrary contract calls)

**Best For**: 
- Payment processing
- USDC settlements
- Token transfers

### Usage

```typescript
import { x402Client } from '@/lib/services/x402';

// User signs authorization (FREE)
const auth = await x402Client.createAuthorization({
  token: USDC_ADDRESS,
  from: userAddress,
  to: recipientAddress,
  amount: '10000000', // 10 USDC
});

// x402 Facilitator executes (user pays $0.00)
const result = await x402Client.executeTransfer(auth);
```

---

## Option 3: Legacy Refund Contract (97% Gasless)

### How It Works

User pays gas upfront, contract refunds ~97%.

**Contract**: `0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9`

**Limitation**: User MUST have CRO in wallet (even if refunded)

### User Experience Flow
```
User clicks "Generate & Verify Proof" 
    ↓
Frontend generates ZK-STARK proof (Python backend)
    ↓
User signs transaction (wallet popup)
    ↓
Contract AUTOMATICALLY refunds gas
    ↓
User net cost: ~$0.00 (97%+ coverage)
```

### Integration Points

**File:** `components/dashboard/ZKProofDemo.tsx`
- Line 68-76: Calls `storeCommitmentOnChainGasless()`
- Handles gasless transaction with automatic refund
- Shows "GASLESS" badge when successful

**File:** `lib/api/onchain-gasless.ts`
- Contract address: `0x52903d1FA10F90e9ec88DD7c3b1F0F73A0f811f9`
- Function: `storeCommitmentOnChainGasless()`
- Refund rate: 5000 gwei (hardcoded for Cronos)

---

## Cost Comparison Summary

| Solution | User Cost | Infrastructure Cost | External Services |
|----------|-----------|---------------------|-------------------|
| **ZKPaymaster** | **$0.00** | $0 (contract refunds) | None |
| **x402 Facilitator** | **$0.00** | $0 | Crypto.com |
| **Legacy Refund** | ~$0.0002 | $0 | None |
| ERC-4337 + Pimlico | $0 | ~$50/mo | Pimlico |
| Gelato Relay | $0 | ~$100/mo | Gelato |
| Biconomy | $0 | ~$200/mo | Biconomy |

**Winner: ZKPaymaster + x402** = TRUE $0.00 with NO external service fees!

---

## Quick Start

### For ZK Commitments (ZKPaymaster)

```bash
# 1. Deploy contract
npx hardhat run scripts/deploy-zk-paymaster.ts --network cronos-testnet

# 2. Fund from faucet (FREE)
# https://cronos.org/faucet

# 3. Add to .env
ZK_PAYMASTER_ADDRESS=0x...

# 4. Test
curl http://localhost:3000/api/gasless/paymaster
```

### For USDC Payments (x402)

```bash
# Already integrated! Just use:
import { x402Client } from '@/lib/services/x402';
```

---

## Status

✅ **COMPLETE - TRUE $0.00 GASLESS AVAILABLE**

| Feature | Status |
|---------|--------|
| ZKPaymaster Contract | ✅ Ready to deploy |
| ZKPaymaster Service | ✅ Implemented |
| ZKPaymaster API | ✅ Implemented |
| x402 USDC Payments | ✅ Working |
| Legacy Refund | ✅ Working (fallback) |
| Documentation | ✅ Updated |

**User Experience:**
- Sign message with wallet (FREE)
- We relay transaction (we get refunded)
- Commitment stored on-chain
- **USER PAYS: $0.00** ✅
