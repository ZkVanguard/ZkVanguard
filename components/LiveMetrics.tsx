'use client';

import { useEffect, useState, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';

interface PoolMetrics {
  tvl: number;
  memberCount: number;
  agents: number;
  sharePrice: number;
}

// Memoized metric card to prevent unnecessary re-renders
const MetricCard = memo(function MetricCard({ 
  label, 
  value, 
  delay 
}: { 
  label: string; 
  value: string | number; 
  delay: number 
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className="p-6 lg:p-8"
    >
      <div className="text-[15px] text-[#86868b] mb-2">{label}</div>
      <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">
        {value}
      </div>
    </motion.div>
  );
});

// Static fallback component for SSR and loading states
function StaticMetricsContent({ t }: { t: (key: string) => string }) {
  return (
    <div>
      <div className="text-center mb-12 lg:mb-16">
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-[-0.015em] mb-3">
          {t('title')}
        </h2>
        <p className="text-[17px] lg:text-[19px] text-[#86868b]">{t('subtitle')}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">{t('tvl')}</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">--</div>
        </div>
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">{t('transactions')}</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">--</div>
        </div>
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">{t('gasSavings')}</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">--</div>
        </div>
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">{t('aiAgentsOnline')}</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">--</div>
        </div>
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
    return {
      tvl: pool?.totalNAV ?? 0,
      memberCount: pool?.memberCount ?? 0,
      sharePrice: pool?.sharePrice ?? 0,
      agents: agentData?.agents?.length ?? 0,
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
    // Fetch real on-chain pool data immediately, then refresh every 30s
    refreshMetrics();
    const interval = setInterval(refreshMetrics, 30000);
    return () => clearInterval(interval);
  }, [mounted, refreshMetrics]);

  // Return static content until client-side mount is complete
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
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 lg:mb-16"
      >
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-[-0.015em] mb-3">
          {t('title')}
        </h2>
        <p className="text-[17px] lg:text-[19px] text-[#86868b]">{t('subtitle')}</p>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <MetricCard label={t('tvl')} value={formattedMetrics.tvl} delay={0.1} />
        <MetricCard label={t('transactions')} value={formattedMetrics.memberCount} delay={0.2} />
        <MetricCard label={t('gasSavings')} value={formattedMetrics.sharePrice} delay={0.3} />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="p-6 lg:p-8"
        >
          <div className="text-[15px] text-[#86868b] mb-2">{t('aiAgentsOnline')}</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter flex items-center gap-2">
            {formattedMetrics.agents}
            <div className="w-2 h-2 bg-[#34C759] rounded-full" />
          </div>
        </motion.div>
      </div>
    </div>
  );
});
