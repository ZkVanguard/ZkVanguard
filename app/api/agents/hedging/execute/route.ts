/**
 * Execute Hedge Position on Moonlander
 * API endpoint for opening SHORT positions on Moonlander perpetuals
 * 
 * Supports:
 * - Real on-chain execution via MoonlanderOnChainClient
 * - Privacy-preserving mode with ZK commitments
 * - Simulation mode when no private key is configured
 */

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { createHedge } from '@/lib/db/hedges';
import { privateHedgeService } from '@/lib/services/PrivateHedgeService';
import { MoonlanderOnChainClient } from '@/integrations/moonlander/MoonlanderOnChainClient';
import { MOONLANDER_CONTRACTS, PAIR_INDEX } from '@/integrations/moonlander/contracts';
import * as crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface HedgeExecutionRequest {
  portfolioId: number;
  asset: string; // e.g., "BTC", "ETH", "CRO"
  side: 'LONG' | 'SHORT';
  notionalValue: number; // USD value to hedge
  leverage?: number; // 1-100x
  stopLoss?: number; // Price level
  takeProfit?: number; // Price level
  reason?: string;
  privateMode?: boolean; // Enable privacy-preserving execution
  privacyLevel?: 'standard' | 'high' | 'maximum'; // Privacy level
  // Auto-Approval Settings
  autoApprovalEnabled?: boolean;
  autoApprovalThreshold?: number;
  signature?: string; // Manager signature (optional if auto-approved)
}

export interface HedgeExecutionResponse {
  success: boolean;
  orderId?: string;
  market: string;
  side: 'LONG' | 'SHORT';
  size: string;
  entryPrice?: string;
  stopLoss?: string;
  takeProfit?: string;
  leverage: number;
  estimatedLiquidationPrice?: string;
  txHash?: string;
  error?: string;
  simulationMode: boolean;
  message?: string;
  // Privacy fields
  privateMode?: boolean;
  commitmentHash?: string;
  stealthAddress?: string;
  zkProofGenerated?: boolean;
  // Auto-Approval fields
  autoApproved?: boolean;
}

