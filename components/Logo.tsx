"use client";

import React from 'react';

export function Logo({ className = '', alt = 'ZkVanguard' }: { className?: string; alt?: string }) {
  // Use existing SVG logo
  const logo = '/assets/branding/logo.svg';

  return (
    <img 
      src={logo} 
      alt={alt} 
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}

export default Logo;
