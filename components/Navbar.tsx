'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { ConnectButton } from './ConnectButton';
import { Menu, X, Zap, FlaskConical, Sun, Moon } from 'lucide-react';
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
    { href: '/docs', label: 'Documentation' },
  ];

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass-strong shadow-2xl' : 'bg-white/80 dark:bg-transparent backdrop-blur-sm'
      }`}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="group flex items-center space-x-3">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-xl blur-lg opacity-50 group-hover:opacity-75 transition-opacity" />
              <div className="relative p-2 bg-gradient-to-br from-emerald-600 to-cyan-600 rounded-xl">
                <Zap className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-black gradient-text">
                Chronos Vanguard
              </span>
              <span className="hidden md:flex items-center space-x-2 -mt-1">
                <FlaskConical className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-amber-400 font-semibold">DEMO</span>
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="relative px-6 py-2.5 text-gray-300 hover:text-white transition-all duration-300 font-medium group"
              >
                <span className="relative z-10">{link.label}</span>
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-600/0 via-cyan-600/0 to-emerald-600/0 group-hover:from-emerald-600/20 group-hover:via-cyan-600/20 group-hover:to-emerald-600/20 rounded-xl transition-all duration-300" />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0.5 bg-gradient-to-r from-emerald-500 to-cyan-500 group-hover:w-full transition-all duration-300" />
              </Link>
            ))}
            <div className="ml-4 pl-4 border-l border-gray-700/50 flex items-center gap-3">
              <button
                onClick={toggleTheme}
                className="p-2.5 glass-strong rounded-xl hover:bg-gradient-to-r hover:from-emerald-600/10 hover:to-cyan-600/10 transition-all duration-300 group"
                aria-label="Toggle theme"
              >
                {theme === 'light' ? (
                  <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300 group-hover:text-emerald-500 transition-colors" />
                ) : (
                  <Sun className="w-5 h-5 text-gray-300 group-hover:text-amber-400 transition-colors" />
                )}
              </button>
              <ConnectButton />
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="lg:hidden flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2.5 glass-strong rounded-xl hover:bg-gradient-to-r hover:from-emerald-600/10 hover:to-cyan-600/10 transition-all duration-300"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              ) : (
                <Sun className="w-5 h-5 text-gray-300" />
              )}
            </button>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2.5 glass-strong rounded-xl hover:bg-gray-800/60 transition-all duration-300"
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
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
                className="block px-6 py-3 text-gray-300 hover:text-white hover:bg-gray-800/40 rounded-xl transition-all duration-300 font-medium"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="px-6 pt-4 border-t border-gray-700/50">
              <ConnectButton />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
