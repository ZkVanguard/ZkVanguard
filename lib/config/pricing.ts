/**
 * ZkVanguard Pricing Configuration
 * 
 * Centralized pricing model based on PRD specifications.
 * All fees, limits, and tier definitions are managed here.
 */

// ============================================================================
// Subscription Tiers
// ============================================================================

export type SubscriptionTier = 'free' | 'retail' | 'pro' | 'institutional' | 'enterprise';

export interface TierLimits {
  // AI Agents
  maxAgents: number;
  availableAgents: AgentType[];
  
  // ZK Proofs
  zkProofsPerMonth: number; // -1 for unlimited
  
  // Hedging
  advancedHedging: boolean;
  maxHedgePositions: number;
  
  // Portfolio
  maxPortfolioValue: number; // USD, -1 for unlimited
  
  // API Access
  apiAccess: boolean;
  apiRateLimit: number; // requests per minute
  
  // Support
  dedicatedSupport: boolean;
  whiteLabel: boolean;
}

export interface TierPricing {
  tier: SubscriptionTier;
  name: string;
  description: string;
  priceMonthly: number; // USD, 0 for free, -1 for custom
  priceAnnual: number; // USD (typically 10-20% discount)
  limits: TierLimits;
  features: string[];
  targetAudience: string;
  portfolioRange: string;
}

// ============================================================================
// AI Agent Types
// ============================================================================

export type AgentType = 'lead' | 'risk' | 'hedging' | 'settlement' | 'reporting';

export const ALL_AGENTS: AgentType[] = ['lead', 'risk', 'hedging', 'settlement', 'reporting'];
export const BASIC_AGENTS: AgentType[] = ['lead', 'risk', 'hedging'];

export const AGENT_INFO: Record<AgentType, { name: string; description: string }> = {
  lead: {
    name: 'Lead Agent',
    description: 'Coordinates all other agents and manages overall portfolio strategy',
  },
  risk: {
    name: 'Risk Agent',
    description: 'Monitors portfolio risk metrics and triggers alerts',
  },
  hedging: {
    name: 'Hedging Agent',
    description: 'Executes automated hedging strategies via perpetuals',
  },
  settlement: {
    name: 'Settlement Agent',
    description: 'Handles position settlements and profit taking',
  },
  reporting: {
    name: 'Reporting Agent',
    description: 'Generates reports and analytics on portfolio performance',
  },
};

// ============================================================================
// Tier Definitions (from PRD)
// ============================================================================

