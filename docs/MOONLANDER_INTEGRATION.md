# Moonlander On-Chain Integration Documentation

## Overview

This document describes the integration between ZkVanguard and Moonlander perpetual futures exchange on Cronos EVM.

## Important Technical Details

### Diamond Proxy Pattern (EIP-2535)

Moonlander uses a **Diamond proxy pattern** (EIP-2535), which means:

1. The main contract at `0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9` is a proxy
2. Functions are delegated to different "facet" contracts
3. Standard ABI approaches don't work - we use **raw transaction encoding**

### Function Selectors

Verified function selectors matching the contract ABI:

| Function | Selector | Notes |
|----------|----------|-------|
| `openMarketTradeWithPythAndExtraFee` | `0x85420cc3` | Opens new position |
| `closeTrade` | `0x73b1caa3` | Closes existing position |
| `updateTradeTpAndSl` | `0x67d22d9b` | Updates TP/SL |
| `addMargin` | `0xfc05c34d` | Adds margin to position |

### Oracle Fee

Every trade requires **0.06 CRO** oracle fee sent with the transaction. This pays for Pyth price feed updates.

## Contract Addresses

### Cronos EVM (Mainnet)

| Contract | Address |
|----------|---------|
| Moonlander | `0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9` |
| MLP Token | `0xb4c70008528227e0545Db5BA4836d1466727DF13` |
| Fee Manager | `0x37888159581ac2CdeA5Fb9C3ed50265a19EDe8Dd` |
| Collateral Manager | `0x5449239f7F6992D7d13fc4E02829aC90B2bEa6D1` |
| USDC (Collateral) | `0xc21223249CA28397B4B6541dfFaEcC539BfF0c59` |

### Cronos zkEVM

| Contract | Address |
|----------|---------|
| Moonlander | `0x02ae2e56bfDF1ee4667405eE7e959CD3fE717A05` |
| MLP Token | `0xe8E4A973Bb36E1714c805F88e2eb3A89f195D04f` |

## Trading Pairs

| Index | Pair |
|-------|------|
| 0 | BTC-USD-PERP |
| 1 | ETH-USD-PERP |
| 2 | CRO-USD-PERP |
| 3 | ATOM-USD-PERP |
| 4 | DOGE-USD-PERP |
| 5 | SOL-USD-PERP |
| 6 | XRP-USD-PERP |
| 7 | LTC-USD-PERP |
| 8 | BNB-USD-PERP |
| 9 | MATIC-USD-PERP |
| 10 | AVAX-USD-PERP |
| 11 | LINK-USD-PERP |
| 12 | UNI-USD-PERP |

## Integration Architecture

### Components

1. **MoonlanderOnChainClient** (`integrations/moonlander/MoonlanderOnChainClient.ts`)
   - Uses raw transaction encoding for Diamond proxy
   - Handles USDC approval
   - Constructs correct calldata with function selectors

2. **MoonlanderClient** (`integrations/moonlander/MoonlanderClient.ts`)
   - API-based client for read operations
   - Falls back to simulated data when API unavailable

3. **PrivateHedgeService** (`lib/privacy/PrivateHedgeService.ts`)
   - Generates ZK commitments
   - Creates stealth addresses
   - Manages nullifiers

### Transaction Flow

```
User Request → Privacy Layer → Moonlander Client → Raw TX → Diamond Proxy
                    ↓
            Commitment stored
            Stealth address used
```

## Usage Example

```typescript
import { MoonlanderOnChainClient } from '@/integrations/moonlander/MoonlanderOnChainClient';
import { PAIR_INDEX } from '@/integrations/moonlander/contracts';

// Initialize client
const client = new MoonlanderOnChainClient('https://evm.cronos.org', 'CRONOS_EVM');
await client.initialize(privateKey);

// Open a trade
const result = await client.openTrade({
  pairIndex: PAIR_INDEX.BTC,
  collateralAmount: '100', // 100 USDC
  leverage: 10,            // 10x leverage
  isLong: false,           // SHORT position
  takeProfit: '90000',     // Optional TP
  stopLoss: '105000',      // Optional SL
  slippagePercent: 0.5,    // 0.5% slippage
});

console.log('Trade opened:', result.txHash);
```

## Testing

Run the integration test:

```bash
npx tsx scripts/tests/test-moonlander-onchain.ts
```

### Test Requirements

1. **CRO**: ~0.1 CRO for gas fees
2. **USDC**: Minimum 10 USDC for testing
3. **Private Key**: Set in `.env.local`

### Environment Variables

```bash
# .env.local
SERVER_WALLET_PRIVATE_KEY=0x...
EXECUTE_TRADE=true  # Enable actual trade execution
```

## Privacy Features

### Commitment Scheme

1. User's hedge details are hashed into a commitment
2. Commitment is stored on-chain before trade
3. Trade is executed from a stealth address
4. Nullifier prevents double-spending

### Stealth Addresses

- Generated deterministically from user's keys
- One-time use per trade
- Cannot be linked to main wallet

### Zero-Knowledge Proofs

- Prove ownership without revealing details
- Verify trade execution without exposing position

## Limitations

1. **Read Functions**: Diamond proxy makes direct contract reads unreliable
   - Use API for position queries
   - Track trades via events

2. **ABI Discovery**: Cannot easily get full ABI
   - Use observed function selectors
   - May need updates if contract is upgraded

3. **Oracle Dependency**: Trades require Pyth oracle
   - 0.06 CRO fee per trade
   - Oracle bots handle price updates

## Troubleshooting

### "Diamond: Function does not exist"

This error means the function selector doesn't match any facet. Solutions:
- Verify you're using the correct selector
- Check if contract was upgraded

### "Insufficient funds"

Ensure wallet has:
- CRO for gas (~0.1 CRO per trade)
- CRO for oracle fee (0.06 CRO)
- USDC for collateral

### "Execution reverted"

Common causes:
- USDC not approved for Moonlander
- Insufficient collateral
- Invalid pair index
- Leverage outside allowed range (2-1000x)

## Resources

- **Moonlander Docs**: https://docs.moonlander.trade/
- **Contract Explorer**: https://explorer.cronos.org/address/0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9
- **Diamond Standard**: https://eips.ethereum.org/EIPS/eip-2535

## Changelog

### 2026-01-18
- Initial Diamond proxy integration
- Raw transaction encoding implemented
- Function selectors discovered and documented
- Test suite created
