'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';

export function InfoTooltip({ content }: { content: string | string[] }) {
  const [isHovered, setIsHovered] = useState(false);
  const lines = Array.isArray(content) ? content : [content];
  
  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Info 
        className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#86868b] hover:text-[#007AFF] cursor-help transition-colors"
      />
      {isHovered && (
        <div className="absolute left-6 top-0 z-[100] w-72 sm:w-80 bg-white border border-[#E5E5EA] rounded-[12px] p-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
          <div className="text-[11px] sm:text-[12px] space-y-1.5">
            {lines.map((line, idx) => (
              <p key={idx} className="leading-relaxed text-[#1D1D1F]">{line}</p>
            ))}
          </div>
          <div className="absolute left-0 top-2 w-2 h-2 bg-white border-l border-t border-[#E5E5EA] transform -translate-x-1 rotate-45" />
        </div>
      )}
    </div>
  );
}
