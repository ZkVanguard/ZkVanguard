import { NextRequest, NextResponse } from 'next/server';
import { getSimulatedPortfolioManager } from '@/lib/services/SimulatedPortfolioManager';

/**
 * Simulated Portfolio Management API
 * 
 * Uses REAL market data from Crypto.com MCP and AI analysis
 * to demonstrate the full system capabilities
 */

export async function GET() {
  try {
    const manager = getSimulatedPortfolioManager();
    await manager.initialize();
    
    const summary = await manager.getSummary();
    const tradeHistory = manager.getTradeHistory();
    const snapshots = manager.getSnapshots();

    return NextResponse.json({
      success: true,
      portfolio: summary,
      trades: tradeHistory,
      snapshots,
      note: 'Using REAL market data from Crypto.com MCP (FREE hackathon service)',
    });
  } catch (error) {
    console.error('Simulated portfolio error:', error);
    return NextResponse.json(
      { error: 'Failed to get portfolio', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, symbol, amount, reason } = body;

    const manager = getSimulatedPortfolioManager();
    await manager.initialize();

    let result;

    switch (action) {
      case 'buy':
        result = await manager.buy(symbol, amount, reason);
        break;
      
      case 'sell':
        result = await manager.sell(symbol, amount, reason);
        break;
      
      case 'analyze':
        result = await manager.analyzePortfolio();
        break;
      
      case 'assess-risk':
        result = await manager.assessRisk();
        break;
      
      case 'get-hedges':
        result = await manager.getHedgeRecommendations();
        break;
      
      case 'execute-ai':
        if (!body.recommendation) {
          return NextResponse.json(
            { error: 'recommendation is required for execute-ai action' },
            { status: 400 }
          );
        }
        result = await manager.executeAIRecommendation(body.recommendation);
        break;
      
      case 'snapshot':
        result = await manager.takeSnapshot();
        break;
      
      default:
        return NextResponse.json(
          { error: 'Invalid action. Valid actions: buy, sell, analyze, assess-risk, get-hedges, execute-ai, snapshot' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      action,
      result,
      portfolio: await manager.getSummary(),
      realData: true,
    });
  } catch (error) {
    console.error('Simulated portfolio action error:', error);
    return NextResponse.json(
      { error: 'Failed to execute action', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
