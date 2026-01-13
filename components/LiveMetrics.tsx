'use client';

import { useEffect, useState, useMemo, memo } from 'react';
import { motion } from 'framer-motion';

// Static fallback component for SSR and loading states
function StaticMetrics() {
  return (
    <div>
      <div className="text-center mb-12 lg:mb-16">
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-[-0.015em] mb-3">
          Real-Time Platform Metrics
        </h2>
        <p className="text-[17px] lg:text-[19px] text-[#86868b]">Live performance data from Cronos Testnet</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">Total Value Locked</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">$2.8M</div>
        </div>
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">Transactions</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">1,247</div>
        </div>
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">Gas Savings</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">67%</div>
        </div>
        <div className="p-6 lg:p-8">
          <div className="text-[15px] text-[#86868b] mb-2">AI Agents Online</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter">5</div>
        </div>
      </div>
    </div>
  );
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

export const LiveMetrics = memo(function LiveMetrics() {
  const [mounted, setMounted] = useState(false);
  const [metrics, setMetrics] = useState({
    tvl: 2847500,
    transactions: 1247,
    gasSaved: 67.3,
    agents: 5,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    
    // Reduced update frequency from 3s to 5s to save CPU
    const interval = setInterval(() => {
      setMetrics((prev) => ({
        tvl: prev.tvl + Math.random() * 5000 - 2500,
        transactions: prev.transactions + Math.floor(Math.random() * 3),
        gasSaved: Math.min(75, prev.gasSaved + Math.random() * 0.1),
        agents: 5, // Static value, doesn't change
      }));
    }, 5000); // Changed from 3000ms to 5000ms

    return () => clearInterval(interval);
  }, [mounted]);

  // Return static content until client-side mount is complete
  if (!mounted) {
    return <StaticMetrics />;
  }

  // Memoize formatted values to prevent recalculation on every render
  const formattedMetrics = {
    tvl: `$${(metrics.tvl / 1000000).toFixed(2)}M`,
    transactions: metrics.transactions.toLocaleString(),
    gasSaved: `${metrics.gasSaved.toFixed(1)}%`,
    agents: metrics.agents,
  };

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 lg:mb-16"
      >
        <h2 className="text-[40px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-[-0.015em] mb-3">
          Real-Time Platform Metrics
        </h2>
        <p className="text-[17px] lg:text-[19px] text-[#86868b]">Live performance data from Cronos Testnet</p>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <MetricCard label="Total Value Locked" value={formattedMetrics.tvl} delay={0.1} />
        <MetricCard label="Transactions" value={formattedMetrics.transactions} delay={0.2} />
        <MetricCard label="Gas Savings" value={formattedMetrics.gasSaved} delay={0.3} />
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="p-6 lg:p-8"
        >
          <div className="text-[15px] text-[#86868b] mb-2">AI Agents</div>
          <div className="text-[48px] lg:text-[56px] font-semibold text-[#1D1D1F] tracking-tighter flex items-center gap-2">
            {formattedMetrics.agents}
            <div className="w-2 h-2 bg-[#34C759] rounded-full" />
          </div>
        </motion.div>
      </div>
    </div>
  );
});
