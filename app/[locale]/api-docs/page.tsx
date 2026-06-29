'use client';

import { Activity, Shield, Brain, Layers, Code2, Zap, Eye, Lock, Mail } from 'lucide-react';

interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  tier: 'public' | 'auth-pending';
  category: string;
}

const ENDPOINTS: ApiEndpoint[] = [
  // === Risk engine (the Aladdin core) ===
  { method: 'GET', path: '/api/platform/risk-overview', summary: 'Platform-wide AUM, drawdown, hedge coverage, cron health, ZK attestation feed', tier: 'public', category: 'risk' },
  { method: 'GET', path: '/api/health/production', summary: 'Operational health of every critical component (DB, RPC, BlueFin, crons)', tier: 'public', category: 'risk' },
  { method: 'GET', path: '/api/portfolio/unified?wallet={addr}', summary: 'Single wallet exposure aggregated across all products + hedge attribution', tier: 'public', category: 'risk' },
  { method: 'POST', path: '/api/agents/risk/assess', summary: 'Submit portfolio state, get RiskAgent evaluation (VaR, concentration, cascade detection)', tier: 'auth-pending', category: 'risk' },

  // === Prediction signal pipeline ===
  { method: 'GET', path: '/api/predictions/per-asset', summary: 'Per-asset fused prediction signal (Polymarket 5-min binaries + Manifold + funding + momentum)', tier: 'public', category: 'signals' },
  { method: 'GET', path: '/api/polymarket/5min-signal', summary: 'Latest BTC/ETH 5-min binary signal with probability, confidence, window state', tier: 'public', category: 'signals' },
  { method: 'GET', path: '/api/market-data', summary: 'Real-time prices + 24h change + volume + funding rates across tracked assets', tier: 'public', category: 'signals' },

  // === AI agent orchestration ===
  { method: 'GET', path: '/api/agents/status', summary: 'Health of all 7 agents (Lead, Risk, Hedging, Settlement, Reporting, PriceMonitor, SuiPool)', tier: 'public', category: 'agents' },
  { method: 'GET', path: '/api/agents/insight-summary', summary: 'AI-generated plain-English summary of portfolio state + recommendations', tier: 'public', category: 'agents' },
  { method: 'GET', path: '/api/agents/lead-cycle/latest', summary: 'Latest autonomous 7-agent decision cycle (consensus votes, ZK proof hashes, executed actions)', tier: 'public', category: 'agents' },
  { method: 'POST', path: '/api/agents/command', summary: 'Direct command to a specific agent (analyze_risk, execute_hedge, etc.)', tier: 'auth-pending', category: 'agents' },

  // === Hedge execution ===
  { method: 'POST', path: '/api/agents/hedging/execute', summary: 'Open a hedge with multi-venue routing (BlueFin / Hyperliquid / Moonlander) and signal-flip exit logic', tier: 'auth-pending', category: 'hedge' },
  { method: 'POST', path: '/api/agents/hedging/close', summary: 'Close a specific hedge', tier: 'auth-pending', category: 'hedge' },
  { method: 'POST', path: '/api/agents/hedging/open-onchain-gasless', summary: 'Open hedge via x402 + ZKPaymaster — merchant-sponsored, user pays $0 gas', tier: 'auth-pending', category: 'hedge' },
  { method: 'GET', path: '/api/admin/route-hedge', summary: 'Test PerpVenueRouter — show optimal split across venues for a hypothetical hedge', tier: 'auth-pending', category: 'hedge' },

  // === ZK proofs ===
  { method: 'POST', path: '/api/zk-proof/generate', summary: 'Generate NIST P-521 STARK proof for hedge / portfolio / risk-decision / custody / compliance scenarios', tier: 'public', category: 'zk' },
  { method: 'POST', path: '/api/zk-proof/verify', summary: 'Verify a STARK proof on-chain via zk_verifier.move', tier: 'public', category: 'zk' },
  { method: 'POST', path: '/api/zk-proof/store-onchain', summary: 'Commit proof hash on-chain for permanent audit trail', tier: 'auth-pending', category: 'zk' },

  // === Pool + portfolio operations ===
  { method: 'GET', path: '/api/sui/community-pool', summary: 'SUI USDC pool state, 4-asset allocation, member position queries, swap quotes', tier: 'public', category: 'pool' },
  { method: 'GET', path: '/api/community-pool', summary: 'Pool stats, members, allocations, NAV (Cronos)', tier: 'public', category: 'pool' },
  { method: 'GET', path: '/api/portfolio/list?address={addr}', summary: 'List wallet portfolios (EVM)', tier: 'public', category: 'pool' },
  { method: 'GET', path: '/api/portfolio/{id}', summary: 'Detailed portfolio state, positions, hedges, NAV, share price', tier: 'public', category: 'pool' },

  // === Settlement + gasless ===
  { method: 'POST', path: '/api/x402/challenge', summary: 'Issue 402 Payment Required challenge for gated content', tier: 'public', category: 'settlement' },
  { method: 'POST', path: '/api/x402/settle', summary: 'Verify x402 payment proof, grant resource access', tier: 'public', category: 'settlement' },
  { method: 'POST', path: '/api/x402/swap', summary: 'Execute gasless cross-token swap', tier: 'auth-pending', category: 'settlement' },
];