export const PRICING_TIERS: Record<SubscriptionTier, TierPricing> = {
  free: {
    tier: 'free',
    name: 'Free Trial',
    description: 'Try ZkVanguard with limited features',
    priceMonthly: 0,
    priceAnnual: 0,
    limits: {
      maxAgents: 1,
      availableAgents: ['lead'],
      zkProofsPerMonth: 2,
      advancedHedging: false,
      maxHedgePositions: 1,
      maxPortfolioValue: 10000, // $10K
      apiAccess: false,
      apiRateLimit: 0,
      dedicatedSupport: false,
      whiteLabel: false,
    },
    features: [
      'Basic portfolio monitoring',
      'Lead AI agent only',
      '2 ZK proofs per month',
      'Community support',
    ],
    targetAudience: 'New users evaluating the platform',
    portfolioRange: '<$10K',
  },
  
  retail: {
    tier: 'retail',
    name: 'Retail',
    description: 'For crypto-native traders',
    priceMonthly: 99,
    priceAnnual: 990, // ~17% discount
    limits: {
      maxAgents: 3,
      availableAgents: BASIC_AGENTS,
      zkProofsPerMonth: 10,
      advancedHedging: false,
      maxHedgePositions: 5,
      maxPortfolioValue: 100000, // $100K
      apiAccess: false,
      apiRateLimit: 0,
      dedicatedSupport: false,
      whiteLabel: false,
    },
    features: [
      '3 AI agents (Lead, Risk, Hedging)',
      'Basic hedging strategies',
      '10 ZK proofs per month',
      'Real-time portfolio monitoring',
      'Email support',
    ],
    targetAudience: 'Crypto-native traders',
    portfolioRange: '<$100K',
  },
  
  pro: {
    tier: 'pro',
    name: 'Pro',
    description: 'For serious traders and family offices',
    priceMonthly: 499,
    priceAnnual: 4990, // ~17% discount
    limits: {
      maxAgents: 5,
      availableAgents: ALL_AGENTS,
      zkProofsPerMonth: -1, // Unlimited
      advancedHedging: true,
      maxHedgePositions: 50,
      maxPortfolioValue: 5000000, // $5M
      apiAccess: false,
      apiRateLimit: 0,
      dedicatedSupport: false,
      whiteLabel: false,
    },
    features: [
      'All 5 AI agents',
      'Advanced hedging strategies',
      'Unlimited ZK proofs',
      'Priority email support',
      'Advanced analytics',
      'Multi-position hedging',
    ],
    targetAudience: 'Family offices',
    portfolioRange: '$100K-$5M',
  },
  
  institutional: {
    tier: 'institutional',
    name: 'Institutional',
    description: 'For hedge funds and large portfolios',
    priceMonthly: 2499,
    priceAnnual: 24990, // ~17% discount
    limits: {
      maxAgents: 5,
      availableAgents: ALL_AGENTS,
      zkProofsPerMonth: -1, // Unlimited
      advancedHedging: true,
      maxHedgePositions: -1, // Unlimited
      maxPortfolioValue: -1, // Unlimited
      apiAccess: true,
      apiRateLimit: 1000, // 1000 req/min
      dedicatedSupport: true,
      whiteLabel: false,
    },
    features: [
      'All 5 AI agents',
      'Advanced hedging strategies',
      'Unlimited ZK proofs',
      'API access',
      'Dedicated support',
      'SLA guarantees',
      'Custom reporting',
    ],
    targetAudience: 'Hedge funds',
    portfolioRange: '>$5M',
  },
  
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    description: 'Custom solutions for RWA platforms',
    priceMonthly: -1, // Custom pricing
    priceAnnual: -1,
    limits: {
      maxAgents: 5,
      availableAgents: ALL_AGENTS,
      zkProofsPerMonth: -1,
      advancedHedging: true,
      maxHedgePositions: -1,
      maxPortfolioValue: -1,
      apiAccess: true,
      apiRateLimit: -1, // Custom
      dedicatedSupport: true,
      whiteLabel: true,
    },
    features: [
      'Full white-label solution',
      'Revenue share model',
      'Custom SLA guarantees',
      'Dedicated engineering support',
      'Custom integrations',
      'On-premise deployment optional',
    ],
    targetAudience: 'RWA platforms',
    portfolioRange: '$100M+ TVL',
  },
};

// ============================================================================
// On-Chain Fee Configuration
// ============================================================================

export interface OnChainFees {
  // HedgeExecutor fees (Cronos EVM)
  hedgeExecutor: {
    feeRateBps: number; // Basis points (100 = 1%)
    maxFeeRateBps: number;
    minCollateralUsdc: number; // Minimum collateral in USDC (6 decimals)
    description: string;
  };
  
  // x402 Gasless fees
  x402Gasless: {
    feePerTransaction: string; // In USDC (6 decimals) - "10000" = 0.01 USDC
    feePerTransactionUsdc: number; // Human readable
    description: string;
  };
  
  // Oracle fees (Moonlander)
  oracle: {
    feePerCallTcro: number; // tCRO for testnet
    feeCro: number; // CRO for mainnet
    description: string;
  };
  
  // SUI Protocol fees
  suiProtocol: {
    feeRateBps: number; // Basis points (50 = 0.5%)
    description: string;
  };
}

