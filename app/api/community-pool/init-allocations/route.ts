/**
 * Initialize Pool Allocations API Endpoint
 * 
 * POST /api/community-pool/init-allocations
 * 
 * Sets the Community Pool's target allocations to enable hedging.
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { ethers } from 'ethers';

const CRONOS_TESTNET_RPC = 'https://evm-t3.cronos.org';
const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';
const POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function setTargetAllocation(uint256[4] newAllocationBps, string reasoning)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function REBALANCER_ROLE() view returns (bytes32)',
];

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Auth check
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Parse optional custom allocations from body
    let targetAllocations = { BTC: 25, ETH: 25, SUI: 25, CRO: 25 };
    try {
      const body = await request.json();
      if (body.allocations) {
        targetAllocations = body.allocations;
      }
    } catch { /* Use defaults */ }
    
    // Validate allocations sum to 100%
    const total = targetAllocations.BTC + targetAllocations.ETH + targetAllocations.SUI + targetAllocations.CRO;
    if (total !== 100) {
      return NextResponse.json({ 
        error: `Allocations must sum to 100%, got ${total}%` 
      }, { status: 400 });
    }
    
    logger.info('[Init Allocations] Starting with target allocations', targetAllocations);
    
    // Get agent signer key
    const signerKey = process.env.AGENT_SIGNER_KEY;
    if (!signerKey) {
      return NextResponse.json({ 
        error: 'AGENT_SIGNER_KEY not configured on server' 
      }, { status: 500 });
    }
    
    const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
    const wallet = new ethers.Wallet(signerKey, provider);
    const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, wallet);
    
    // Check current allocations
    const stats = await pool.getPoolStats();
    const currentAllocations = {
      BTC: Number(stats._allocations[0]) / 100,
      ETH: Number(stats._allocations[1]) / 100,
      SUI: Number(stats._allocations[2]) / 100,
      CRO: Number(stats._allocations[3]) / 100,
    };
    
    logger.info('[Init Allocations] Current allocations', currentAllocations);
    
    // Check if already allocated (skip if force not set)
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === 'true';
    
    const isAlreadyAllocated = currentAllocations.BTC > 0 || currentAllocations.ETH > 0;
    if (isAlreadyAllocated && !force) {
      return NextResponse.json({
        success: true,
        message: 'Pool already has allocations set. Use ?force=true to override.',
        currentAllocations,
        skipped: true,
      });
    }
    
    // Check rebalancer role
    const REBALANCER_ROLE = await pool.REBALANCER_ROLE();
    const hasRole = await pool.hasRole(REBALANCER_ROLE, wallet.address);
    
    if (!hasRole) {
      return NextResponse.json({
        error: 'Wallet does not have REBALANCER_ROLE',
        walletAddress: wallet.address,
        rebalancerRole: REBALANCER_ROLE,
      }, { status: 403 });
    }
    
    // Convert to BPS
    const allocationsBps: [number, number, number, number] = [
      targetAllocations.BTC * 100,
      targetAllocations.ETH * 100,
      targetAllocations.SUI * 100,
      targetAllocations.CRO * 100,
    ];
    
    const reasoning = `Initial allocation: ${targetAllocations.BTC}% BTC, ${targetAllocations.ETH}% ETH, ${targetAllocations.SUI}% SUI, ${targetAllocations.CRO}% CRO for diversified hedging`;
    
    logger.info('[Init Allocations] Setting allocations', { allocationsBps, reasoning });
    
    // Execute transaction
    const tx = await pool.setTargetAllocation(allocationsBps, reasoning);
    logger.info('[Init Allocations] Transaction submitted', { txHash: tx.hash });
    
    const receipt = await tx.wait();
    logger.info('[Init Allocations] Transaction confirmed', { 
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    });
    
    // Verify new allocations
    const newStats = await pool.getPoolStats();
    const newAllocations = {
      BTC: Number(newStats._allocations[0]) / 100,
      ETH: Number(newStats._allocations[1]) / 100,
      SUI: Number(newStats._allocations[2]) / 100,
      CRO: Number(newStats._allocations[3]) / 100,
    };
    
    const duration = Date.now() - startTime;
    
    return NextResponse.json({
      success: true,
      message: 'Pool allocations initialized successfully',
      previousAllocations: currentAllocations,
      newAllocations,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      duration: `${duration}ms`,
    });
    
  } catch (error) {
    logger.error('[Init Allocations] Failed', error);
    
    // Check for rebalance cooldown error
    if (error instanceof Error && error.message.includes('RebalanceCooldown')) {
      return NextResponse.json({
        error: 'Rebalance cooldown active. Try again later.',
        details: 'Rate limited - please try again later',
      }, { status: 429 });
    }
    
    return safeErrorResponse(error, 'Failed to initialize allocations');
  }
}

export async function GET(request: NextRequest) {
  // Allow GET to check current status
  try {
    const provider = new ethers.JsonRpcProvider(CRONOS_TESTNET_RPC);
    const pool = new ethers.Contract(COMMUNITY_POOL_ADDRESS, POOL_ABI, provider);
    
    const stats = await pool.getPoolStats();
    const allocations = {
      BTC: Number(stats._allocations[0]) / 100,
      ETH: Number(stats._allocations[1]) / 100,
      SUI: Number(stats._allocations[2]) / 100,
      CRO: Number(stats._allocations[3]) / 100,
    };
    
    const totalNAV = parseFloat(ethers.formatUnits(stats._totalNAV, 6));
    const sharePrice = parseFloat(ethers.formatUnits(stats._sharePrice, 6));
    
    return NextResponse.json({
      success: true,
      allocations,
      totalNAV,
      sharePrice,
      needsInitialization: allocations.BTC === 0 && allocations.ETH === 0,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to get allocations');
  }
}
