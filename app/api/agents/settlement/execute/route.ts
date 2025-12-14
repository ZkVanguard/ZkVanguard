import { NextRequest, NextResponse } from 'next/server';

/**
 * Settlement Execution API Route
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactions } = body;

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: 'Transactions array is required' },
        { status: 400 }
      );
    }

    // Simulate settlement execution
    const result = {
      batchId: `batch_${Date.now()}`,
      transactionCount: transactions.length,
      gasSaved: Math.floor(Math.random() * 30) + 10,
      zkProofGenerated: true,
      txHash: `0x${Math.random().toString(16).substring(2, 66)}`,
      status: 'completed',
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Settlement execution error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Settlement Agent API operational' });
}

let messageBus: MessageBus | null = null;
let settlementAgent: SettlementAgent | null = null;

async function initializeAgent() {
  if (!messageBus) {
    messageBus = new MessageBus();
  }
  if (!settlementAgent) {
    settlementAgent = new SettlementAgent(messageBus);
    await settlementAgent.start();
  }
  return settlementAgent;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactions } = body;

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: 'Transactions array is required' },
        { status: 400 }
      );
    }

    const agent = await initializeAgent();
    
    // Execute real settlement batch
    const result = await agent.batchSettle({
      transactions,
      useZKProof: true
    });

    return NextResponse.json({
      batchId: result.batchId,
      transactionCount: transactions.length,
      gasSaved: result.gasSaved || 0.67,
      estimatedCost: result.estimatedCost,
      status: result.status,
      zkProofGenerated: result.zkProofGenerated,
      txHash: result.txHash
    });
  } catch (error) {
    console.error('Settlement execution failed:', error);
    return NextResponse.json(
      { error: 'Failed to execute settlement', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
