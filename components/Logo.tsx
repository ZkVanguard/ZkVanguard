"use client";

import Image from 'next/image';
import React from 'react';

export function Logo({ className = '', alt = 'ZkVanguard' }: { className?: string; alt?: string }) {
  // Use the SVG asset in public for consistent rendering across server/client
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

export default Logo;
