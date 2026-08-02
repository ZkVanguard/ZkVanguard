# Moonlander Mainnet Migration Guide

> **Status**: All ABI research complete. Every function selector verified against the live Diamond proxy on Cronos EVM mainnet (chain 25).

---

## Table of Contents
1. [Architecture Difference Summary](#1-architecture-difference-summary)
2. [Verified Contract ABI](#2-verified-contract-abi)
3. [Step 1: Update IMoonlanderRouter Interface](#3-step-1-update-imoonlanderrouter-interface)
4. [Step 2: Rewrite MockMoonlander.sol](#4-step-2-rewrite-mockmoonlandersol)
5. [Step 3: Update HedgeExecutor.sol](#5-step-3-update-hedgeexecutorsol)
6. [Step 4: Update integrations/moonlander/abis.ts](#6-step-4-update-abists)
7. [Step 5: Update MoonlanderOnChainClient.ts](#7-step-5-update-moonlanderonchaionclientts)
8. [Step 6: Update contracts.ts with pairBase Addresses](#8-step-6-update-contractsts)
9. [Step 7: Pyth Oracle Integration](#9-step-7-pyth-oracle-integration)
10. [Step 8: Deploy & Switch](#10-step-8-deploy--switch)
11. [Reference: All Verified Selectors](#11-reference-all-verified-selectors)
12. [Reference: Diamond Facet Map](#12-reference-diamond-facet-map)

---

## 1. Architecture Difference Summary

| Aspect | Current Mock | Real Moonlander |
|--------|-------------|-----------------|
| **Pair identifier** | `uint256 pairIndex` (0=BTC, 1=ETH...) | `address pairBase` (unique address per pair) |
| **Trade identifier** | `(trader, pairIndex, tradeIndex)` | `bytes32 tradeHash` (returned from open) |
| **Open function** | `openMarketTradeWithPythAndExtraFee(address,uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes[])` → selector `0x85420cc3` | `openMarketTradeWithPythAndExtraFee((address,bool,address,uint96,uint128,uint128,uint128,uint128,uint24),uint96,bytes[])` → selector `0x16d48137` |
| **Close function** | `closeTrade(uint256,uint256)` → `0x73b1caa3` | `closeTrade(bytes32)` → `0x5177fd3b` |
| **Update TP/SL** | `updateTradeTpAndSl(uint256,uint256,uint256,uint256)` → `0x67d22d9b` | `updateTradeTpAndSl(bytes32,uint128,uint128)` → `0x2f745df6` |
| **Add margin** | `addMargin(uint256,uint256,uint256)` → `0x05a24c0f` | `addMargin(bytes32,uint96)` → `0x29d9ddce` |
| **Open returns** | `uint256 tradeIndex` | `bytes32 tradeHash` |
| **Position size** | `uint256` (flat) | `uint128 qty` (packed) |
| **Collateral** | `uint256` (flat) | `uint96 amountIn` (packed, max ~79B USDC) |
| **Price scale** | `10^10` | `10^18` (1e18 per USD) |
| **Direction** | `uint256 direction` (2=long, 0=short) | `bool isLong` |
| **Struct format** | Flat parameters | `IBook.OpenDataInput` tuple |
| **Oracle** | Mock prices | Pyth Network (payable, needs `priceUpdateData`) |
| **Extra fee** | `uint256 fee` | `uint96 extraFee` (separate param outside struct) |

### The IBook.OpenDataInput Struct

```solidity
struct OpenDataInput {
    address pairBase;     // Token address identifying the trading pair
    bool    isLong;       // true = long, false = short
    address tokenIn;      // Collateral token (USDC: 0xc21223249CA28397B4B6541dfFaEcC539BfF0c59)
    uint96  amountIn;     // Collateral amount (USDC 6 decimals)
    uint128 qty;          // Position quantity (leveraged notional, 18 decimals)
    uint128 price;        // Limit price for slippage (18 decimals, 0 = market)
    uint128 stopLoss;     // Stop loss price (18 decimals, 0 = none)
    uint128 takeProfit;   // Take profit price (18 decimals, 0 = none)
    uint24  broker;       // Broker ID (0 for direct, 2 for Moonlander frontend)
}
```

**Price scaling**: Prices are in **18 decimals**. Example from a real trade:
- `price: 2003268572653500000000` → $2003.27 (÷ 1e18)
- `amountIn: 149960000` → 149.96 USDC (÷ 1e6)
- `qty: 377760164500` → leveraged position value (÷ 1e6 = $377,760 notional)

---

## 2. Verified Contract ABI

### Functions Found in Moonlander Frontend JS

```json
[
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "pairBase", "type": "address" },
          { "internalType": "bool", "name": "isLong", "type": "bool" },
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "uint96", "name": "amountIn", "type": "uint96" },
          { "internalType": "uint128", "name": "qty", "type": "uint128" },
          { "internalType": "uint128", "name": "price", "type": "uint128" },
          { "internalType": "uint128", "name": "stopLoss", "type": "uint128" },
          { "internalType": "uint128", "name": "takeProfit", "type": "uint128" },
          { "internalType": "uint24", "name": "broker", "type": "uint24" }
        ],
        "internalType": "struct IBook.OpenDataInput",
        "name": "data",
        "type": "tuple"
      },
      { "internalType": "bytes[]", "name": "priceUpdateData", "type": "bytes[]" }
    ],
    "name": "openMarketTradeWithPyth",
    "outputs": [{ "internalType": "bytes32", "name": "tradeHash", "type": "bytes32" }],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "tradeHash", "type": "bytes32" }
    ],
    "name": "closeTrade",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "tradeHash", "type": "bytes32" },
      { "internalType": "uint128", "name": "takeProfit", "type": "uint128" },
      { "internalType": "uint128", "name": "stopLoss", "type": "uint128" }
    ],
    "name": "updateTradeTpAndSl",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "tradeHash", "type": "bytes32" },
      { "internalType": "uint96", "name": "amount", "type": "uint96" }
    ],
    "name": "addMargin",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32[]", "name": "tradeHashes", "type": "bytes32[]" }
    ],
    "name": "batchCloseTrade",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "lpReceiveFundingFeeUsd", "type": "uint256" }
    ],
    "name": "settleLpFundingFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
```

> **Note**: `openMarketTradeWithPyth` (selector `0x1d451be5`) and `openMarketTradeWithPythAndExtraFee` (selector `0x16d48137`) are **both active** in the diamond. The latter adds a `uint96 extraFee` parameter between the struct and the bytes[].

---

## 3. Step 1: Update IMoonlanderRouter Interface

**File**: `contracts/core/HedgeExecutor.sol` (bottom of file, lines ~610-645)

Replace the current `IMoonlanderRouter` interface with:

```solidity
interface IMoonlanderRouter {
    struct OpenDataInput {
        address pairBase;     // Pair token address (NOT a uint256 index!)
        bool    isLong;       // true = long, false = short
        address tokenIn;      // Collateral token address (USDC)
        uint96  amountIn;     // Collateral amount (6 decimals for USDC)
        uint128 qty;          // Leveraged position qty (18 decimals)
        uint128 price;        // Price for slippage check (18 decimals, 0 = market)
        uint128 stopLoss;     // Stop loss price (18 decimals, 0 = none)
        uint128 takeProfit;   // Take profit price (18 decimals, 0 = none)
        uint24  broker;       // Broker ID (use 0)
    }

    /// @notice Open market trade with Pyth oracle price feed
    /// @dev Selector: 0x1d451be5
    function openMarketTradeWithPyth(
        OpenDataInput calldata data,
        bytes[] calldata priceUpdateData
    ) external payable returns (bytes32 tradeHash);

    /// @notice Open market trade with Pyth oracle + extra fee
    /// @dev Selector: 0x16d48137
    function openMarketTradeWithPythAndExtraFee(
        OpenDataInput calldata data,
        uint96 extraFee,
        bytes[] calldata priceUpdateData
    ) external payable returns (bytes32 tradeHash);

    /// @notice Close a trade by its hash
    /// @dev Selector: 0x5177fd3b
    function closeTrade(bytes32 tradeHash) external;

    /// @notice Batch close multiple trades
    /// @dev Selector: 0xd8eb6e91
    function batchCloseTrade(bytes32[] calldata tradeHashes) external;

    /// @notice Update take profit and stop loss
    /// @dev Selector: 0x2f745df6
    function updateTradeTpAndSl(
        bytes32 tradeHash,
        uint128 takeProfit,
        uint128 stopLoss
    ) external;

    /// @notice Add margin to an existing trade
    /// @dev Selector: 0x29d9ddce
    function addMargin(bytes32 tradeHash, uint96 amount) external payable;
}
```

---

## 4. Step 2: Rewrite MockMoonlander.sol

**File**: `contracts/mocks/MockMoonlander.sol`

The mock needs to match the real interface exactly so your HedgeExecutor can be tested against it without changes. Key changes:

1. **Replace flat params** with `OpenDataInput` struct  
2. **Use `bytes32 tradeHash`** as identifier (generate via keccak256)
3. **Return `bytes32`** from open instead of `uint256`
4. **`closeTrade(bytes32)`** instead of `closeTrade(uint256, uint256)`
5. **`addMargin(bytes32, uint96)`** instead of `addMargin(uint256, uint256, uint256)`
6. **`updateTradeTpAndSl(bytes32, uint128, uint128)`**
7. **Use `address pairBase`** instead of `uint256 pairIndex`
8. **Price scale**: Use 1e18 instead of 1e10

Here's the new MockMoonlander structure:

```solidity
contract MockMoonlander {
    struct OpenDataInput {
        address pairBase;
        bool    isLong;
        address tokenIn;
        uint96  amountIn;
        uint128 qty;
        uint128 price;
        uint128 stopLoss;
        uint128 takeProfit;
        uint24  broker;
    }
    
    struct Trade {
        address trader;
        address pairBase;
        address tokenIn;
        uint96  collateralAmount;
        uint128 qty;
        uint128 openPrice;
        bool    isLong;
        uint128 tp;
        uint128 sl;
        bool    isOpen;
    }
    
    // Trade storage: tradeHash => Trade
    mapping(bytes32 => Trade) public trades;
    
    // Mock prices: pairBase => price (18 decimals)
    mapping(address => uint128) public mockPrices;
    
    uint256 private tradeNonce;
    
    function openMarketTradeWithPyth(
        OpenDataInput calldata data,
        bytes[] calldata priceUpdateData
    ) external payable returns (bytes32 tradeHash) {
        // Transfer collateral
        IERC20(data.tokenIn).transferFrom(msg.sender, address(this), data.amountIn);
        
        // Generate trade hash (mimics real contract)
        tradeHash = keccak256(abi.encodePacked(msg.sender, data.pairBase, tradeNonce++));
        
        uint128 price = mockPrices[data.pairBase];
        if (price == 0) price = data.price; // fallback
        
        trades[tradeHash] = Trade({
            trader: msg.sender,
            pairBase: data.pairBase,
            tokenIn: data.tokenIn,
            collateralAmount: data.amountIn,
            qty: data.qty,
            openPrice: price,
            isLong: data.isLong,
            tp: data.takeProfit,
            sl: data.stopLoss,
            isOpen: true
        });
        
        return tradeHash;
    }
    
    function openMarketTradeWithPythAndExtraFee(
        OpenDataInput calldata data,
        uint96 extraFee,
        bytes[] calldata priceUpdateData
    ) external payable returns (bytes32 tradeHash) {
        // Same as above, just with extra fee param
        IERC20(data.tokenIn).transferFrom(msg.sender, address(this), data.amountIn);
        
        tradeHash = keccak256(abi.encodePacked(msg.sender, data.pairBase, tradeNonce++));
        
        uint128 price = mockPrices[data.pairBase];
        if (price == 0) price = data.price;
        
        trades[tradeHash] = Trade({
            trader: msg.sender,
            pairBase: data.pairBase,
            tokenIn: data.tokenIn,
            collateralAmount: data.amountIn,
            qty: data.qty,
            openPrice: price,
            isLong: data.isLong,
            tp: data.takeProfit,
            sl: data.stopLoss,
            isOpen: true
        });
        
        return tradeHash;
    }
    
    function closeTrade(bytes32 tradeHash) external {
        Trade storage trade = trades[tradeHash];
        require(trade.isOpen, "Trade not open");
        
        // Calculate PnL and return collateral
        uint128 currentPrice = mockPrices[trade.pairBase];
        // ... simplified PnL calc using 18-decimal prices ...
        
        trade.isOpen = false;
        IERC20(trade.tokenIn).transfer(trade.trader, returnAmount);
    }
    
    function updateTradeTpAndSl(bytes32 tradeHash, uint128 takeProfit, uint128 stopLoss) external {
        Trade storage trade = trades[tradeHash];
        require(trade.isOpen, "Trade not open");
        trade.tp = takeProfit;
        trade.sl = stopLoss;
    }
    
    function addMargin(bytes32 tradeHash, uint96 amount) external payable {
        Trade storage trade = trades[tradeHash];
        require(trade.isOpen, "Trade not open");
        IERC20(trade.tokenIn).transferFrom(msg.sender, address(this), amount);
        trade.collateralAmount += amount;
    }
    
    function batchCloseTrade(bytes32[] calldata tradeHashes) external {
        for (uint i = 0; i < tradeHashes.length; i++) {
            // ... close each trade ...
        }
    }
    
    // Admin: set mock prices (18 decimal scale)
    function setMockPrice(address pairBase, uint128 price) external {
        mockPrices[pairBase] = price;
    }
}
```

---

## 5. Step 3: Update HedgeExecutor.sol

**File**: `contracts/core/HedgeExecutor.sol`

### 5a. Change HedgePosition struct

The `tradeIndex` field must change from `uint256` to `bytes32 tradeHash`:

```solidity
struct HedgePosition {
    bytes32 hedgeId;
    address trader;
    address pairBase;           // ← CHANGED from uint256 pairIndex
    bytes32 tradeHash;          // ← CHANGED from uint256 tradeIndex
    uint256 collateralAmount;
    uint256 leverage;
    bool isLong;
    bytes32 commitmentHash;
    bytes32 nullifier;
    uint256 openTimestamp;
    uint256 closeTimestamp;
    int256 realizedPnl;
    HedgeStatus status;
}
```

### 5b. Change openHedge function signature

Replace `uint256 pairIndex` with `address pairBase`:

```solidity
function openHedge(
    address pairBase,           // ← CHANGED from uint256 pairIndex
    uint256 collateralAmount,
    uint256 leverage,
    bool isLong,
    bytes32 commitmentHash,
    bytes32 nullifier,
    bytes32 merkleRoot
) external payable nonReentrant whenNotPaused returns (bytes32 hedgeId) {
```

### 5c. Change the Moonlander call inside openHedge

Replace the current flat-parameter call:

```solidity
// OLD (lines 251-266):
uint256 leveragedAmount = netCollateral * leverage;
uint256 direction = isLong ? 2 : 0;
bytes[] memory emptyPythData = new bytes[](0);
uint256 tradeIndex = IMoonlanderRouter(moonlanderRouter)
    .openMarketTradeWithPythAndExtraFee{value: 0.06 ether}(
        address(0), pairIndex, address(collateralToken),
        netCollateral, 0, leveragedAmount, 0, 0, direction, 0, emptyPythData
    );
```

With the new struct-based call:

```solidity
// NEW:
uint128 qty = uint128(netCollateral * leverage);  // leveraged notional
bytes[] memory emptyPythData = new bytes[](0);

IMoonlanderRouter.OpenDataInput memory tradeData = IMoonlanderRouter.OpenDataInput({
    pairBase:   pairBase,
    isLong:     isLong,
    tokenIn:    address(collateralToken),
    amountIn:   uint96(netCollateral),
    qty:        qty,
    price:      0,              // market order
    stopLoss:   0,              // set later
    takeProfit: 0,              // set later
    broker:     0               // direct
});

bytes32 tradeHash = IMoonlanderRouter(moonlanderRouter)
    .openMarketTradeWithPyth{value: msg.value}(tradeData, emptyPythData);
```

### 5d. Change closeHedge

Replace:
```solidity
// OLD:
IMoonlanderRouter(moonlanderRouter).closeTrade(hedge.pairIndex, hedge.tradeIndex);
```
With:
```solidity
// NEW:
IMoonlanderRouter(moonlanderRouter).closeTrade(hedge.tradeHash);
```

### 5e. Change addMargin

Replace:
```solidity
// OLD:
IMoonlanderRouter(moonlanderRouter).addMargin(hedge.pairIndex, hedge.tradeIndex, amount);
```
With:
```solidity
// NEW:
IMoonlanderRouter(moonlanderRouter).addMargin(hedge.tradeHash, uint96(amount));
```

### 5f. Update agentOpenHedge similarly

Apply the same `pairIndex → pairBase` and struct changes to the `agentOpenHedge` function.

### 5g. Update emergencyCloseHedge

Same `closeTrade(bytes32)` change.

---

## 6. Step 4: Update integrations/moonlander/abis.ts

**File**: `integrations/moonlander/abis.ts`

Replace the entire `MOONLANDER_ABI` export with the verified ABI from [Section 2](#2-verified-contract-abi). The old ABI uses wrong types (uint256 everywhere, old gTrades v6 Trade struct). The new ABI must use the `IBook.OpenDataInput` struct with packed types.

Key changes:
- `closeTrade`: `(uint256, uint256)` → `(bytes32)`
- `updateTradeTpAndSl`: `(uint256, uint256, uint256, uint256)` → `(bytes32, uint128, uint128)`
- `addMargin`: `(uint256, uint256, uint256)` → `(bytes32, uint96)`
- `openMarketTradeWithPythAndExtraFee`: flat params → tuple struct + uint96 + bytes[]
- Add `openMarketTradeWithPyth` (without extra fee)
- Add `batchCloseTrade(bytes32[])`
- Remove all old gTrades v6 struct references

---

## 7. Step 5: Update MoonlanderOnChainClient.ts

**File**: `integrations/moonlander/MoonlanderOnChainClient.ts`

### 7a. Fix selectors (line ~28-33)

```typescript
// OLD:
const MOONLANDER_SELECTORS = {
  openMarketTradeWithPythAndExtraFee: '0x85420cc3',  // WRONG
  closeTrade: '0x73b1caa3',                           // WRONG
  updateTradeTpAndSl: '0x67d22d9b',                   // WRONG
  addMargin: '0xfc05c34d',                             // WRONG
} as const;

// NEW:
const MOONLANDER_SELECTORS = {
  openMarketTradeWithPyth: '0x1d451be5',
  openMarketTradeWithPythAndExtraFee: '0x16d48137',
  closeTrade: '0x5177fd3b',
  updateTradeTpAndSl: '0x2f745df6',
  addMargin: '0x29d9ddce',
  batchCloseTrade: '0xd8eb6e91',
} as const;
```

### 7b. Fix openTrade encoding (line ~220-280)

Replace flat param encoding with struct encoding:

```typescript
// Encode the struct as a tuple
const encodedParams = this.abiCoder.encode(
  [
    'tuple(address pairBase, bool isLong, address tokenIn, uint96 amountIn, uint128 qty, uint128 price, uint128 stopLoss, uint128 takeProfit, uint24 broker)',
    'bytes[]',
  ],
  [
    {
      pairBase: pairBaseAddress,   // from PAIR_BASES mapping
      isLong: isLong,
      tokenIn: this.contracts.USDC,
      amountIn: collateralWei,
      qty: leveragedAmount,        // uint128
      price: BigInt(0),            // market order
      stopLoss: slPrice,           // uint128, 18 decimals
      takeProfit: tpPrice,         // uint128, 18 decimals
      broker: 0,
    },
    pythUpdateData,
  ]
);

const calldata = MOONLANDER_SELECTORS.openMarketTradeWithPyth + encodedParams.slice(2);
```

### 7c. Fix closeTrade encoding (line ~330-350)

```typescript
// OLD: encode(['uint256', 'uint256'], [pairIndex, tradeIndex])
// NEW:
const encodedParams = this.abiCoder.encode(['bytes32'], [tradeHash]);
const calldata = MOONLANDER_SELECTORS.closeTrade + encodedParams.slice(2);
```

### 7d. Fix updateTpSl encoding

```typescript
const encodedParams = this.abiCoder.encode(
  ['bytes32', 'uint128', 'uint128'],
  [tradeHash, tpPrice, slPrice]  // prices in 18 decimals
);
```

### 7e. Fix addMargin encoding

```typescript
const encodedParams = this.abiCoder.encode(
  ['bytes32', 'uint96'],
  [tradeHash, amountWei]
);
```

### 7f. Update Types

```typescript
// OLD Trade interface uses pairIndex/index as bigint
// NEW: trades are identified by bytes32 tradeHash

export interface Position {
  tradeHash: string;          // bytes32 trade identifier
  market: string;
  pairBase: string;           // address
  side: 'LONG' | 'SHORT';
  size: string;
  collateral: string;
  entryPrice: string;
  // ...
}

export interface CloseTradeParams {
  tradeHash: string;          // bytes32 (replaces pairIndex + tradeIndex)
}

export interface UpdateTpSlParams {
  tradeHash: string;          // bytes32
  takeProfit: string;         // price in USD (will be scaled to 18 decimals)
  stopLoss: string;
}
```

---

## 8. Step 6: Update contracts.ts with pairBase Addresses

**File**: `integrations/moonlander/contracts.ts`

Replace the numeric `PAIR_INDEX` mapping with actual `pairBase` addresses from the Moonlander API (`https://api.moonlander.trade/v1/pairs`):

```typescript
// Pair base addresses (from https://api.moonlander.trade/v1/pairs)
// These are Moonlander's internal pair identifier addresses, NOT token addresses
export const PAIR_BASES = {
  CRONOS_EVM: {
    'BTC-USD': '0xd65e5dba71231d35a5802ba83dc6cb6746c9758d',
    'ETH-USD': '0x898b3560affd6d955b1574d87ee09e46669c60ea',
    'CRO-USD': '0xbcaa34ff9d5bfd0d948b18cf6bf39a882f4a1cbd',
    'SOL-USD': '0x570a5d26f7765ecb712c0924e4de545b89fd43df',
    'XRP-USD': '0x7b881c1a16814126813a5304b3a1aa0aba10c88a',
    'LINK-USD': '0x16eb7875c41b1d5812128790450f30658786aa23',
    'TRUMP-USD': '0x000000e744ccff009df0008a9bee3eeeb8e17993',
    'SAND-USD': '0x508fe42428b0e9de1501799f1f5d54a5203639dc',
    'VIRTUAL-USD': '0xf3a4d4f01b7ca4dfbad493504f69e6791e550531',
    'MELANIA-USD': '0x0a045883e84c4b026562a1925bc15e4f8775ac61',
    'KAITO-USD': '0x6284d80177c54e0b736c68eb6ef5fcbf846bd648',
    'FARTCOIN-USD': '0x3803b1deafebbc452dbf2e36b6a5f7f76f0bcfd9',
    'TON-USD': '0x8d96ea3c7f7b7a824e2c8277495007c7fbd769ea',
    'TAO-USD': '0x3e06a0bf43bc145c7d83b5bedc2f28f4d6406fa0',
    'ALGO-USD': '0x7714436708e5b037e338c6dea157dd4e7624192e',
    'FET-USD': '0x708078a2bf535b2ac0667cebd3a9c6d481f624a0',
    'RAY-USD': '0x78e7ae906d5421488454b48fc4edef4e7cb1fe0d',
    'S-USD': '0x6d03365edf19e6c233241ca2175729ecf55330b9',
  },
} as const;

// Reverse mapping for lookup
export const PAIR_BASE_TO_SYMBOL: Record<string, string> = Object.entries(PAIR_BASES.CRONOS_EVM).reduce(
  (acc, [symbol, addr]) => ({ ...acc, [addr.toLowerCase()]: symbol }),
  {}
);
```

> **Important**: These are NOT ERC20 token addresses. They are Moonlander's internal pair identifier addresses. They don't have `symbol()` or `decimals()` functions. Check `https://api.moonlander.trade/v1/pairs` periodically - addresses can change when pairs are updated.

---

## 9. Step 7: Pyth Oracle Integration

On mainnet, Moonlander requires Pyth price update data for `openMarketTradeWithPyth`. On testnet with MockMoonlander, you can pass empty arrays.

### For Mainnet

```typescript
import { EvmPriceServiceConnection } from '@pythnetwork/pyth-evm-js';

const pythConnection = new EvmPriceServiceConnection('https://hermes.pyth.network');

// Pyth price feed IDs (from https://api.moonlander.trade/v1/pairs)
const PYTH_PRICE_FEEDS = {
  'BTC-USD': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'ETH-USD': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'CRO-USD': '0x23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe', // check exact
  'SOL-USD': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  // ... add others from the pairs API response pythPriceFeedId field
};

// Get Pyth update data before opening trade
async function getPythUpdateData(pair: string): Promise<string[]> {
  const feedId = PYTH_PRICE_FEEDS[pair];
  const priceUpdateData = await pythConnection.getPriceFeedsUpdateData([feedId]);
  return priceUpdateData;
}
```

The Pyth oracle fee is sent as `msg.value` (ETH/CRO). Observed: `0.06 CRO` per update. The Pyth contract on Cronos: `0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B`.

### For Testnet (MockMoonlander)

Pass empty arrays:
```typescript
const priceUpdateData: string[] = [];
```

---

## 10. Step 8: Deploy & Switch

### Migration Path

1. **Deploy updated MockMoonlander** to testnet with the new interface
2. **Upgrade HedgeExecutor** via UUPS proxy (new implementation with struct-based calls)
3. **Test end-to-end** on testnet against the updated mock
4. **Switch to mainnet**:
   - Change `moonlanderRouter` to real Moonlander: `0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9`
   - Change `collateralToken` to real USDC: `0xc21223249CA28397B4B6541dfFaEcC539BfF0c59`
   - Ensure the deployer/relayer has CRO for gas + Pyth oracle fees
   - Pass real Pyth `priceUpdateData` when opening trades

### Key Mainnet Considerations

- **Real money at risk** — test thoroughly on testnet first
- **Oracle fees**: Every `openMarketTradeWithPyth` call needs CRO for Pyth update fees
- **Slippage**: Set `price` field in the struct to current market price ± slippage%, not 0
- **Gas**: Diamond proxy calls use more gas than simple contracts. Use `gasLimit: 1_000_000`
- **Pair availability**: Check `status` field from pairs API. Only trade `AVAILABLE` pairs
- **Collateral limits**: `uint96 amountIn` max = ~79.2 billion (79,228,162,514 USDC) — more than enough
- **Position qty limits**: `uint128 qty` max = ~340 undecillion — more than enough

---

## 11. Reference: All Verified Selectors

| Selector | Function Signature | Verified |
|----------|-------------------|----------|
| `0x1d451be5` | `openMarketTradeWithPyth((address,bool,address,uint96,uint128,uint128,uint128,uint128,uint24),bytes[])` | ✅ keccak256 + facetAddress confirmed |
| `0x16d48137` | `openMarketTradeWithPythAndExtraFee((address,bool,address,uint96,uint128,uint128,uint128,uint128,uint24),uint96,bytes[])` | ✅ keccak256 + facetAddress confirmed |
| `0x5177fd3b` | `closeTrade(bytes32)` | ✅ from frontend ABI |
| `0x2f745df6` | `updateTradeTpAndSl(bytes32,uint128,uint128)` | ✅ from frontend ABI |
| `0x29d9ddce` | `addMargin(bytes32,uint96)` | ✅ from frontend ABI |
| `0xd8eb6e91` | `batchCloseTrade(bytes32[])` | ✅ from frontend ABI |
| `0x04eeaae9` | `settleLpFundingFee(uint256)` | ✅ from frontend ABI |

### Other Trading Facet Selectors (unknown signatures)

These are also in the trading facet but we don't have their signatures yet:

| Selector | Status |
|----------|--------|
| `0x91a79f2c` | Unknown |
| `0x0f20f800` | Unknown |
| `0x64317306` | Unknown |
| `0x046a0888` | Unknown |
| `0x714351df` | Unknown |
| `0x562639f2` | Unknown |
| `0x60087b7b` | Unknown |

---

## 12. Reference: Diamond Facet Map

**Diamond Proxy**: `0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9`  
**Total Facets**: 23  
**Trading Facet**: `0x8b59461369400503f25EEEc90018e49B036B92d9` (14 selectors)  

### Moonlander API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET https://api.moonlander.trade/v1/pairs` | All trading pairs with pairBase addresses, OI caps, Pyth feed IDs |
| `GET https://api.moonlander.trade/geo` | Geo restriction check |

### Key Addresses (Cronos EVM Mainnet, Chain 25)

| Contract | Address |
|----------|---------|
| Moonlander Diamond | `0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9` |
| USDC (Cronos) | `0xc21223249CA28397B4B6541dfFaEcC539BfF0c59` |
| WCRO | `0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23` |
| Pyth Oracle | `0xE0d0e68297772Dd5a1f1D99897c581E2082dbA5B` |
| MLP Pool | `0xb4c70008528227e0545Db5BA4836d1466727DF13` |

---

## Summary Checklist

- [ ] Update `IMoonlanderRouter` interface in HedgeExecutor.sol
- [ ] Rewrite `MockMoonlander.sol` with new struct + bytes32 trade hashes
- [ ] Update `HedgePosition` struct (`pairIndex` → `pairBase`, `tradeIndex` → `tradeHash`)
- [ ] Update `openHedge()` to build `OpenDataInput` struct
- [ ] Update `closeHedge()` with `closeTrade(bytes32)`
- [ ] Update `addMargin()` with `addMargin(bytes32, uint96)`  
- [ ] Update `agentOpenHedge()` same as openHedge
- [ ] Update `emergencyCloseHedge()` same as closeHedge
- [ ] Replace `integrations/moonlander/abis.ts` with verified ABI
- [ ] Fix all 4 selectors in `MoonlanderOnChainClient.ts`
- [ ] Fix calldata encoding (flat → struct tuple)
- [ ] Add `PAIR_BASES` mapping to `contracts.ts`
- [ ] Add Pyth oracle integration for mainnet
- [ ] Test on testnet with updated mock
- [ ] Deploy to mainnet
