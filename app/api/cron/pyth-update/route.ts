/**
 * QStash Cron Job: Pyth Price Updater
 * 
 * Pushes fresh price data from Pyth Hermes API to on-chain Pyth contracts.
 * Essential for testnet deployments where prices don't auto-update.
 * 
 * Schedule: Every 30 minutes via Upstash QStash
 * 
 * Security: Verified by QStash signature or CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { verifyCronRequest } from '@/lib/qstash';
import { isMainnet } from '@/lib/utils/network';

export const runtime = 'nodejs';

export const maxDuration = 30;
// Pyth contract addresses by chain
const PYTH_CONTRACTS: Record<number, string> = {
  11155111: '0xDd24F84d36BF92C65F92307595335bdFab5Bbd21', // Sepolia
  296: '0xA2aa501b19aff244D90cc15a4Cf739D2725B5729',      // Hedera Testnet
  338: '0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320',      // Cronos Testnet
};

// RPC URLs
const RPC_URLS: Record<number, string> = {
  11155111: 'https://sepolia.drpc.org',
  296: 'https://testnet.hashio.io/api',
  338: 'https://evm-t3.cronos.org/',
};

// Price IDs to update (BTC, ETH, SUI, CRO)
const PRICE_IDS = [
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH
  '23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe', // SUI
  '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744', // CRO
];

const PYTH_ABI = [
  'function updatePriceFeeds(bytes[] calldata updateData) external payable',
  'function getUpdateFee(bytes[] calldata updateData) external view returns (uint256)',
];

interface PythUpdateResult {
  chainId: number;
  chainName: string;
  success: boolean;
  txHash?: string;
  error?: string;
  pricesUpdated?: number;
}

/**
 * Fetch price update data from Pyth Hermes API
 */
async function fetchPriceUpdates(): Promise<string[] | null> {
  try {
    const idsQuery = PRICE_IDS.map(id => `ids[]=${id}`).join('&');
    const url = `https://hermes.pyth.network/v2/updates/price/latest?${idsQuery}`;
    
    const response = await fetch(url, { 
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      throw new Error(`Hermes API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.binary?.data?.[0]) {
      throw new Error('No binary data in response');
    }
    
    return ['0x' + data.binary.data[0]];
  } catch (error: any) {
    logger.error('[PythUpdate] Failed to fetch from Hermes:', error.message);
    return null;
  }
}

/**
 * Push price updates to a specific chain
 */
async function updateChain(chainId: number, updateData: string[]): Promise<PythUpdateResult> {
  const chainName = chainId === 11155111 ? 'Sepolia' 
    : chainId === 296 ? 'Hedera Testnet' 
    : chainId === 338 ? 'Cronos Testnet' 
    : `Chain ${chainId}`;
  
  const pythAddress = PYTH_CONTRACTS[chainId];
  const rpcUrl = RPC_URLS[chainId];
  
  if (!pythAddress || !rpcUrl) {
    return { chainId, chainName, success: false, error: 'Chain not configured' };
  }
  
  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    return { chainId, chainName, success: false, error: 'No private key configured' };
  }
  
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const pyth = new ethers.Contract(pythAddress, PYTH_ABI, wallet);
    
    // Get update fee
    const fee = await pyth.getUpdateFee(updateData);
    logger.info(`[PythUpdate] ${chainName}: Update fee = ${ethers.formatEther(fee)} ETH`);
    
    // Check wallet balance
    const balance = await provider.getBalance(wallet.address);
    if (balance < fee) {
      return { chainId, chainName, success: false, error: `Insufficient balance: ${ethers.formatEther(balance)} ETH` };
    }
    
    // Push updates
    const tx = await pyth.updatePriceFeeds(updateData, { value: fee });
    logger.info(`[PythUpdate] ${chainName}: Tx submitted: ${tx.hash}`);
    
    const receipt = await tx.wait();
    logger.info(`[PythUpdate] ${chainName}: Confirmed in block ${receipt.blockNumber}`);
    
    return {
      chainId,
      chainName,
      success: true,
      txHash: tx.hash,
      pricesUpdated: PRICE_IDS.length,
    };
  } catch (error: any) {
    logger.error(`[PythUpdate] ${chainName} failed:`, error.message);
    return { chainId, chainName, success: false, error: error.message?.slice(0, 100) };
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  // Verify request is from QStash or has valid CRON_SECRET
  const authResult = await verifyCronRequest(request, 'PythUpdate');
  if (authResult !== true) {
    logger.warn('[PythUpdate] Unauthorized request');
    return authResult; // Returns the 401 NextResponse
  }
  
  logger.info('[PythUpdate] Starting price update cron...');

  // Pyth auto-updates on mainnet — this cron is for testnets only
  if (isMainnet()) {
    logger.info('[PythUpdate] Skipping — Pyth auto-updates on mainnet');
    return NextResponse.json({ success: true, skipped: true, reason: 'mainnet' });
  }
  
  // Step 1: Fetch latest prices from Hermes
  const updateData = await fetchPriceUpdates();
  if (!updateData) {
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch price updates from Pyth Hermes',
      ranAt: new Date().toISOString(),
    }, { status: 500 });
  }
  
  logger.info(`[PythUpdate] Got update data (${updateData[0].length} bytes)`);
  
  // Step 2: Get target chains from query param or default to Sepolia
  const chainsParam = request.nextUrl.searchParams.get('chains');
  const targetChains = chainsParam 
    ? chainsParam.split(',').map(c => parseInt(c.trim(), 10))
    : [11155111]; // Default to Sepolia only
  
  // Step 3: Update each chain
  const results: PythUpdateResult[] = [];
  for (const chainId of targetChains) {
    const result = await updateChain(chainId, updateData);
    results.push(result);
  }
  
  const duration = Date.now() - startTime;
  const succeeded = results.filter(r => r.success).length;
  
  logger.info(`[PythUpdate] Complete: ${succeeded}/${results.length} chains updated in ${duration}ms`);
  
  return NextResponse.json({
    success: succeeded > 0,
    ranAt: new Date().toISOString(),
    duration,
    priceIds: PRICE_IDS.length,
    results,
    summary: {
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
    },
  });
}

// Also support POST for QStash webhooks
export const POST = GET;
