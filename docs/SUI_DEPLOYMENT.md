# ZkVanguard - SUI Blockchain Integration

## 🌐 Multi-Chain Architecture

ZkVanguard now supports **SUI blockchain** as an alternative to Cronos, enabling a true multi-chain RWA management platform.

| Chain | Type | Network | Status | Explorer |
|-------|------|---------|--------|----------|
| **Cronos** | EVM | Testnet (338) | ✅ Live | [explorer.cronos.org](https://explorer.cronos.org/testnet) |
| **SUI** | Move | Testnet | ✅ Deployed | [suiscan.xyz](https://suiscan.xyz/testnet) |

---

## 📦 Deployed SUI Contracts

### Package Information
| Item | Value |
|------|-------|
| **Package ID** | `0xd76a2da684743b47e64382b61004314bca46fb2dc94a286c4f1882caa0dfc1d9` |
| **Transaction** | [GpWKsg8871F7S81hPnbYgXFHZLVc5zfZtNKS7GemHsNC](https://suiscan.xyz/testnet/tx/GpWKsg8871F7S81hPnbYgXFHZLVc5zfZtNKS7GemHsNC) |
| **Modules** | `rwa_manager`, `zk_verifier`, `payment_router` |

### Shared Objects (For dApp Interaction)
| Contract | Object ID | Purpose |
|----------|-----------|---------|
| **RWAManagerState** | `0x84925d623a658bc40a5821ef74458e7f8e8f5a2971c58ec9df6fb59277a8951d` | Portfolio management |
| **ZKVerifierState** | `0x19f9c7a1ca761442180928f0efe982d414fd324948a1a092a258e8116c56213e` | ZK proof verification |
| **PaymentRouterState** | `0x08c0f37564f618162edc982d714b79dd946fbf7d387731f6c5ca3946d6cbe507` | Payment routing |

### Admin Capabilities (Owned Objects)
| Capability | Object ID |
|------------|-----------|
| **RWA AdminCap** | `0x5084205f4dedd52f9d7b6680f3ff27af1046f9e43a02b0de40b52815a91b3e37` |
| **ZK AdminCap** | `0xc75d4cb2e146dca7e4e3ab5f61a35ca47089fae87c9f37c55e6ec426535ec635` |
| **PaymentRouter AdminCap** | `0x96806d2d91e38658534d1d56269c97b9e883e6a4c5f2442bbdafefaa42503cf8` |
| **UpgradeCap** | `0xfb1edf7256ca536619883b4e70afdf4762e3b1584f77f09913381fc9753ae745` |

---

## 🚀 SUI Deployment Guide

### Prerequisites

1. **Install SUI CLI**
   ```bash
   # Windows (PowerShell)
   Invoke-WebRequest -Uri "https://github.com/MystenLabs/sui/releases/download/testnet-v1.46.0/sui-testnet-v1.46.0-windows-x86_64.zip" -OutFile sui.zip
   Expand-Archive -Path sui.zip -DestinationPath $HOME\.sui\bin
   $env:PATH += ";$HOME\.sui\bin"
   
   # Mac/Linux
   brew install sui
   # OR
   cargo install --locked --git https://github.com/MystenLabs/sui.git --branch testnet sui
   ```

2. **Configure SUI Client**
   ```bash
   sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
   sui client switch --env testnet
   ```

3. **Create Wallet & Get Testnet SUI**
   ```bash
   sui client new-address ed25519
   # Visit: https://suiexplorer.com/faucet?network=testnet
   # Or use: sui client faucet
   ```

### Deploy Contracts

```bash
cd contracts/sui

# Build
sui move build

# Deploy (requires ~0.1 SUI)
sui client publish --gas-budget 500000000

# Save the Package ID and Object IDs from output
```

### Environment Variables

Add to `.env.local`:
```env
# SUI Testnet Configuration
NEXT_PUBLIC_SUI_PACKAGE_ID=0xd76a2da684743b47e64382b61004314bca46fb2dc94a286c4f1882caa0dfc1d9
NEXT_PUBLIC_SUI_RWA_MANAGER_STATE=0x84925d623a658bc40a5821ef74458e7f8e8f5a2971c58ec9df6fb59277a8951d
NEXT_PUBLIC_SUI_ZK_VERIFIER_STATE=0x19f9c7a1ca761442180928f0efe982d414fd324948a1a092a258e8116c56213e
NEXT_PUBLIC_SUI_PAYMENT_ROUTER_STATE=0x08c0f37564f618162edc982d714b79dd946fbf7d387731f6c5ca3946d6cbe507
NEXT_PUBLIC_SUI_ADMIN_CAP=0x5084205f4dedd52f9d7b6680f3ff27af1046f9e43a02b0de40b52815a91b3e37
```

---

## 📁 Contract Architecture

### rwa_manager.move
Core portfolio management with:
- Portfolio creation and tokenization
- Multi-asset allocation tracking
- Risk tier management (LOW, MEDIUM, HIGH)
- Automated rebalancing triggers
- Deposit/withdrawal with SUI

### zk_verifier.move
Zero-knowledge proof verification:
- STARK/SNARK proof verification
- Commitment-based verification
- Proof expiry management
- On-chain audit trail

### payment_router.move
Payment routing and gas sponsorship:
- Sponsored transaction support
- Payment channel management
- Multi-recipient routing
- Fee distribution

---

## 🔄 Multi-Chain Integration

### Provider Setup

```tsx
// app/providers.tsx
import { MultiChainProvider } from './multi-chain-providers';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MultiChainProvider>
      {children}
    </MultiChainProvider>
  );
}
```

### Using Chain Selector

```tsx
import { ChainSelector } from '@/components/ChainSelector';
import { useActiveChain } from '@/lib/hooks/useActiveChain';

function MyComponent() {
  const { chainType, isEVM, isSUI } = useActiveChain();
  
  return (
    <div>
      <ChainSelector />
      {isEVM && <EVMComponent />}
      {isSUI && <SUIComponent />}
    </div>
  );
}
```

### SUI Contract Hooks

```tsx
import { useCreatePortfolio, useVerifyProof } from '@/lib/contracts/suiHooks';

function PortfolioManager() {
  const createPortfolio = useCreatePortfolio();
  const verifyProof = useVerifyProof();
  
  const handleCreate = async () => {
    await createPortfolio.mutateAsync({
      name: 'My Portfolio',
      initialDeposit: 1_000_000_000, // 1 SUI
      riskTier: 1, // MEDIUM
    });
  };
}
```

---

## 🔐 Security Considerations

### SUI-Specific
1. **Object Ownership**: Admin capabilities are owned objects - protect private keys
2. **Shared Objects**: State objects are shared - anyone can read, only authorized can write
3. **Gas Sponsorship**: Payment router can sponsor transactions for users
4. **Upgrade Cap**: Keep upgrade capability secure for contract upgrades

### Multi-Chain
1. **Chain Verification**: Always verify which chain user is connected to
2. **Address Format**: SUI addresses (0x...) differ from EVM addresses
3. **Transaction Signing**: Different signing methods for EVM vs SUI wallets

---

## 📊 Gas Costs

| Operation | Estimated Cost (MIST) | SUI Equivalent |
|-----------|----------------------|----------------|
| Package Deploy | ~100,000,000 | ~0.1 SUI |
| Create Portfolio | ~5,000,000 | ~0.005 SUI |
| Deposit | ~3,000,000 | ~0.003 SUI |
| Verify Proof | ~2,000,000 | ~0.002 SUI |
| Rebalance | ~10,000,000 | ~0.01 SUI |

---

## 🔗 Useful Links

- **SUI Documentation**: https://docs.sui.io
- **Move Language**: https://move-language.github.io/move
- **SUI Explorer**: https://suiscan.xyz/testnet
- **Faucet**: https://suiexplorer.com/faucet?network=testnet
- **Package Explorer**: https://suiscan.xyz/testnet/object/0xd76a2da684743b47e64382b61004314bca46fb2dc94a286c4f1882caa0dfc1d9

---

## 🛠️ Troubleshooting

### Build Errors
```bash
# Update dependencies
sui move build --fetch-deps-only

# Clean and rebuild
rm -rf build/
sui move build
```

### Version Mismatch
```bash
# Check versions
sui --version
sui client envs

# Update Move.toml to match CLI version
[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.46.0" }
```

### Insufficient Gas
```bash
# Check balance
sui client gas

# Request more from faucet
sui client faucet
```
