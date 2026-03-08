import { NextRequest, NextResponse } from 'next/server';
import { getOnChainPortfolioManager } from '@/lib/services/OnChainPortfolioManager';
import { logger } from '@/lib/utils/logger';
import { requireAuth, requireAdminAuth } from '@/lib/security/auth-middleware';
import { readLimiter, mutationLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

// SECURITY: Max mint amount to prevent unlimited minting
const MAX_MINT_AMOUNT = 1_000_000_000; // $1B max

/**
 * On-Chain Portfolio API
 * 
 * Manages the portfolio using ACTUAL MockUSDC on Cronos Testnet
 * SECURITY: POST requires auth. Mint requires admin auth. Amount bounds enforced.
 */

export async function GET(request: NextRequest) {
  const limited = readLimiter.check(request);
  if (limited) return limited;

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
    return safeErrorResponse(error, 'portfolio/onchain GET');
  }
}

export async function POST(request: NextRequest) {
  // Rate limit mutations
  const limited = mutationLimiter.check(request);
  if (limited) return limited;

  // SECURITY: Require auth for all POST actions
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

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
      
      case 'mint': {
        // SECURITY: Mint is admin-only to prevent unlimited token minting
        const adminCheck = requireAdminAuth(request);
        if (adminCheck !== true) return adminCheck;
        
        if (!amount || amount <= 0 || amount > MAX_MINT_AMOUNT) {
          return NextResponse.json(
            { success: false, error: `Amount must be between 1 and ${MAX_MINT_AMOUNT}` },
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
            { success: false, error: 'Minting requires PRIVATE_KEY environment variable' },
            { status: 400 }
          );
        }
        break;
      }
      
      case 'full-analysis':
        const summary = await manager.getSummary();
        result = summary;
        break;
      
      case 'create-portfolio':
        // Create portfolio on RWAManager with MockUSDC deposit
        const depositAmount = body.depositAmount || 150000000; // Default $150M
        const createResult = await manager.createPortfolioOnRWAManager(depositAmount);
        
        if (!createResult.success) {
          return NextResponse.json(
            { error: createResult.error || 'Failed to create portfolio' },
            { status: 400 }
          );
        }
        
        result = {
          message: `Portfolio #${createResult.portfolioId} created with $${depositAmount.toLocaleString()} MockUSDC`,
          portfolioId: createResult.portfolioId,
          txHashes: createResult.txHashes,
          allocations: createResult.allocations,
          totalValue: depositAmount,
          assets: {
            BTC: { percentage: 35, value: depositAmount * 0.35 },
            ETH: { percentage: 30, value: depositAmount * 0.30 },
            CRO: { percentage: 20, value: depositAmount * 0.20 },
            SUI: { percentage: 15, value: depositAmount * 0.15 },
          },
        };
        break;
      
      default:
        return NextResponse.json(
          { error: 'Invalid action. Valid actions: refresh, assess-risk, mint, full-analysis, create-portfolio' },
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
    return safeErrorResponse(error, 'portfolio/onchain POST');
  }
}
