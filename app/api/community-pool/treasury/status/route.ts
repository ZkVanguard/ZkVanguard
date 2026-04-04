/**
 * Treasury Status API
 * 
 * Returns the status of the server-managed EVM treasury wallet
 * AND SUI MSafe multisig treasury.
 * This endpoint exposes ONLY public addresses and operational status.
 * 
 * SECURITY: No private keys or sensitive data are ever returned.
 */

import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';

export const maxDuration = 10;
// Cache the treasury address (derived from env var, but only the public address)
let cachedTreasuryAddress: string | null = null;

function getTreasuryAddress(): string | null {
  if (cachedTreasuryAddress) return cachedTreasuryAddress;
  
  // Get the treasury wallet address from private key (server-side only)
  const treasuryKey = process.env.TREASURY_PRIVATE_KEY 
    || process.env.SERVER_WALLET_PRIVATE_KEY
    || process.env.PRIVATE_KEY;
  
  if (!treasuryKey) {
    return null;
  }
  
  try {
    const wallet = new ethers.Wallet(treasuryKey);
    cachedTreasuryAddress = wallet.address;
    return cachedTreasuryAddress;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const treasuryAddress = getTreasuryAddress();
    
    if (!treasuryAddress) {
      return NextResponse.json({
        address: '0x0000000000000000000000000000000000000000',
        balance: '0',
        isOperational: false,
        error: 'Treasury not configured'
      }, { status: 503 });
    }
    
    // Get balance from Sepolia (primary testnet)
    let balance = '0';
    try {
      const provider = new ethers.JsonRpcProvider(
        process.env.SEPOLIA_RPC_URL || 'https://sepolia.drpc.org'
      );
      
      // WDK USDT on Sepolia
      const usdtAddress = '0xd077a400968890eacc75cdc901f0356c943e4fdb';
      const usdtAbi = ['function balanceOf(address) view returns (uint256)'];
      const usdt = new ethers.Contract(usdtAddress, usdtAbi, provider);
      
      const rawBalance = await usdt.balanceOf(treasuryAddress);
      balance = ethers.formatUnits(rawBalance, 6);
    } catch (err) {
      // Balance fetch failed, but treasury is still operational
      logger.warn('[Treasury Status] Balance fetch failed:', err);
    }

    // SUI MSafe treasury info (non-blocking)
    let suiTreasury = null;
    try {
      const { getSuiCommunityPoolService } = await import('@/lib/services/SuiCommunityPoolService');
      const suiService = getSuiCommunityPoolService('testnet');
      const info = await suiService.getTreasuryInfo();
      suiTreasury = {
        address: info.treasuryAddress,
        msafeAddress: info.msafeAddress,
        msafeConfigured: info.msafeConfigured,
        pendingFees: info.totalPendingFees,
        lastFeeCollection: info.lastFeeCollection,
        isOperational: !!info.treasuryAddress,
      };
    } catch {
      // SUI treasury fetch failed — non-critical
    }
    
    return NextResponse.json({
      address: treasuryAddress,
      balance,
      isOperational: true,
      lastActivity: new Date().toISOString(),
      sui: suiTreasury,
    });
  } catch (error) {
    logger.error('[Treasury Status] Error:', error);
    return NextResponse.json({
      address: '0x0000000000000000000000000000000000000000',
      balance: '0',
      isOperational: false,
      error: 'Treasury service error'
    }, { status: 500 });
  }
}
