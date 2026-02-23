/**
 * useAIManager Hook
 * =================
 * React hook for managing and monitoring the AI continuous management service.
 * Provides access to health status, metrics, and control functions.
 * 
 * Usage:
 * ```tsx
 * const { status, start, stop, forceRefresh, isHealthy } = useAIManager();
 * ```
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AIManager, type AIServiceType, type ServiceHealth, type ManagerMetrics, type ServiceStatus } from '@/lib/services/ai-manager';

export interface UseAIManagerReturn {
  // Status
  isRunning: boolean;
  websocketConnected: boolean;
  services: Record<AIServiceType, ServiceStatus>;
  queueLength: number;
  metrics: ManagerMetrics;
  
  // Computed
  isHealthy: boolean;
  hasIssues: boolean;
  overallHealth: ServiceHealth;
  
  // Controls
  start: () => void;
  stop: () => void;
  restart: () => void;
  forceRefresh: (type: AIServiceType) => void;
  pauseService: (type: AIServiceType) => void;
  resumeService: (type: AIServiceType) => void;
  setInterval: (type: AIServiceType, ms: number) => void;
  
  // Service-specific helpers
  getRiskHealth: () => ServiceHealth;
  getHedgesHealth: () => ServiceHealth;
  getInsightsHealth: () => ServiceHealth;
  getActionHealth: () => ServiceHealth;
}

export function useAIManager(autoStart = true): UseAIManagerReturn {
  const [status, setStatus] = useState(() => AIManager.getStatus());
  
  // Refresh status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(AIManager.getStatus());
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Auto-start on mount if requested
  useEffect(() => {
    if (autoStart && !status.isRunning) {
      AIManager.start();
      setStatus(AIManager.getStatus());
    }
    
    // Cleanup on unmount
    return () => {
      // Don't stop on unmount - let it run in background
      // AIManager.stop();
    };
  }, [autoStart]);
  
  // Computed values
  const isHealthy = useMemo(() => {
    return Object.values(status.services).every(s => s.health === 'healthy');
  }, [status.services]);
  
  const hasIssues = useMemo(() => {
    return Object.values(status.services).some(
      s => s.health === 'unhealthy' || s.health === 'degraded'
    );
  }, [status.services]);
  
  const overallHealth = useMemo<ServiceHealth>(() => {
    const healths = Object.values(status.services).map(s => s.health);
    if (healths.includes('unhealthy')) return 'unhealthy';
    if (healths.includes('degraded')) return 'degraded';
    if (healths.every(h => h === 'healthy')) return 'healthy';
    return 'unknown';
  }, [status.services]);
  
  // Control functions
  const start = useCallback(() => {
    AIManager.start();
    setStatus(AIManager.getStatus());
  }, []);
  
  const stop = useCallback(() => {
    AIManager.stop();
    setStatus(AIManager.getStatus());
  }, []);
  
  const restart = useCallback(() => {
    AIManager.restart();
    setTimeout(() => setStatus(AIManager.getStatus()), 1500);
  }, []);
  
  const forceRefresh = useCallback((type: AIServiceType) => {
    AIManager.forceRefresh(type);
  }, []);
  
  const pauseService = useCallback((type: AIServiceType) => {
    AIManager.pauseService(type);
    setStatus(AIManager.getStatus());
  }, []);
  
  const resumeService = useCallback((type: AIServiceType) => {
    AIManager.resumeService(type);
    setStatus(AIManager.getStatus());
  }, []);
  
  const setServiceInterval = useCallback((type: AIServiceType, ms: number) => {
    AIManager.setServiceInterval(type, ms);
  }, []);
  
  // Service-specific health getters
  const getRiskHealth = useCallback(() => status.services.risk?.health || 'unknown', [status.services]);
  const getHedgesHealth = useCallback(() => status.services.hedges?.health || 'unknown', [status.services]);
  const getInsightsHealth = useCallback(() => status.services.insights?.health || 'unknown', [status.services]);
  const getActionHealth = useCallback(() => status.services.action?.health || 'unknown', [status.services]);
  
  return {
    // Status
    isRunning: status.isRunning,
    websocketConnected: status.websocketConnected,
    services: status.services,
    queueLength: status.queueLength,
    metrics: status.metrics,
    
    // Computed
    isHealthy,
    hasIssues,
    overallHealth,
    
    // Controls
    start,
    stop,
    restart,
    forceRefresh,
    pauseService,
    resumeService,
    setInterval: setServiceInterval,
    
    // Service helpers
    getRiskHealth,
    getHedgesHealth,
    getInsightsHealth,
    getActionHealth,
  };
}

export default useAIManager;
