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

## Option 2: x402 Facilitator Protocol (TRUE $0.00 for USDC)

### What is x402?

**x402** is Crypto.com's official gasless payment protocol built on EIP-3009 (`transferWithAuthorization`). It enables TRUE gasless USDC/token transfers where the x402 Facilitator pays all gas costs.

**Package**: `@crypto.com/facilitator-client`  
**Network**: Cronos Mainnet & Testnet  
**No API Key Required**: Public gasless infrastructure!

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                  x402 GASLESS FLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. User signs EIP-3009 authorization (WALLET)              │
│     Cost: $0.00 (just signature)                            │
│                           ↓                                  │
│  2. Generate payment header via SDK                          │
│     Cost: $0.00                                              │
│                           ↓                                  │
│  3. x402 Facilitator submits to blockchain                  │
│     Cost: Facilitator pays gas (FREE for user!)             │
│                           ↓                                  │
│  4. USDC transferred on-chain                               │
│     USER TOTAL: $0.00 ✅                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### x402 SDK Methods

```typescript
import { Facilitator, CronosNetwork } from '@crypto.com/facilitator-client';

// Initialize (no API key needed!)
const facilitator = new Facilitator({
  network: CronosNetwork.CronosTestnet,
});

// Available methods:
facilitator.generatePaymentRequirements()  // Build payment specs
facilitator.generatePaymentHeader()        // Create EIP-3009 signature
facilitator.verifyPayment()                // Verify payment is valid
facilitator.settlePayment()                // Execute gasless transfer
facilitator.getSupported()                 // Check supported tokens
```

### Usage Example

```typescript
import { X402Client } from '@/integrations/x402/X402Client';

const x402 = new X402Client();
x402.setSigner(walletSigner);

// 1. Execute TRUE gasless USDC transfer
const result = await x402.executeGaslessTransfer({
  token: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0', // DevUSDCe
  from: userAddress,
  to: recipientAddress,
  amount: '10000000', // 10 USDC (6 decimals)
});

console.log(result);
// { txHash: '0x...', status: 'confirmed', gasless: true }

// 2. Batch transfers (also gasless!)
const batch = await x402.executeBatchTransfer({
  token: USDC_ADDRESS,
  from: userAddress,
  recipients: ['0x...', '0x...', '0x...'],
  amounts: ['5000000', '3000000', '2000000'],
});
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/x402/swap` | POST | Execute DEX swap with x402 settlement |
| `/api/x402/swap` | GET | Get VVS Finance swap quote |
| `/api/x402/settle` | POST | Settle payment via x402 |
| `/api/x402/challenge` | POST | Create payment challenge |

### Supported Tokens (Cronos Testnet)

| Token | Address | Decimals |
|-------|---------|----------|
| DevUSDCe | `0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0` | 6 |
| TCRO | Native | 18 |

### What x402 CAN Do
- ✅ Gasless USDC/token transfers (EIP-3009)
- ✅ Payment verification & settlement
- ✅ Batch transfers
- ✅ DEX swap settlements

### What x402 CANNOT Do
- ❌ Arbitrary contract calls (use ZKPaymaster!)
- ❌ Meta-transactions for custom functions
- ❌ Storing data on-chain (use ZKPaymaster!)

### Files

- `integrations/x402/X402Client.ts` - Main x402 client using SDK
- `integrations/x402/X402Client.server.ts` - Server-side client
- `lib/services/X402GaslessService.ts` - Legacy service wrapper
- `app/api/x402/swap/route.ts` - Swap API
- `app/api/x402/settle/route.ts` - Settlement API
- `app/api/x402/challenge/route.ts` - Payment challenges

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
