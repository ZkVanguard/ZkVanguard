'use client';

import { useEffect, useState, useCallback, memo } from 'react';
import { useTranslations } from 'next-intl';

interface PoolMetrics {
  tvl: number;
  memberCount: number;
  agents: number;
  sharePrice: number;
}

const MetricCard = memo(function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="p-6 lg:p-8">
      <div className="text-[15px] text-claude-ink3 mb-2">{label}</div>
      <div className="text-[48px] lg:text-[56px] font-semibold text-claude-ink tracking-tight">
        {value}
      </div>
    </div>
  );
});

function StaticMetricsContent({ t }: { t: (key: string) => string }) {
  return (
    <div>
      <div className="text-center mb-12 lg:mb-16">
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-claude-ink tracking-[-0.01em] mb-3">
          {t('title')}
        </h2>
        <p className="text-[17px] lg:text-[19px] text-claude-ink3">{t('subtitle')}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {[t('tvl'), t('transactions'), t('gasSavings'), t('aiAgentsOnline')].map((label) => (
          <div key={label} className="p-6 lg:p-8">
            <div className="text-[15px] text-claude-ink3 mb-2">{label}</div>
            <div className="text-[48px] lg:text-[56px] font-semibold text-claude-ink tracking-tight">--</div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function fetchPoolMetrics(): Promise<PoolMetrics | null> {
  try {
    const [poolRes, agentRes] = await Promise.all([
      fetch('/api/community-pool', { next: { revalidate: 0 } }),
      fetch('/api/agents/status', { next: { revalidate: 0 } }),
    ]);
    const poolData = poolRes.ok ? await poolRes.json() : null;
    const agentData = agentRes.ok ? await agentRes.json() : null;

    const pool = poolData?.pool;
    // /api/agents/status returns `agents` as an object keyed by role
    // (risk, hedging, settlement, reporting, lead), not an array — the
    // previous .length read was always undefined, showing "0 online".
    const agentsObj = agentData?.agents as Record<string, unknown> | undefined;
    return {
      tvl: pool?.totalNAV ?? 0,
      memberCount: pool?.memberCount ?? 0,
      sharePrice: pool?.sharePrice ?? 0,
      agents: agentsObj ? Object.keys(agentsObj).length : 0,
    };
  } catch {
    return null;
  }
}

export const LiveMetrics = memo(function LiveMetrics() {
  const t = useTranslations('liveMetrics');
  const [mounted, setMounted] = useState(false);
  const [metrics, setMetrics] = useState<PoolMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMetrics = useCallback(async () => {
    const data = await fetchPoolMetrics();
    if (data) {
      setMetrics(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    refreshMetrics();
    const interval = setInterval(refreshMetrics, 30000);
    return () => clearInterval(interval);
  }, [mounted, refreshMetrics]);

  if (!mounted || loading) {
    return <StaticMetricsContent t={t} />;
  }

  const formattedMetrics = {
    tvl: metrics ? (metrics.tvl >= 1_000_000
      ? `$${(metrics.tvl / 1_000_000).toFixed(2)}M`
      : metrics.tvl >= 1_000
        ? `$${(metrics.tvl / 1_000).toFixed(1)}K`
        : `$${metrics.tvl.toFixed(2)}`
    ) : '--',
    memberCount: metrics ? metrics.memberCount.toLocaleString() : '--',
    sharePrice: metrics ? `$${metrics.sharePrice.toFixed(4)}` : '--',
    agents: metrics?.agents ?? 0,
  };

  return (
    <div>
      <div className="text-center mb-12 lg:mb-16">
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-claude-ink tracking-[-0.01em] mb-3">
          {t('title')}
        </h2>
        <p className="text-[17px] lg:text-[19px] text-claude-ink3">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <MetricCard label={t('tvl')} value={formattedMetrics.tvl} />
        <MetricCard label={t('transactions')} value={formattedMetrics.memberCount} />
        <MetricCard label={t('gasSavings')} value={formattedMetrics.sharePrice} />
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-claude-ink3 mb-2">{t('aiAgentsOnline')}</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-claude-ink tracking-tight flex items-center gap-2">
            {formattedMetrics.agents}
            <div className="w-2 h-2 bg-claude-orange rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
});
