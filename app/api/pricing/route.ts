import { NextResponse } from 'next/server';
import {
  PRICING_TIERS,
  ON_CHAIN_FEES,
  ALL_AGENTS,
  BASIC_AGENTS,
  AGENT_INFO,
  getRecommendedTier,
  calculateHedgeFee,
  getAnnualSavings,
  formatPrice,
  type SubscriptionTier,
} from '@/lib/config/pricing';
import type { PricingDisplayData } from '@/lib/config/subscription-types';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = 3600; // Cache for 1 hour

/**
 * Pricing API
 * GET /api/pricing - Get all pricing tiers and fee information
 */
export async function GET() {
  try {
    // Build display-friendly pricing data
    const tiers: PricingDisplayData[] = Object.values(PRICING_TIERS).map((tier) => {
      const isUnlimitedZk = tier.limits.zkProofsPerMonth === -1;
      const isUnlimitedHedge = tier.limits.maxHedgePositions === -1;
      
      return {
        tier: tier.tier,
        name: tier.name,
        description: tier.description,
        monthlyPrice: formatPrice(tier.priceMonthly),
        annualPrice: formatPrice(tier.priceAnnual),
        annualSavings: tier.priceMonthly > 0 
          ? `Save $${getAnnualSavings(tier.tier).toLocaleString()}/year`
          : '',
        features: tier.features,
        limits: {
          agents: tier.limits.maxAgents === 5 
            ? 'All 5 AI agents' 
            : `${tier.limits.maxAgents} AI agent${tier.limits.maxAgents > 1 ? 's' : ''}`,
          zkProofs: isUnlimitedZk ? 'Unlimited' : `${tier.limits.zkProofsPerMonth}/month`,
          hedging: tier.limits.advancedHedging ? 'Advanced' : 'Basic',
          support: tier.limits.dedicatedSupport 
            ? 'Dedicated' 
            : tier.tier === 'free' 
              ? 'Community' 
              : 'Email',
        },
        isPopular: tier.tier === 'pro',
        ctaText: tier.tier === 'free' 
          ? 'Start Free Trial' 
          : tier.tier === 'enterprise' 
            ? 'Contact Sales' 
            : 'Get Started',
        ctaLink: tier.tier === 'enterprise' 
          ? '/contact' 
          : `/subscribe?tier=${tier.tier}`,
      };
    });

    // On-chain fee information
    const fees = {
      hedge: {
        rateBps: ON_CHAIN_FEES.hedgeExecutor.feeRateBps,
        ratePercent: ON_CHAIN_FEES.hedgeExecutor.feeRateBps / 100,
        minCollateralUsdc: ON_CHAIN_FEES.hedgeExecutor.minCollateralUsdc / 1_000_000,
        description: ON_CHAIN_FEES.hedgeExecutor.description,
        example: {
          collateral: 1000,
          fee: calculateHedgeFee(1000),
          net: 1000 - calculateHedgeFee(1000),
        },
      },
      gasless: {
        feePerTransaction: ON_CHAIN_FEES.x402Gasless.feePerTransactionUsdc,
        description: ON_CHAIN_FEES.x402Gasless.description,
        note: 'Fee is paid by platform, not user',
      },
      oracle: {
        feePerCall: ON_CHAIN_FEES.oracle.feeCro,
        currency: 'CRO',
        description: ON_CHAIN_FEES.oracle.description,
      },
      sui: {
        rateBps: ON_CHAIN_FEES.suiProtocol.feeRateBps,
        ratePercent: ON_CHAIN_FEES.suiProtocol.feeRateBps / 100,
        description: ON_CHAIN_FEES.suiProtocol.description,
      },
    };

    // Agent information
    const agents = ALL_AGENTS.map((agent) => ({
      id: agent,
      ...AGENT_INFO[agent],
      availableIn: Object.entries(PRICING_TIERS)
        .filter(([_, tier]) => tier.limits.availableAgents.includes(agent))
        .map(([key]) => key),
    }));

    return NextResponse.json({
      success: true,
      data: {
        tiers,
        fees,
        agents,
        basicAgents: BASIC_AGENTS,
        allAgents: ALL_AGENTS,
      },
      meta: {
        currency: 'USD',
        billingCycles: ['monthly', 'annual'],
        annualDiscountPercent: 17,
      },
    });
  } catch (error) {
    console.error('[Pricing API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch pricing information',
      },
      { status: 500 }
    );
  }
}

/**
 * Get recommended tier based on portfolio value
 * POST /api/pricing
 * Body: { portfolioValue: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { portfolioValue } = body;

    if (typeof portfolioValue !== 'number' || portfolioValue < 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid portfolioValue - must be a positive number',
        },
        { status: 400 }
      );
    }

    const recommendedTier = getRecommendedTier(portfolioValue);
    const tierData = PRICING_TIERS[recommendedTier];

    return NextResponse.json({
      success: true,
      data: {
        recommendedTier,
        tierName: tierData.name,
        price: formatPrice(tierData.priceMonthly),
        reason: `Based on your portfolio value of $${portfolioValue.toLocaleString()}, we recommend the ${tierData.name} tier.`,
        features: tierData.features,
      },
    });
  } catch (error) {
    console.error('[Pricing API] POST Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get tier recommendation',
      },
      { status: 500 }
    );
  }
}
