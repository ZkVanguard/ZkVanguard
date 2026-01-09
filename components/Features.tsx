'use client';

import { ShieldCheckIcon, BoltIcon, ChartBarIcon, LockClosedIcon } from '@heroicons/react/24/outline';

const features = [
  {
    icon: ShieldCheckIcon,
    title: 'ZK Proofs',
    description: 'Zero-knowledge verification for privacy & security.',
    iconColor: 'text-[#007AFF]',
    iconBg: 'bg-[#007AFF]/10',
  },
  {
    icon: BoltIcon,
    title: 'AI Agents',
    description: '24/7 automated portfolio optimization.',
    iconColor: 'text-[#34C759]',
    iconBg: 'bg-[#34C759]/10',
  },
  {
    icon: ChartBarIcon,
    title: 'Live Analytics',
    description: 'Real-time risk metrics & insights.',
    iconColor: 'text-[#FF9500]',
    iconBg: 'bg-[#FF9500]/10',
  },
  {
    icon: LockClosedIcon,
    title: 'Quantum-Proof ZK-STARK',
    description: 'Post-quantum cryptography for future security.',
    iconColor: 'text-[#AF52DE]',
    iconBg: 'bg-[#AF52DE]/10',
  },
];

export function Features() {
  const backgrounds = [
    'bg-white',
    'bg-[#f5f5f7]',
    'bg-[#f5f5f7]',
    'bg-white',
  ];

  return (
    <div>
      {/* Mobile - vertical stack */}
      <div className="lg:hidden space-y-3">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div key={index} className={`${backgrounds[index]} rounded-[20px] p-10`}>
              <Icon className={`w-9 h-9 ${feature.iconColor} mb-4`} strokeWidth={1.5} />
              <h2 className="text-[36px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-3">
                {feature.title}
              </h2>
              <p className="text-[19px] font-normal text-[#86868b] leading-[1.47] tracking-[-0.003em]">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Desktop - 2 column refined layout */}
      <div className="hidden lg:grid lg:grid-cols-2 gap-3">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div key={index} className={`${backgrounds[index]} rounded-[24px] p-14`}>
              <Icon className={`w-11 h-11 ${feature.iconColor} mb-5`} strokeWidth={1.5} />
              <h2 className="text-[48px] font-semibold text-[#1d1d1f] tracking-[-0.025em] leading-[1.08] mb-4">
                {feature.title}
              </h2>
              <p className="text-[21px] font-normal text-[#86868b] leading-[1.47] tracking-[-0.003em] max-w-[460px]">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
