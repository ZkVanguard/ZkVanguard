'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ConnectButton } from './ConnectButton';
import { Menu, X, FlaskConical, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { theme, toggleTheme } = useTheme();

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
    { href: '/zk-proof', label: 'ZK Proofs' },
    { href: '/zk-authenticity', label: '🔐 Verify Authenticity' },
    { href: '/docs', label: 'Documentation' },
  ];

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'backdrop-blur-xl shadow-lg' : 'backdrop-blur-xl'
      }`}
      style={{background: scrolled ? 'rgba(15, 15, 26, 0.85)' : 'rgba(15, 15, 26, 0.7)'}}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="group flex items-center space-x-2">
            <img src="/assets/branding/logo-navbar.svg" alt="ZkVanguard" className="h-16 w-auto transition-transform group-hover:scale-105" />
            <span className="hidden md:flex items-center space-x-2">
              <FlaskConical className="w-3 h-3 text-orange-500" />
              <span className="text-[10px] text-orange-500 font-semibold">DEMO</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2 text-gray-300 hover:text-primary-400 rounded-xl hover:bg-gray-800 transition-all font-medium"
              >
                {link.label}
              </Link>
            ))}
            <div className="ml-4 pl-4 border-l border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 transition-all shadow-ios"
                aria-label="Toggle theme"
              >
                {theme === 'light' ? (
                  <Moon className="w-5 h-5 text-gray-700" />
                ) : (
                  <Sun className="w-5 h-5 text-gray-300" />
                )}
              </button>
              <ConnectButton />
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="lg:hidden flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2.5 glass-strong rounded-xl hover:bg-gradient-to-r hover:from-primary-600/10 hover:to-secondary-500/10 transition-all duration-300"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              ) : (
                <Sun className="w-5 h-5 text-slate-300" />
              )}
            </button>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2.5 glass-strong rounded-xl hover:bg-primary-600/10 transition-all duration-300"
            >
              {isOpen ? <X className="w-6 h-6 text-slate-700 dark:text-slate-300" /> : <Menu className="w-6 h-6 text-slate-700 dark:text-slate-300" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isOpen && (
          <div className="lg:hidden py-6 glass-strong rounded-2xl mt-2 mb-4 space-y-2 animate-fadeIn">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-6 py-3 text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-slate-700/50 rounded-xl transition-all duration-300 font-medium"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="px-6 pt-4 border-t border-slate-200 dark:border-slate-700">
              <ConnectButton />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
