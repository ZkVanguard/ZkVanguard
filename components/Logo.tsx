"use client";

import React from 'react';
import Image from 'next/image';

export function Logo({ className = '', alt = 'ZkVanguard' }: { className?: string; alt?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Image 
        src="/logo-official.svg" 
        alt={alt} 
        width={36}
        height={36}
        className="h-9 w-9 rounded-lg"
        priority
      />
      <span className="text-title-3 font-semibold text-label-primary tracking-tight hidden sm:inline">
        ZkVanguard
      </span>
    </div>
  );
}

export default Logo;
