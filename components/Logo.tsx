"use client";

import React from 'react';

export function Logo({ className = '', alt = 'ZkVanguard' }: { className?: string; alt?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img 
        src="/logo-official.svg" 
        alt={alt} 
        className="h-9 w-9 rounded-lg"
        style={{ objectFit: 'contain' }}
      />
      <span className="text-title-3 font-semibold text-label-primary tracking-tight hidden sm:inline">
        ZkVanguard
      </span>
    </div>
  );
}

export default Logo;
