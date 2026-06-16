'use client';

import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Link } from '../i18n/routing';
import { ConnectButton } from './ConnectButton';
import { LanguageSelector } from './LanguageSelector';
import { Menu, X } from 'lucide-react';
import Logo from './Logo';
import { useTranslations } from 'next-intl';

export const Navbar = memo(function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const t = useTranslations('nav');

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > 20);
        ticking = false;
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '/', label: t('home') },
    { href: '/dashboard', label: t('dashboard') },
    { href: '/agents', label: t('agents') },
    { href: '/simulator', label: t('simulator') },
    { href: '/pricing', label: 'Pricing' },
  ];

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
        scrolled
          ? 'bg-system-bg-primary/85 backdrop-blur-xl shadow-ios-1 border-b border-separator-opaque/40'
          : 'bg-system-bg-primary/90 backdrop-blur-lg'
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-[52px]">
          {/* Logo - Always visible */}
          <Link href="/" className="flex items-center gap-2 -ml-2">
            <Logo />
            <span className="lg:hidden text-[17px] font-semibold text-[#1d1d1f] tracking-tight">ZkVanguard</span>
          </Link>

          {/* Desktop Navigation - Centered with proper spacing */}
          <div className="hidden lg:flex items-center justify-center flex-1 gap-1 mx-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 h-11 flex items-center text-[16px] font-normal text-label-secondary hover:text-ios-blue active:scale-[0.98] transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)] whitespace-nowrap"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Desktop - Language Selector + Connect Button (Right side) */}
          <div className="hidden lg:flex items-center gap-3">
            <LanguageSelector />
            <ConnectButton />
          </div>

          {/* Mobile Menu Button - Proper 44pt touch target */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="lg:hidden w-11 h-11 flex items-center justify-center -mr-2 text-label-primary hover:text-ios-blue active:scale-[0.96] transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
            aria-label="Toggle menu"
          >
            {isOpen ? (
              <X className="w-6 h-6" strokeWidth={2} />
            ) : (
              <Menu className="w-6 h-6" strokeWidth={2} />
            )}
          </button>
        </div>

        {/* Mobile Navigation - Clean iOS-style list */}
        {isOpen && (
          <div className="lg:hidden pb-4 border-t border-black/10 animate-fade-in">
            <div className="py-2 space-y-0.5">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block px-3 h-11 flex items-center text-[17px] text-label-primary hover:bg-system-bg-grouped active:scale-[0.98] rounded-ios transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                  onClick={() => setIsOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 pt-3 px-3 border-t border-black/10 space-y-3">
              <LanguageSelector />
              <ConnectButton />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
});
