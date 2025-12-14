import { NextRequest, NextResponse } from 'next/server';

/**
 * Risk Assessment API Route
 * Returns portfolio risk metrics
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Simulate risk assessment calculation
    const riskMetrics = {
      var: 0.12 + Math.random() * 0.08,
      volatility: 0.18 + Math.random() * 0.15,
      sharpeRatio: 1.5 + Math.random() * 1.0,
      liquidationRisk: 0.03 + Math.random() * 0.07,
      healthScore: 75 + Math.random() * 20,
      recommendations: [
        'Consider hedging positions with high volatility',
        'Portfolio diversification is recommended',
        'Monitor market conditions closely'
      ],
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(riskMetrics);
  } catch (error) {
    console.error('Risk assessment error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Risk Agent API operational' });
}
