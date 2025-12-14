import { NextRequest, NextResponse } from 'next/server';
import { ReportingAgent } from '@/agents/specialized/ReportingAgent';
import { MessageBus } from '@/agents/communication/MessageBus';

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
