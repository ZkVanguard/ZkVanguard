# ZK Proof Verification Guide

## Overview

Your transaction `0xf502c2c8001751d0a828ea431aa32c0c2773370ebb2b47ec23dae456414fa5d8` successfully executed on Cronos Testnet! This guide explains how to verify ZK proofs both on-chain and off-chain.

## Transaction Details

- **TX Hash**: `0xf502c2c8001751d0a828ea431aa32c0c2773370ebb2b47ec23dae456414fa5d8`
- **Explorer**: https://explorer.cronos.org/testnet/tx/0xf502c2c8001751d0a828ea431aa32c0c2773370ebb2b47ec23dae456414fa5d8
- **Status**: ✅ SUCCESS
- **Gas Used**: 148,045
- **Block**: 62,943,360

## Verification Methods

### 1. Off-Chain Verification (Python Backend)

Verify proofs using the CUDA-accelerated Python backend:

```bash
# Check backend status
curl http://localhost:8000/health

# Generate a proof
curl -X POST http://localhost:8000/api/zk/generate \
  -H "Content-Type: application/json" \
  -d '{
    "proof_type": "settlement",
    "data": {
      "payments": [
        {"recipient": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb", "amount": 1000},
        {"recipient": "0x170E8232E9e18eeB1839dB1d939501994f1e272F", "amount": 2000}
      ]
    },
    "portfolio_id": 1
  }'

# Check proof status
curl http://localhost:8000/api/zk/proof/<JOB_ID>

# Verify proof off-chain
curl -X POST http://localhost:8000/api/zk/verify \
  -H "Content-Type: application/json" \
  -d '{
    "proof": { <PROOF_DATA> },
    "public_inputs": [3000, 2]
  }'
```

**Performance**: ~10-20ms with CUDA acceleration

### 2. On-Chain Verification (ZKVerifier Contract)

Verify proofs permanently on the blockchain:

**Contract Address**: `0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8`

#### Via Frontend Dashboard

1. Start the frontend:
   ```bash
   npm run dev
   ```

2. Open http://localhost:3000/dashboard

3. Connect your wallet

4. Navigate to "ZK Proof Verification" section

5. Click "Submit Proof for Verification"

6. Select proof type (settlement/risk/rebalance)

7. Click "Generate & Verify"

8. Sign the transaction in your wallet

9. Wait for confirmation

10. View transaction on explorer

#### Via Hardhat Script

```bash
# Verify a specific transaction
node scripts/verify-onchain-proof.js <TX_HASH>
```

#### Via Smart Contract Direct Call

```solidity
// Contract: ZKVerifier
// Function: verifyProof(string proofType, uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] publicSignals)

// Example parameters:
// proofType: "settlement"
// a: [trace_commitment_x, trace_commitment_y]
// b: [[fri_commitment_00, fri_commitment_01], [fri_commitment_10, fri_commitment_11]]
// c: [eval_commitment_x, eval_commitment_y]
// publicSignals: [witness_value_1, witness_value_2, ...]
```

### 3. Query Verified Proofs

Read proof data from the blockchain:

```javascript
const { ethers } = require('ethers');

// Connect to Cronos Testnet
const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org');
const zkVerifierAddress = '0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8';

const ABI = [
  'function proofs(bytes32) view returns (bytes32 proofHash, uint256 timestamp, address submitter, bool verified, string proofType)',
  'function proofRegistry(uint256) view returns (bytes32)'
];

const zkVerifier = new ethers.Contract(zkVerifierAddress, ABI, provider);

// Get specific proof
const proofHash = '0x...';
const proofData = await zkVerifier.proofs(proofHash);
console.log('Proof verified:', proofData.verified);
console.log('Proof type:', proofData.proofType);
console.log('Timestamp:', new Date(Number(proofData.timestamp) * 1000));

// Get proof from registry
const registryIndex = 0;
const registeredProofHash = await zkVerifier.proofRegistry(registryIndex);
console.log('Proof hash:', registeredProofHash);
```

## Verification Scripts

### Test Complete Verification Flow

