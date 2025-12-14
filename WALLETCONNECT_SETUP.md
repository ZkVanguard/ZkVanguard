# 🔗 Get Your FREE WalletConnect Project ID

## Why You're Seeing These Errors

The console warnings about `403 Forbidden` and `demo_mode_disabled` happen because RainbowKit needs a valid WalletConnect Project ID to work properly.

**Good news**: Your wallet connection still works! But getting a real Project ID will:
- Remove all console errors ✅
- Enable WalletConnect mobile wallets 📱
- Add analytics to see wallet usage 📊
- It's 100% FREE! 🎉

---

## 🚀 How to Fix (Takes 2 Minutes)

### Step 1: Get Your Project ID

1. Go to **https://cloud.walletconnect.com/**
2. Click "Sign Up" (or log in if you have an account)
3. Create a new project - name it "Chronos Vanguard"
4. Copy your **Project ID** (looks like: `a1b2c3d4e5f6...`)

### Step 2: Add to Your Project

Open `.env.local` and paste your Project ID:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

### Step 3: Restart Dev Server

```bash
# Press Ctrl+C to stop the server
# Then restart:
npm run dev
```

---

## ✅ That's It!

All errors will disappear and your wallet connection will be production-ready.

---

## 🔍 About the Other Warnings

### `@react-native-async-storage/async-storage`
This is harmless - it's an optional React Native dependency that MetaMask SDK includes, but isn't needed for web apps.

### `pino-pretty`
Also harmless - an optional logging package that WalletConnect includes.

Both warnings are now suppressed in `next.config.js` so they won't clutter your console anymore.

---

## 📚 Learn More

- [WalletConnect Docs](https://docs.walletconnect.com/)
- [RainbowKit Docs](https://www.rainbowkit.com/)
- [Wagmi Docs](https://wagmi.sh/)
