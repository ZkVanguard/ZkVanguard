/**
 * Auto-Rebalancing API Route
 * 
 * Endpoints:
 * - POST /api/agents/auto-rebalance?action=start
 * - POST /api/agents/auto-rebalance?action=stop  
 * - POST /api/agents/auto-rebalance?action=enable
 * - POST /api/agents/auto-rebalance?action=disable
 * - POST /api/agents/auto-rebalance?action=trigger_assessment
 * - GET  /api/agents/auto-rebalance?action=status
 * - GET  /api/agents/auto-rebalance?action=assessment&portfolioId=3
 */

import { NextRequest, NextResponse } from 'next/server';
import { autoRebalanceService, type AutoRebalanceConfig, type RebalanceFrequency } from '@/lib/services/AutoRebalanceService';
import { logger } from '@/lib/utils/logger';
import { 
  saveAutoRebalanceConfig, 
  getAutoRebalanceConfig,
  getAutoRebalanceConfigs,
  deleteAutoRebalanceConfig 
} from '@/lib/storage/auto-rebalance-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST - Control auto-rebalancing service
 */
export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const body = await request.json().catch(() => ({}));
    
    const { portfolioId, walletAddress, config } = body;

    switch (action) {
      case 'start':
        // Start the auto-rebalancing service
        await autoRebalanceService.start();
        return NextResponse.json({
          success: true,
          message: 'Auto-rebalancing service started',
          status: autoRebalanceService.getStatus(),
        });

      case 'stop':
        // Stop the auto-rebalancing service
        autoRebalanceService.stop();
        return NextResponse.json({
          success: true,
          message: 'Auto-rebalancing service stopped',
        });

      case 'enable':
        // Enable auto-rebalancing for a specific portfolio
        if (!portfolioId || !walletAddress) {
          return NextResponse.json(
            { success: false, error: 'portfolioId and walletAddress required' },
            { status: 400 }
          );
        }

        const rebalanceConfig: AutoRebalanceConfig = {
          portfolioId: parseInt(portfolioId),
          walletAddress,
          enabled: true,
          threshold: config?.threshold || 2, // Default: 2% drift (lowered for active rebalancing)
          frequency: (config?.frequency || 'DAILY') as RebalanceFrequency,
          autoApprovalEnabled: config?.autoApprovalEnabled !== false, // Default: enabled
          autoApprovalThreshold: config?.autoApprovalThreshold || 200000000, // Default: $200M
          targetAllocations: config?.targetAllocations,
        };

        // Save to persistent storage (for Vercel Cron)
        await saveAutoRebalanceConfig({
          ...rebalanceConfig,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Also enable in in-memory service (for local dev)
        autoRebalanceService.enableForPortfolio(rebalanceConfig);

        // Make sure service is running
        await autoRebalanceService.start();

        return NextResponse.json({
          success: true,
          message: `Auto-rebalancing enabled for portfolio ${portfolioId}`,
          config: rebalanceConfig,
          status: autoRebalanceService.getStatus(),
        });

      case 'disable':
        // Disable auto-rebalancing for a specific portfolio
        if (!portfolioId) {
          return NextResponse.json(
            { success: false, error: 'portfolioId required' },
            { status: 400 }
          );
        }

        // Remove from persistent storage
        await deleteAutoRebalanceConfig(parseInt(portfolioId));

        // Also disable in in-memory service
        autoRebalanceService.disableForPortfolio(parseInt(portfolioId));

        return NextResponse.json({
          success: true,
          message: `Auto-rebalancing disabled for portfolio ${portfolioId}`,
        });

      case 'trigger_assessment':
        // Manually trigger rebalancing assessment for a portfolio
        if (!portfolioId || !walletAddress) {
          return NextResponse.json(
            { success: false, error: 'portfolioId and walletAddress required' },
            { status: 400 }
          );
        }

        const assessment = await autoRebalanceService.triggerAssessment(
          parseInt(portfolioId),
          walletAddress
        );

        return NextResponse.json({
          success: true,
          assessment,
        });

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action. Use: start, stop, enable, disable, or trigger_assessment' },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('[API] Auto-rebalance error', {
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Get status and assessments
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const portfolioId = searchParams.get('portfolioId');

    switch (action) {
      case 'status':
        // Get service status
        const status = autoRebalanceService.getStatus();
        return NextResponse.json({
          success: true,
          status,
        });

      case 'assessment':
        // Get last assessment for a portfolio
        if (!portfolioId) {
          return NextResponse.json(
            { success: false, error: 'portfolioId required' },
            { status: 400 }
          );
        }

        const assessment = autoRebalanceService.getLastAssessment(parseInt(portfolioId));

        if (!assessment) {
          return NextResponse.json({
            success: false,
            error: 'No assessment available for this portfolio',
          }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          assessment,
        });

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action. Use: status or assessment' },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('[API] Auto-rebalance GET error', {
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
