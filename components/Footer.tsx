"use client";

import { Link } from '../i18n/routing';
import { useTranslations } from 'next-intl';

export function Footer() {
  const t = useTranslations('footer');
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#f5f5f7]">
      <div className="max-w-[980px] mx-auto px-6 lg:px-8">
        {/* Top section - Navigation */}
        <div className="pt-12 lg:pt-16 pb-8 lg:pb-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-20">
            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">{t('product')}</h3>
              <ul className="space-y-3">
                <li><Link href="/dashboard" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)] leading-relaxed">{t('dashboard')}</Link></li>
                <li><Link href="/agents" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)] leading-relaxed">{t('agents')}</Link></li>
                <li><Link href="/simulator" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)] leading-relaxed">{t('simulator')}</Link></li>
                <li><Link href="/docs" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)] leading-relaxed">{t('documentation')}</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">{t('platform')}</h3>
              <ul className="space-y-3">
                <li><Link href="/zk-proof" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('zkVerification')}</Link></li>
                <li><Link href="/zk-authenticity" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('authenticity')}</Link></li>
                <li><Link href="/whitepaper" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('whitepaper')}</Link></li>
                <li><a href="#" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('api')}</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">{t('resources')}</h3>
              <ul className="space-y-3">
                <li><a href="https://calendly.com/ashishregmi2017/30min" target="_blank" rel="noopener noreferrer" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('contact')}</a></li>
                <li><a href="https://t.me/+QoAodv90iWExZmVh" target="_blank" rel="noopener noreferrer" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('community')}</a></li>
                <li><a href="https://github.com/mrarejimmyz/ZkVanguard" target="_blank" rel="noopener noreferrer" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('github')}</a></li>
                <li><a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('twitter')}</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-[12px] font-semibold text-[#1d1d1f] mb-4 tracking-wide">{t('legal')}</h3>
              <ul className="space-y-3">
                <li><Link href="/privacy" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('privacy')}</Link></li>
                <li><Link href="/terms" className="text-[14px] text-[#424245] hover:text-[#007AFF] transition-colors leading-relaxed">{t('terms')}</Link></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom section - Copyright */}
        <div className="border-t border-[#d2d2d7] py-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="text-[12px] text-[#86868b] leading-relaxed">
              © {currentYear} ZkVanguard. {t('rights')}
              <span className="hidden md:inline ml-2">·</span>
              <span className="block md:inline md:ml-2 text-[#007AFF]">{t('testnet')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[12px]">
              <span className="px-3 py-1.5 bg-[#007AFF]/10 text-[#007AFF] rounded-full font-medium">
                {t('stage')}
              </span>
              <span className="text-[#86868b]">{t('builtWith')}</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
