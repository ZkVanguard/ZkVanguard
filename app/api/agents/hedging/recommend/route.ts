import { NextRequest, NextResponse } from 'next/server';

/**
 * Hedging Recommendations API Route
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, positions } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Generate hedging recommendations
    const recommendations = [
      {
        id: '1',
        type: 'short',
        asset: 'CRO',
        amount: 1000,
        confidence: 0.85,
        reasoning: 'Hedge against CRO volatility'
      },
      {
        id: '2',
        type: 'options',
        asset: 'USDC',
        amount: 500,
        confidence: 0.92,
        reasoning: 'Stable hedge position'
      }
    ];

    return NextResponse.json({
      recommendations,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Hedging recommendation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Hedging Agent API operational' });
}

let messageBus: MessageBus | null = null;
let hedgingAgent: HedgingAgent | null = null;

async function initializeAgent() {
  if (!messageBus) {
    messageBus = new MessageBus();
  }
  if (!hedgingAgent) {
    hedgingAgent = new HedgingAgent(messageBus);
    await hedgingAgent.start();
  }
  return hedgingAgent;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, positions } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    const agent = await initializeAgent();
    
    // Generate real hedging recommendations
    const recommendations = await agent.generateHedges({
      positions: positions || [],
      riskProfile: {},
      marketConditions: {}
    });

    return NextResponse.json(recommendations);
  } catch (error) {
    console.error('Hedging recommendation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate hedges', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
