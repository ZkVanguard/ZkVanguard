# Chronos Vanguard - Deployment Guide

## 🚀 Quick Deploy to Vercel

### Prerequisites
- GitHub account
- Vercel account (free tier works)
- Environment variables ready

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial Next.js build"
git branch -M main
git remote add origin https://github.com/yourusername/chronos-vanguard.git
git push -u origin main
```

### Step 2: Deploy to Vercel

#### Option A: Vercel Dashboard (Recommended)

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository
4. Framework Preset: **Next.js** (auto-detected)
5. Root Directory: `./`
6. Build Command: `npm run build:next`
7. Output Directory: `.next` (auto-detected)
8. Install Command: `npm install`

#### Option B: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

### Step 3: Environment Variables

Add these in Vercel Dashboard → Settings → Environment Variables:

#### Required
```env
NEXT_PUBLIC_CRONOS_RPC_URL=https://rpc-zkevm-testnet.cronos.org
NEXT_PUBLIC_CHAIN_ID=282
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

#### Contract Addresses (after deployment)
```env
NEXT_PUBLIC_RWA_MANAGER_ADDRESS=0x...
NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=0x...
```

#### API Endpoints
```env
NEXT_PUBLIC_MOONLANDER_API=https://api.moonlander.io
NEXT_PUBLIC_VVS_API=https://api.vvs.finance
NEXT_PUBLIC_MCP_API=https://mcp.cronos.org/api
NEXT_PUBLIC_X402_API=https://x402.cronos.org/api
NEXT_PUBLIC_DELPHI_API=https://api.delphi.cronos.org
```

#### Optional
```env
NEXT_PUBLIC_GA_ID=your_google_analytics_id
NEXT_PUBLIC_ENABLE_ZK_PROOFS=true
NEXT_PUBLIC_ENABLE_CHAT=true
```

### Step 4: Deploy

Click **Deploy** or run:
```bash
vercel --prod
```

Your app will be live at: `https://your-project.vercel.app`

---

## 🔧 Alternative Deployments

### Deploy to Netlify

1. Connect GitHub repository
2. Build command: `npm run build:next`
3. Publish directory: `.next`
4. Add environment variables

### Deploy to AWS Amplify

```bash
amplify init
amplify add hosting
amplify publish
```

### Deploy to Docker

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:next

FROM node:18-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "run", "start:next"]
```

```bash
docker build -t chronos-vanguard .
docker run -p 3000:3000 chronos-vanguard
```

---

## 🔐 Security Checklist

- [ ] Set all environment variables
- [ ] Enable HTTPS (automatic on Vercel)
- [ ] Configure CSP headers (in next.config.js)
- [ ] Add rate limiting for API routes
- [ ] Enable authentication if needed
- [ ] Review security headers
- [ ] Test wallet connections on testnet first

---

## 📊 Monitoring

### Vercel Analytics (Free)
- Automatically enabled
- View in Vercel Dashboard → Analytics

### Custom Analytics
Add to `app/layout.tsx`:

```typescript
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

---

## 🧪 Pre-Deployment Testing

### 1. Build Test
```bash
npm run build:next
npm run start:next
# Visit http://localhost:3000
```

### 2. Type Check
```bash
npm run typecheck
```

### 3. Lint Check
```bash
npm run lint
```

### 4. Test All Features
- [ ] Home page loads
- [ ] Wallet connection works
- [ ] Dashboard accessible after connecting
- [ ] Chat interface responsive
- [ ] Portfolio overview displays
- [ ] Agent activity updates
- [ ] Positions list renders
- [ ] Settlements panel works
- [ ] Mobile responsive
- [ ] Theme switching

---

## 🌐 Domain Setup

### Custom Domain on Vercel

1. Go to Settings → Domains
2. Add your domain
3. Configure DNS:
   - Type: `A` Record
   - Name: `@`
   - Value: `76.76.21.21`
   
   OR
   
   - Type: `CNAME`
   - Name: `www`
   - Value: `cname.vercel-dns.com`

4. Wait for DNS propagation (5-48 hours)

---

## 🔄 CI/CD Pipeline

### GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install Dependencies
        run: npm ci
        
      - name: Type Check
        run: npm run typecheck
        
      - name: Lint
        run: npm run lint
        
      - name: Build
        run: npm run build:next
        
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

---

## 📈 Performance Optimization

### 1. Image Optimization
Use Next.js `<Image>` component:

```typescript
import Image from 'next/image';

<Image 
  src="/logo.png" 
  width={200} 
  height={100} 
  alt="Logo"
/>
```

### 2. Bundle Analysis

```bash
npm i -D @next/bundle-analyzer

# next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer(nextConfig);

# Run
ANALYZE=true npm run build:next
```

### 3. Loading States
Add suspense boundaries in `app/layout.tsx`:

```typescript
import { Suspense } from 'react';

<Suspense fallback={<Loading />}>
  {children}
</Suspense>
```

---

## 🐛 Troubleshooting

### Build Fails
```bash
# Clear cache
rm -rf .next node_modules
npm install
npm run build:next
```

### Hydration Errors
- Ensure all client components have `'use client'`
- Check for mismatched HTML structure
- Verify localStorage/window access is client-side only

### Wallet Connection Issues
- Check RPC URL is accessible
- Verify chain ID matches network
- Test on testnet first

### Environment Variables Not Working
- Must start with `NEXT_PUBLIC_` for browser access
- Restart dev server after changes
- Redeploy to Vercel after env var changes

---

## 📚 Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel Deployment Docs](https://vercel.com/docs)
- [Wagmi Documentation](https://wagmi.sh)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Cronos zkEVM Docs](https://docs.cronos.org)

---

## ✅ Post-Deployment Checklist

- [ ] Site accessible at production URL
- [ ] Wallet connection works on mainnet/testnet
- [ ] All pages load correctly
- [ ] Mobile responsive verified
- [ ] Analytics tracking setup
- [ ] Error monitoring configured
- [ ] Performance metrics acceptable
- [ ] SEO meta tags set
- [ ] Social share preview working
- [ ] Custom domain configured (if applicable)

---

**Deployment Status**: ✅ READY

Your Chronos Vanguard app is now production-ready!

🌐 Development: http://localhost:3000
🚀 Production: https://your-app.vercel.app

Need help? Check NEXTJS_SETUP.md for detailed documentation.
