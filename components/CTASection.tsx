'use client';

import { Link } from '../i18n/routing';
import { useWallet } from '@/lib/hooks/useWallet';
import { useTranslations } from 'next-intl';

export function CTASection() {
  useWallet();
  const t = useTranslations('cta');

  return (
    <section className="py-32 lg:py-40">
      <div className="container mx-auto px-5">
        <div className="max-w-[980px] mx-auto text-center">
          <h2 className="text-[52px] lg:text-[76px] font-semibold text-claude-ink tracking-[-0.02em] leading-[1.05] mb-6 lg:mb-8">
            {t('title')}
          </h2>
          <p className="text-[21px] lg:text-[27px] text-claude-ink2 leading-[1.42] tracking-[-0.003em] mb-12 lg:mb-16 max-w-[720px] mx-auto">
            {t('subtitle')}
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-10 py-4 bg-claude-orange hover:bg-claude-rust rounded-full font-semibold text-[19px] text-white transition-colors duration-200 min-w-[200px] shadow-[0_12px_32px_-12px_rgba(189,91,61,0.6)]"
          >
            {t('button')}
          </Link>
        </div>
      </div>
    </section>
  );
}
