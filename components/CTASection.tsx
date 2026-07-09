'use client';

import { Link } from '../i18n/routing';
import { useWallet } from '@/lib/hooks/useWallet';
import { useTranslations } from 'next-intl';

export function CTASection() {
  useWallet();
  const t = useTranslations('cta');

  return (
    <section className="py-16 sm:py-24 md:py-32 lg:py-40">
      <div className="container mx-auto px-4 sm:px-5 max-w-full">
        <div className="max-w-[980px] mx-auto text-center">
          <h2 className="text-[32px] sm:text-[42px] md:text-[52px] lg:text-[76px] font-semibold text-claude-ink tracking-[-0.02em] leading-[1.1] sm:leading-[1.05] mb-4 sm:mb-6 lg:mb-8 break-words px-1">
            {t('title')}
          </h2>
          <p className="text-base sm:text-lg md:text-[21px] lg:text-[27px] text-claude-ink2 leading-relaxed sm:leading-[1.42] tracking-[-0.003em] mb-8 sm:mb-12 lg:mb-16 max-w-[720px] mx-auto px-1">
            {t('subtitle')}
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center h-12 sm:h-auto px-8 sm:px-10 py-3 sm:py-4 bg-claude-orange hover:bg-claude-rust active:scale-[0.98] rounded-full font-semibold text-base sm:text-[19px] text-white transition-all duration-200 min-w-[180px] sm:min-w-[200px] shadow-[0_12px_32px_-12px_rgba(189,91,61,0.6)]"
          >
            {t('button')}
          </Link>
        </div>
      </div>
    </section>
  );
}
