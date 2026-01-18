# ZkVanguard Privacy-Preserving Hedge Architecture

## Overview

ZkVanguard implements a **privacy-preserving on-chain hedge system** that allows users to execute hedges on Moonlander perpetuals while keeping their portfolio and position details completely private.

## The Problem

When executing hedges on a public blockchain (like Cronos), anyone can see:
- Your wallet address
- What asset you're hedging
- Position size and direction
- Entry and exit prices
- Your PnL

**This exposes your investment strategy to the world.**

## Our Solution: ZK-Protected Private Hedging

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PRIVACY ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   USER'S PRIVATE DATA                  ON-CHAIN (PUBLIC)            │
│   ─────────────────                    ──────────────────           │
│                                                                     │
│   ┌─────────────────┐                  ┌─────────────────┐          │
│   │ Asset: BTC      │                  │ Commitment:     │          │
│   │ Side: SHORT     │   ──hash──►      │ 0x7a3f...c91    │          │
│   │ Size: 0.5       │                  │                 │          │
│   │ Entry: $95,000  │                  │ (reveals NOTHING)│         │
│   │ Salt: random    │                  └─────────────────┘          │
│   └─────────────────┘                                               │
│                                                                     │
│   Your Main Wallet                     Stealth Address              │
│   ─────────────────                    ─────────────────            │
│   ┌─────────────────┐                  ┌─────────────────┐          │
│   │ 0xYour...Wallet │   ──derive──►    │ 0xStealth123    │          │
│   │                 │                  │ (unlinkable)    │          │
│   └─────────────────┘                  └─────────────────┘          │
│                                                                     │
│   ZK Proof verifies hedge is valid WITHOUT revealing any details    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Privacy Components

### 1. Commitment Scheme

```typescript
// What we store on-chain:
commitmentHash = SHA256(asset || side || size || entryPrice || salt)

// Example:
Input: { asset: "BTC", side: "SHORT", size: 0.5, entryPrice: 95000, salt: "random123..." }
Output: "0x7a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0c91"
```

**What's public:** Just the hash (meaningless without the pre-image)  
**What's private:** Everything about your hedge

### 2. Stealth Addresses

Each hedge uses a **one-time stealth address** that cannot be linked to your main wallet:

```
Your Wallet (0xAbc...123) ──ECDH──► Stealth Address (0xXyz...789)
                                          │
                                          ▼
                                   Executes hedge
                                   (No link to you!)
```

- Generated using Elliptic Curve Diffie-Hellman (ECDH)
- Each hedge gets a fresh address
- Blockchain observers cannot connect stealth → main wallet

### 3. ZK Proofs

Our ZK-STARK system generates proofs that verify:
- ✅ A valid hedge exists
- ✅ Collateral requirements are met
- ✅ Settlement is correct

**Without revealing:**
- ❌ Asset being hedged
- ❌ Position size
- ❌ Direction (long/short)
- ❌ Entry/exit prices

### 4. Batch Aggregation

Hedges are batched hourly before execution:

```
Hour 1: [Commitment A, Commitment B, Commitment C, ...]
           ↓
        Aggregated Execution
           ↓
        Batch Merkle Root stored on-chain
```

This obscures:
- Individual trade timing
- Per-trade amounts
- Trading patterns

## How It Works

### Creating a Private Hedge

```typescript
// API Call
POST /api/agents/hedging/execute
{
  "asset": "BTC",
  "side": "SHORT",
  "notionalValue": 10000,
  "leverage": 5,
  "privateMode": true,      // ← Enable privacy
  "privacyLevel": "maximum" // ← Full ZK protection
}

// Response
{
  "success": true,
  "commitmentHash": "0x7a3f...",      // Safe to share
  "stealthAddress": "0xStealth...",   // One-time address
  "zkProofGenerated": true,
  "market": "BTC-USD-PERP",
  "privateMode": true
}
```

### What Gets Stored Where

