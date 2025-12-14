import { NextRequest, NextResponse } from 'next/server';
import { HedgingAgent } from '@/agents/specialized/HedgingAgent';
import { MessageBus } from '@/agents/communication/MessageBus';

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
