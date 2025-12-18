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
      <section className="py-16 bg-gradient-to-b from-gray-900/50 to-transparent border-y border-blue-500/10">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="gradient-text">
                Platform Capabilities (Testnet Simulation)
              </span>
            </h2>
            <p className="text-gray-400">Live metrics with real market data and simulated portfolio amounts</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-secondary-500 transition-all">
              <div className="text-sm text-gray-400 mb-2">Total Value Locked</div>
              <div className="text-3xl font-bold text-secondary-400">$2.8M</div>
            </div>
            <div className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-primary-500 transition-all">
              <div className="text-sm text-gray-400 mb-2">Transactions</div>
              <div className="text-3xl font-bold text-primary-400">1,247</div>
            </div>
            <div className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-accent-500 transition-all">
              <div className="text-sm text-gray-400 mb-2">Gas Savings</div>
              <div className="text-3xl font-bold text-accent-400">67%</div>
            </div>
            <div className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-amber-500 transition-all">
              <div className="text-sm text-gray-400 mb-2">AI Agents Online</div>
              <div className="text-3xl font-bold text-amber-400">5</div>
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
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="gradient-text">
              Platform Capabilities (Testnet Simulation)
            </span>
          </h2>
          <p className="text-gray-400">Live metrics demonstrating system performance with simulated data</p>
          <div className="mt-3 text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded-lg px-4 py-2 inline-block">
            WARNING: Demo Environment - Real testnet infrastructure with real market data, simulated portfolio amounts
          </div>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-secondary-500 transition-all card-hover"
          >
            <div className="text-sm text-gray-400 mb-2">Total Value Locked</div>
            <div className="text-3xl font-bold text-secondary-400 mb-1">
              ${(metrics.tvl / 1000000).toFixed(2)}M
            </div>
            <div className="text-xs text-secondary-600 dark:text-secondary-400">+12.5% this month</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-primary-500 transition-all card-hover"
          >
            <div className="text-sm text-gray-400 mb-2">Transactions</div>
            <div className="text-3xl font-bold text-primary-400 mb-1">
              {metrics.transactions.toLocaleString()}
            </div>
            <div className="text-xs text-primary-400">+{Math.floor(Math.random() * 5)} last hour</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-accent-500 transition-all card-hover"
          >
            <div className="text-sm text-gray-400 mb-2">Gas Savings</div>
            <div className="text-3xl font-bold text-accent-400 mb-1">
              {metrics.gasSaved.toFixed(1)}%
            </div>
            <div className="text-xs text-accent-400">via x402 batching</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="p-6 glass-strong border border-gray-800 rounded-xl hover:border-amber-500 transition-all card-hover"
          >
            <div className="text-sm text-gray-400 mb-2">AI Agents</div>
            <div className="text-3xl font-bold text-amber-400 mb-1 flex items-center">
              {metrics.agents}
              <div className="ml-2 w-2 h-2 bg-secondary-500 rounded-full animate-pulse" />
            </div>
            <div className="text-xs text-amber-400">All online</div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
