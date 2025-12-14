# Chronos Vanguard - Next.js Frontend

## Quick Start

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev:next
# or
npm run frontend:dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production
```bash
npm run build:next
```

### Start Production Server
```bash
npm run start:next
```

## Project Structure

```
Chronos-Vanguard/
├── app/                      # Next.js 14 App Router
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Home page
│   ├── providers.tsx        # Web3 & Theme providers
│   └── dashboard/           # Dashboard pages
│       └── page.tsx
├── components/              # React components
│   ├── Navbar.tsx          # Navigation bar
│   ├── Footer.tsx          # Footer
│   ├── Hero.tsx            # Landing hero section
│   ├── Features.tsx        # Features showcase
│   ├── AgentShowcase.tsx   # Agent details
│   └── dashboard/          # Dashboard components
│       ├── PortfolioOverview.tsx
│       ├── RiskMetrics.tsx
│       ├── ChatInterface.tsx
│       ├── AgentActivity.tsx
│       ├── PositionsList.tsx
│       └── SettlementsPanel.tsx
├── lib/                     # Utilities & configs
│   └── chains.ts           # Network configurations
├── styles/                  # Global styles
│   └── globals.css
├── public/                  # Static assets
├── next.config.js          # Next.js configuration
├── tailwind.config.js      # Tailwind CSS config
├── tsconfig.json           # TypeScript config
└── vercel.json             # Vercel deployment config
```

## Features

### 🎨 Modern UI/UX
- **Responsive Design**: Mobile-first approach with Tailwind CSS
- **Dark Theme**: Beautiful dark mode interface
- **Smooth Animations**: Polished transitions and effects
- **Gradient Accents**: Eye-catching gradient text and backgrounds

### 🔗 Web3 Integration
- **Wallet Connection**: MetaMask & WalletConnect support via Wagmi
- **Cronos zkEVM**: Native support for Cronos zkEVM Testnet
- **Real-time Updates**: Live portfolio and position tracking
- **Transaction Management**: Seamless on-chain interactions

### 🤖 AI Agent Interface
- **Natural Language Chat**: Communicate with AI agents in plain English
- **Multi-Agent Coordination**: Monitor all agent activities in real-time
- **Task Status Tracking**: See exactly what agents are doing
- **Automated Execution**: Set it and forget it

### 📊 Dashboard Components

#### Portfolio Overview
- Total portfolio value
- 24h change ($/%)
- Number of positions
- Active hedges count

#### Risk Metrics
- Value at Risk (VaR)
- Portfolio volatility
- Liquidation risk assessment
- Sharpe ratio

#### Agent Activity Feed
- Real-time agent task updates
- Status indicators (pending/processing/completed/failed)
- Timestamp tracking
- Action descriptions

#### Chat Interface
- Natural language processing
- Command history
- AI responses
- Multi-turn conversations

#### Positions List
- Open perpetual positions
- PnL tracking
- Entry/current prices
- Leverage indicators
- Long/short badges

#### Settlements Panel
- Pending payments
- Priority levels (URGENT/HIGH/MEDIUM/LOW)
- Status tracking
- Token amounts

## Environment Variables

Create a `.env.local` file:

```env
# Network
NEXT_PUBLIC_CRONOS_RPC_URL=https://rpc-zkevm-testnet.cronos.org
NEXT_PUBLIC_CHAIN_ID=282

# Contracts (update after deployment)
NEXT_PUBLIC_RWA_MANAGER_ADDRESS=0x...
NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=0x...

# APIs
NEXT_PUBLIC_MOONLANDER_API=https://api.moonlander.io
NEXT_PUBLIC_VVS_API=https://api.vvs.finance
NEXT_PUBLIC_MCP_API=https://mcp.cronos.org/api
NEXT_PUBLIC_X402_API=https://x402.cronos.org/api

# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **React**: 18.2
- **TypeScript**: 5.3
- **Styling**: Tailwind CSS 3.4
- **Web3**: Wagmi 1.4, Viem 1.21
- **State Management**: TanStack Query (React Query)
- **Icons**: Lucide React
- **Theme**: next-themes

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Set environment variables
4. Deploy

```bash
# Or use Vercel CLI
npm i -g vercel
vercel
```

### Environment Variables on Vercel

Set these in Vercel Dashboard → Settings → Environment Variables:
- `NEXT_PUBLIC_CRONOS_RPC_URL`
- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- All contract addresses
- All API endpoints

### Build Settings

- **Framework Preset**: Next.js
- **Build Command**: `npm run build:next`
- **Output Directory**: `.next`
- **Install Command**: `npm install`
- **Development Command**: `npm run dev:next`

## Development

### Run Linting
```bash
npm run lint
```

### Format Code
```bash
npm run format
```

### Type Checking
```bash
npm run typecheck
```

### Run All Checks
```bash
npm run lint && npm run typecheck
```

## Adding New Pages

Create a new folder in `app/`:

```typescript
// app/agents/page.tsx
export default function AgentsPage() {
  return <div>Agents Page</div>;
}
```

## Adding New Components

Create in `components/`:

```typescript
// components/MyComponent.tsx
'use client';

export function MyComponent() {
  return <div>My Component</div>;
}
```

## API Routes

Create in `app/api/`:

```typescript
// app/api/hello/route.ts
export async function GET() {
  return Response.json({ message: 'Hello' });
}
```

## Troubleshooting

### Hydration Errors
Ensure client components use `'use client'` directive.

### Wallet Connection Issues
Check RPC URL and chain ID are correct.

### Build Errors
Run `npm run typecheck` to find TypeScript errors.

### Styling Issues
Check Tailwind config includes all component paths.

## Performance

- **Image Optimization**: Use Next.js `<Image>` component
- **Code Splitting**: Automatic with App Router
- **Bundle Analysis**: Run `ANALYZE=true npm run build`
- **Caching**: Configured in `next.config.js`

## Security

- **Content Security Policy**: Set in headers
- **XSS Protection**: Enabled
- **HTTPS Only**: Enforced in production
- **Secure Headers**: Configured in `next.config.js`

## Support

For issues or questions:
1. Check this README
2. Review Next.js documentation
3. Check component code comments
4. Open an issue on GitHub

---

**Status**: ✅ Ready for Development

Run `npm run dev:next` to start!
