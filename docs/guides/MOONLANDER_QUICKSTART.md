# 🛡️ Moonlander Hedging - Quick Start

## What Was Implemented

✅ **Full Moonlander.trade integration** for automated perpetual futures hedging on Cronos EVM testnet

### Key Features

1. **AI-Triggered Hedging**: Click "Open Hedge" → AI opens SHORT position on Moonlander
2. **Real Perpetuals Trading**: Uses MoonlanderClient to execute on-chain
3. **Risk-Based Sizing**: Hedge size calculated from prediction probability
4. **Automatic Stop-Loss/Take-Profit**: Protection against liquidation
5. **Dual Mode**: Simulation (no keys) + Live trading (with keys)

## Quick Test

### 1. Start Dev Server

```bash
bun run dev
```

### 2. Test in Browser

1. Go to http://localhost:3000/dashboard
2. Navigate to "Insights" tab
3. Find a high-risk prediction (e.g., "BTC crash expected")
4. Click **"Open Hedge"**
5. Watch the notification show hedge details

### 3. Test via CLI

```bash
node test-moonlander-hedge.mjs
```

Expected output:
```
🛡️  MOONLANDER HEDGE EXECUTION TEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ HEDGE EXECUTION RESULT:
   Status: ✅ SUCCESS
   Order ID: sim-hedge-1737159234567
   Market: BTC-USD-PERP
   Side: SHORT
   Position Size: 0.0988
   Entry Price: $43000
   Leverage: 5x
   Liquidation Price: $50200.00
   Mode: 🎭 SIMULATION

⚠️  SIMULATION MODE ACTIVE
   To enable live trading:
   1. Set MOONLANDER_PRIVATE_KEY in .env.local
   2. Fund wallet on Cronos Testnet
   3. Get Moonlander API keys from https://moonlander.trade
```

## Enable Live Trading (Optional)

### 1. Get Test Funds

```bash
# Visit Cronos faucet
https://cronos.org/faucet

# Fund your wallet with 10-20 TCRO
```

### 2. Configure Keys

Add to `.env.local`:

```bash
MOONLANDER_PRIVATE_KEY=your_private_key_with_tcro
NEXT_PUBLIC_CRONOS_TESTNET_RPC=https://evm-t3.cronos.org
```

### 3. Restart & Test

```bash
bun run dev

# Now clicking "Open Hedge" executes REAL trades on testnet
```

## API Endpoint

**POST** `/api/agents/hedging/execute`

```bash
curl -X POST http://localhost:3000/api/agents/hedging/execute \
  -H "Content-Type: application/json" \
  -d '{
    "asset": "BTC",
    "side": "SHORT",
    "notionalValue": 850,
    "leverage": 5,
    "stopLoss": 45000,
    "takeProfit": 40000,
    "reason": "Market crash hedge (85% probability)"
  }'
```

## Files Modified/Created

### Created
- ✅ `app/api/agents/hedging/execute/route.ts` - Hedge execution API
- ✅ `test-moonlander-hedge.mjs` - Test script
- ✅ `docs/integrations/MOONLANDER_INTEGRATION.md` - Full docs

### Modified
- ✅ `app/dashboard/page.tsx` - Added real Moonlander call to handleOpenHedge
- ✅ `.env.example` - Added Moonlander configuration

## How It Works

```
User clicks "Open Hedge"
         ↓
Dashboard calls /api/agents/hedging/execute
         ↓
API calculates hedge parameters:
  - Notional = $1000 × (probability/100)
  - Asset from prediction (BTC, ETH, CRO)
  - Side = SHORT (protect against crash)
  - Leverage = 5x
         ↓
MoonlanderClient.openHedge():
  1. Get current market price
  2. Calculate position size
  3. Place MARKET order
  4. Set stop-loss (optional)
  5. Set take-profit (optional)
         ↓
Return order details to frontend
         ↓
Show success notification with:
  - Market, Side, Size, Entry Price, Leverage
```

## Hackathon Demo Script

### For Judges (Simulation Mode)

1. **Show prediction**: "BTC crash expected (85% probability)"
2. **Click Open Hedge**: Button triggers AI analysis + hedge execution
3. **Show notification**:
   ```
   ✅ Hedge Opened on Moonlander
   
   Market: BTC-USD-PERP
   Side: SHORT
   Size: 0.0197
   Entry: $43000
   Leverage: 5x
   
   ⚠️ SIMULATION MODE
   ```
4. **Explain**: "In production, this would open a real SHORT position on Moonlander.trade to protect the portfolio"

### For Live Demo (Testnet)

1. **Show funded wallet**: Display TCRO balance
2. **Execute same flow**: Real transaction on Cronos testnet
3. **Show Moonlander UI**: Navigate to https://moonlander.trade/portfolio
4. **Verify position**: Show the SHORT position in Moonlander interface

## Integration Points for Hackathon

### ✅ Track 2: x402 Agentic Finance
- Automated hedge execution via AI agents
- Risk-managed position sizing
- Multi-step settlement (order + stop-loss + take-profit)

### ✅ Track 3: Cronos Ecosystem Integration
- **Moonlander**: Full perpetuals trading integration
- **VVS Finance**: Already integrated for swaps
- Demonstrates deep protocol integration

### ✅ Main Track: x402 Applications
- Agent-triggered payments (hedge capital allocation)
- Automated treasury management
- Dynamic asset management based on AI predictions

## Key Selling Points

1. **Real Protocol Integration**: Not mocked - uses actual Moonlander SDK
2. **Risk Management**: Automatic stop-loss and liquidation protection
3. **AI-Driven**: Position size based on prediction confidence
4. **Gasless via x402**: No gas fees for users
5. **Production-Ready**: Works in both simulation and live modes

## Troubleshooting

### "Nothing happens when clicking Open Hedge"

- Check browser console (F12)
- Look for API response in Network tab
- Verify dev server is running on port 3000

### "API Error 500"

- Check server terminal for error logs
- Verify `.env.local` has required variables
- Ensure Moonlander SDK is properly initialized

### "Want to test on mainnet"

⚠️ **DO NOT USE MAINNET FOR HACKATHON DEMO**
- Use testnet only (Chain ID 338)
- Real money at risk on mainnet
- Faucet TCRO is free and sufficient

## Next Steps

- [x] ✅ Implement Moonlander hedge execution
- [x] ✅ Connect to dashboard "Open Hedge" button
- [x] ✅ Add simulation mode for demos
- [ ] 📹 Record demo video showing the flow
- [ ] 📝 Add to final submission documentation

## Documentation

Full integration guide: [`docs/integrations/MOONLANDER_INTEGRATION.md`](docs/integrations/MOONLANDER_INTEGRATION.md)

---

**🎯 Ready for Hackathon Submission**

This integration demonstrates:
- Real DeFi protocol integration (Moonlander)
- AI-driven automated trading
- Risk management and position sizing
- Cronos EVM ecosystem usage
- Production-quality error handling
