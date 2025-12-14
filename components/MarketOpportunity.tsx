'use client';

import { motion } from 'framer-motion';
import { DollarSign, Users, Zap, TrendingUp, Globe, Shield } from 'lucide-react';

const marketData = [
  {
    icon: DollarSign,
    label: 'RWA Market Size',
    value: '$16T',
    description: 'Expected by 2030 (BCG)',
    color: 'text-green-500',
  },
  {
    icon: TrendingUp,
    label: 'Growth Rate',
    value: '50x',
    description: 'Market expansion 2024-2030',
    color: 'text-blue-500',
  },
  {
    icon: Globe,
    label: 'Target Market',
    value: '$1.2T',
    description: 'DeFi institutional assets',
    color: 'text-purple-500',
  },
  {
    icon: Users,
    label: 'Potential Users',
    value: '10K+',
    description: 'Institutional traders',
    color: 'text-yellow-500',
  },
];

const competitors = [
  { name: 'Traditional Risk Tools', gap: 'No AI automation' },
  { name: 'DeFi Protocols', gap: 'Limited RWA support' },
  { name: 'Centralized Services', gap: 'Custodial risk' },
];

export function MarketOpportunity() {
  return (
    <section className="py-24 bg-gray-800 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-purple-900/20" />
      
      <div className="container mx-auto px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
              Massive Market Opportunity
            </span>
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Positioned at the intersection of RWA tokenization and AI-powered DeFi
          </p>
        </motion.div>

        {/* Market Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {marketData.map((data, index) => {
            const Icon = data.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="p-6 bg-gray-900 border border-gray-700 rounded-xl text-center"
              >
                <div className={`inline-flex p-3 ${data.color.replace('text-', 'bg-')}/10 rounded-lg mb-3`}>
                  <Icon className={`w-6 h-6 ${data.color}`} />
                </div>
                <div className="text-3xl font-bold mb-2 text-white">{data.value}</div>
                <div className="text-sm text-gray-400 mb-1">{data.label}</div>
                <div className="text-xs text-gray-500">{data.description}</div>
              </motion.div>
            );
          })}
        </div>

        {/* Competitive Advantage */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto"
        >
          <h3 className="text-2xl font-bold text-center mb-8 text-white">Our Competitive Edge</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {competitors.map((comp, index) => (
              <div key={index} className="p-6 bg-gray-900 border border-gray-700 rounded-xl">
                <div className="text-lg font-semibold mb-2 text-white">{comp.name}</div>
                <div className="text-sm text-red-400 mb-3">❌ {comp.gap}</div>
                <div className="text-sm text-green-400">[CHECK] Chronos Vanguard</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Unique Value Props */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 p-8 bg-gradient-to-br from-blue-900/30 to-purple-900/30 border border-blue-500/20 rounded-2xl max-w-4xl mx-auto"
        >
          <div className="flex items-center space-x-3 mb-6">
            <Shield className="w-8 h-8 text-blue-500" />
            <h3 className="text-2xl font-bold text-white">Why Chronos Vanguard Wins</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-white">AI-Powered Automation</div>
                <div className="text-sm text-gray-400">5 specialized agents working 24/7</div>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-white">ZK-STARK Verification</div>
                <div className="text-sm text-gray-400">Privacy + Auditability guaranteed</div>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-white">Non-Custodial</div>
                <div className="text-sm text-gray-400">Users keep full control of assets</div>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-white">Gas Optimization</div>
                <div className="text-sm text-gray-400">67% savings via x402 batching</div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
