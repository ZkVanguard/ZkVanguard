import { NextRequest, NextResponse } from 'next/server';
import { getOnChainPortfolioManager } from '@/lib/services/OnChainPortfolioManager';
import { logger } from '@/lib/utils/logger';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

/**
 * On-Chain Portfolio API
 * 
 * Manages the portfolio using ACTUAL MockUSDC on Cronos Testnet
 * 
 * Contract Addresses:
 * - MockUSDC: 0x28217DAddC55e3C4831b4A48A00Ce04880786967
 * - MockMoonlander: 0xAb4946d7BD583a74F5E5051b22332fA674D7BE54
 * - HedgeExecutor: 0x090b6221137690EbB37667E4644287487CE462B9
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'summary';
    const address = searchParams.get('address');

    const manager = getOnChainPortfolioManager();
    await manager.initialize(address || undefined);

    let result;

    switch (action) {
      case 'summary':
        result = await manager.getSummary();
        break;
      
      case 'positions':
        result = manager.getPositions();
        break;
      
      case 'risk':
        result = await manager.assessRiskWithAI();
        break;
      
      case 'balance':
        const balance = await manager.getMockUSDCBalance();
        result = {
          mockUSDC: {
            raw: balance.raw.toString(),
            formatted: balance.formatted,
            symbol: 'MockUSDC',
            decimals: 6,
          },
          contract: manager.getContractAddresses().MockUSDC,
        };
        break;
      
      case 'contracts':
        result = manager.getContractAddresses();
        break;
      
      default:
        result = await manager.getSummary();
    }

    return NextResponse.json({
      success: true,
      action,
      data: result,
      metadata: {
        source: 'OnChainPortfolioManager',
        network: 'cronos-testnet',
        chainId: 338,
        realAPITracking: true,
        aiRiskManagement: true,
        onChainMockUSDC: true,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    logger.error('On-Chain portfolio API error', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch on-chain portfolio', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, address, amount } = body;

    const manager = getOnChainPortfolioManager();
    await manager.initialize(address || undefined);

    let result;

    switch (action) {
      case 'refresh':
        // Refresh prices
        await (manager as unknown as { refreshPrices(): Promise<void> }).refreshPrices?.();
        result = { message: 'Prices refreshed', timestamp: Date.now() };
        break;
      
      case 'assess-risk':
        result = await manager.assessRiskWithAI();
        break;
      
      case 'mint':
        // Mint MockUSDC (requires PRIVATE_KEY in env)
        if (!amount || amount <= 0) {
          return NextResponse.json(
            { error: 'Amount is required for minting' },
            { status: 400 }
          );
        }
        const txHash = await manager.mintMockUSDC(amount);
        if (txHash) {
          result = { 
            message: `Minted ${amount.toLocaleString()} MockUSDC`,
            txHash,
            timestamp: Date.now(),
          };
        } else {
          return NextResponse.json(
            { error: 'Minting requires PRIVATE_KEY environment variable' },
            { status: 400 }
          );
        }
        break;
      
      case 'full-analysis':
        const summary = await manager.getSummary();
        result = summary;
        break;
      
      default:
        return NextResponse.json(
          { error: 'Invalid action. Valid actions: refresh, assess-risk, mint, full-analysis' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      action,
      result,
      metadata: {
        network: 'cronos-testnet',
        chainId: 338,
        realAPITracking: true,
        aiRiskManagement: true,
        onChainMockUSDC: true,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    logger.error('On-Chain portfolio action error', error);
    return NextResponse.json(
      { 
        error: 'Failed to execute action', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
