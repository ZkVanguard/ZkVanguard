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
    <div className="glass-light rounded-3xl p-6 border border-gray-200 shadow-ios">
      <h3 className="text-lg font-bold mb-4 text-gray-900">Platform Stats</h3>
      <div className="grid grid-cols-2 gap-4">
        {stats.map((stat, index) => (
          <div
            key={index}
            className={`text-center transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: `${index * 100}ms` }}
          >
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1 sm:mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-xs sm:text-sm md:text-base text-gray-600 font-medium">{stat.label}</div>
            </div>
          ))}
        </div>
    </div>
  );
}
