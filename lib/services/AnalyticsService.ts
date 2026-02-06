/**
 * GDPR-Compliant Analytics Service
 * 
 * Uses Neon PostgreSQL (free tier: 512MB, 3GB transfer/month)
 * 
 * Data collected (all anonymized):
 * - Page views (no IP stored)
 * - Feature usage (aggregated)
 * - Wallet connection events (hashed address only)
 * - Error events (for debugging)
 * 
 * Data NOT collected:
 * - Personal information (names, emails)
 * - IP addresses
 * - Precise geolocation
 * - Portfolio values or positions
 */

import { logger } from '@/lib/utils/logger';

// Check if analytics consent is given
function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  
  try {
    const consent = localStorage.getItem('zkvanguard_cookie_consent');
    if (!consent) return false;
    const parsed = JSON.parse(consent);
    return parsed.analytics === true;
  } catch {
    return false;
  }
}

// Hash function for anonymizing wallet addresses
async function hashAddress(address: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(address.toLowerCase() + 'zkvanguard_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// Get anonymized session ID (no cookies needed)
function getSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  
  let sessionId = sessionStorage.getItem('zk_session_id');
  if (!sessionId) {
    sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('zk_session_id', sessionId);
  }
  return sessionId;
}

// Analytics event types
export type AnalyticsEvent = 
  | 'page_view'
  | 'wallet_connect'
  | 'wallet_disconnect'
  | 'portfolio_create'
  | 'portfolio_view'
  | 'swap_initiated'
  | 'swap_completed'
  | 'hedge_created'
  | 'zk_proof_generated'
  | 'ai_chat_message'
  | 'chain_switched'
  | 'error';

export interface AnalyticsPayload {
  event: AnalyticsEvent;
  page?: string;
  chain?: string;
  feature?: string;
  error_type?: string;
  metadata?: Record<string, string | number | boolean>;
}

/**
 * Track an analytics event (GDPR compliant)
 */
export async function trackEvent(payload: AnalyticsPayload): Promise<void> {
  // Only track if consent given
  if (!hasAnalyticsConsent()) {
    logger.debug('Analytics event skipped - no consent', { component: 'AnalyticsService' });
    return;
  }

  try {
    const eventData = {
      ...payload,
      session_id: getSessionId(),
      timestamp: new Date().toISOString(),
      page: payload.page || (typeof window !== 'undefined' ? window.location.pathname : '/'),
      referrer: typeof document !== 'undefined' ? document.referrer?.split('?')[0] : undefined,
      screen_width: typeof window !== 'undefined' ? window.innerWidth : undefined,
      user_agent_type: getBrowserType(),
    };

    // Send to analytics API
    await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    }).catch(() => {
      // Silently fail - don't impact user experience
    });
  } catch {
    // Silently fail
  }
}

/**
 * Track page view
 */
export function trackPageView(page?: string): void {
  trackEvent({ event: 'page_view', page });
}

/**
 * Track wallet connection (anonymized)
 */
export async function trackWalletConnect(address: string, chain: string): Promise<void> {
  const hashedAddress = await hashAddress(address);
  trackEvent({
    event: 'wallet_connect',
    chain,
    metadata: { address_hash: hashedAddress },
  });
}

/**
 * Track feature usage
 */
export function trackFeatureUse(feature: string, metadata?: Record<string, string | number | boolean>): void {
  trackEvent({
    event: 'swap_initiated', // Generic feature event
    feature,
    metadata,
  });
}

/**
 * Track errors (for debugging)
 */
export function trackError(errorType: string, errorMessage: string): void {
  trackEvent({
    event: 'error',
    error_type: errorType,
    metadata: { message: errorMessage.slice(0, 200) }, // Truncate for privacy
  });
}

// Get basic browser type (not full user agent for privacy)
function getBrowserType(): string {
  if (typeof navigator === 'undefined') return 'server';
  
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('chrome')) return 'chrome';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('safari')) return 'safari';
  if (ua.includes('edge')) return 'edge';
  return 'other';
}

/**
 * Analytics React Hook
 */
export function useAnalytics() {
  return {
    trackPageView,
    trackWalletConnect,
    trackFeatureUse,
    trackError,
    trackEvent,
  };
}

export default {
  trackEvent,
  trackPageView,
  trackWalletConnect,
  trackFeatureUse,
  trackError,
};
