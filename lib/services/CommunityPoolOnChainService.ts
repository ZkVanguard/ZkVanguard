/**
 * Community Pool On-Chain Service
 * 
 * Interacts with the deployed CommunityPool smart contract:
 * - Read pool stats and member positions
 * - Execute deposits and withdrawals
 * - Apply AI allocation decisions
 */

import { ethers, type BrowserProvider, type Signer } from 'ethers';
import { logger } from '../utils/logger';
import { isMainnet } from '../utils/network';

// Contract ABI (key functions only)
const COMMUNITY_POOL_ABI = [
  // View functions
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function calculateTotalNAV() view returns (uint256)',
  'function getNavPerShare() view returns (uint256)',
  'function getMemberCount() view returns (uint256)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinedAt, uint256 lastDepositAt, uint256 highWaterMark)',
  'function isMember(address) view returns (bool)',
  'function targetAllocationBps(uint256) view returns (uint256)',
  'function managementFeeBps() view returns (uint256)',
  'function performanceFeeBps() view returns (uint256)',
  
  // Write functions
  'function deposit(uint256 amount) returns (uint256 shares)',
  'function withdraw(uint256 sharesToBurn) returns (uint256 amountUSD)',
  'function setTargetAllocation(uint256[4] newAllocationBps, string reasoning)',
  
  // Events
  'event Deposited(address indexed member, uint256 amountUSD, uint256 sharesReceived, uint256 sharePrice, uint256 timestamp)',
  'event Withdrawn(address indexed member, uint256 sharesBurned, uint256 amountUSD, uint256 sharePrice, uint256 timestamp)',
  'event Rebalanced(address indexed executor, uint256[4] previousBps, uint256[4] newBps, string reasoning, uint256 timestamp)',
];

// ERC20 ABI for USDC approval
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Contract addresses
const ADDRESSES = {
  mainnet: {
    communityPool: '', // TODO: Deploy and set
    usdc: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59',
  },
  testnet: {
    communityPool: '', // TODO: Deploy and set
    usdc: '0x28217daddC55e3C4831b4A48A00Ce04880786967',
  },
};

/**
 * Get contract addresses for current network
 */
export function getPoolAddresses(chainId: number) {
  if (chainId === 25) {
    return ADDRESSES.mainnet;
  }
  return ADDRESSES.testnet;
}

/**
 * Create CommunityPool contract instance
 */
export function getCommunityPoolContract(
  provider: BrowserProvider | ethers.JsonRpcProvider,
  signer?: Signer
) {
  const chainId = 338; // Default to testnet
  const addresses = getPoolAddresses(chainId);
  
  if (!addresses.communityPool) {
    throw new Error('CommunityPool not deployed on this network');
  }
  
  const contractAddress = addresses.communityPool;
  
  if (signer) {
    return new ethers.Contract(contractAddress, COMMUNITY_POOL_ABI, signer);
  }
  
  return new ethers.Contract(contractAddress, COMMUNITY_POOL_ABI, provider);
}

/**
 * Create USDC contract instance
 */
export function getUsdcContract(
  provider: BrowserProvider | ethers.JsonRpcProvider,
  signer?: Signer,
  chainId: number = 338
) {
  const addresses = getPoolAddresses(chainId);
  
  if (signer) {
    return new ethers.Contract(addresses.usdc, ERC20_ABI, signer);
  }
  
  return new ethers.Contract(addresses.usdc, ERC20_ABI, provider);
}

// ═══════════════════════════════════════════════════════════════
// READ FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export interface OnChainPoolStats {
  totalShares: string;
  totalNAV: string;
  memberCount: number;
  sharePrice: string;
  allocations: {
    BTC: number;
    ETH: number;
    SUI: number;
    CRO: number;
  };
}

/**
 * Get pool statistics from on-chain
 */
