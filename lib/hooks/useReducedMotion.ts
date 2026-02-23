/**
 * Hook to detect if user prefers reduced motion
 * Also checks device capabilities for low-power devices
 */
import { useEffect, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);
  
  useEffect(() => {
    // Check media query
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    
    // Also check device capability (low-end devices)
    const nav = navigator as { hardwareConcurrency?: number; deviceMemory?: number };
    const lowPower = (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) || 
                     (nav.deviceMemory && nav.deviceMemory < 4);
    
    if (lowPower) setReducedMotion(true);
    
    return () => mq.removeEventListener('change', handler);
  }, []);
  
  return reducedMotion;
}

/**
 * Get animation variants based on reduced motion preference
 */
export function getMotionVariants(reducedMotion: boolean) {
  if (reducedMotion) {
    return {
      initial: {},
      animate: {},
      exit: {},
      transition: { duration: 0 },
    };
  }
  
  return {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.3, ease: 'easeOut' },
  };
}
