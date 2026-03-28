/**
 * On-chain transaction verification for community pool deposits/withdrawals.
 * 
 * SECURITY: Prevents fake deposits where someone could call the API
 * with a fabricated txHash and get shares credited without actually depositing.
 */

import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import type { ChainConfig } from './types';
import { getChainConfig } from './chain-config';

// CommunityPool event signatures for deposit/withdraw
// Event: Deposited(address indexed member, uint256 amountUSD, uint256 sharesReceived, uint256 sharePrice, uint256 timestamp)
const DEPOSIT_EVENT_TOPIC = ethers.id('Deposited(address,uint256,uint256,uint256,uint256)');
// Event: Withdrawn(address indexed member, uint256 sharesBurned, uint256 amountUSD, uint256 sharePrice, uint256 timestamp)
const WITHDRAW_EVENT_TOPIC = ethers.id('Withdrawn(address,uint256,uint256,uint256,uint256)');

/**
 * Verify that a transaction hash corresponds to a real on-chain deposit
 * to the CommunityPool contract from the claimed wallet.
 * 
 * @param txHash - The transaction hash to verify
 * @param expectedWallet - The wallet address that should have made the deposit
 * @param chainConfig - Chain configuration for RPC and contract address
 * @returns Verified deposit amount in USD (from on-chain), or null if invalid
 */
export async function verifyOnChainDeposit(
  txHash: string,
  expectedWallet: string,
  chainConfig: ChainConfig = getChainConfig()
): Promise<{ verified: boolean; amountUSD: number; sharesReceived: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const poolAddress = chainConfig.poolAddress;
    
    // Fetch transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'Transaction not found on-chain' };
    }
    
    // Verify transaction was successful
    if (receipt.status !== 1) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'Transaction failed on-chain' };
    }
    
    // Verify transaction was to the CommunityPool contract
    if (receipt.to?.toLowerCase() !== poolAddress.toLowerCase()) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'Transaction not to CommunityPool contract' };
    }
    
    // Find the Deposited event in the logs
    const depositLog = receipt.logs.find(log => 
      log.topics[0] === DEPOSIT_EVENT_TOPIC &&
      log.address.toLowerCase() === poolAddress.toLowerCase()
    );
    
    if (!depositLog) {
      return { verified: false, amountUSD: 0, sharesReceived: 0, error: 'No Deposited event found in transaction' };
    }
    
    // Decode the event: Deposited(address depositor, uint256 amount, uint256 shares)
    // depositor is indexed (in topics[1])
    const depositorAddress = ethers.getAddress('0x' + depositLog.topics[1].slice(26));
    
    // Verify the depositor matches the expected wallet
    if (depositorAddress.toLowerCase() !== expectedWallet.toLowerCase()) {
      return { 
        verified: false, 
        amountUSD: 0, 
        sharesReceived: 0, 
        error: `Depositor ${depositorAddress} does not match expected ${expectedWallet}` 
      };
    }
    
    // Decode the non-indexed parameters: amountUSD, sharesReceived, sharePrice, timestamp
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      depositLog.data
    );
    const amountUSD = parseFloat(ethers.formatUnits(decoded[0], 6)); // USDC has 6 decimals
    const sharesReceived = parseFloat(ethers.formatUnits(decoded[1], 18)); // Shares have 18 decimals
    
    logger.info(`[CommunityPool] Verified on-chain deposit: ${expectedWallet} deposited $${amountUSD}, received ${sharesReceived} shares`);
    
    return { verified: true, amountUSD, sharesReceived };
    
  } catch (error: any) {
    logger.error('[CommunityPool] On-chain deposit verification failed:', error);
    return { verified: false, amountUSD: 0, sharesReceived: 0, error: error.message };
  }
}

/**
 * Verify that a transaction hash corresponds to a real on-chain withdrawal
 * from the CommunityPool contract by the claimed wallet.
 */
export async function verifyOnChainWithdraw(
  txHash: string,
  expectedWallet: string,
  chainConfig: ChainConfig = getChainConfig()
): Promise<{ verified: boolean; amountUSD: number; sharesBurned: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const poolAddress = chainConfig.poolAddress;
    
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction not found on-chain' };
    }
    
    if (receipt.status !== 1) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction failed on-chain' };
    }
    
    if (receipt.to?.toLowerCase() !== poolAddress.toLowerCase()) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'Transaction not to CommunityPool contract' };
    }
    
    // Find the Withdrawn event: Withdrawn(address member, uint256 shares, uint256 amountOut, uint256 fee)
    const withdrawLog = receipt.logs.find(log => 
      log.topics[0] === WITHDRAW_EVENT_TOPIC &&
      log.address.toLowerCase() === poolAddress.toLowerCase()
    );
    
    if (!withdrawLog) {
      return { verified: false, amountUSD: 0, sharesBurned: 0, error: 'No Withdrawn event found in transaction' };
    }
    
    const memberAddress = ethers.getAddress('0x' + withdrawLog.topics[1].slice(26));
    
    if (memberAddress.toLowerCase() !== expectedWallet.toLowerCase()) {
      return { 
        verified: false, 
        amountUSD: 0, 
        sharesBurned: 0, 
        error: `Withdrawer ${memberAddress} does not match expected ${expectedWallet}` 
      };
    }
    
    // Decode: sharesBurned, amountUSD, sharePrice, timestamp (4 non-indexed params)
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      withdrawLog.data
    );
    const sharesBurned = parseFloat(ethers.formatUnits(decoded[0], 18));
    // amountUSD is in 6 decimals (USDC)
    const amountUSD = parseFloat(ethers.formatUnits(decoded[1], 6));
    
    logger.info(`[CommunityPool] Verified on-chain withdrawal: ${expectedWallet} withdrew $${amountUSD}, burned ${sharesBurned} shares`);
    
    return { verified: true, amountUSD, sharesBurned };
    
  } catch (error: any) {
    logger.error('[CommunityPool] On-chain withdrawal verification failed:', error);
    return { verified: false, amountUSD: 0, sharesBurned: 0, error: error.message };
  }
}