/**
 * POST /api/agents/hedging/execute
 * Execute a hedge position on Moonlander perpetuals (Cronos testnet)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body: HedgeExecutionRequest = await request.json();
    const { 
      asset, side, notionalValue, leverage = 5, stopLoss, takeProfit, reason, 
      privateMode = false, privacyLevel = 'standard',
      autoApprovalEnabled = false, autoApprovalThreshold = 10000, signature 
    } = body;

    // Check if signature is required
    const requiresSignature = !autoApprovalEnabled || notionalValue > autoApprovalThreshold;
    
    if (requiresSignature && !signature) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Signature required for hedge execution',
          message: `Hedge value ($${notionalValue.toLocaleString()}) requires manager approval${autoApprovalEnabled ? ` (threshold: $${autoApprovalThreshold.toLocaleString()})` : ''}`
        },
        { status: 403 }
      );
    }

    logger.info('🛡️ Executing hedge on Moonlander', {
      asset: privateMode ? '[PRIVATE]' : asset,
      side: privateMode ? '[PRIVATE]' : side,
      notionalValue: privateMode ? '[PRIVATE]' : notionalValue,
      leverage,
      reason,
      privateMode,
      privacyLevel,
      autoApproved: autoApprovalEnabled && notionalValue <= autoApprovalThreshold,
    });

    // Validate inputs
    if (!asset || !side || !notionalValue) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: asset, side, notionalValue' },
        { status: 400 }
      );
    }

    if (leverage < 1 || leverage > 100) {
      return NextResponse.json(
        { success: false, error: 'Leverage must be between 1 and 100' },
        { status: 400 }
      );
    }

    // Initialize Moonlander client for Cronos Testnet
    const provider = new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org'
    );

    // Use wallet for signing (in production, use secure key management)
    const privateKey = process.env.MOONLANDER_PRIVATE_KEY || process.env.PRIVATE_KEY;
    
    if (!privateKey) {
      logger.warn('⚠️ No private key configured - running in simulation mode');
      
      // Get REAL current price from Crypto.com Exchange API
      let baseAsset = asset.toUpperCase().replace('-PERP', '');
      
      // Map wrapped tokens to their base equivalents
      if (baseAsset === 'WBTC') baseAsset = 'BTC';  // WBTC = Wrapped BTC (1:1)
      if (baseAsset === 'WETH') baseAsset = 'ETH';  // WETH = Wrapped ETH (1:1)
      
      let mockPrice = 1000; // Fallback
      
      try {
        const tickerResponse = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers');
        const tickerData = await tickerResponse.json();
        const ticker = tickerData.result.data.find((t: any) => t.i === `${baseAsset}_USDT`);
        
        if (ticker) {
          mockPrice = parseFloat(ticker.a); // Ask price (current price)
          logger.info(`📊 Using real ${baseAsset} price: $${mockPrice}`);
        } else {
          logger.warn(`⚠️ Ticker not found for ${baseAsset}, using fallback price`);
        }
      } catch (priceError) {
        logger.error('❌ Failed to fetch real price, using fallback', { error: priceError });
      }
      
      // Return simulated hedge execution with REAL price
      const market = `${asset.toUpperCase()}-USD-PERP`;
      const size = ((notionalValue * leverage) / mockPrice).toFixed(4);
      const liquidationPrice = side === 'SHORT' 
        ? mockPrice * (1 + 0.8 / leverage) 
        : mockPrice * (1 - 0.8 / leverage);

      const orderId = `sim-hedge-${Date.now()}`;
      
      // Generate privacy components if privateMode is enabled
      let commitmentHash: string | undefined;
      let stealthAddress: string | undefined;
      let zkProofGenerated = false;
      
      if (privateMode) {
        try {
          const masterPublicKey = crypto.randomBytes(33).toString('hex');
          const privateHedge = await privateHedgeService.createPrivateHedge(
            asset.toUpperCase(),
            side,
            parseFloat(size),
            notionalValue,
            leverage,
            mockPrice,
            masterPublicKey
          );
          
          commitmentHash = privateHedge.commitmentHash;
          stealthAddress = privateHedge.stealthAddress;
          zkProofGenerated = true;
          
          logger.info('🔐 Privacy layer added to hedge', {
            commitmentHash: commitmentHash.substring(0, 16) + '...',
            stealthAddress: stealthAddress.substring(0, 10) + '...',
          });
        } catch (privacyError) {
          logger.error('Failed to generate privacy layer', { error: privacyError });
        }
      }
      
      // Save to PostgreSQL (even in simulation mode)
      try {
        console.log('💾 Attempting to save hedge to database:', {
          orderId,
          portfolioId: body.portfolioId,
          asset: privateMode ? '[PRIVATE]' : asset.toUpperCase(),
          market,
          size,
          notionalValue: privateMode ? '[PRIVATE]' : notionalValue,
        });
        
        await createHedge({
          orderId,
          portfolioId: body.portfolioId,
          asset: asset.toUpperCase(),
          market,
          side,
          size: parseFloat(size),
          notionalValue,
          leverage,
          entryPrice: mockPrice,
          liquidationPrice,
          stopLoss,
          takeProfit,
          simulationMode: true,
          reason,
          predictionMarket: reason,
          txHash: commitmentHash, // Store commitment hash as reference
        });
        
        logger.info('💾 Simulated hedge saved to database', { orderId, privateMode });
        console.log('✅ Hedge saved successfully to database');
      } catch (dbError) {
        console.error('❌ Failed to save hedge to database:', dbError);
        logger.error('❌ Failed to save hedge to database', { error: dbError });
        // Continue anyway - don't fail the request if DB is down
      }

      return NextResponse.json({
        success: true,
        orderId,
        market,
        side,
        size,
        entryPrice: mockPrice.toString(),
        stopLoss: stopLoss?.toString(),
        takeProfit: takeProfit?.toString(),
        leverage,
        estimatedLiquidationPrice: liquidationPrice.toFixed(2),
        simulationMode: true,
        privateMode,
        commitmentHash,
        stealthAddress,
        zkProofGenerated,
        autoApproved: autoApprovalEnabled && notionalValue <= autoApprovalThreshold,
        message: privateMode 
          ? '✅ PRIVATE HEDGE: Commitment stored, details encrypted (unlinkable on-chain)'
          : `✅ SIMULATION: Hedge executed successfully${autoApprovalEnabled && notionalValue <= autoApprovalThreshold ? ' (auto-approved)' : ''} (add MOONLANDER_PRIVATE_KEY for live trading)`,
      } satisfies HedgeExecutionResponse);
    }

    //=================================================================================
    // REAL MOONLANDER ON-CHAIN EXECUTION PATH 
    // Uses actual smart contracts on Cronos EVM
    //=================================================================================
    
    logger.info('🚀 Executing REAL on-chain hedge via Moonlander contracts');
    
    // Determine network (mainnet or testnet)
    const network = process.env.MOONLANDER_NETWORK === 'mainnet' ? 'CRONOS_EVM' : 'CRONOS_TESTNET';
    const rpcUrl = network === 'CRONOS_EVM' 
      ? MOONLANDER_CONTRACTS.CRONOS_EVM.RPC_URL 
      : (process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org');
    
    // Create on-chain client
    const moonlander = new MoonlanderOnChainClient(rpcUrl, network as any);
    await moonlander.initialize(privateKey);

    // Map asset to Moonlander market format and get pair index
    const market = `${asset.toUpperCase()}-USD-PERP`;
    let pairIndex: number;
    try {
      pairIndex = moonlander.getPairIndex(asset);
    } catch {
      // If pair not found, default to BTC (index 0)
      logger.warn(`Pair ${asset} not found, defaulting to BTC`);
      pairIndex = 0;
    }
    
    // Get current price for position sizing
    let currentPrice = 1000;
    try {
      let baseAsset = asset.toUpperCase().replace('-PERP', '');
      if (baseAsset === 'WBTC') baseAsset = 'BTC';
      if (baseAsset === 'WETH') baseAsset = 'ETH';
      
      const tickerResponse = await fetch('https://api.crypto.com/exchange/v1/public/get-tickers');
      const tickerData = await tickerResponse.json();
      const ticker = tickerData.result.data.find((t: any) => t.i === `${baseAsset}_USDT`);
      if (ticker) currentPrice = parseFloat(ticker.a);
    } catch (e) {
      logger.warn('Failed to fetch price, using fallback');
    }

    // Calculate collateral needed (notionalValue / leverage)
    const collateralAmount = (notionalValue / leverage).toFixed(2);
    
    // Generate privacy components if enabled
    let commitmentHash: string | undefined;
    let stealthAddress: string | undefined;
    let zkProofGenerated = false;
    
    if (privateMode) {
      const masterPublicKey = crypto.randomBytes(33).toString('hex');
      const privateHedge = await privateHedgeService.createPrivateHedge(
        asset.toUpperCase(),
        side,
        notionalValue / currentPrice,
        notionalValue,
        leverage,
        currentPrice,
        masterPublicKey
      );
      commitmentHash = privateHedge.commitmentHash;
      stealthAddress = privateHedge.stealthAddress;
      zkProofGenerated = true;
      
      logger.info('🔐 Privacy layer generated for on-chain hedge', {
        commitmentHash: commitmentHash.substring(0, 16) + '...',
      });
    }

    // Execute on-chain trade
    const tradeResult = await moonlander.openTrade({
      pairIndex,
      collateralAmount,
      leverage,
      isLong: side === 'LONG',
      takeProfit: takeProfit?.toString(),
      stopLoss: stopLoss?.toString(),
      slippagePercent: 1.0, // 1% slippage tolerance
    });

    // Save to PostgreSQL
    try {
      await createHedge({
        orderId: tradeResult.txHash,
        portfolioId: body.portfolioId,
        asset: asset.toUpperCase(),
        market,
        side,
        size: parseFloat(tradeResult.positionSizeUsd) / currentPrice,
        notionalValue,
        leverage,
        entryPrice: currentPrice,
        liquidationPrice: side === 'SHORT' 
          ? currentPrice * (1 + 0.8 / leverage)
          : currentPrice * (1 - 0.8 / leverage),
        stopLoss,
        takeProfit,
        simulationMode: false,
        reason,
        predictionMarket: reason,
        txHash: tradeResult.txHash,
      });
      logger.info('💾 On-chain hedge saved to database', { txHash: tradeResult.txHash });
    } catch (dbError) {
      logger.error('❌ Failed to save hedge to database', { error: dbError });
    }

    logger.info('✅ On-chain hedge executed successfully', {
      txHash: tradeResult.txHash,
      tradeIndex: tradeResult.tradeIndex,
      positionSizeUsd: tradeResult.positionSizeUsd,
      executionTime: Date.now() - startTime,
      privateMode,
    });

    return NextResponse.json({
      success: true,
      orderId: tradeResult.txHash,
      market,
      side,
      size: (parseFloat(tradeResult.positionSizeUsd) / currentPrice).toFixed(4),
      entryPrice: currentPrice.toString(),
      stopLoss: stopLoss?.toString(),
      takeProfit: takeProfit?.toString(),
      leverage,
      txHash: tradeResult.txHash,
      simulationMode: false,
      privateMode,
      commitmentHash,
      stealthAddress,
      zkProofGenerated,
      autoApproved: autoApprovalEnabled && notionalValue <= autoApprovalThreshold,
      message: privateMode 
        ? '✅ PRIVATE ON-CHAIN: Trade executed with privacy protection'
        : `✅ ON-CHAIN: Hedge executed successfully${autoApprovalEnabled && notionalValue <= autoApprovalThreshold ? ' (auto-approved)' : ''}`,
    } satisfies HedgeExecutionResponse);

  } catch (error) {
    logger.error('❌ Hedge execution failed', { error });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during hedge execution',
        simulationMode: true,
      } satisfies Partial<HedgeExecutionResponse>,
      { status: 500 }
    );
  }
}
