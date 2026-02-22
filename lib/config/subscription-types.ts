/**
 * Subscription Types
 * 
 * Types and interfaces for managing user subscriptions.
 */

import { SubscriptionTier, AgentType } from './pricing';

// ============================================================================
// User Subscription
// ============================================================================

export interface UserSubscription {
  userId: string;
  walletAddress: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  
  // Billing
  billingCycle: 'monthly' | 'annual';
  startDate: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  
  // Usage tracking
  usage: SubscriptionUsage;
  
  // Payment (optional - for managed billing)
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export type SubscriptionStatus = 
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export interface SubscriptionUsage {
  // ZK Proofs
  zkProofsUsedThisMonth: number;
  zkProofsLastReset: Date;
  
  // Hedge Positions
  activeHedgePositions: number;
  totalHedgesCreated: number;
  
  // API (if applicable)
  apiCallsThisMinute: number;
  apiCallsLastReset: Date;
  
  // Portfolio tracking
  currentPortfolioValue: number;
  peakPortfolioValue: number;
}

// ============================================================================
// Feature Access
// ============================================================================

export interface FeatureAccess {
  canAccessAgent: (agent: AgentType) => boolean;
  canCreateZkProof: boolean;
  canCreateHedge: boolean;
  canAccessApi: boolean;
  hasAdvancedHedging: boolean;
  hasDedicatedSupport: boolean;
  hasWhiteLabel: boolean;
  
  // Usage limits
  zkProofsRemaining: number;
  hedgePositionsRemaining: number;
  apiCallsRemaining: number;
}

// ============================================================================
// Subscription Events
// ============================================================================

export type SubscriptionEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.renewed'
  | 'usage.zk_proof'
  | 'usage.hedge_created'
  | 'usage.hedge_closed'
  | 'usage.api_call'
  | 'limit.reached'
  | 'limit.warning';

export interface SubscriptionEvent {
  id: string;
  type: SubscriptionEventType;
  userId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

// ============================================================================
// Upgrade/Downgrade
// ============================================================================

export interface TierChangeRequest {
  currentTier: SubscriptionTier;
  targetTier: SubscriptionTier;
  effectiveDate: 'immediate' | 'end_of_period';
  prorationAmount?: number; // USD, positive = charge, negative = credit
}

export interface TierChangeResult {
  success: boolean;
  newTier: SubscriptionTier;
  effectiveDate: Date;
  prorationApplied: number;
  nextBillingAmount: number;
  message: string;
}

// ============================================================================
// Pricing Display
// ============================================================================

export interface PricingDisplayData {
  tier: SubscriptionTier;
  name: string;
  description: string;
  monthlyPrice: string; // Formatted: "$99", "Custom", "Free"
  annualPrice: string;
  annualSavings: string;
  features: string[];
  limits: {
    agents: string; // "3 AI agents", "All 5 AI agents"
    zkProofs: string; // "10/month", "Unlimited"
    hedging: string; // "Basic", "Advanced"
    support: string; // "Community", "Email", "Dedicated"
  };
  isPopular: boolean;
  ctaText: string;
  ctaLink: string;
}

// ============================================================================
// Helper Types
// ============================================================================

export type UsageMetric = 'zk_proofs' | 'hedge_positions' | 'api_calls' | 'portfolio_value';

export interface UsageLimitCheck {
  metric: UsageMetric;
  currentValue: number;
  limit: number;
  isUnlimited: boolean;
  percentUsed: number;
  isAtLimit: boolean;
  isNearLimit: boolean; // >80%
}