export const ON_CHAIN_FEES: OnChainFees = {
  hedgeExecutor: {
    feeRateBps: 10, // 0.1%
    maxFeeRateBps: 100, // 1% max as per contract
    minCollateralUsdc: 1_000_000, // 1 USDC (6 decimals)
    description: 'Platform fee charged on hedge executions',
  },
  
  x402Gasless: {
    feePerTransaction: '10000', // 0.01 USDC in 6 decimals
    feePerTransactionUsdc: 0.01,
    description: 'Fee per gasless transaction (paid by platform, not user)',
  },
  
  oracle: {
    feePerCallTcro: 0.06, // Testnet
    feeCro: 0.06, // Mainnet (same for now)
    description: 'Oracle fee for Moonlander price feeds',
  },
  
  suiProtocol: {
    feeRateBps: 50, // 0.5%
    description: 'Protocol fee on SUI RWA Manager operations',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the appropriate tier based on portfolio value
 */
export function getRecommendedTier(portfolioValueUsd: number): SubscriptionTier {
  if (portfolioValueUsd <= 10000) return 'free';
  if (portfolioValueUsd <= 100000) return 'retail';
  if (portfolioValueUsd <= 5000000) return 'pro';
  if (portfolioValueUsd <= 100000000) return 'institutional';
  return 'enterprise';
}

/**
 * Calculate hedge fee in USDC
 */
export function calculateHedgeFee(collateralUsdc: number): number {
  const feeBps = ON_CHAIN_FEES.hedgeExecutor.feeRateBps;
  return (collateralUsdc * feeBps) / 10000;
}

/**
 * Calculate SUI protocol fee
 */
export function calculateSuiProtocolFee(amountUsdc: number): number {
  const feeBps = ON_CHAIN_FEES.suiProtocol.feeRateBps;
  return (amountUsdc * feeBps) / 10000;
}

/**
 * Check if a feature is available for a tier
 */
export function isFeatureAvailable(tier: SubscriptionTier, feature: keyof TierLimits): boolean {
  const limits = PRICING_TIERS[tier].limits;
  const value = limits[feature];
  
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && value !== -1;
  if (Array.isArray(value)) return value.length > 0;
  
  return true;
}

/**
 * Check if an agent is available for a tier
 */
export function isAgentAvailable(tier: SubscriptionTier, agent: AgentType): boolean {
  return PRICING_TIERS[tier].limits.availableAgents.includes(agent);
}

/**
 * Get ZK proofs remaining for a user
 */
export function getZkProofsRemaining(tier: SubscriptionTier, usedThisMonth: number): number {
  const limit = PRICING_TIERS[tier].limits.zkProofsPerMonth;
  if (limit === -1) return Infinity;
  return Math.max(0, limit - usedThisMonth);
}

/**
 * Check if user can create more hedge positions
 */
export function canCreateHedge(
  tier: SubscriptionTier,
  currentPositions: number
): boolean {
  const maxPositions = PRICING_TIERS[tier].limits.maxHedgePositions;
  if (maxPositions === -1) return true;
  return currentPositions < maxPositions;
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  if (price === 0) return 'Free';
  if (price === -1) return 'Custom';
  return `$${price.toLocaleString()}`;
}

/**
 * Get annual savings compared to monthly billing
 */
export function getAnnualSavings(tier: SubscriptionTier): number {
  const { priceMonthly, priceAnnual } = PRICING_TIERS[tier];
  if (priceMonthly <= 0 || priceAnnual <= 0) return 0;
  return (priceMonthly * 12) - priceAnnual;
}

/**
 * Calculate ROI based on PRD analysis
 * Pro tier: 8x-10x ROI
 */
export function estimatedMonthlySavings(tier: SubscriptionTier): {
  gasFeeSavings: number;
  laborSavings: number;
  riskMitigation: number;
  total: number;
} {
  switch (tier) {
    case 'pro':
      return {
        gasFeeSavings: 3500, // $2K-$5K/month → ~$3.5K average
        laborSavings: 12500, // 0.5 FTE at $150K/year
        riskMitigation: 2500, // ~$30K/year prevented losses
        total: 18500,
      };
    case 'institutional':
      return {
        gasFeeSavings: 7500, // Higher volume
        laborSavings: 20000, // More FTE replacement
        riskMitigation: 5000, // Larger portfolio protection
        total: 32500,
      };
    default:
      return {
        gasFeeSavings: 500,
        laborSavings: 0,
        riskMitigation: 500,
        total: 1000,
      };
  }
}
