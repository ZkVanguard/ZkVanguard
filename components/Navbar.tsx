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
    { href: '/zk-proof', label: 'ZK Proofs' },
    { href: '/zk-authenticity', label: 'Verify' },
    { href: '/docs', label: 'Docs' },
  ];

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
        scrolled 
          ? 'bg-white/80 backdrop-blur-xl shadow-ios-2 border-b border-separator-opaque' 
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
                className="px-3 h-11 flex items-center text-callout font-normal text-label-primary hover:text-ios-blue transition-colors whitespace-nowrap"
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
            className="lg:hidden w-11 h-11 flex items-center justify-center -mr-2 text-label-primary hover:text-ios-blue transition-colors"
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
          <div className="lg:hidden pb-4 border-t border-separator-non-opaque animate-fade-in">
            <div className="py-2 space-y-0.5">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block px-3 h-11 flex items-center text-body text-label-primary hover:bg-system-bg-secondary rounded-ios transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 pt-3 px-3 border-t border-separator-non-opaque">
              <ConnectButton />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
