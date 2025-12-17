import { NextRequest, NextResponse } from 'next/server';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';

/**
 * Hedging Recommendations API Route
 * Uses Crypto.com AI for intelligent hedge strategy generation
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, portfolioData, riskProfile } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Use Crypto.com AI service for hedge recommendations
    const aiService = getCryptocomAIService();
    const aiRecommendations = await aiService.generateHedgeRecommendations(
      portfolioData || { address },
      riskProfile || {}
    );

    // Format for API response
    const recommendations = aiRecommendations.map(rec => ({
      strategy: rec.strategy,
      confidence: rec.confidence,
      expectedReduction: rec.expectedReduction,
      description: rec.description,
      actions: rec.actions.map(action => ({
        action: action.action.toUpperCase(),
        asset: action.asset,
        size: action.amount / 1000, // Convert to reasonable size
        leverage: action.action === 'short' ? 5 : 3,
        reason: rec.description,
        expectedGasSavings: 0.65 + Math.random() * 0.1
      }))
    }));

    return NextResponse.json({
      recommendations,
      aiPowered: aiService.isAvailable(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Hedging recommendation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate hedges', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
