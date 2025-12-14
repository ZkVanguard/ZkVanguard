# 🚀 Production Setup Checklist for Cronos Vanguard

## ⚠️ CRITICAL: Fix WalletConnect 403 Errors

Your wallet **is connected** but showing 403 errors because WalletConnect Cloud needs to know which domains are authorized to use your Project ID.

---

## 📋 Step-by-Step Setup (5 minutes)

### 1. Go to WalletConnect Cloud Dashboard
🔗 **https://cloud.walletconnect.com/**

### 2. Find Your Project
Look for project with ID: `a3b7532423dc88e03fd167375f597f59`

### 3. Configure Allowed Origins
Click on your project → **"Settings"** or **"Configuration"** → Find **"Allowed Origins"** section

### 4. Add These URLs (IMPORTANT!)

#### For Development:
```
http://localhost:3000
http://localhost:3001
http://127.0.0.1:3000
```

#### For Production (when you deploy):
```
https://your-app.vercel.app
https://chronos-vanguard.vercel.app
https://your-custom-domain.com
```

### 5. Save & Wait
- Click **Save** or **Update**
- Wait **1-2 minutes** for changes to propagate globally
- Refresh your browser

---

## ✅ What This Fixes

After adding allowed origins:
- ✅ No more 403 Forbidden errors
- ✅ WalletConnect mobile wallets work perfectly
- ✅ Analytics tracking enabled
- ✅ Production-ready wallet integration
- ✅ Support for 300+ wallets

---

## 🔒 Security Note

This is a **security feature** - it prevents unauthorized websites from using your Project ID. Only domains you explicitly allow can use your WalletConnect configuration.

---

## 📊 Production Optimizations Already Applied

### In `app/providers.tsx`:
- ✅ Explicit RPC endpoints (no fallback to slow public RPCs)
- ✅ Retry logic: 3 attempts for failed requests
- ✅ Query caching: 60s stale time, 5min garbage collection
- ✅ SSR-safe configuration
- ✅ Required Project ID validation (fails fast if missing)

### In `next.config.js`:
- ✅ Webpack optimizations for Web3 libraries
- ✅ Suppressed optional dependency warnings
- ✅ Production-ready bundle configuration

### In `.env.local`:
- ✅ Production RPC endpoints configured
- ✅ Environment-specific settings
- ✅ Clear documentation for deployment

---

## 🚢 Deployment Checklist

### Before Deploying to Production:

1. **Update Environment Variables**
   ```bash
   # In your hosting platform (Vercel, Netlify, etc.)
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=a3b7532423dc88e03fd167375f597f59
   NEXT_PUBLIC_ENABLE_REAL_AGENTS=true
   NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.com
   NEXT_PUBLIC_CRONOS_MAINNET_RPC=https://evm.cronos.org
   NEXT_PUBLIC_CRONOS_TESTNET_RPC=https://evm-t3.cronos.org
   ```

2. **Add Production URL to WalletConnect**
   - Get your deployment URL (e.g., `https://chronos-vanguard.vercel.app`)
   - Add it to WalletConnect Cloud → Allowed Origins
   - Add your custom domain if using one

3. **Test Wallet Connection**
   - Test on desktop (MetaMask, Coinbase Wallet)
   - Test on mobile (WalletConnect QR code)
   - Test network switching (Cronos Testnet ↔ Mainnet)

4. **Monitor Usage**
   - Check WalletConnect Cloud dashboard for analytics
   - Monitor wallet connection success rate
   - Track which wallets users prefer

---

## 🎯 Expected Behavior After Setup

### Development (localhost):
- ✅ Connect button shows modal with wallet options
- ✅ MetaMask connects instantly
- ✅ WalletConnect QR code works for mobile wallets
- ✅ No 403 errors in console
- ✅ Network switching works smoothly

### Production (deployed):
- ✅ Same as development
- ✅ HTTPS ensures secure wallet connections
- ✅ Analytics tracked in WalletConnect dashboard
- ✅ Ready to handle high transaction volume

---

## 📞 Need Help?

### Common Issues:

**Q: Still seeing 403 errors after adding origins?**
A: Wait 2-3 minutes for DNS propagation, then hard refresh (Ctrl+Shift+R)

**Q: Wallet connects but can't sign transactions?**
A: Check you're on the correct network (Cronos Testnet or Mainnet)

**Q: WalletConnect QR code doesn't work?**
A: Make sure your production URL is in Allowed Origins

**Q: Analytics not showing up?**
A: Can take 15-30 minutes for first data to appear in dashboard

---

## 🏆 Hackathon Ready

Your project is now configured for:
- ✅ Cronos x402 Paytech Hackathon submission
- ✅ High-volume transaction processing
- ✅ Production-grade wallet integration
- ✅ Multiple wallet support (300+ wallets)
- ✅ Cronos EVM Mainnet & Testnet
- ✅ Mobile wallet support via WalletConnect

**Next Step**: Configure Allowed Origins in WalletConnect Cloud to remove the 403 errors!
