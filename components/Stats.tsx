'use client';

import { useEffect, useState } from 'react';

const stats = [
  { label: 'Tests Passing', value: '10/10', prefix: '' },
  { label: 'AI Agents Operational', value: '5', prefix: '' },
  { label: 'ZK Proofs Generated', value: '2', prefix: '' },
  { label: 'Gas Cost (x402)', value: '$0.00', prefix: '' },
];

export function Stats() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="glass-light rounded-2xl p-8">
      <h3 className="text-lg font-semibold mb-6 text-gray-900 tracking-tight">Platform Stats</h3>
      <div className="grid grid-cols-2 gap-4">
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
