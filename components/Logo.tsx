"use client";

import React, { useState } from 'react';

export function Logo({ className = '', alt = 'Chronos' }: { className?: string; alt?: string }) {
  // Client-side loader that prefers `logo.jpg` (if provided by designer),
  // falls back to `zkvanguard-logo.png`, then to `logo-navbar.svg`.
  const preferred = '/assets/branding/logo.jpg';
  const fallbackPng = '/assets/branding/zkvanguard-logo.png';
  const fallbackSvg = '/assets/branding/logo-navbar.svg';

  const [src, setSrc] = useState(preferred);

  const handleError = () => {
    if (src === preferred) setSrc(fallbackPng);
    else if (src === fallbackPng) setSrc(fallbackSvg);
    else setSrc('');
  };

  if (!src) {
    // Final inline SVG fallback (very small and accessible)
    return (
      <svg
        className={className}
        width="160"
        height="48"
        viewBox="0 0 160 48"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={alt}
      >
        <rect width="160" height="48" rx="6" fill="#47704c" />
        <text x="18" y="32" fill="#ffffff" fontSize="16" fontFamily="sans-serif">Chronos</text>
      </svg>
    );
  }

  return (
    // Use a regular <img> so the browser will attempt to load the designer-supplied JPEG.
    // `onError` will swap to the next fallback if the file isn't present in `public`.
    <img
      src={src}
      alt={alt}
      className={className}
      width={160}
      height={48}
      onError={handleError}
      style={{ objectFit: 'contain' }}
    />
  );
}

export default Logo;