| Data | Location | Who Can See |
|------|----------|-------------|
| Commitment Hash | On-chain (Cronos) | Everyone (but meaningless) |
| Stealth Address | On-chain (Cronos) | Everyone (but unlinkable) |
| Nullifier | On-chain (Cronos) | Everyone (prevents double-spend) |
| Encrypted Hedge Details | Local DB | Only you (with your key) |
| Actual Asset/Size/Price | Nowhere on-chain | Nobody |

## Smart Contract: ZKHedgeCommitment

```solidity
// Stores privacy-preserving hedge commitments
contract ZKHedgeCommitment {
    
    // Store commitment without revealing hedge details
    function storeCommitment(
        bytes32 commitmentHash,  // H(asset||side||size||salt)
        bytes32 nullifier,       // Prevents double-settlement
        bytes32 merkleRoot       // For batch verification
    ) external;
    
    // Settle with ZK proof (no details revealed)
    function settleHedgeWithProof(
        bytes32 commitmentHash,
        bytes calldata zkProof
    ) external;
    
    // Batch settle for maximum privacy
    function batchSettleHedges(
        bytes32[] calldata commitmentHashes,
        bytes calldata aggregatedProof
    ) external;
}
```

## Privacy Levels

| Level | Features | Use Case |
|-------|----------|----------|
| **Standard** | Local encryption only | Quick trades, testing |
| **High** | + On-chain commitment + Stealth address | Regular trading |
| **Maximum** | + ZK proof + Batch aggregation | Sensitive positions |

## Integration with Moonlander

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   ZkVanguard    │───►│  ZKHedgeCommit   │───►│   Moonlander    │
│                 │    │  (Commitments)   │    │   (Perpetuals)  │
│  - Portfolio    │    │                  │    │                 │
│  - Risk Mgmt    │    │  Stores:         │    │  Executes:      │
│  - Hedging      │    │  - Commitment    │    │  - Via Relayer  │
│                 │    │  - Nullifier     │    │  - Aggregated   │
└─────────────────┘    │  - Stealth Addr  │    │  - Anonymous    │
                       └──────────────────┘    └─────────────────┘
```

### Flow:

1. **User creates hedge** → ZkVanguard generates commitment
2. **Commitment stored** → On-chain via stealth address
3. **Relayer executes** → Aggregated trade on Moonlander
4. **Settlement** → ZK proof verifies without revealing details

## API Endpoints

### Execute Private Hedge
```
POST /api/agents/hedging/execute
POST /api/agents/hedging/private-execute
```

### Get Privacy Info
```
GET /api/agents/hedging/private-execute
```

### Verify ZK Proof
```
POST /api/agents/hedging/verify-proof
```

## Security Guarantees

1. **Computational Privacy**: Commitments are SHA-256 hashes - computationally infeasible to reverse
2. **Unlinkability**: Stealth addresses use ECDH - cannot link to main wallet
3. **Zero-Knowledge**: ZK-STARK proofs reveal nothing except validity
4. **Forward Secrecy**: Each hedge uses fresh randomness
5. **Quantum Resistance**: Using NIST P-521 certified curve (521-bit security)

## What Observers Can See vs. Can't See

### ✅ Visible (But Useless):
- A commitment hash exists
- A stealth address made a transaction
- Some value was locked as collateral
- A hedge was settled

### ❌ Hidden (Protected):
- Your wallet address
- What asset you hedged
- Position size
- Direction (long/short)
- Entry/exit prices
- Profit or loss
- Your trading strategy
- Your portfolio composition

## Conclusion

ZkVanguard's privacy architecture ensures that while hedges execute on-chain for transparency and security, your **investment strategy, positions, and PnL remain completely private**. 

The combination of commitment schemes, stealth addresses, ZK proofs, and batch aggregation creates a robust privacy layer that protects against both casual observers and sophisticated chain analysis.

---

*For more details, see:*
- [lib/services/PrivateHedgeService.ts](../lib/services/PrivateHedgeService.ts) - TypeScript implementation
- [contracts/core/ZKHedgeCommitment.sol](../contracts/core/ZKHedgeCommitment.sol) - Smart contract
- [zkp/core/zk_system.py](../zkp/core/zk_system.py) - ZK-STARK implementation
