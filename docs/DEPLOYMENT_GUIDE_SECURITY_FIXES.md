# Security Fixes Deployment Guide
**Date:** January 5, 2026

---

## 🚀 Quick Start

### Step 1: Deploy Updated Smart Contract

```powershell
# Navigate to project root
cd c:\Users\mrare\OneDrive\Documents\ZkVanguard

# Compile contracts
npx hardhat compile

# Deploy to Cronos testnet
npx hardhat run scripts/deploy.ts --network cronos-testnet

# Note the deployed address for RWAManager
```

**Expected Output:**
```
✅ RWAManager deployed to: 0x...
✅ Portfolio ownership modifier added
✅ Rebalancing protection enabled
✅ Strategy execution protection enabled
```

---

### Step 2: Update Frontend Contract References

**File:** `lib/contracts/hooks.ts` or wherever contract addresses are stored

Update with new RWAManager address:
```typescript
const RWA_MANAGER_ADDRESS = '0x...' // New address from Step 1
```

---

### Step 3: Test Locally

```powershell
# Start development server
npm run dev

# Open browser to http://localhost:3000
```

---

## ✅ Testing Checklist

### Test 1: Portfolio Creation (Should Work)
1. Connect wallet
2. Click "Create AI-Managed Portfolio"
3. Configure strategy
4. Sign creation transaction
5. ✅ Verify portfolio created

### Test 2: Hedge Recommendation (Read-Only, Should Work)
1. In chat, type: "Hedge my portfolio"
2. ✅ Verify AI shows recommendations
3. ✅ Verify "Approve & Execute" button appears
4. ✅ NO execution happens automatically

### Test 3: Hedge Execution (Requires Approval)
1. Click "Approve & Execute Hedge" button
2. ✅ Verify approval modal appears
3. ✅ Verify details shown (action, risks, outcome)
4. Click "Approve & Sign"
5. ✅ Verify MetaMask opens for signature
6. Sign the message
7. ✅ Verify hedge executes
8. ✅ Verify success message with signature hash

### Test 4: Signature Rejection (Should Cancel)
1. Request hedge execution
2. Click "Approve & Sign"
3. In MetaMask, click "Reject"
4. ✅ Verify action cancelled
5. ✅ Verify message: "Action cancelled by manager"

### Test 5: Unauthorized Access (Should Fail)
1. Connect wallet A, create portfolio
2. Switch to wallet B
3. Try to rebalance portfolio from wallet A
4. ✅ Verify transaction fails
5. ✅ Verify error: "Not authorized for this portfolio"

---

## 🔧 Troubleshooting

### Issue: "Not authorized for this portfolio"
**Cause:** Trying to modify portfolio you don't own  
**Solution:** Switch to correct wallet address

### Issue: "User rejected signature"
**Cause:** Manager clicked reject in MetaMask  
**Solution:** Normal behavior, action cancelled as expected

### Issue: Modal doesn't appear
**Cause:** Missing action button click  
**Solution:** Verify message has `actions` array with button

### Issue: "Contract not deployed"
**Cause:** Using old contract address  
**Solution:** Update contract address in hooks.ts

---

## 📊 Verification Commands

### Check Contract on Cronos Testnet
```bash
# View contract on block explorer
https://explorer.cronos.org/testnet/address/0x...

# Verify ownership modifier exists
npx hardhat verify --network cronos-testnet 0x... <constructor-args>
```

### Check Transaction on Chain
```bash
# After hedge execution, check tx hash
https://explorer.cronos.org/testnet/tx/0x...

# Verify signature included in tx data
```

---

## 🎯 Expected User Experience

### Manager Workflow:
```
1. "Hedge my portfolio" 
   → AI shows recommendations (instant)

2. Click "Approve & Execute"
   → Modal shows details

3. Review action preview
   → See risks, expected outcome

4. Click "Approve & Sign"
   → MetaMask opens

5. Sign message ($0 gas)
   → Signature collected

6. Execution via x402
   → Hedge applied, $0 gas

7. Confirmation
   → Success with signature hash
```

**Time:** ~30 seconds from request to execution  
**Gas Cost:** $0.00 (x402 gasless)  
**Manager Control:** 100% - can reject at any step

---

## 🔐 Security Verification

### Smart Contract Level:
```solidity
// Verify this modifier exists
modifier onlyPortfolioOwnerOrApproved(uint256 _portfolioId) {
    require(
        portfolio.owner == msg.sender || hasRole(ADMIN_ROLE, msg.sender),
        "Not authorized for this portfolio"
    );
    _;
}

// Verify it's applied to rebalancePortfolio
function rebalancePortfolio(...) 
    onlyRole(AGENT_ROLE) 
    onlyPortfolioOwnerOrApproved(_portfolioId)  // ✅ Check this
```

### Frontend Level:
```typescript
// Verify approval modal exists
<ActionApprovalModal
  isOpen={showApprovalModal}
  action={pendingAction}
  onApprove={callback}  // ✅ Collects signature
  onReject={cancel}     // ✅ Cancels action
/>

// Verify signature included in execution
await executeSettlementBatch([...], signature);  // ✅ Check signature param
```

---

## 📝 Post-Deployment Checklist

- [ ] Contract deployed to testnet
- [ ] Contract verified on block explorer
- [ ] Frontend updated with new contract address
- [ ] Portfolio creation tested
- [ ] Hedge recommendation tested
- [ ] Approval modal tested
- [ ] Signature collection tested
- [ ] Hedge execution tested
- [ ] Rejection flow tested
- [ ] Unauthorized access blocked
- [ ] x402 gasless working
- [ ] Documentation updated
- [ ] Demo video recorded

---

## 🎥 Demo Script

### For Investors:

**Opening:**
> "Let me show you how managers maintain full control while benefiting from AI recommendations."

**Step 1: Show Recommendation**
> "I ask our AI: 'Hedge my portfolio.' The AI analyzes market conditions and provides recommendations instantly. Notice - nothing executes automatically."

**Step 2: Show Approval Flow**
> "To execute, I click 'Approve & Execute.' A detailed preview appears showing exactly what will happen, including risks."

**Step 3: Show Signature**
> "I review and click 'Approve & Sign.' My wallet opens - this is ME authorizing the action, not the AI executing on its own."

**Step 4: Show Execution**
> "After I sign, the action executes via x402 protocol - gasless, so it costs me $0 in fees. The hedge is now active, protecting my portfolio."

**Closing:**
> "At every step, I'm in control. The AI provides intelligence, but I make the decisions. This is true non-custodial portfolio management with AI enhancement."

---

## 📞 Support

**Issues?** Check:
1. Contract deployed correctly?
2. Frontend using new contract address?
3. Wallet connected?
4. MetaMask not blocking popups?
5. Network set to Cronos testnet?

**Still stuck?** Review [SECURITY_FIXES_IMPLEMENTATION.md](SECURITY_FIXES_IMPLEMENTATION.md)

---

**Status:** ✅ Ready for deployment and testing
