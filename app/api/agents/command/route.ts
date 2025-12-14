import { NextRequest, NextResponse } from 'next/server';
import { LeadAgent } from '@/agents/core/LeadAgent';
import { MessageBus } from '@/agents/communication/MessageBus';

let messageBus: MessageBus | null = null;
let leadAgent: LeadAgent | null = null;

async function initializeAgent() {
  if (!messageBus) {
    messageBus = new MessageBus();
  }
  if (!leadAgent) {
    leadAgent = new LeadAgent(messageBus);
    await leadAgent.start();
  }
  return leadAgent;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { command } = body;

    if (!command) {
      return NextResponse.json(
        { error: 'Command is required' },
        { status: 400 }
      );
    }

    const agent = await initializeAgent();
    
    // Process natural language command through Lead Agent
    const response = await agent.processNaturalLanguage(command);

    return NextResponse.json({
      success: response.success,
      response: response.response,
      action: response.action,
      data: response.data,
      agent: response.agent
    });
  } catch (error) {
    console.error('Command processing failed:', error);
    return NextResponse.json(
      { error: 'Failed to process command', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
