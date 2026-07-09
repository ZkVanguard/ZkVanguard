'use client';

import type { ComponentType, SVGProps } from 'react';

// Loose type — Lucide + Heroicons icons all accept className and strokeWidth
// but their declared prop types differ. Widen to SVGProps so we can pass
// strokeWidth for iOS-style weight animation without fighting TypeScript.
type IconType = ComponentType<Partial<SVGProps<SVGSVGElement>> & { className?: string }>;

// Reusable iOS-style bottom tab bar for the dashboard on mobile.
//
// Why a component: the drawer-only nav that used to live inline in
// dashboard/page.tsx meant users had to (1) tap menu → (2) drawer opens →
// (3) tap tab → (4) drawer animates closed → (5) content renders. Four
// interaction steps to move between the vault and hedges. Native iOS apps
// use a bottom tab bar for exactly this reason: one tap = one nav change.
//
// The tab bar sits fixed to the bottom on mobile only (`lg:hidden`),
// respects the iPhone home-indicator safe area via the pb-safe utility,
// and highlights the active tab. Overflow items ('More') route to the
// drawer so the primary tab bar stays scannable at 5 items or fewer.

export interface MobileTabItem<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconType;
  badge?: string;
}

interface MobileTabBarProps<Id extends string> {
  items: readonly MobileTabItem<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  onOpenMore?: () => void;
  moreLabel?: string;
  /** Icon for the "More" tab (only shown when onOpenMore is provided). */
  moreIcon?: IconType;
}

export function MobileTabBar<Id extends string>({
  items,
  activeId,
  onSelect,
  onOpenMore,
  moreLabel = 'More',
  moreIcon: MoreIcon,
}: MobileTabBarProps<Id>) {
  // Cap the primary tabs at 4 when a "More" button is present, so the row
  // shows 5 items max (Apple's Human Interface Guidelines cap for tab bars).
  const primary = onOpenMore ? items.slice(0, 4) : items.slice(0, 5);

  return (
    <nav
      role="tablist"
      aria-label="Dashboard sections"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/85 backdrop-blur-2xl border-t border-black/[0.08] pb-safe"
      style={{
        // Extra tint layer keeps the bar readable on white pages (iOS uses
        // a subtle vibrancy effect that our backdrop-blur alone doesn't
        // fully replicate).
        boxShadow: '0 -1px 0 rgba(0, 0, 0, 0.04)',
      }}
    >
      <div className="flex items-stretch h-[52px] max-w-lg mx-auto">
        {primary.map((item) => {
          const Icon = item.icon;
          const isActive = activeId === item.id;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={isActive}
              aria-label={item.label}
              onClick={() => onSelect(item.id)}
              className={`
                flex-1 flex flex-col items-center justify-center gap-[3px] min-w-0
                text-[10px] font-medium tracking-tight
                transition-all duration-200 ease-out
                active:scale-[0.92]
                ${isActive ? 'text-[#007AFF]' : 'text-[#86868b]'}
              `}
            >
              <div className="relative">
                <Icon
                  className="w-[26px] h-[26px] transition-transform duration-200 ease-out"
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                {item.badge && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-[#FF3B30] text-white text-[9px] font-bold flex items-center justify-center leading-none shadow-sm">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className={`truncate max-w-full leading-tight ${isActive ? 'font-semibold' : ''}`}>
                {item.label}
              </span>
            </button>
          );
        })}

        {onOpenMore && (
          <button
            role="tab"
            aria-label={moreLabel}
            onClick={onOpenMore}
            className="flex-1 flex flex-col items-center justify-center gap-[3px] min-w-0 text-[10px] font-medium tracking-tight text-[#86868b] transition-all duration-200 active:scale-[0.92]"
          >
            {MoreIcon ? (
              <MoreIcon className="w-[26px] h-[26px]" strokeWidth={1.8} />
            ) : (
              <div className="flex gap-[3px] h-[26px] items-center">
                <span className="w-1 h-1 rounded-full bg-current" />
                <span className="w-1 h-1 rounded-full bg-current" />
                <span className="w-1 h-1 rounded-full bg-current" />
              </div>
            )}
            <span className="truncate max-w-full leading-tight">{moreLabel}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
