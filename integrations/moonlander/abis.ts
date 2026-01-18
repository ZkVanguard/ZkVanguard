/**
 * Moonlander Contract ABIs
 * 
 * Based on contract interaction patterns observed on-chain:
 * - openMarketTradeWithPythAndExtraFee
 * - closeTrade
 * - updateTradeTpAndSl
 * - addMargin
 * - executeTpSlOrLiqV2
 */

// Main Moonlander Trading Contract ABI
export const MOONLANDER_ABI = [
  // ═══════════════════════════════════════════════════════════════
  // OPENING TRADES
  // ═══════════════════════════════════════════════════════════════
  
  // Open market trade with Pyth oracle price and extra fee
  {
    "inputs": [
      { "name": "trade", "type": "tuple", "components": [
        { "name": "trader", "type": "address" },
        { "name": "pairIndex", "type": "uint256" },
        { "name": "index", "type": "uint256" },
        { "name": "initialPosToken", "type": "uint256" },
        { "name": "positionSizeUsd", "type": "uint256" },
        { "name": "openPrice", "type": "uint256" },
        { "name": "buy", "type": "bool" },
        { "name": "leverage", "type": "uint256" },
        { "name": "tp", "type": "uint256" },
        { "name": "sl", "type": "uint256" }
      ]},
      { "name": "orderType", "type": "uint8" },
      { "name": "slippageP", "type": "uint256" },
      { "name": "pythUpdateData", "type": "bytes[]" }
    ],
    "name": "openMarketTradeWithPythAndExtraFee",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  
  // Open limit/stop order
  {
    "inputs": [
      { "name": "trade", "type": "tuple", "components": [
        { "name": "trader", "type": "address" },
        { "name": "pairIndex", "type": "uint256" },
        { "name": "index", "type": "uint256" },
        { "name": "initialPosToken", "type": "uint256" },
        { "name": "positionSizeUsd", "type": "uint256" },
        { "name": "openPrice", "type": "uint256" },
        { "name": "buy", "type": "bool" },
        { "name": "leverage", "type": "uint256" },
        { "name": "tp", "type": "uint256" },
        { "name": "sl", "type": "uint256" }
      ]},
      { "name": "orderType", "type": "uint8" },
      { "name": "maxSlippageP", "type": "uint256" }
    ],
    "name": "openTrade",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // ═══════════════════════════════════════════════════════════════
  // CLOSING TRADES
  // ═══════════════════════════════════════════════════════════════
  
  // Close trade (market close)
  {
    "inputs": [
      { "name": "pairIndex", "type": "uint256" },
      { "name": "index", "type": "uint256" }
    ],
    "name": "closeTrade",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Close trade with Pyth price update
  {
    "inputs": [
      { "name": "pairIndex", "type": "uint256" },
      { "name": "index", "type": "uint256" },
      { "name": "pythUpdateData", "type": "bytes[]" }
    ],
    "name": "closeTradeWithPyth",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },

  // ═══════════════════════════════════════════════════════════════
  // MANAGING POSITIONS
  // ═══════════════════════════════════════════════════════════════
  
  // Update take profit and stop loss
  {
    "inputs": [
      { "name": "pairIndex", "type": "uint256" },
      { "name": "index", "type": "uint256" },
      { "name": "tp", "type": "uint256" },
      { "name": "sl", "type": "uint256" }
    ],
    "name": "updateTradeTpAndSl",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Add margin to position
  {
    "inputs": [
      { "name": "pairIndex", "type": "uint256" },
      { "name": "index", "type": "uint256" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "addMargin",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  
  // Remove margin from position
  {
    "inputs": [
      { "name": "pairIndex", "type": "uint256" },
      { "name": "index", "type": "uint256" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "removeMargin",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION (called by keepers/bots)
  // ═══════════════════════════════════════════════════════════════
  
  // Execute TP/SL or liquidation
  {
    "inputs": [
      { "name": "orderType", "type": "uint8" },
      { "name": "trader", "type": "address" },
      { "name": "pairIndex", "type": "uint256" },
      { "name": "index", "type": "uint256" },
      { "name": "pythUpdateData", "type": "bytes[]" }
    ],
    "name": "executeTpSlOrLiqV2",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  
  // Batch price callback
  {
    "inputs": [
      { "name": "requests", "type": "tuple[]", "components": [
        { "name": "orderType", "type": "uint8" },
        { "name": "trader", "type": "address" },
        { "name": "pairIndex", "type": "uint256" },
        { "name": "index", "type": "uint256" }
      ]},
      { "name": "pythUpdateData", "type": "bytes[]" }
    ],
    "name": "batchRequestPriceCallbackV2",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },

  // ═══════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════
  
  // Get trade info
  {
    "inputs": [
      { "name": "trader", "type": "address" },
      { "name": "pairIndex", "type": "uint256" },
      { "name": "index", "type": "uint256" }
    ],
    "name": "getTrade",
    "outputs": [
      { "name": "", "type": "tuple", "components": [
        { "name": "trader", "type": "address" },
        { "name": "pairIndex", "type": "uint256" },
        { "name": "index", "type": "uint256" },
        { "name": "initialPosToken", "type": "uint256" },
        { "name": "positionSizeUsd", "type": "uint256" },
        { "name": "openPrice", "type": "uint256" },
        { "name": "buy", "type": "bool" },
        { "name": "leverage", "type": "uint256" },
        { "name": "tp", "type": "uint256" },
        { "name": "sl", "type": "uint256" }
      ]}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Get all trades for trader
  {
    "inputs": [
      { "name": "trader", "type": "address" }
    ],
    "name": "getTradesForTrader",
    "outputs": [
      { "name": "", "type": "tuple[]", "components": [
        { "name": "trader", "type": "address" },
        { "name": "pairIndex", "type": "uint256" },
        { "name": "index", "type": "uint256" },
        { "name": "initialPosToken", "type": "uint256" },
        { "name": "positionSizeUsd", "type": "uint256" },
        { "name": "openPrice", "type": "uint256" },
        { "name": "buy", "type": "bool" },
        { "name": "leverage", "type": "uint256" },
        { "name": "tp", "type": "uint256" },
        { "name": "sl", "type": "uint256" }
      ]}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Get trade count for trader-pair
  {
    "inputs": [
      { "name": "trader", "type": "address" },
      { "name": "pairIndex", "type": "uint256" }
    ],
    "name": "openTradesCount",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Get pair info
  {
    "inputs": [{ "name": "pairIndex", "type": "uint256" }],
    "name": "pairInfos",
    "outputs": [
      { "name": "maxLeverage", "type": "uint256" },
      { "name": "minLeverage", "type": "uint256" },
      { "name": "maxPositionSize", "type": "uint256" },
      { "name": "maxGainP", "type": "uint256" },
      { "name": "groupIndex", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Get collateral token
  {
    "inputs": [],
    "name": "collateral",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Get current open interest
  {
    "inputs": [
      { "name": "pairIndex", "type": "uint256" },
      { "name": "long", "type": "bool" }
    ],
    "name": "openInterest",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },

  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════
  
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "trader", "type": "address" },
      { "indexed": true, "name": "pairIndex", "type": "uint256" },
      { "indexed": false, "name": "index", "type": "uint256" },
      { "indexed": false, "name": "positionSizeUsd", "type": "uint256" },
      { "indexed": false, "name": "openPrice", "type": "uint256" },
      { "indexed": false, "name": "buy", "type": "bool" },
      { "indexed": false, "name": "leverage", "type": "uint256" }
    ],
    "name": "TradeOpened",
    "type": "event"
  },
  
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "trader", "type": "address" },
      { "indexed": true, "name": "pairIndex", "type": "uint256" },
      { "indexed": false, "name": "index", "type": "uint256" },
      { "indexed": false, "name": "closePrice", "type": "uint256" },
      { "indexed": false, "name": "percentProfit", "type": "int256" },
      { "indexed": false, "name": "pnl", "type": "int256" }
    ],
    "name": "TradeClosed",
    "type": "event"
  },
  
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "trader", "type": "address" },
      { "indexed": true, "name": "pairIndex", "type": "uint256" },
      { "indexed": false, "name": "index", "type": "uint256" },
      { "indexed": false, "name": "newTp", "type": "uint256" },
      { "indexed": false, "name": "newSl", "type": "uint256" }
    ],
    "name": "TpSlUpdated",
    "type": "event"
  },
  
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "trader", "type": "address" },
      { "indexed": true, "name": "pairIndex", "type": "uint256" },
      { "indexed": false, "name": "index", "type": "uint256" },
      { "indexed": false, "name": "amount", "type": "uint256" },
      { "indexed": false, "name": "newLeverage", "type": "uint256" }
    ],
    "name": "MarginAdded",
    "type": "event"
  },
  
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "trader", "type": "address" },
      { "indexed": true, "name": "pairIndex", "type": "uint256" },
      { "indexed": false, "name": "index", "type": "uint256" },
      { "indexed": false, "name": "liqPrice", "type": "uint256" }
    ],
    "name": "TradeLiquidated",
    "type": "event"
  }
] as const;

// MLP Token ABI (Liquidity Pool)
export const MLP_ABI = [
  // Standard ERC20
  {
    "inputs": [{ "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "spender", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // MLP specific
  {
    "inputs": [],
    "name": "getAum",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getMlpPrice",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// ERC20 ABI for collateral tokens
export const ERC20_ABI = [
  {
    "inputs": [{ "name": "account", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "spender", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "owner", "type": "address" },
      { "name": "spender", "type": "address" }
    ],
    "name": "allowance",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "name": "to", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "transfer",
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
