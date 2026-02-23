/**
 * Hook to detect connection speed and adapt loading behavior
 */
import { useEffect, useState } from 'react';

export type ConnectionSpeed = 'fast' | 'medium' | 'slow' | 'offline';

interface ConnectionState {
  speed: ConnectionSpeed;
  isOnline: boolean;
  effectiveType: string;
}

export function useConnectionSpeed(): ConnectionState {
  const [state, setState] = useState<ConnectionState>({
    speed: 'fast',
    isOnline: true,
    effectiveType: '4g',
  });
  
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    
    const updateSpeed = () => {
      const connection = (navigator as Navigator & { 
        connection?: { effectiveType: string; downlink: number } 
      }).connection;
      
      if (!navigator.onLine) {
        setState({ speed: 'offline', isOnline: false, effectiveType: 'offline' });
        return;
      }
      
      if (connection) {
        const effectiveType = connection.effectiveType;
        let speed: ConnectionSpeed = 'fast';
        
        if (effectiveType === '4g' && connection.downlink > 5) {
          speed = 'fast';
        } else if (effectiveType === '4g' || effectiveType === '3g') {
          speed = 'medium';
        } else {
          speed = 'slow';
        }
        
        setState({ speed, isOnline: true, effectiveType });
      } else {
        setState({ speed: 'fast', isOnline: true, effectiveType: 'unknown' });
      }
    };
    
    updateSpeed();
    
    window.addEventListener('online', updateSpeed);
    window.addEventListener('offline', updateSpeed);
    
    const connection = (navigator as Navigator & { 
      connection?: EventTarget 
    }).connection;
    connection?.addEventListener('change', updateSpeed);
    
    return () => {
      window.removeEventListener('online', updateSpeed);
      window.removeEventListener('offline', updateSpeed);
      connection?.removeEventListener('change', updateSpeed);
    };
  }, []);
  
  return state;
}

/**
 * Get adaptive timeout based on connection speed
 */
export function getAdaptiveTimeout(speed: ConnectionSpeed): number {
  switch (speed) {
    case 'fast': return 10000;
    case 'medium': return 20000;
    case 'slow': return 30000;
    case 'offline': return 0;
  }
}

/**
 * Get adaptive polling interval based on connection speed
 */
export function getAdaptivePollingInterval(speed: ConnectionSpeed, baseInterval: number): number {
  switch (speed) {
    case 'fast': return baseInterval;
    case 'medium': return baseInterval * 1.5;
    case 'slow': return baseInterval * 2;
    case 'offline': return 0; // Don't poll when offline
  }
}
