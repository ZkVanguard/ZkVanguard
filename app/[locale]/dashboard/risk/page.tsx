'use client';

import { useEffect, useState } from 'react';
import {
  Activity, Shield, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, Clock, Layers, Database, Zap, Eye,
} from 'lucide-react';
import { logger } from '@/lib/utils/logger';

interface HedgeRow {
  market: string;
  side: 'LONG' | 'SHORT';
  notionalUsd: number;
  unrealizedPnlUsd: number;
  leverage: number;
  ageMinutes: number;
}

interface CronHealth {
  key: string;
  ageMinutes: number;
  status: 'ok' | 'warn' | 'stale';
}

interface ZkAttestationRow {
  market: string;
  side: string;
  zkProofHash: string;
  createdAt: string;
}

interface RiskOverview {
  asOf: string;
  platform: {
    tvlUsd: number;
    netCapitalDeposited: number;
    netCapitalReturn: { absoluteUsd: number; percent: number };
    memberCount: number;
    sharePrice: number;
    peakSharePrice: number;
    drawdownPct: number;
    sharePriceReturn: number;
  };
  hedge: {
    activeCount: number;
    totalNotionalUsd: number;
    totalUnrealizedPnlUsd: number;
    coverageRatio: number;
    positions: HedgeRow[];
  };
  reconciliation: {
    cronHealth: CronHealth[];
    healthyCount: number;
    warnCount: number;
    staleCount: number;
  };
  zkAttestations: {
    last24hCount: number;
    recentFeed: ZkAttestationRow[];
  };
  signals: {
    BTC?: { direction: string; confidence: number };
    ETH?: { direction: string; confidence: number };
  };
}

