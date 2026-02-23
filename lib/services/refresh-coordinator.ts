/**
 * Refresh Coordinator
 * 
 * Centralizes all polling/refresh logic to prevent:
 * - Render storms from multiple components refreshing simultaneously
 * - Unnecessary network requests
 * - Battery drain on mobile devices
 * 
 * Usage:
 *   refreshCoordinator.on('refresh:positions', fetchPositions);
 *   refreshCoordinator.start();
 */

import { EventEmitter } from 'events';
import { logger } from '@/lib/utils/logger';

export type RefreshTarget = 'positions' | 'prices' | 'hedges' | 'ai' | 'all';

interface RefreshConfig {
  interval: number;
  priority: number; // Lower = higher priority
  enabled: boolean;
}

class RefreshCoordinator extends EventEmitter {
  private configs: Map<RefreshTarget, RefreshConfig> = new Map([
    ['prices', { interval: 5000, priority: 0, enabled: true }],      // 5s - critical
    ['positions', { interval: 60000, priority: 1, enabled: true }],  // 60s
    ['hedges', { interval: 30000, priority: 2, enabled: true }],     // 30s
    ['ai', { interval: 120000, priority: 3, enabled: true }],        // 2min - lowest priority
  ]);
  
  private timers: Map<RefreshTarget, NodeJS.Timeout> = new Map();
  private paused = false;
  private started = false;
  private lastRefresh: Map<RefreshTarget, number> = new Map();
  
  constructor() {
    super();
    this.setMaxListeners(50);
    
    // Listen to visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }
  
  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      logger.debug('[RefreshCoordinator] Page visible, resuming refreshes');
      this.resume();
      // Force immediate refresh of all on visibility restore
      this.forceRefresh('all');
    } else {
      logger.debug('[RefreshCoordinator] Page hidden, pausing refreshes');
      this.pause();
    }
  };
  
  /**
   * Start all refresh timers with staggered initial fetches
   */
  start(): void {
    if (this.started || this.paused) return;
    this.started = true;
    
    logger.info('[RefreshCoordinator] Starting coordinated refreshes');
    
    // Sort by priority and stagger initial fetches
    const sortedTargets = Array.from(this.configs.entries())
      .filter(([, config]) => config.enabled)
      .sort((a, b) => a[1].priority - b[1].priority);
    
    let delay = 0;
    for (const [target, config] of sortedTargets) {
      // Stagger initial fetch by 200ms per target
      setTimeout(() => {
        this.emitRefresh(target);
        
        // Set up recurring interval
        this.timers.set(target, setInterval(() => {
          if (document.visibilityState === 'visible' && !this.paused) {
            this.emitRefresh(target);
          }
        }, config.interval));
      }, delay);
      
      delay += 200;
    }
  }
  
  /**
   * Pause all refresh timers
   */
  pause(): void {
    this.paused = true;
    this.timers.forEach(timer => clearInterval(timer));
    this.timers.clear();
    logger.debug('[RefreshCoordinator] Paused');
  }
  
  /**
   * Resume refresh timers
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    
    // Restart timers (start() will handle the rest)
    this.started = false;
    this.start();
  }
  
  /**
   * Force immediate refresh of a target (bypasses throttling)
   */
  forceRefresh(target: RefreshTarget = 'all'): void {
    if (target === 'all') {
      // Stagger even forced refreshes to prevent thundering herd
      let delay = 0;
      for (const t of ['prices', 'positions', 'hedges', 'ai'] as RefreshTarget[]) {
        setTimeout(() => this.emitRefresh(t), delay);
        delay += 100;
      }
    } else {
      this.emitRefresh(target);
    }
  }
  
  /**
   * Update refresh interval for a target
   */
  setInterval(target: RefreshTarget, interval: number): void {
    const config = this.configs.get(target);
    if (config) {
      config.interval = interval;
      
      // Restart timer with new interval
      const existingTimer = this.timers.get(target);
      if (existingTimer) {
        clearInterval(existingTimer);
        this.timers.set(target, setInterval(() => {
          if (document.visibilityState === 'visible' && !this.paused) {
            this.emitRefresh(target);
          }
        }, interval));
      }
    }
  }
  
  /**
   * Enable/disable a refresh target
   */
  setEnabled(target: RefreshTarget, enabled: boolean): void {
    const config = this.configs.get(target);
    if (config) {
      config.enabled = enabled;
      
      if (!enabled) {
        const timer = this.timers.get(target);
        if (timer) {
          clearInterval(timer);
          this.timers.delete(target);
        }
      }
    }
  }
  
  /**
   * Get time since last refresh for a target
   */
  getTimeSinceRefresh(target: RefreshTarget): number {
    const last = this.lastRefresh.get(target);
    return last ? Date.now() - last : Infinity;
  }
  
  /**
   * Check if a target needs refresh based on its interval
   */
  needsRefresh(target: RefreshTarget): boolean {
    const config = this.configs.get(target);
    if (!config) return false;
    
    const timeSince = this.getTimeSinceRefresh(target);
    return timeSince >= config.interval;
  }
  
  private emitRefresh(target: RefreshTarget): void {
    this.lastRefresh.set(target, Date.now());
    this.emit(`refresh:${target}`);
    logger.debug(`[RefreshCoordinator] Emitted refresh:${target}`);
  }
  
  /**
   * Stop coordinator and clean up
   */
  destroy(): void {
    this.pause();
    this.removeAllListeners();
    
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }
}

// Singleton instance
export const refreshCoordinator = new RefreshCoordinator();

// Auto-start when imported client-side (if not SSR)
if (typeof window !== 'undefined') {
  // Delay start to allow providers to register listeners
  setTimeout(() => refreshCoordinator.start(), 1000);
}
