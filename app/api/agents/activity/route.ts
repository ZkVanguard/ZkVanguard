import { NextRequest, NextResponse } from 'next/server';

/**
 * Agent Activity Feed API Route
 */
export async function GET() {
  try {
    // Generate recent agent activity
    const activities = [
      {
        id: '1',
        agentName: 'Risk Agent',
        agentType: 'risk',
        action: 'assess_risk',
        description: 'Completed portfolio risk assessment',
        status: 'completed',
        timestamp: new Date(Date.now() - 30000).toISOString(),
        priority: 'high'
      },
      {
        id: '2',
        agentName: 'Hedging Agent',
        agentType: 'hedging',
        action: 'generate_hedges',
        description: 'Generated 3 hedging recommendations',
        status: 'completed',
        timestamp: new Date(Date.now() - 60000).toISOString(),
        priority: 'medium'
      },
      {
        id: '3',
        agentName: 'Settlement Agent',
        agentType: 'settlement',
        action: 'batch_settle',
        description: 'Processing settlement batch with ZK proofs',
        status: 'processing',
        timestamp: new Date(Date.now() - 90000).toISOString(),
        priority: 'critical'
      },
      {
        id: '4',
        agentName: 'Reporting Agent',
        agentType: 'reporting',
        action: 'generate_report',
        description: 'Monthly performance report generated',
        status: 'completed',
        timestamp: new Date(Date.now() - 120000).toISOString(),
        priority: 'low'
      },
      {
        id: '5',
        agentName: 'Lead Agent',
        agentType: 'lead',
        action: 'coordinate',
        description: 'Coordinating multi-agent strategy execution',
        status: 'processing',
        timestamp: new Date(Date.now() - 150000).toISOString(),
        priority: 'high'
      }
    ];

    return NextResponse.json(activities);
  } catch (error) {
    console.error('Activity feed error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
