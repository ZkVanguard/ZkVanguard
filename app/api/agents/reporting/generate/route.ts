import { NextRequest, NextResponse } from 'next/server';

/**
 * Portfolio Reporting API Route
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, period } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Generate portfolio report
    const report = {
      address,
      period: period || 'daily',
      totalValue: 50000 + Math.random() * 50000,
      profitLoss: -5000 + Math.random() * 10000,
      performance: {
        daily: 2.5,
        weekly: 8.3,
        monthly: 15.7
      },
      topPositions: [
        { asset: 'CRO', value: 25000, pnl: 5.2 },
        { asset: 'USDC', value: 15000, pnl: 0.1 },
        { asset: 'ETH', value: 10000, pnl: 8.5 }
      ],
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(report);
  } catch (error) {
    console.error('Report generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Reporting Agent API operational' });
}

let messageBus: MessageBus | null = null;
let reportingAgent: ReportingAgent | null = null;

async function initializeAgent() {
  if (!messageBus) {
    messageBus = new MessageBus();
  }
  if (!reportingAgent) {
    reportingAgent = new ReportingAgent(messageBus);
    await reportingAgent.start();
  }
  return reportingAgent;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, period } = body;

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    const agent = await initializeAgent();
    
    // Generate real portfolio report
    const report = await agent.generateReport({
      address,
      period: period || 'daily',
      includeMetrics: true
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error('Report generation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