export async function getOnChainPoolStats(
  provider: BrowserProvider | ethers.JsonRpcProvider
): Promise<OnChainPoolStats> {
  const contract = getCommunityPoolContract(provider);
  
  const stats = await contract.getPoolStats();
  
  return {
    totalShares: ethers.formatUnits(stats._totalShares, 18),
    totalNAV: ethers.formatUnits(stats._totalNAV, 6),
    memberCount: Number(stats._memberCount),
    sharePrice: ethers.formatUnits(stats._sharePrice, 18),
    allocations: {
      BTC: Number(stats._allocations[0]) / 100,
      ETH: Number(stats._allocations[1]) / 100,
      SUI: Number(stats._allocations[2]) / 100,
      CRO: Number(stats._allocations[3]) / 100,
    },
  };
}

export interface OnChainMemberPosition {
  shares: string;
  valueUSD: string;
  percentage: number;
  isMember: boolean;
  depositedUSD: string;
  withdrawnUSD: string;
  joinedAt: Date | null;
}

/**
 * Get member position from on-chain
 */
export async function getOnChainMemberPosition(
  provider: BrowserProvider | ethers.JsonRpcProvider,
  memberAddress: string
): Promise<OnChainMemberPosition> {
  const contract = getCommunityPoolContract(provider);
  
  const [position, memberData, isMember] = await Promise.all([
    contract.getMemberPosition(memberAddress),
    contract.members(memberAddress),
    contract.isMember(memberAddress),
  ]);
  
  return {
    shares: ethers.formatUnits(position.shares, 18),
    valueUSD: ethers.formatUnits(position.valueUSD, 6),
    percentage: Number(position.percentage) / 100,
    isMember,
    depositedUSD: ethers.formatUnits(memberData.depositedUSD, 6),
    withdrawnUSD: ethers.formatUnits(memberData.withdrawnUSD, 6),
    joinedAt: memberData.joinedAt > 0 
      ? new Date(Number(memberData.joinedAt) * 1000) 
      : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// WRITE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export interface DepositResult {
  success: boolean;
  txHash?: string;
  sharesReceived?: string;
  sharePrice?: string;
  error?: string;
}

/**
 * Deposit USDC into the community pool
 */
export async function depositOnChain(
  signer: Signer,
  amountUSD: number,
  chainId: number = 338
): Promise<DepositResult> {
  try {
    const addresses = getPoolAddresses(chainId);
    const amount = ethers.parseUnits(amountUSD.toString(), 6);
    
    // First approve USDC spending
    const usdc = getUsdcContract(
      signer.provider as BrowserProvider,
      signer,
      chainId
    );
    
    const currentAllowance = await usdc.allowance(
      await signer.getAddress(),
      addresses.communityPool
    );
    
    if (currentAllowance < amount) {
      logger.info('[CommunityPool] Approving USDC...');
      const approveTx = await usdc.approve(addresses.communityPool, amount);
      await approveTx.wait();
    }
    
    // Now deposit
    const pool = getCommunityPoolContract(
      signer.provider as BrowserProvider,
      signer
    );
    
    logger.info(`[CommunityPool] Depositing $${amountUSD}...`);
    const tx = await pool.deposit(amount);
    const receipt = await tx.wait();
    
    // Parse Deposited event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = pool.interface.parseLog(log);
        return parsed?.name === 'Deposited';
      } catch {
        return false;
      }
    });
    
    let sharesReceived = '0';
    let sharePrice = '1';
    
    if (event) {
      const parsed = pool.interface.parseLog(event);
      sharesReceived = ethers.formatUnits(parsed?.args.sharesReceived || 0, 18);
      sharePrice = ethers.formatUnits(parsed?.args.sharePrice || 0, 18);
    }
    
    logger.info(`[CommunityPool] Deposit successful: ${sharesReceived} shares`);
    
    return {
      success: true,
      txHash: receipt.hash,
      sharesReceived,
      sharePrice,
    };
    
  } catch (error: any) {
    logger.error('[CommunityPool] Deposit failed:', error);
    return {
      success: false,
      error: error.message || 'Deposit failed',
    };
  }
}

export interface WithdrawResult {
  success: boolean;
  txHash?: string;
  amountUSD?: string;
  sharesBurned?: string;
  error?: string;
}

