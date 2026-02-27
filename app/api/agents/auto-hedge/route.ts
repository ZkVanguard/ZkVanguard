/**
 * Auto-Hedging Control API
 * 
 * Endpoints for controlling the autonomous auto-hedging service:
 * - GET: Get current status and configuration
 * - POST: Start/stop auto-hedging or configure portfolio
 * - DELETE: Disable auto-hedging for a portfolio
 */

import { NextRequest, NextResponse } from 'next/server';
import { autoHedgingService, AUTO_HEDGE_CONFIG } from '@/lib/services/AutoHedgingService';
import { logger } from '@/lib/utils/logger';
import { 
  saveAutoHedgeConfig, 
  deleteAutoHedgeConfig, 
  disableAutoHedge,
  getAutoHedgeConfig 
} from '@/lib/storage/auto-hedge-storage';

export async function GET(request: NextRequest) {
  try {
    // Ensure service is running
    const status = autoHedgingService.getStatus();
    if (!status.isRunning) {
      logger.info('[AutoHedge API] Service not running, starting...');
      await autoHedgingService.start();
    }
    
    const searchParams = request.nextUrl.searchParams;
    const portfolioId = searchParams.get('portfolioId');
    
    // Get service status
    const currentStatus = autoHedgingService.getStatus();
    
    // If portfolio specified, get its last risk assessment
    let riskAssessment = null;
    if (portfolioId) {
      riskAssessment = autoHedgingService.getLastRiskAssessment(parseInt(portfolioId));
    }
    
    return NextResponse.json({
      success: true,
      isRunning: currentStatus.isRunning,
      enabledPortfolios: currentStatus.enabledPortfolios,
      lastUpdate: currentStatus.lastUpdate,
      config: currentStatus.config,
      riskAssessment,
    });
  } catch (error) {
    logger.error('Auto-hedging status error', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to get auto-hedging status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, portfolioId, walletAddress, config } = body;
    
    switch (action) {
      case 'start':
        // Start the auto-hedging service
        await autoHedgingService.start();
        return NextResponse.json({
          success: true,
          message: 'Auto-hedging service started',
          status: autoHedgingService.getStatus(),
        });
      
      case 'stop':
        // Stop the auto-hedging service
        autoHedgingService.stop();
        return NextResponse.json({
          success: true,
          message: 'Auto-hedging service stopped',
        });
      
      case 'enable':
        // Enable auto-hedging for a specific portfolio
        // Community Pool (portfolioId=0) doesn't require walletAddress
        const parsedPortfolioId = parseInt(portfolioId);
        const isCommunityPool = parsedPortfolioId === 0;
        
        if (portfolioId === undefined || portfolioId === null) {
          return NextResponse.json(
            { success: false, error: 'portfolioId required' },
            { status: 400 }
          );
        }
        
        if (!isCommunityPool && !walletAddress) {
          return NextResponse.json(
            { success: false, error: 'walletAddress required for non-community portfolios' },
            { status: 400 }
          );
        }
        
        const portfolioConfig = {
          portfolioId: parsedPortfolioId,
          walletAddress: isCommunityPool ? 'community-pool' : walletAddress,
          enabled: true,
          riskThreshold: config?.riskThreshold || 7, // Default: trigger at risk score 7+
          maxLeverage: config?.maxLeverage || AUTO_HEDGE_CONFIG.DEFAULT_LEVERAGE,
          allowedAssets: config?.allowedAssets || ['BTC', 'ETH', 'CRO', 'SUI'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        
        // Persist to storage FIRST
        await saveAutoHedgeConfig(portfolioConfig);
        
        // Then enable in runtime service
        autoHedgingService.enableForPortfolio(portfolioConfig);
        
        // Make sure service is running
        await autoHedgingService.start();
        
        logger.info('[AutoHedge API] Portfolio enabled and persisted', {
          portfolioId,
          walletAddress,
          riskThreshold: portfolioConfig.riskThreshold
        });
        
        return NextResponse.json({
          success: true,
          message: `Auto-hedging enabled for portfolio ${portfolioId}`,
          config: portfolioConfig,
          status: autoHedgingService.getStatus(),
        });
      
      case 'disable':
        // Disable auto-hedging for a specific portfolio
        if (!portfolioId) {
          return NextResponse.json(
            { success: false, error: 'portfolioId required' },
            { status: 400 }
          );
        }
        
        // Disable in storage (soft delete - sets enabled=false)
        await disableAutoHedge(parseInt(portfolioId));
        
        // Disable in runtime service
        autoHedgingService.disableForPortfolio(parseInt(portfolioId));
        
        logger.info('[AutoHedge API] Portfolio disabled and persisted', {
          portfolioId
        });
        
        return NextResponse.json({
          success: true,
          message: `Auto-hedging disabled for portfolio ${portfolioId}`,
        });
      
      case 'trigger_assessment':
        // Manually trigger risk assessment for a portfolio
        const assessPortfolioId = parseInt(portfolioId);
        const isCommunityPoolAssess = assessPortfolioId === 0;
        
        if (portfolioId === undefined || portfolioId === null) {
          return NextResponse.json(
            { success: false, error: 'portfolioId required' },
            { status: 400 }
          );
        }
        
        if (!isCommunityPoolAssess && !walletAddress) {
          return NextResponse.json(
            { success: false, error: 'walletAddress required for non-community portfolios' },
            { status: 400 }
          );
        }
        
        const assessment = await autoHedgingService.triggerRiskAssessment(
          assessPortfolioId,
          isCommunityPoolAssess ? 'community-pool' : walletAddress
        );
        
        return NextResponse.json({
          success: true,
          assessment,
        });
      
      case 'update_pnl':
        // Manually trigger PnL update for all hedges
        const result = await autoHedgingService.updateAllHedgePnL();
        
        return NextResponse.json({
          success: true,
          updated: result.updated,
          errors: result.errors,
        });
      
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}. Valid actions: start, stop, enable, disable, trigger_assessment, update_pnl` },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('Auto-hedging action error', { error });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to execute action' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const portfolioId = searchParams.get('portfolioId');
    
    if (!portfolioId) {
      return NextResponse.json(
        { success: false, error: 'portfolioId required' },
        { status: 400 }
      );
    }
    
    // Delete from storage (hard delete)
    await deleteAutoHedgeConfig(parseInt(portfolioId));
    
    // Disable in runtime service
    autoHedgingService.disableForPortfolio(parseInt(portfolioId));
    
    logger.info('[AutoHedge API] Portfolio config deleted', {
      portfolioId
    });
    
    return NextResponse.json({
      success: true,
      message: `Auto-hedging configuration deleted for portfolio ${portfolioId}`,
    });
  } catch (error) {
    logger.error('Auto-hedging delete error', { error });
    return NextResponse.json(
      { success: false, error: 'Failed to delete auto-hedging configuration' },
      { status: 500 }
    );
  }
}