function fmtUsd(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
function fmtPct(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}
function fmtAge(min: number): string {
  if (!Number.isFinite(min)) return '∞';
  if (min < 60) return `${min.toFixed(1)} min`;
  return `${(min / 60).toFixed(1)} h`;
}

function StatusDot({ status }: { status: 'ok' | 'warn' | 'stale' }) {
  const color = status === 'ok' ? 'bg-green-500' : status === 'warn' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function StatCard({ label, value, sub, icon: Icon, tone = 'neutral' }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'neutral' | 'positive' | 'negative' | 'warn';
}) {
  const toneClass = tone === 'positive' ? 'text-green-700'
    : tone === 'negative' ? 'text-red-700'
    : tone === 'warn' ? 'text-amber-700'
    : 'text-[#1d1d1f]';
  return (
    <div className="bg-white border border-black/5 rounded-2xl p-5">
      <div className="flex items-center gap-2 text-[#86868b] text-[12px] font-medium mb-2">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-[28px] font-semibold tracking-[-0.02em] ${toneClass}`}>{value}</div>
      {sub && <div className="text-[13px] text-[#86868b] mt-1">{sub}</div>}
    </div>
  );
}

function HedgePositionRow({ h }: { h: HedgeRow }) {
  const pnlPositive = h.unrealizedPnlUsd >= 0;
  return (
    <div className="grid grid-cols-12 gap-2 py-2.5 border-b border-black/5 last:border-b-0 items-center text-[13px]">
      <div className="col-span-3 font-semibold text-[#1d1d1f]">
        {h.market}
        <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${h.side === 'LONG' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {h.side}
        </span>
      </div>
      <div className="col-span-2 text-right font-mono text-[#1d1d1f]">{fmtUsd(h.notionalUsd)}</div>
      <div className="col-span-2 text-right text-[#86868b]">{h.leverage}×</div>
      <div className={`col-span-2 text-right font-mono font-medium ${pnlPositive ? 'text-green-700' : 'text-red-700'}`}>
        {fmtUsd(h.unrealizedPnlUsd)}
      </div>
      <div className="col-span-3 text-right text-[12px] text-[#86868b]">{fmtAge(h.ageMinutes)} ago</div>
    </div>
  );
}

export default function PlatformRiskPage() {
  const [data, setData] = useState<RiskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/platform/risk-overview')
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((json) => { if (!cancelled) setData(json as RiskOverview); })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.error('[RiskPage] fetch failed', { error: msg });
          if (!cancelled) setError(msg);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const interval = setInterval(load, 60_000); // refresh every 60s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[12px] text-[#86868b] uppercase tracking-wide font-medium mb-1">Platform risk overview</div>
          <h1 className="text-[32px] font-semibold text-[#1d1d1f] tracking-[-0.02em]">
            ZkVanguard — live institutional view
          </h1>
          <p className="text-[13px] text-[#86868b] mt-1">
            Real-time aggregate metrics for every shipped fund and the operational layer behind them.
            Updates every 60 seconds.
          </p>
        </div>
        {data?.asOf && (
          <div className="text-[12px] text-[#86868b] font-mono">
            as of {new Date(data.asOf).toLocaleTimeString()}
          </div>
        )}
      </header>

      {loading && !data && <div className="text-[14px] text-[#86868b]">Loading platform risk metrics…</div>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-[13px]">
          Failed to load: {error}
        </div>
      )}

      {data && (
        <>
          {/* Platform TVL + return */}
          <section>
            <h2 className="text-[13px] font-medium text-[#86868b] uppercase tracking-wide mb-3">Platform AUM</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total NAV"
                value={fmtUsd(data.platform.tvlUsd)}
                sub={`${data.platform.memberCount} members`}
                icon={Layers}
              />
              <StatCard
                label="Capital-flow return"
                value={fmtUsd(data.platform.netCapitalReturn.absoluteUsd)}
                sub={`${fmtPct(data.platform.netCapitalReturn.percent)} on ${fmtUsd(data.platform.netCapitalDeposited)} deposits`}
                icon={data.platform.netCapitalReturn.absoluteUsd >= 0 ? TrendingUp : TrendingDown}
                tone={data.platform.netCapitalReturn.absoluteUsd >= 0 ? 'positive' : 'negative'}
              />
              <StatCard
                label="Share price"
                value={`$${data.platform.sharePrice.toFixed(4)}`}
                sub={`${fmtPct(data.platform.sharePriceReturn)} since inception`}
                icon={Activity}
                tone="positive"
              />
              <StatCard
                label={data.platform.drawdownPct > 0 ? 'Drawdown from ATH' : 'At ATH'}
                value={data.platform.drawdownPct > 0 ? fmtPct(-data.platform.drawdownPct) : 'New peak'}
                sub={`peak $${data.platform.peakSharePrice.toFixed(4)}`}
                icon={data.platform.drawdownPct > 3 ? AlertTriangle : Eye}
                tone={data.platform.drawdownPct > 5 ? 'warn' : 'neutral'}
              />
            </div>
          </section>

          {/* Hedge engine */}
          <section className="bg-white border border-black/5 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#1d1d1f]" />
                <h2 className="text-[17px] font-semibold text-[#1d1d1f]">Hedge engine</h2>
              </div>
              <div className="flex items-center gap-4 text-[12px] text-[#86868b]">
                <span>Coverage: <strong className="text-[#1d1d1f]">{(data.hedge.coverageRatio * 100).toFixed(0)}%</strong> of NAV</span>
                <span>Active: <strong className="text-[#1d1d1f]">{data.hedge.activeCount}</strong></span>
                <span className={`font-medium ${data.hedge.totalUnrealizedPnlUsd >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  uPnL {fmtUsd(data.hedge.totalUnrealizedPnlUsd)}
                </span>
              </div>
            </div>
            {data.hedge.positions.length === 0 ? (
              <div className="text-[#86868b] text-[13px] py-4 text-center">No active hedges.</div>
            ) : (
              <>
                <div className="grid grid-cols-12 gap-2 pb-2 mb-1 border-b border-black/5 text-[11px] text-[#86868b] uppercase tracking-wide font-medium">
                  <div className="col-span-3">Market</div>
                  <div className="col-span-2 text-right">Notional</div>
                  <div className="col-span-2 text-right">Leverage</div>
                  <div className="col-span-2 text-right">uPnL</div>
                  <div className="col-span-3 text-right">Age</div>
                </div>
                <div>
                  {data.hedge.positions.map((h, i) => <HedgePositionRow key={`${h.market}-${i}`} h={h} />)}
                </div>
              </>
            )}
          </section>

          {/* Two-column: reconciliation + ZK attestations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Reconciliation */}
            <section className="bg-white border border-black/5 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#1d1d1f]" />
                  <h2 className="text-[17px] font-semibold text-[#1d1d1f]">Operational reconciliation</h2>
                </div>
                <div className="flex items-center gap-3 text-[12px]">
                  <span className="text-green-700">{data.reconciliation.healthyCount} ok</span>
                  {data.reconciliation.warnCount > 0 && <span className="text-amber-700">{data.reconciliation.warnCount} warn</span>}
                  {data.reconciliation.staleCount > 0 && <span className="text-red-700">{data.reconciliation.staleCount} stale</span>}
                </div>
              </div>
              <div className="space-y-1.5">
                {data.reconciliation.cronHealth.map((c) => (
                  <div key={c.key} className="flex items-center justify-between text-[13px] py-1.5 border-b border-black/5 last:border-b-0">
                    <div className="flex items-center gap-2">
                      <StatusDot status={c.status} />
                      <span className="font-mono text-[12px] text-[#1d1d1f]">{c.key}</span>
                    </div>
                    <span className={`text-[12px] font-medium ${c.status === 'ok' ? 'text-[#86868b]' : c.status === 'warn' ? 'text-amber-700' : 'text-red-700'}`}>
                      {fmtAge(c.ageMinutes)} ago
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#86868b] mt-3">
                Three independent reconciliation loops: on-chain Move state ↔ BlueFin venue ↔ Postgres mirror.
              </p>
            </section>

            {/* ZK attestation feed */}
            <section className="bg-white border border-black/5 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#1d1d1f]" />
                  <h2 className="text-[17px] font-semibold text-[#1d1d1f]">ZK attestation feed</h2>
                </div>
                <div className="text-[12px] text-[#86868b]">
                  <strong className="text-[#1d1d1f]">{data.zkAttestations.last24hCount}</strong> in 24h
                </div>
              </div>
              {data.zkAttestations.recentFeed.length === 0 ? (
                <div className="text-[#86868b] text-[13px] py-4 text-center">No recent ZK proofs on attached hedges.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.zkAttestations.recentFeed.map((z, i) => (
                    <div key={i} className="flex items-center justify-between text-[12px] py-1.5 border-b border-black/5 last:border-b-0">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3 text-green-700" />
                        <span className="text-[#1d1d1f]">{z.market} {z.side}</span>
                        <span className="font-mono text-[11px] text-[#86868b]">{z.zkProofHash}</span>
                      </div>
                      <span className="text-[#86868b]">{new Date(z.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-[#86868b] mt-3">
                Post-quantum STARK proofs (NIST P-521) bound on-chain via <code className="bg-[#f5f5f7] px-1.5 py-0.5 rounded">zk_verifier.move</code>.
              </p>
            </section>
          </div>

          {/* Signals strip */}
          {(data.signals.BTC || data.signals.ETH) && (
            <section className="bg-white border border-black/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-[#1d1d1f]" />
                <h2 className="text-[17px] font-semibold text-[#1d1d1f]">Live prediction signal</h2>
                <span className="text-[11px] text-[#86868b]">fused: Polymarket + Manifold + funding + momentum</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {data.signals.BTC && (
                  <div className="bg-[#f5f5f7] rounded-xl px-4 py-3">
                    <div className="text-[11px] text-[#86868b]">BTC</div>
                    <div className="text-[15px] font-semibold text-[#1d1d1f]">
                      {data.signals.BTC.direction} <span className="text-[12px] text-[#86868b]">· {data.signals.BTC.confidence}% conf</span>
                    </div>
                  </div>
                )}
                {data.signals.ETH && (
                  <div className="bg-[#f5f5f7] rounded-xl px-4 py-3">
                    <div className="text-[11px] text-[#86868b]">ETH</div>
                    <div className="text-[15px] font-semibold text-[#1d1d1f]">
                      {data.signals.ETH.direction} <span className="text-[12px] text-[#86868b]">· {data.signals.ETH.confidence}% conf</span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          <footer className="text-center text-[11px] text-[#86868b] pt-4">
            Every number on this page is verifiable on-chain or via <code className="bg-[#f5f5f7] px-1.5 py-0.5 rounded">/api/health/production</code>.
            Pool capped at $10K TVL by contract until external audit closes.
          </footer>
        </>
      )}
    </div>
  );
}
