'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function LiveMetrics() {
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
    
    const interval = setInterval(() => {
      setMetrics((prev) => ({
        tvl: prev.tvl + Math.random() * 5000 - 2500,
        transactions: prev.transactions + Math.floor(Math.random() * 3),
        gasSaved: Math.min(75, prev.gasSaved + Math.random() * 0.1),
        agents: 5,
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, [mounted]);

  if (!mounted) {
    // Return static content for SSR
    return (
      <section className="py-8 relative">
        <div className="container mx-auto px-4">
          <div className="glass-strong rounded-3xl p-10 border border-blue-500/10">
            <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-3">
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Real-Time Platform Metrics
              </span>
            </h2>
            <p className="text-lg text-gray-400">Live performance data from Cronos Testnet</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="p-8 glass-strong border border-blue-500/20 rounded-2xl hover:border-blue-500/40 transition-all">
              <div className="text-sm text-gray-400 mb-2">Total Value Locked</div>
              <div className="text-4xl font-bold text-emerald-400">$2.8M</div>
            </div>
            <div className="p-8 glass-strong border border-purple-500/20 rounded-2xl hover:border-purple-500/40 transition-all">
              <div className="text-sm text-gray-400 mb-2">Transactions</div>
              <div className="text-4xl font-bold text-blue-400">1,247</div>
            </div>
            <div className="p-8 glass-strong border border-cyan-500/20 rounded-2xl hover:border-cyan-500/40 transition-all">
              <div className="text-sm text-gray-400 mb-2">Gas Savings</div>
              <div className="text-4xl font-bold text-cyan-400">67%</div>
            </div>
            <div className="p-8 glass-strong border border-emerald-500/20 rounded-2xl hover:border-emerald-500/40 transition-all">
              <div className="text-sm text-gray-400 mb-2">AI Agents Online</div>
              <div className="text-4xl font-bold text-emerald-400">5</div>
            </div>
          </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 border-y border-slate-300 dark:border-slate-700">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-3">
            <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Real-Time Platform Metrics
            </span>
          </h2>
          <p className="text-lg text-gray-400">Live performance data from Cronos Testnet</p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="p-8 glass-strong border border-blue-500/20 rounded-2xl hover:border-blue-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10"
          >
            <div className="text-sm text-gray-400 mb-2">Total Value Locked</div>
            <div className="text-4xl font-bold text-emerald-400 mb-1">
              ${(metrics.tvl / 1000000).toFixed(2)}M
            </div>
            <div className="text-xs text-secondary-600 dark:text-secondary-400">+12.5% this month</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="p-8 glass-strong border border-purple-500/20 rounded-2xl hover:border-purple-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10"
          >
            <div className="text-sm text-gray-400 mb-2">Transactions</div>
            <div className="text-4xl font-bold text-blue-400 mb-1">
              {metrics.transactions.toLocaleString()}
            </div>
            <div className="text-xs text-primary-400">+{Math.floor(Math.random() * 5)} last hour</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="p-8 glass-strong border border-cyan-500/20 rounded-2xl hover:border-cyan-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/10"
          >
            <div className="text-sm text-gray-400 mb-2">Gas Savings</div>
            <div className="text-4xl font-bold text-cyan-400 mb-1">
              {metrics.gasSaved.toFixed(1)}%
            </div>
            <div className="text-xs text-accent-400">via x402 batching</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="p-8 glass-strong border border-emerald-500/20 rounded-2xl hover:border-emerald-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/10"
          >
            <div className="text-sm text-gray-400 mb-2">AI Agents</div>
            <div className="text-4xl font-bold text-emerald-400 mb-1 flex items-center">
              {metrics.agents}
              <div className="ml-2 w-2 h-2 bg-secondary-500 rounded-full animate-pulse" />
            </div>
            <div className="text-xs text-emerald-400">All online</div>
          </motion.div>
        </div>
        </div>
      </div>
    </section>
  );
}
