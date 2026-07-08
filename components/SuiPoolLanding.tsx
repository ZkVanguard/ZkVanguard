'use client';

import { memo, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightIcon, ShieldCheckIcon, BoltIcon, ChartBarIcon,
  SparklesIcon, CubeTransparentIcon, LockClosedIcon,
} from '@heroicons/react/24/outline';

// ───────────────────────────────────────────────────────────────────────────
// Live SUI Community Pool landing page — Apple-themed, single focus.
//
// Pulls real-time numbers from /api/sui/community-pool?network=mainnet
// (cached 30s server-side), so a fresh visitor sees actual NAV / share price /
// composition / ATH instead of stale marketing.
//
// Design tokens: tailwind.config.js `ios.*`, `system-bg.*`, `label.*`,
// typography `large-title`, `title-1`, `headline`, etc., shadows `ios-1/2/3`.
// No warm `claude-*` colors anywhere.
// ───────────────────────────────────────────────────────────────────────────

interface PoolSummary {
  totalNAV: number;        // USDC
  sharePrice: number;
  allTimeHighNav: number;  // ATH share price
  totalDeposited: number;
  totalWithdrawn: number;
  memberCount: number;
  totalShares: number;
  allocation: Record<string, number>; // live composition (BTC/ETH/SUI/USDC)
  paused: boolean;
}

const ASSET_ICONS: Record<string, string> = {
  BTC: '₿', ETH: 'Ξ', SUI: '💧', USDC: '$',
};
const ASSET_GRADIENTS: Record<string, string> = {
  BTC: 'from-[#F7931A] to-[#FBB040]',
  ETH: 'from-[#627EEA] to-[#8FA5F2]',
  SUI: 'from-[#4DA2FF] to-[#79C2FF]',
  USDC: 'from-[#2775CA] to-[#4A9CE8]',
};

function formatUsd(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) {
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return '$' + n.toFixed(decimals);
}

