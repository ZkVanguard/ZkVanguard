import { NextRequest, NextResponse } from 'next/server';

/**
 * Natural Language Command Processing API Route
 */
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

    // Process natural language command
    const lowerCommand = command.toLowerCase();
    let response = {
      success: true,
      response: '',
      action: '',
      data: {},
      agent: 'lead'
    };

    if (lowerCommand.includes('risk') || lowerCommand.includes('analyze')) {
      response.response = 'Analyzing portfolio risk... Your current risk score is 78/100. Portfolio shows moderate volatility with good diversification.';
      response.action = 'risk_assessment';
      response.agent = 'risk';
    } else if (lowerCommand.includes('hedge') || lowerCommand.includes('protect')) {
      response.response = 'Generating hedging strategies... I recommend 3 hedge positions to reduce downside risk by 25%.';
      response.action = 'hedging_recommendation';
      response.agent = 'hedging';
    } else if (lowerCommand.includes('settle') || lowerCommand.includes('execute')) {
      response.response = 'Executing settlement batch... Transaction completed with 23% gas savings using ZK proofs.';
      response.action = 'settlement_execution';
      response.agent = 'settlement';
    } else if (lowerCommand.includes('report') || lowerCommand.includes('performance')) {
      response.response = 'Generating portfolio report... Your portfolio is up 8.5% this month with excellent risk-adjusted returns.';
      response.action = 'report_generation';
      response.agent = 'reporting';
    } else {
      response.response = 'I can help you with risk analysis, hedging strategies, settlement execution, and performance reporting. What would you like to do?';
      response.action = 'help';
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Command processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Command Agent API operational' });
}

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
