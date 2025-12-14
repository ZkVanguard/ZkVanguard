'use client';

import { useEffect, useState } from 'react';

const stats = [
  { label: 'Simulated TVL (Demo)', value: '$2.5M', prefix: '' },
  { label: 'AI Agents Built', value: '5', prefix: '' },
  { label: 'Demo Positions', value: '1,247', prefix: '' },
  { label: 'Gas Saved (Verified)', value: '67%', prefix: '' },
];

export function Stats() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <section className="py-16 bg-gray-800/50 border-y border-gray-700">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <div
              key={index}
              className={`text-center transition-all duration-700 ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: `${index * 100}ms` }}
            >
              <div className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-sm md:text-base text-gray-400">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
