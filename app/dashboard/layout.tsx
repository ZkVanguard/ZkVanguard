'use client';

import { ReactNode } from 'react';

// Dashboard has its own layout - no footer, handles its own spacing
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style jsx global>{`
        /* Hide footer on dashboard pages */
        footer {
          display: none !important;
        }
        /* Remove extra top padding from main since dashboard handles it */
        main.flex-grow {
          padding-top: 0 !important;
        }
      `}</style>
      {children}
    </>
  );
}
