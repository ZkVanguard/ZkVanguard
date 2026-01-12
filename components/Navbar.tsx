'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ConnectButton } from './ConnectButton';
import { Menu, X } from 'lucide-react';
import Logo from './Logo';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/agents', label: 'Agents' },
    { href: '/simulator', label: 'Simulator' },
  ];

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
        scrolled 
          ? 'bg-white/80 backdrop-blur-xl shadow-[0_4px_12px_rgba(0,0,0,0.08)] border-b border-black/10' 
          : 'bg-white/95 backdrop-blur-lg'
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
                className="px-3 h-11 flex items-center text-[16px] font-normal text-[#1d1d1f] hover:text-[#007AFF] active:scale-[0.98] transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)] whitespace-nowrap"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Desktop - Connect Button (Right side) */}
          <div className="hidden lg:flex items-center">
            <ConnectButton />
          </div>

          {/* Mobile Menu Button - Proper 44pt touch target */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="lg:hidden w-11 h-11 flex items-center justify-center -mr-2 text-[#1d1d1f] hover:text-[#007AFF] active:scale-[0.96] transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
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
                  className="block px-3 h-11 flex items-center text-[17px] text-[#1d1d1f] hover:bg-[#f5f5f7] active:scale-[0.98] rounded-[10px] transition-all duration-[200ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
                  onClick={() => setIsOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 pt-3 px-3 border-t border-black/10">
              <ConnectButton />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
