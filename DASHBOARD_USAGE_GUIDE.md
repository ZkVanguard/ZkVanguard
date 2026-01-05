# Dashboard Usage Guide - Manager Approval Flow

## 🎯 Where to Find the AI Chat Interface

The **AI Agent Chat** is located in the **right sidebar** of the dashboard.

### Dashboard Layout:
```
┌─────────────────────────────────────────────────────────┐
│  Header (Network, Balance, etc.)                        │
├─────────────────────────────────────────────────────────┤
│  [Overview] [Agents] [Positions] [Settlements] ← Tabs   │
├──────────────────────────────┬──────────────────────────┤
│                              │                          │
│  Main Content Area           │   AI Agent Chat         │
│  (2/3 width)                 │   (1/3 width)           │
│                              │   ← LOOK HERE!          │
│  - Portfolio Creator         │                          │
│  - Portfolio Overview        │   Chat messages          │
│  - Risk Metrics              │   Quick action buttons   │
│  - ZK Proof Demo             │   Input field            │
│                              │                          │
└──────────────────────────────┴──────────────────────────┘
```

## 🤖 Testing the Manager Approval Flow

### Step 1: Open the Chat Interface
1. Go to dashboard
2. Look at the **right sidebar** (1/3 of screen width)
3. You should see:
   - 🤖 **AI Agent** header
   - **5 Online** badge (showing active agents)
   - Initial greeting message
   - Quick action buttons below the greeting

### Step 2: Request a Hedge Strategy

**Option A: Use Quick Action Button**
- Click the button: **"Get hedge recommendations"**

**Option B: Type Command**
- In the chat input at bottom, type: `Hedge my portfolio`
- Press Enter

### Step 3: AI Shows Recommendations

The AI will respond with:
```
🛡️ Hedge Strategy Recommended (via Moonlander)

Portfolio Size: $10.0M
Target Yield: 8%

AI-Recommended Hedges:
1. SHORT on BTC
   • Leverage: 2x
   • Size: $500K
   • Reason: Protect against market correction

💡 Review and approve to execute. No action taken without your signature.

[🛡️ Approve & Execute Hedge] ← BUTTON APPEARS HERE
```

### Step 4: Click Approve Button

When you see the **"🛡️ Approve & Execute Hedge"** button:
1. Click it
2. A modal will appear

### Step 5: Review the Approval Modal

The modal shows:
```
┌──────────────────────────────────────────────┐
│  🛡️ Manager Approval Required                │
├──────────────────────────────────────────────┤
│  Action Details:                             │
│  Execute Hedge Strategy                      │
│  Short position on BTC to protect portfolio  │
│                                              │
│  Details:                                    │
│  Asset: BTC                                  │
│  Action: SHORT                               │
│  Leverage: 2x                                │
│  Position Size: $500K                        │
│  Gas Cost: $0.00 (x402 gasless)             │
│                                              │
│  ⚠️ Risk Considerations:                     │
│  • Leverage amplifies both gains and losses  │
│  • Market volatility may trigger liquidation│
│  • Counterparty risk on derivatives platform│
│                                              │
│  ✅ Expected Outcome:                        │
│  Protect against market correction.          │
│  Target yield: 8%                            │
│                                              │
│  [Reject]  [🔐 Approve & Sign]              │
└──────────────────────────────────────────────┘
```

### Step 6: Sign with Your Wallet

1. Click **"Approve & Sign"**
2. MetaMask will open
3. You'll see a signature request (NOT a transaction, just message signing)
4. **Cost: $0.00** (no gas for signing)
5. Click **"Sign"** in MetaMask

### Step 7: Execution with x402 Gasless

After signing:
- Hedge executes via x402 gasless protocol
- **Gas Cost: $0.00** (paid by x402, not you)
- Success message appears with signature proof

```
✅ Hedge Executed Successfully

Status: Confirmed
Batch ID: BATCH_20260105
Manager Signature: 0x1234...abcd
Gas Cost: $0.00 (x402 gasless)

Your portfolio is now protected with the approved hedge strategy.
```

## 🎭 Other Commands You Can Try