const CATEGORIES = [
  { id: 'risk', label: 'Risk engine', icon: Shield, blurb: 'Aladdin-equivalent. The same risk infrastructure ZkVanguard uses on its own funds, exposed as APIs.' },
  { id: 'signals', label: 'Signal pipeline', icon: Activity, blurb: 'Fused prediction-market alpha (Polymarket + Manifold + funding + momentum) with multi-timeframe drift detection.' },
  { id: 'agents', label: 'AI agent orchestration', icon: Brain, blurb: '7-agent autonomous engine with 2/3 consensus voting and ZK attestation on trade-impacting decisions.' },
  { id: 'hedge', label: 'Hedge execution', icon: Zap, blurb: 'Multi-venue perp routing (BlueFin / Hyperliquid / Moonlander) with funding-rate-aware splits.' },
  { id: 'zk', label: 'ZK proofs', icon: Lock, blurb: 'Post-quantum STARK (NIST P-521, no trusted setup). Five proof types: hedge, portfolio ownership, risk decision, custody, compliance.' },
  { id: 'pool', label: 'Pool & portfolio', icon: Layers, blurb: 'Read state and operations on the SUI USDC community pool + EVM portfolio variants.' },
  { id: 'settlement', label: 'Settlement & gasless', icon: Eye, blurb: 'x402 protocol + ZKPaymaster meta-transactions. Sponsor user gas on hedge/deposit flows.' },
];