```bash
node scripts/test-zk-verification.js
```

This script:
1. ✅ Generates a ZK-STARK proof using Python backend
2. ✅ Verifies proof off-chain (CUDA-accelerated)
3. ✅ Shows on-chain verification instructions
4. ✅ Displays useful commands and links

### Verify Specific Transaction

```bash
node scripts/verify-onchain-proof.js 0xf502c2c8001751d0a828ea431aa32c0c2773370ebb2b47ec23dae456414fa5d8
```

This script:
- Fetches transaction details
- Parses ProofVerified events
- Shows proof metadata
- Displays verification status

## Proof Types

### Settlement Proof
Proves valid batch payment settlement:
```json
{
  "proof_type": "settlement",
  "data": {
    "payments": [
      {"recipient": "0x...", "amount": 1000, "token": "0x..."}
    ]
  }
}
```

### Risk Assessment Proof
Proves risk calculation correctness:
```json
{
  "proof_type": "risk",
  "data": {
    "portfolio_value": 100000,
    "volatility": 250,
    "value_at_risk": 5000
  }
}
```

### Rebalance Proof
Proves portfolio rebalancing logic:
```json
{
  "proof_type": "rebalance",
  "data": {
    "old_allocations": [5000, 3000, 2000],
    "new_allocations": [4000, 4000, 2000]
  }
}
```

## System Architecture

```
User Input
    ↓
Frontend (Next.js)
    ↓
Python Backend (CUDA)
    ↓
ZK-STARK Proof Generation
(AIR + FRI Protocol)
    ↓
Contract Format Conversion
    ↓
On-Chain Submission
    ↓
ZKVerifier.verifyProof()
    ↓
Permanent Blockchain Storage
```

## Verification Status Indicators

| Symbol | Meaning |
|--------|---------|
| ✅ | Verified successfully |
| ❌ | Verification failed |
| ⏳ | Verification pending |
| 🔐 | CUDA accelerated |
| 📦 | Stored on-chain |

## API Endpoints

- **Health Check**: `GET http://localhost:8000/health`
- **Statistics**: `GET http://localhost:8000/api/zk/stats`
- **Generate Proof**: `POST http://localhost:8000/api/zk/generate`
- **Check Status**: `GET http://localhost:8000/api/zk/proof/:id`
- **Verify Off-Chain**: `POST http://localhost:8000/api/zk/verify`
- **Documentation**: `GET http://localhost:8000/docs`

## Explorer Links

- **ZKVerifier Contract**: https://explorer.cronos.org/testnet/address/0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8
- **Your Transaction**: https://explorer.cronos.org/testnet/tx/0xf502c2c8001751d0a828ea431aa32c0c2773370ebb2b47ec23dae456414fa5d8
- **Cronos Testnet**: https://explorer.cronos.org/testnet

## Troubleshooting

### Backend Not Running
```bash
# Start the Python backend
cd zkp
python -m uvicorn api.server:app --host 0.0.0.0 --port 8000
```

### CUDA Not Available
The system automatically falls back to CPU if CUDA is unavailable. Performance will be slower but fully functional.

### Transaction Failed
1. Check gas limit (recommended: 300,000+)
2. Verify wallet has tCRO for gas
3. Check contract address is correct
4. Review transaction logs on explorer

### Proof Generation Timeout
- Normal generation: 10-20ms (CUDA)
- CPU fallback: 100-500ms
- If timeout: Check backend logs

## Next Steps

1. ✅ **Test Off-Chain**: Run `node scripts/test-zk-verification.js`
2. ✅ **Verify On-Chain**: Use dashboard at http://localhost:3000/dashboard
3. ✅ **Query Proofs**: Use provided scripts to read blockchain data
4. ✅ **Monitor**: Check http://localhost:8000/api/zk/stats for metrics

## Support

- **Backend API**: http://localhost:8000/docs
- **Frontend**: http://localhost:3000/dashboard
- **Explorer**: https://explorer.cronos.org/testnet
- **Contract**: 0x46A497cDa0e2eB61455B7cAD60940a563f3b7FD8
