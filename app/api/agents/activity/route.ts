import { NextRequest, NextResponse } from 'next/server';
import { MessageBus } from '@/agents/communication/MessageBus';

let messageBus: MessageBus | null = null;

function getMessageBus() {
  if (!messageBus) {
    messageBus = new MessageBus();
  }
  return messageBus;
}

export async function GET(request: NextRequest) {
  try {
    const bus = getMessageBus();
    
    // Get recent messages from message bus
    const recentMessages = bus.getRecentMessages ? bus.getRecentMessages(20) : [];

    const activity = recentMessages.map((msg: any) => ({
      id: msg.id || Date.now().toString(),
      agentName: getAgentDisplayName(msg.source || msg.from),
      agentType: msg.source || msg.from,
      action: msg.type,
      description: formatMessage(msg),
      status: msg.status || 'completed',
      timestamp: msg.timestamp || new Date(),
      priority: msg.priority || 'medium'
    }));

    return NextResponse.json(activity);
  } catch (error) {
    console.error('Failed to fetch agent activity:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function getAgentDisplayName(agentType: string): string {
  const names: Record<string, string> = {
    'risk-agent': 'Risk Agent',
    'hedging-agent': 'Hedging Agent',
    'settlement-agent': 'Settlement Agent',
    'reporting-agent': 'Reporting Agent',
    'lead-agent': 'Lead Agent'
  };
  return names[agentType] || agentType;
}

function formatMessage(msg: any): string {
  if (msg.type === 'RISK_ASSESSMENT') {
    return `Portfolio VaR: ${msg.payload?.var || 'N/A'}, Health: ${msg.payload?.healthScore || 'N/A'}`;
  }
  if (msg.type === 'HEDGE_RECOMMENDATION') {
    return `${msg.payload?.action} ${msg.payload?.asset} ${msg.payload?.size}x`;
  }
  if (msg.type === 'SETTLEMENT_BATCH') {
    return `Batch settlement: ${msg.payload?.count || 0} transactions`;
  }
  if (msg.type === 'REPORT_GENERATED') {
    return `${msg.payload?.period || 'Portfolio'} report generated`;
  }
  return msg.payload?.description || msg.type;
}
