'use client';

/**
 * Shared shell for /dashboard and its sub-routes.
 *
 * User report: "when we go to platforms any tab, the sidebar vanishes."
 * Root cause was that /dashboard/portfolio, /dashboard/risk, and
 * /dashboard/custody are standalone routes that don't inherit
 * dashboard/page.tsx's chrome. This layout gives every sub-route the
 * same navbar clearance plus a horizontal tab strip so users always
 * know which dashboard surface they're on and can jump between them
 * in one click.
 *
 * The dashboard root (/dashboard) has its own full-width shell with a
 * left sidebar of state-driven tabs (Vault / Overview / Positions /
 * Hedges / AI Agents / Insights); the strip below is redundant there,
 * so we hide it on the root path.
 */

import type { ComponentType, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Home, Briefcase, Activity, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { PositionsProvider } from '@/contexts/PositionsContext';
import { AIDecisionsProvider } from '@/contexts/AIDecisionsContext';

interface DashboardTab {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const SUB_TABS: DashboardTab[] = [
  { href: '/dashboard', label: 'Vault', icon: Home },
  { href: '/dashboard/portfolio', label: 'Portfolio', icon: Briefcase },
  { href: '/dashboard/risk', label: 'Risk', icon: Activity },
  { href: '/dashboard/custody', label: 'Custody', icon: ShieldCheck },
];

/**
 * Strip out `/en`, `/de`, ... from the leading segment so the tab
 * highlight logic doesn't have to know the current locale. next-intl
 * routes always have a locale prefix.
 */
function stripLocale(path: string): string {
  const m = path.match(/^\/[a-z]{2,}(\/.*)?$/);
  return m ? m[1] || '/' : path;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const routePath = stripLocale(pathname);
  const onRoot = routePath === '/dashboard';

  return (
    <PositionsProvider>
      <AIDecisionsProvider>
        {onRoot ? (
          // Root keeps its self-contained shell (with left sidebar +
          // state-driven tabs). No wrapper padding — the page owns it.
          children
        ) : (
          // Sub-pages inherit the shared frame: navbar clearance +
          // sticky tab strip so users always know which surface they're
          // on and can jump between them in one click.
          <div className="pt-[52px] min-h-screen bg-[#f5f5f7]">
            <nav
              aria-label="Dashboard sections"
              // Sits directly under the global Navbar (top: 52px). Own
              // z-index one below Navbar's z-50 so any modal stays above.
              className="sticky top-[52px] z-40 bg-white/95 backdrop-blur-xl border-b border-black/5"
            >
              <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 flex items-center gap-1 overflow-x-auto scrollbar-none h-12">
                {SUB_TABS.map(({ href, label, icon: Icon }) => {
                  const isActive = routePath === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={[
                        'flex items-center gap-1.5 px-3 h-9 rounded-lg text-[13px] font-medium',
                        'transition-colors whitespace-nowrap flex-shrink-0',
                        isActive
                          ? 'bg-[#007AFF]/10 text-[#007AFF]'
                          : 'text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/5',
                      ].join(' ')}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </nav>
            {children}
          </div>
        )}
      </AIDecisionsProvider>
    </PositionsProvider>
  );
}
