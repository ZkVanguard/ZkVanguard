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
      <section className="py-16 bg-gradient-to-b from-gray-800 to-gray-900 border-y border-gray-700">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="bg-gradient-to-r from-green-500 to-blue-500 bg-clip-text text-transparent">
                Platform Capabilities (Testnet Simulation)
              </span>
            </h2>
            <p className="text-gray-400">Live metrics demonstrating system performance with simulated data</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl">
              <div className="text-sm text-gray-400 mb-2">Total Value Locked</div>
              <div className="text-3xl font-bold text-green-500">$2.8M</div>
            </div>
            <div className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl">
              <div className="text-sm text-gray-400 mb-2">Transactions</div>
              <div className="text-3xl font-bold text-blue-500">1,247</div>
            </div>
            <div className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl">
              <div className="text-sm text-gray-400 mb-2">Gas Savings</div>
              <div className="text-3xl font-bold text-purple-500">67%</div>
            </div>
            <div className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl">
              <div className="text-sm text-gray-400 mb-2">AI Agents Online</div>
              <div className="text-3xl font-bold text-orange-500">5</div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 bg-gradient-to-b from-gray-800 to-gray-900 border-y border-gray-700">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            <span className="bg-gradient-to-r from-green-500 to-blue-500 bg-clip-text text-transparent">
              Platform Capabilities (Testnet Simulation)
            </span>
          </h2>
          <p className="text-gray-400">Live metrics demonstrating system performance with simulated data</p>
          <div className="mt-3 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2 inline-block">
            WARNING: Demo Environment - Real testnet infrastructure, simulated market data
          </div>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl"
          >
            <div className="text-sm text-gray-400 mb-2">Total Value Locked</div>
            <div className="text-3xl font-bold text-green-500 mb-1">
              ${(metrics.tvl / 1000000).toFixed(2)}M
            </div>
            <div className="text-xs text-green-400">+12.5% this month</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl"
          >
            <div className="text-sm text-gray-400 mb-2">Transactions</div>
            <div className="text-3xl font-bold text-blue-500 mb-1">
              {metrics.transactions.toLocaleString()}
            </div>
            <div className="text-xs text-blue-400">+{Math.floor(Math.random() * 5)} last hour</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl"
          >
            <div className="text-sm text-gray-400 mb-2">Gas Savings</div>
            <div className="text-3xl font-bold text-purple-500 mb-1">
              {metrics.gasSaved.toFixed(1)}%
            </div>
            <div className="text-xs text-purple-400">via x402 batching</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="p-6 bg-gray-800/50 border border-gray-700 rounded-xl"
          >
            <div className="text-sm text-gray-400 mb-2">AI Agents</div>
            <div className="text-3xl font-bold text-yellow-500 mb-1 flex items-center">
              {metrics.agents}
              <div className="ml-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            </div>
            <div className="text-xs text-yellow-400">All online</div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