/**
 * Withdraw from the community pool by burning shares
 */
export async function withdrawOnChain(
  signer: Signer,
  sharesToBurn: number
): Promise<WithdrawResult> {
  try {
    const shares = ethers.parseUnits(sharesToBurn.toString(), 18);
    
    const pool = getCommunityPoolContract(
      signer.provider as BrowserProvider,
      signer
    );
    
    logger.info(`[CommunityPool] Withdrawing ${sharesToBurn} shares...`);
    const tx = await pool.withdraw(shares);
    const receipt = await tx.wait();
    
    // Parse Withdrawn event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = pool.interface.parseLog(log);
        return parsed?.name === 'Withdrawn';
      } catch {
        return false;
      }
    });
    
    let amountUSD = '0';
    
    if (event) {
      const parsed = pool.interface.parseLog(event);
      amountUSD = ethers.formatUnits(parsed?.args.amountUSD || 0, 6);
    }
    
    logger.info(`[CommunityPool] Withdrawal successful: $${amountUSD}`);
    
    return {
      success: true,
      txHash: receipt.hash,
      amountUSD,
      sharesBurned: sharesToBurn.toString(),
    };
    
  } catch (error: any) {
    logger.error('[CommunityPool] Withdrawal failed:', error);
    return {
      success: false,
      error: error.message || 'Withdrawal failed',
    };
  }
}

export interface RebalanceResult {
  success: boolean;
  txHash?: string;
  newAllocations?: { BTC: number; ETH: number; SUI: number; CRO: number };
  error?: string;
}

/**
 * Apply AI allocation decision on-chain
 */
export async function applyAllocationOnChain(
  signer: Signer,
  allocations: { BTC: number; ETH: number; SUI: number; CRO: number },
  reasoning: string
): Promise<RebalanceResult> {
  try {
    // Convert percentages to basis points
    const allocationBps = [
      Math.round(allocations.BTC * 100),
      Math.round(allocations.ETH * 100),
      Math.round(allocations.SUI * 100),
      Math.round(allocations.CRO * 100),
    ];
    
    // Verify sum is 100%
    const total = allocationBps.reduce((a, b) => a + b, 0);
    if (total !== 10000) {
      throw new Error(`Allocations must sum to 100%, got ${total / 100}%`);
    }
    
    const pool = getCommunityPoolContract(
      signer.provider as BrowserProvider,
      signer
    );
    
    logger.info(`[CommunityPool] Applying allocation: BTC=${allocations.BTC}%, ETH=${allocations.ETH}%, SUI=${allocations.SUI}%, CRO=${allocations.CRO}%`);
    
    const tx = await pool.setTargetAllocation(allocationBps, reasoning);
    const receipt = await tx.wait();
    
    logger.info(`[CommunityPool] Rebalance successful`);
    
    return {
      success: true,
      txHash: receipt.hash,
      newAllocations: allocations,
    };
    
  } catch (error: any) {
    logger.error('[CommunityPool] Rebalance failed:', error);
    return {
      success: false,
      error: error.message || 'Rebalance failed',
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if user has sufficient USDC balance for deposit
 */
export async function checkUsdcBalance(
  provider: BrowserProvider | ethers.JsonRpcProvider,
  userAddress: string,
  chainId: number = 338
): Promise<{ balance: string; sufficient: boolean; minDeposit: number }> {
  const usdc = getUsdcContract(provider, undefined, chainId);
  const balance = await usdc.balanceOf(userAddress);
  
  const minDeposit = 10; // $10 minimum
  const balanceUSD = parseFloat(ethers.formatUnits(balance, 6));
  
  return {
    balance: balanceUSD.toFixed(2),
    sufficient: balanceUSD >= minDeposit,
    minDeposit,
  };
}

/**
 * Set the deployed contract address
 */
export function setPoolAddress(chainId: number, address: string) {
  if (chainId === 25) {
    ADDRESSES.mainnet.communityPool = address;
  } else {
    ADDRESSES.testnet.communityPool = address;
  }
}