function MethodBadge({ method }: { method: 'GET' | 'POST' }) {
  return (
    <span className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${method === 'GET' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
      {method}
    </span>
  );
}

function TierBadge({ tier }: { tier: 'public' | 'auth-pending' }) {
  return tier === 'public' ? (
    <span className="text-[10px] uppercase tracking-wide font-medium text-green-700">public</span>
  ) : (
    <span className="text-[10px] uppercase tracking-wide font-medium text-amber-700">auth · pending</span>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <header className="space-y-3">
        <div className="text-[12px] text-[#86868b] uppercase tracking-wide font-medium">API surface</div>
        <h1 className="text-[36px] font-semibold text-[#1d1d1f] tracking-[-0.02em]">
          Aladdin-as-a-Service for Sui
        </h1>
        <p className="text-[17px] text-[#1d1d1f] leading-relaxed max-w-3xl">
          ZkVanguard runs three live products on a shared risk engine + signal pipeline + ZK
          attestation stack. The same APIs that power our internal funds are available for other
          Sui projects to build on — vaults, DEXes, treasury managers, RWA tokenizers.
        </p>
        <p className="text-[13px] text-[#86868b] max-w-3xl">
          ~50 endpoints across 7 categories. Public endpoints are accessible without auth (rate
          limited per IP). Production-grade endpoints flagged <code className="bg-[#f5f5f7] px-1.5 py-0.5 rounded">auth · pending</code> will
          require an API key after the Tranche 2-3 productization (Stripe billing + per-key quotas).
        </p>
      </header>

      {/* Aladdin framing */}
      <section className="bg-gradient-to-br from-[#f5f5f7] to-white border border-black/5 rounded-2xl p-6">
        <div className="flex items-start gap-3 mb-3">
          <Code2 className="w-5 h-5 text-[#4ca3ff] mt-1" />
          <h2 className="text-[20px] font-semibold text-[#1d1d1f] tracking-[-0.02em]">
            Why this matters
          </h2>
        </div>
        <p className="text-[14px] text-[#1d1d1f] leading-relaxed mb-3">
          BlackRock's $1B+ ARR Aladdin moat isn't its AUM — it's that 200+ external asset managers
          pay to use its risk engine. ZkVanguard takes the same shape on Sui: <strong>the risk
          engine, signal pipeline, agent orchestrator, and ZK attestation primitives that we run our
          own funds on are productized as B2B infrastructure for the entire Sui ecosystem.</strong>
        </p>
        <p className="text-[13px] text-[#86868b]">
          Today: 50+ endpoints documented, public read access. After audit + Tranche 2 productization:
          API-key auth + per-tier quotas + Stripe billing.
        </p>
      </section>

      {/* Per-category sections */}
      {CATEGORIES.map((cat) => {
        const Icon = cat.icon;
        const endpoints = ENDPOINTS.filter((e) => e.category === cat.id);
        return (
          <section key={cat.id} className="space-y-3">
            <div className="flex items-center gap-2 border-b border-black/5 pb-2">
              <Icon className="w-4 h-4 text-[#1d1d1f]" />
              <h2 className="text-[20px] font-semibold text-[#1d1d1f]">{cat.label}</h2>
              <span className="text-[11px] text-[#86868b]">({endpoints.length} endpoints)</span>
            </div>
            <p className="text-[13px] text-[#86868b] max-w-3xl">{cat.blurb}</p>
            <div className="space-y-1">
              {endpoints.map((e) => (
                <div key={`${e.method}-${e.path}`} className="flex items-start gap-3 py-2 border-b border-black/5 last:border-b-0">
                  <div className="flex items-center gap-2 min-w-[420px]">
                    <MethodBadge method={e.method} />
                    <code className="font-mono text-[12px] text-[#1d1d1f]">{e.path}</code>
                  </div>
                  <div className="text-[13px] text-[#1d1d1f] flex-1">{e.summary}</div>
                  <TierBadge tier={e.tier} />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* Example call */}
      <section className="bg-[#0A0E1A] text-[#e1e4e8] rounded-2xl p-6">
        <div className="text-[12px] text-[#86868b] uppercase tracking-wide font-medium mb-3">
          Example — fetch live platform risk
        </div>
        <pre className="font-mono text-[12px] leading-relaxed overflow-x-auto">
{`# Public, no auth needed today
curl -s https://www.zkvanguard.xyz/api/platform/risk-overview \\
  | jq '.platform.tvlUsd, .hedge.coverageRatio, .reconciliation.healthyCount'

# Per-wallet exposure across all products
curl -s 'https://www.zkvanguard.xyz/api/portfolio/unified?wallet=0x...' \\
  | jq '.totals.nav, .totals.unrealizedPnlPct'

# Fused prediction signal driving the autonomous trader
curl -s https://www.zkvanguard.xyz/api/predictions/per-asset \\
  | jq '.predictions[] | { asset, direction, confidence, recommendation }'`}
        </pre>
      </section>

      {/* Tier roadmap */}
      <section className="space-y-3">
        <h2 className="text-[20px] font-semibold text-[#1d1d1f] border-b border-black/5 pb-2">
          Tier roadmap
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-black/5 rounded-2xl p-5">
            <div className="text-[12px] text-green-700 uppercase tracking-wide font-medium mb-2">Free · live now</div>
            <div className="text-[15px] font-semibold text-[#1d1d1f] mb-2">Public read APIs</div>
            <ul className="text-[13px] text-[#86868b] space-y-1">
              <li>· 120 req/min per IP</li>
              <li>· No auth required</li>
              <li>· Real-time platform state, signals, agent activity</li>
              <li>· Suitable for dashboards, monitoring, research</li>
            </ul>
          </div>
          <div className="border border-black/5 rounded-2xl p-5">
            <div className="text-[12px] text-amber-700 uppercase tracking-wide font-medium mb-2">Pro · Tranche 2</div>
            <div className="text-[15px] font-semibold text-[#1d1d1f] mb-2">Authenticated write APIs</div>
            <ul className="text-[13px] text-[#86868b] space-y-1">
              <li>· API key required</li>
              <li>· Hedge open/close, ZK proof commit</li>
              <li>· Agent command + consensus voting</li>
              <li>· 1,000 req/min per key</li>
            </ul>
          </div>
          <div className="border border-black/5 rounded-2xl p-5">
            <div className="text-[12px] text-[#4ca3ff] uppercase tracking-wide font-medium mb-2">Enterprise · Tranche 3</div>
            <div className="text-[15px] font-semibold text-[#1d1d1f] mb-2">White-label + SDK</div>
            <ul className="text-[13px] text-[#86868b] space-y-1">
              <li>· Custody attestation primitive</li>
              <li>· Dedicated SLAs</li>
              <li>· On-prem deployment available</li>
              <li>· TypeScript SDK + sample apps</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="bg-white border border-black/5 rounded-2xl p-6 text-center">
        <Mail className="w-6 h-6 text-[#4ca3ff] mx-auto mb-3" />
        <h2 className="text-[20px] font-semibold text-[#1d1d1f] mb-2">
          Building on this infrastructure?
        </h2>
        <p className="text-[14px] text-[#86868b] mb-4 max-w-2xl mx-auto">
          We're shipping API-key auth, Stripe billing, and the TypeScript SDK as the Tranche 2-3
          grant deliverables. Reach out if you want early-access integration — we'll fast-track
          your project.
        </p>
        <a
          href="mailto:ashishregmi2017@gmail.com?subject=ZkVanguard%20API%20early%20access"
          className="inline-flex items-center gap-2 bg-[#1d1d1f] text-white px-5 py-2.5 rounded-xl text-[14px] font-semibold hover:bg-[#0A0E1A]"
        >
          <Mail className="w-4 h-4" /> Request early access
        </a>
      </section>

      <footer className="text-center text-[11px] text-[#86868b] pt-4">
        ZkVanguard · SUI mainnet · 50+ endpoints · 1,713 LOC ZK primitives · audit pending
      </footer>
    </div>
  );
}
