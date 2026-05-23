"use client";

import { memo } from 'react';
import Link from 'next/link';
import { ArrowRightIcon, ShieldCheckIcon, BoltIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

export const Hero = memo(function Hero() {
  const t = useTranslations('hero');

  return (
    <section className="relative overflow-hidden bg-claude-bg">
      {/* Soft warm radial wash */}
      <div className="claude-hero-glow absolute inset-0 -z-10" />

      <div className="relative w-full px-5 lg:px-8 pt-28 pb-20 sm:pt-32 sm:pb-24 lg:pt-40 lg:pb-32">
        <div className="max-w-[1200px] mx-auto">

          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-16 items-center">

            {/* Left: Main content */}
            <div className="max-w-[640px]">
              {/* Eyebrow — warm pill */}
              <div className="claude-chip inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 mb-7">
                <span className="w-1.5 h-1.5 rounded-full bg-claude-orange" />
                <span className="text-[13px] font-medium tracking-wide">
                  {t('eyebrow')}
                </span>
                <span className="w-px h-3 bg-claude-orange/30" />
                <span className="text-[13px] font-semibold">
                  {t('quantumProof')}
                </span>
              </div>

              {/* Hero headline — Apple-style tight bold sans */}
              <h1 className="text-[40px] leading-[1.08] sm:text-[52px] sm:leading-[1.06] lg:text-[68px] xl:text-[76px] lg:leading-[1.04] font-bold text-claude-ink tracking-[-0.03em] mb-5 sm:mb-6">
                {t('headline1')}
                <br />
                <span className="text-claude-orange">
                  {t('headline2')}
                </span>
              </h1>

              {/* Subtitle */}
              <p className="text-[18px] sm:text-[21px] lg:text-[22px] text-claude-ink2 font-normal leading-[1.55] mb-9 sm:mb-10 max-w-[560px]">
                {t('subtitle')}
              </p>

              {/* CTA */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <Link
                  href="/dashboard"
                  className="group inline-flex items-center justify-center gap-2.5 px-7 sm:px-8 h-[52px] sm:h-[56px] bg-claude-orange text-white text-[16px] sm:text-[17px] font-semibold rounded-[14px] hover:bg-claude-rust active:scale-[0.97] transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-[0_10px_28px_-10px_rgba(189,91,61,0.55)] w-full sm:w-auto"
                >
                  <span>{t('ctaDashboard')}</span>
                  <ArrowRightIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]" strokeWidth={2.25} />
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center gap-1.5 h-[52px] sm:h-[56px] px-2 text-[16px] sm:text-[17px] font-medium text-claude-ink2 hover:text-claude-rust transition-colors duration-200"
                >
                  {t('ctaLearnMore')}
                  <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                </a>
              </div>
            </div>

            {/* Right: Visual — Desktop only */}
            <div className="hidden lg:block relative">
              <div className="relative w-full max-w-[500px] ml-auto space-y-4">

                {/* Primary card — Zero-Knowledge Security */}
                <div className="claude-card p-7">
                  <div className="flex items-start gap-4 mb-6">
                    <div className="w-14 h-14 rounded-[16px] bg-claude-orange/12 flex items-center justify-center flex-shrink-0">
                      <ShieldCheckIcon className="w-7 h-7 text-claude-orange" strokeWidth={1.9} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[19px] font-semibold text-claude-ink mb-1.5 tracking-[-0.01em]">
                        Zero-Knowledge Security
                      </h3>
                      <p className="text-[15px] text-claude-ink2 leading-[1.45]">
                        ZK-STARK verification. Your strategies stay completely private.
                      </p>
                    </div>
                  </div>
                  {/* Warm minimal chart */}
                  <div className="flex items-end gap-1.5 h-16 px-1">
                    {[60, 82, 68, 95, 72, 88, 78].map((height, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-[4px] bg-gradient-to-t from-claude-orange/55 to-claude-orange"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>

                {/* Secondary cards row */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="claude-card p-6">
                    <div className="w-11 h-11 rounded-[13px] bg-claude-ink/[0.05] flex items-center justify-center mb-4">
                      <ChartBarIcon className="w-5 h-5 text-claude-ink2" strokeWidth={2} />
                    </div>
                    <h4 className="text-[17px] font-semibold text-claude-ink mb-1.5 tracking-[-0.01em]">
                      Real-Time Data
                    </h4>
                    <p className="text-[14px] text-claude-ink2 leading-[1.4]">
                      Live market analytics and insights
                    </p>
                  </div>

                  <div className="claude-card p-6">
                    <div className="w-11 h-11 rounded-[13px] bg-claude-ink/[0.05] flex items-center justify-center mb-4">
                      <BoltIcon className="w-5 h-5 text-claude-ink2" strokeWidth={2} />
                    </div>
                    <h4 className="text-[17px] font-semibold text-claude-ink mb-1.5 tracking-[-0.01em]">
                      AI Automation
                    </h4>
                    <p className="text-[14px] text-claude-ink2 leading-[1.4]">
                      Autonomous trading and risk mitigation
                    </p>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* Mobile: feature showcase */}
          <div className="lg:hidden mt-12 space-y-3.5">
            {[
              { Icon: ShieldCheckIcon, tint: 'bg-claude-orange/12', color: 'text-claude-orange', title: 'Zero-Knowledge Security', body: 'Quantum-proof privacy for your portfolio' },
              { Icon: BoltIcon, tint: 'bg-claude-ink/[0.05]', color: 'text-claude-ink2', title: 'AI Automation', body: 'Autonomous trading and risk mitigation' },
              { Icon: ChartBarIcon, tint: 'bg-claude-ink/[0.05]', color: 'text-claude-ink2', title: 'Real-Time Data', body: 'Live market analytics and insights' },
            ].map(({ Icon, tint, color, title, body }) => (
              <div key={title} className="claude-card p-5">
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 w-11 h-11 rounded-[13px] ${tint} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${color}`} strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[17px] font-semibold text-claude-ink mb-1">{title}</h3>
                    <p className="text-[15px] text-claude-ink2 leading-snug">{body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
});
