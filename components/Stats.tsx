'use client';

import { useEffect, useState } from 'react';

const stats = [
  { label: 'AI Agents', value: '5', prefix: '' },
  { label: 'Gas Savings', value: '100%', prefix: '' },
  { label: 'ZK Proofs', value: '2K+', prefix: '' },
  { label: 'Response Time', value: '<1s', prefix: '' },
];

export function Stats() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="glass-light rounded-2xl p-8 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <h3 className="text-xl font-semibold mb-6 text-gray-900 tracking-tight relative z-10">Platform Performance</h3>
      <div className="grid grid-cols-2 gap-4 relative z-10">
        {stats.map((stat, index) => (
          <div
            key={index}
            className={`text-center transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: `${index * 100}ms` }}
          >
              <div className="text-3xl sm:text-4xl md:text-5xl font-semibold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent tracking-tight">
                {stat.value}
              </div>
              <div className="text-sm sm:text-base text-gray-600 font-medium">{stat.label}</div>
            </div>
          ))}
        </div>
    </div>
  );
}