function formatPct(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

export const SuiPoolLanding = memo(function SuiPoolLanding() {
  const [pool, setPool] = useState<PoolSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/sui/community-pool?network=mainnet');
        const j = await r.json();
        if (!cancelled && j?.success && j?.data) {
          const d = j.data;
          setPool({
            totalNAV: Number(d.totalNAV ?? 0),
            sharePrice: Number(d.sharePrice ?? 1),
            allTimeHighNav: Number(d.allTimeHighNav ?? 1),
            totalDeposited: Number(d.totalDeposited ?? 0),
            totalWithdrawn: Number(d.totalWithdrawn ?? 0),
            memberCount: Number(d.memberCount ?? 0),
            totalShares: Number(d.totalShares ?? 0),
            allocation: d.allocation ?? {},
            paused: !!d.paused,
          });
        }
      } catch {
        /* silent — show fallback */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30000); // refresh every 30s
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const returnPct = pool ? ((pool.sharePrice - 1) / 1) * 100 : 0;
  const profitUsd = pool ? pool.totalNAV - (pool.totalDeposited - pool.totalWithdrawn) : 0;
  const offAthPct = pool ? ((pool.sharePrice - pool.allTimeHighNav) / pool.allTimeHighNav) * 100 : 0;

  // Build allocation legend (positive entries only)
  const allocationEntries = pool
    ? Object.entries(pool.allocation || {})
        .filter(([, v]) => Number(v) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
    : [];

  return (
    <div className="bg-system-bg-primary text-label-primary">
      {/* ─────────────────────────────────────────────────────────────── */}
      {/* HERO                                                            */}
      {/* ─────────────────────────────────────────────────────────────── */}
      <section className="relative pt-24 pb-16 sm:pt-32 sm:pb-24 lg:pt-40 lg:pb-32 px-5 lg:px-8 overflow-hidden">
        {/* Apple-style soft gradient backdrop */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-system-bg-tertiary via-system-bg-primary to-system-bg-primary" />
        <div
          className="absolute -z-10 top-0 left-1/2 -translate-x-1/2 w-[120%] h-[600px] opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(0,122,255,0.15) 0%, rgba(0,122,255,0) 60%)',
          }}
        />

        <div className="max-w-[1100px] mx-auto">
          {/* Status pill */}
          <div className="flex items-center justify-center mb-8 sm:mb-10">
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-system-bg-grouped border border-separator-opaque/40">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-ios-green opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-ios-green" />
              </span>
              <span className="text-footnote font-medium text-label-secondary">
                Live on SUI Mainnet
              </span>
              <span className="w-px h-3 bg-separator-opaque/40" />
              <span className="text-footnote font-semibold text-label-primary">
                {pool?.memberCount ?? 0} members
              </span>
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-center text-[44px] sm:text-[64px] lg:text-[80px] font-bold tracking-[-0.03em] leading-[1.05] text-label-primary mb-6 sm:mb-8">
            AI-managed USDC vault.
            <br />
            <span className="bg-gradient-to-r from-ios-blue to-[#5AC8FA] bg-clip-text text-transparent">
              Real returns. On chain.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-center text-callout sm:text-[20px] text-label-secondary max-w-[640px] mx-auto leading-[1.5] mb-10 sm:mb-12">
            Deposit USDC. A 7-agent system allocates across BTC, ETH, and SUI
            with auto-hedged perp protection on BlueFin. Verified by ZK-STARK
            proofs.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14 sm:mb-16">
            <Link
              href="/dashboard"
              className="group inline-flex items-center justify-center gap-2 px-8 h-[52px] sm:h-[56px] bg-ios-blue text-white text-headline font-semibold rounded-ios-xl hover:bg-[#0062CC] active:scale-[0.97] transition-all duration-200 shadow-ios-2 w-full sm:w-auto"
            >
              Deposit USDC
              <ArrowRightIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" strokeWidth={2.5} />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-1 h-[52px] sm:h-[56px] px-2 text-headline font-medium text-label-secondary hover:text-ios-blue transition-colors"
            >
              How it works
              <ArrowRightIcon className="w-4 h-4" strokeWidth={2.25} />
            </a>
          </div>

          {/* ─── LIVE STATS BAR ─── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 max-w-[920px] mx-auto">
            <StatCard
              label="Pool NAV"
              value={loading ? '—' : formatUsd(pool?.totalNAV ?? 0)}
              hint="Total assets under management"
              loading={loading}
            />
            <StatCard
              label="Share Price"
              value={loading ? '—' : `$${(pool?.sharePrice ?? 1).toFixed(4)}`}
              hint={`Started at $1.0000  ·  ATH $${(pool?.allTimeHighNav ?? 1).toFixed(4)}`}
              loading={loading}
            />
            <StatCard
              label="Total Return"
              value={loading ? '—' : formatPct(returnPct)}
              hint={`Off ATH ${formatPct(offAthPct, 2)}`}
              valueClass={returnPct >= 0 ? 'text-ios-green' : 'text-ios-red'}
              loading={loading}
            />
            <StatCard
              label="Members"
              value={loading ? '—' : String(pool?.memberCount ?? 0)}
              hint={loading ? '' : `${(pool?.totalShares ?? 0).toFixed(2)} shares issued`}
              loading={loading}
            />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* LIVE COMPOSITION                                                */}
      {/* ─────────────────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-5 lg:px-8 bg-system-bg-secondary">
        <div className="max-w-[1100px] mx-auto">
          <div className="flex flex-col lg:flex-row gap-12 lg:gap-16 items-start">
            {/* Left: heading */}
            <div className="lg:max-w-[420px] lg:sticky lg:top-24">
              <p className="text-caption-1 font-semibold uppercase tracking-wide text-ios-blue mb-3">
                Live composition
              </p>
              <h2 className="text-[34px] sm:text-[40px] lg:text-[48px] font-bold tracking-[-0.02em] leading-[1.1] text-label-primary mb-5">
                Where your USDC is right now.
              </h2>
              <p className="text-callout text-label-secondary leading-[1.55]">
                The AI rebalances every 30 minutes across BTC, ETH and SUI based
                on live market signals. Idle USDC counts as a defensive bucket.
                Refreshes every 30s.
              </p>
            </div>

            {/* Right: allocation visualization */}
            <div className="flex-1 w-full">
              {!loading && allocationEntries.length > 0 ? (
                <div className="bg-system-bg-primary rounded-ios-xl p-6 sm:p-8 shadow-ios-1 border border-separator-opaque/30">
                  {/* Stack bar */}
                  <div className="h-3 rounded-full overflow-hidden flex mb-6 bg-system-bg-grouped">
                    {allocationEntries.map(([asset, pct]) => (
                      <div
                        key={asset}
                        className={`bg-gradient-to-r ${ASSET_GRADIENTS[asset] || 'from-gray-300 to-gray-400'}`}
                        style={{ width: `${pct}%` }}
                        title={`${asset} ${pct}%`}
                      />
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                    {allocationEntries.map(([asset, pct]) => (
                      <div key={asset} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-ios bg-gradient-to-br ${
                              ASSET_GRADIENTS[asset] || 'from-gray-300 to-gray-400'
                            } flex items-center justify-center text-white text-base font-semibold shadow-ios-1`}
                          >
                            {ASSET_ICONS[asset] || '?'}
                          </div>
                          <div>
                            <div className="text-headline font-semibold text-label-primary">{asset}</div>
                            <div className="text-caption-1 text-label-tertiary">
                              {pool ? formatUsd((pool.totalNAV * Number(pct)) / 100, 2) : '—'}
                            </div>
                          </div>
                        </div>
                        <div className="text-title-3 font-semibold text-label-primary tabular-nums">
                          {Number(pct).toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-system-bg-primary rounded-ios-xl p-8 shadow-ios-1 border border-separator-opaque/30 animate-pulse">
                  <div className="h-3 bg-system-bg-grouped rounded-full mb-6" />
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-ios bg-system-bg-grouped" />
                          <div className="w-16 h-4 bg-system-bg-grouped rounded" />
                        </div>
                        <div className="w-12 h-4 bg-system-bg-grouped rounded" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* HOW IT WORKS                                                    */}
      {/* ─────────────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 sm:py-28 px-5 lg:px-8 bg-system-bg-primary">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-14 sm:mb-16">
            <p className="text-caption-1 font-semibold uppercase tracking-wide text-ios-blue mb-3">
              How it works
            </p>
            <h2 className="text-[34px] sm:text-[44px] lg:text-[52px] font-bold tracking-[-0.02em] leading-[1.1] text-label-primary mb-4">
              Three things working together.
            </h2>
            <p className="text-callout text-label-secondary max-w-[560px] mx-auto leading-[1.55]">
              A continuous loop runs every 30 minutes. You just deposit and watch.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
            <FeatureCard
              icon={<SparklesIcon className="w-6 h-6" />}
              accent="from-[#007AFF] to-[#5AC8FA]"
              eyebrow="Step 1"
              title="AI decides"
              body="Seven specialised agents fuse Polymarket prediction signals, Crypto.com price feeds and funding rates into one allocation target."
            />
            <FeatureCard
              icon={<BoltIcon className="w-6 h-6" />}
              accent="from-[#34C759] to-[#30D158]"
              eyebrow="Step 2"
              title="Pool rebalances"
              body="USDC is swapped on-chain across BTC, ETH and SUI via the 7k aggregator. Drift-based — only trades when allocation actually shifts."
            />
            <FeatureCard
              icon={<ShieldCheckIcon className="w-6 h-6" />}
              accent="from-[#AF52DE] to-[#BF5AF2]"
              eyebrow="Step 3"
              title="Hedges open"
              body="A matching BlueFin perp position is opened or adjusted to delta-neutralise downside while keeping upside exposure."
            />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* TRUST STRIP — safety guarantees on chain                        */}
      {/* ─────────────────────────────────────────────────────────────── */}
      <section className="py-16 sm:py-24 px-5 lg:px-8 bg-system-bg-secondary">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-12">
            <p className="text-caption-1 font-semibold uppercase tracking-wide text-ios-blue mb-3">
              Built for trust
            </p>
            <h2 className="text-[28px] sm:text-[36px] lg:text-[42px] font-bold tracking-[-0.02em] leading-[1.15] text-label-primary mb-3">
              Every safety guard is on chain.
            </h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <TrustCard
              icon={<LockClosedIcon className="w-5 h-5" />}
              title="TVL cap"
              value="$10,000"
              hint="Hard ceiling enforced in Move"
            />
            <TrustCard
              icon={<CubeTransparentIcon className="w-5 h-5" />}
              title="NAV oracle"
              value="Strict mode"
              hint="Deposits revert if attestation is > 2 h stale"
            />
            <TrustCard
              icon={<ShieldCheckIcon className="w-5 h-5" />}
              title="Withdraw cap"
              value="25% / day"
              hint="Per-tx safety throttle"
            />
            <TrustCard
              icon={<ChartBarIcon className="w-5 h-5" />}
              title="ZK-STARK proofs"
              value="Post-quantum"
              hint="Risk attestations published"
            />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* PLATFORM SURFACES — discoverability for the BlackRock-shaped views */}
      {/* ─────────────────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-24 px-5 lg:px-8 bg-system-bg-secondary border-y border-separator-opaque/20">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10 sm:mb-12">
            <div className="inline-block text-caption-1 font-semibold uppercase tracking-wide text-label-tertiary mb-3">
              How it works
            </div>
            <h2 className="text-[28px] sm:text-[36px] lg:text-[44px] font-bold tracking-[-0.02em] leading-[1.1] text-label-primary mb-4">
              An asset manager you can audit line by line.
            </h2>
            <p className="text-callout sm:text-[18px] text-label-secondary max-w-[640px] mx-auto leading-[1.5]">
              A 7-agent orchestration fuses prediction-market signals, executes
              hedges on BlueFin, and ZK-attests every meaningful decision — all
              live on Sui mainnet.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <SurfaceCard
              href="/dashboard/portfolio"
              eyebrow="Your position"
              title="Pool shares + attributed hedges."
              body="See what you own in the vault and which hedges are covering your risk."
            />
            <SurfaceCard
              href="/dashboard/risk"
              eyebrow="Platform risk"
              title="Live vault dashboard."
              body="Real-time TVL, drawdown, hedge coverage, cron health, ZK attestation feed. Auto-refresh 60s."
            />
            <SurfaceCard
              href="/rwa"
              eyebrow="RWA custody"
              title="Real-world assets, provably backed."
              body="Custodian-signed attestations bind portfolios to off-chain assets — without revealing the list. For issuers, custodians, institutions."
            />
            <SurfaceCard
              href="/agents"
              eyebrow="7-agent system"
              title="Autonomous orchestration."
              body="Lead, Risk, Hedging, Settlement, Reporting, PriceMonitor, SuiPool — running 24/7 with 2-of-3 consensus on trades &gt; $100k."
            />
            <SurfaceCard
              href="/zk"
              eyebrow="ZK-STARK system"
              title="Post-quantum verifiable AI."
              body="CUDA-accelerated STARK prover. ~180-bit soundness, no trusted setup, verifiable in the browser."
            />
            <SurfaceCard
              href="/whitepaper"
              eyebrow="Whitepaper"
              title="Read the full thesis."
              body="Prediction-market alpha, 7-agent architecture, STARK-attested execution, tokenomics, roadmap."
            />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/* FOOTER CTA                                                      */}
      {/* ─────────────────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 px-5 lg:px-8 bg-system-bg-primary">
        <div className="max-w-[800px] mx-auto text-center">
          <h2 className="text-[34px] sm:text-[44px] lg:text-[52px] font-bold tracking-[-0.02em] leading-[1.1] text-label-primary mb-5">
            Join in seconds.
          </h2>
          <p className="text-callout sm:text-[20px] text-label-secondary mb-8 leading-[1.5]">
            Connect a SUI wallet, deposit any amount of USDC, and let the
            AI work. Currently {pool?.memberCount ?? 0}{' '}
            members{pool && pool.totalNAV > 0 ? ` sharing ${formatUsd(profitUsd)} in realised profit` : ''}.
          </p>
          <Link
            href="/dashboard"
            className="group inline-flex items-center justify-center gap-2 px-10 h-[56px] bg-ios-blue text-white text-headline font-semibold rounded-ios-xl hover:bg-[#0062CC] active:scale-[0.97] transition-all duration-200 shadow-ios-2"
          >
            Open Dashboard
            <ArrowRightIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" strokeWidth={2.5} />
          </Link>
          {pool?.paused && (
            <p className="mt-6 text-footnote text-ios-orange font-medium">
              Note: deposits are currently paused for maintenance.
            </p>
          )}
        </div>
      </section>
    </div>
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────────────

function StatCard({
  label, value, hint, valueClass = 'text-label-primary', loading = false,
}: {
  label: string; value: string; hint?: string; valueClass?: string; loading?: boolean;
}) {
  return (
    <div className="bg-system-bg-primary rounded-ios-xl p-5 sm:p-6 shadow-ios-1 border border-separator-opaque/30">
      <div className="text-caption-1 font-medium uppercase tracking-wide text-label-tertiary mb-2">
        {label}
      </div>
      <div className={`text-title-2 sm:text-title-1 font-bold tabular-nums ${valueClass} ${loading ? 'animate-pulse' : ''}`}>
        {value}
      </div>
      {hint && (
        <div className="text-caption-1 text-label-tertiary mt-1.5 tabular-nums truncate">{hint}</div>
      )}
    </div>
  );
}

function FeatureCard({
  icon, accent, eyebrow, title, body,
}: {
  icon: React.ReactNode; accent: string; eyebrow: string; title: string; body: string;
}) {
  return (
    <div className="bg-system-bg-secondary rounded-ios-xl p-6 sm:p-7 border border-separator-opaque/30 hover:shadow-ios-2 transition-shadow duration-300">
      <div
        className={`inline-flex items-center justify-center w-11 h-11 rounded-ios bg-gradient-to-br ${accent} text-white mb-5 shadow-ios-1`}
      >
        {icon}
      </div>
      <div className="text-caption-1 font-semibold uppercase tracking-wide text-label-tertiary mb-1.5">
        {eyebrow}
      </div>
      <h3 className="text-title-3 font-semibold text-label-primary mb-2">{title}</h3>
      <p className="text-subheadline text-label-secondary leading-[1.55]">{body}</p>
    </div>
  );
}

function TrustCard({
  icon, title, value, hint,
}: {
  icon: React.ReactNode; title: string; value: string; hint: string;
}) {
  return (
    <div className="bg-system-bg-primary rounded-ios-xl p-5 sm:p-6 border border-separator-opaque/30 shadow-ios-1">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-ios-blue">{icon}</div>
        <div className="text-caption-1 font-semibold uppercase tracking-wide text-label-tertiary">
          {title}
        </div>
      </div>
      <div className="text-title-3 sm:text-title-2 font-bold text-label-primary mb-1">{value}</div>
      <div className="text-caption-1 text-label-tertiary leading-[1.4]">{hint}</div>
    </div>
  );
}

function SurfaceCard({
  href, eyebrow, title, body,
}: {
  href: string; eyebrow: string; title: string; body: string;
}) {
  return (
    <Link
      href={href}
      className="group block bg-system-bg-primary rounded-ios-xl p-5 sm:p-6 border border-separator-opaque/30 hover:shadow-ios-2 hover:border-ios-blue/30 transition-all duration-300"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-caption-1 font-semibold uppercase tracking-wide text-label-tertiary">
          {eyebrow}
        </div>
        <ArrowRightIcon
          className="w-4 h-4 text-label-tertiary group-hover:text-ios-blue group-hover:translate-x-1 transition-all"
          strokeWidth={2}
        />
      </div>
      <h3 className="text-headline font-semibold text-label-primary mb-1.5 leading-tight">
        {title}
      </h3>
      <p className="text-subheadline text-label-secondary leading-[1.5]">{body}</p>
    </Link>
  );
}
