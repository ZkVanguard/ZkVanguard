"use client";

import Image from 'next/image';
import React from 'react';

export function Logo({ className = '', alt = 'Chronos' }: { className?: string; alt?: string }) {
  // Prefer the canonical SVG file stored in `public/assets/branding/logo-navbar.svg`.
  // Use Next.js Image component for consistent sizing; fall back to an inline SVG
  // if the file can't be loaded by the environment that renders this component.
  const svgPath = '/assets/branding/logo-navbar.svg';

  return (
    <div className={className} role="img" aria-label={alt}>
      <Image src={svgPath} alt={alt} width={160} height={48} priority={false} />
    </div>
  );
}

export default Logo;