### 1. Analyze Portfolio
**Type:** `Analyze my portfolio`
- Shows VaR, volatility, Sharpe ratio
- **No signature required** (read-only)

### 2. Assess Risk
**Type:** `Assess risk level`
- Risk level, max drawdown, concentration risk
- **No signature required** (read-only)

### 3. Buy Assets
**Type:** `Buy 100 CRO`
- Would trigger approval flow
- **Signature required** (write operation)

### 4. Rebalance Portfolio
**Type:** `Rebalance to 60/40 BTC/ETH`
- Shows proposed changes
- **Signature required** (write operation)
- Approval modal with preview

## 🔍 Troubleshooting

### Issue: Can't See Chat Interface
**Check:**
1. Are you on desktop? (Mobile layout might hide it)
2. Scroll to the right side of the page
3. Make sure you're on the **"Overview"** tab
4. Try zooming out (Ctrl + Mouse Wheel)

### Issue: No Quick Action Buttons
**Check:**
1. Look below the initial greeting message
2. Should see 4 buttons in a row:
   - Analyze portfolio
   - Assess risk level
   - Buy 100 CRO
   - Get hedge recommendations

### Issue: Button Clicked but Nothing Happens
**Check:**
1. Is wallet connected? (top right)
2. Check browser console for errors (F12)
3. Try refreshing the page
4. Make sure you're on Cronos Testnet

### Issue: No Approval Modal Appears
**Check:**
1. Did you click the action button in the chat message?
2. Look for a modal overlay (dark background)
3. Check if popup blockers are interfering
4. Try clearing browser cache

### Issue: MetaMask Doesn't Open
**Check:**
1. Is MetaMask installed?
2. Is it unlocked?
3. Is it connected to the site?
4. Try clicking "Connect Wallet" first

## 📊 Expected Flow Summary

```
User Action                    → AI Response              → Manager Action
────────────────────────────────────────────────────────────────────────
"Hedge my portfolio"          → Recommendations shown     → (Read-only, no action needed)
                              → [Approve Button] appears  
                                                          
Click "Approve & Execute"     → Approval Modal opens      → Review details
                                                          → Click "Approve & Sign"
                                                          
Sign in MetaMask ($0)         → Execution starts          → (Automated)
                                                          
x402 executes ($0)            → Success message           → Done!
                                Signature: 0x123...        
```

## 🔐 Security Features Active

✅ **Portfolio Ownership Verified** - Smart contract checks you own the portfolio  
✅ **Manager Signature Required** - Every action needs your approval  
✅ **ZK Proofs Generated** - Privacy-preserving verification  
✅ **x402 Gasless** - $0 transaction costs  
✅ **Rejection Friendly** - Cancel at any step  

## 🎯 Quick Test Checklist

- [ ] Can see AI Agent chat in right sidebar
- [ ] Can see quick action buttons
- [ ] Click "Get hedge recommendations"
- [ ] See hedge strategies appear
- [ ] See "Approve & Execute" button
- [ ] Click button, modal appears
- [ ] Modal shows all details
- [ ] Click "Approve & Sign"
- [ ] MetaMask opens
- [ ] Sign message ($0.00)
- [ ] See success message with signature

## 📞 What to Look For

### In the Chat Interface:
1. **Bot icon** (🤖) at top
2. **"5 Online"** badge (green)
3. **Welcome message** from AI agent
4. **4 quick action buttons** below message
5. **Input field** at bottom with send button

### When Requesting Hedge:
1. **AI response** with strategy details
2. **Action button** at bottom of message
3. **Button label**: "🛡️ Approve & Execute Hedge"

### In the Approval Modal:
1. **Large title**: "Manager Approval Required"
2. **Action details** section
3. **Risk warnings** in yellow box
4. **Expected outcome** in green box
5. **Two buttons**: Reject (left) and Approve & Sign (right)

### After Signing:
1. **Success message** in chat
2. **Signature hash** displayed
3. **Batch ID** shown
4. **Gas cost**: $0.00

---

**Status:** ✅ All components deployed and active  
**Last Updated:** January 5, 2026  
**Build:** Production Ready
