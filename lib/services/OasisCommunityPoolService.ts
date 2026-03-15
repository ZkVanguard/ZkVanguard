/**
 * Oasis Community Pool On-Chain Service
 * 
 * Reads/writes community pool state on Oasis Sapphire. Uses the same
 * CommunityPool ABI as Cronos since the Solidity contracts are identical.
 * 
 * Differences from Cronos:
 * - Uses Oasis Sapphire RPC via ThrottledProvider
 * - Contract addresses from OASIS_CONTRACT_ADDRESSES
 * - ROSE native token instead of CRO/tCRO
 * 
 * @see lib/services/CommunityPoolStatsService.ts (Cronos unified stats)
 * @see lib/services/SuiCommunityPoolService.ts   (SUI equivalent)
 */

import { ethers, type BrowserProvider, type Signer } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getOasisSapphireProvider } from '@/lib/throttled-provider';
import { OASIS_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';

// ============================================
// ABI (same CommunityPool Solidity contract)
// ============================================

const COMMUNITY_POOL_ABI = [
  'function getPoolStats() view returns (uint256 _totalShares, uint256 _totalNAV, uint256 _memberCount, uint256 _sharePrice, uint256[4] _allocations)',
  'function getMemberPosition(address member) view returns (uint256 shares, uint256 valueUSD, uint256 percentage)',
  'function calculateTotalNAV() view returns (uint256)',
  'function getNavPerShare() view returns (uint256)',
  'function getMemberCount() view returns (uint256)',
  'function members(address) view returns (uint256 shares, uint256 depositedUSD, uint256 withdrawnUSD, uint256 joinedAt, uint256 lastDepositAt, uint256 highWaterMark)',
  'function isMember(address) view returns (bool)',
  'function targetAllocationBps(uint256) view returns (uint256)',
  'function deposit(uint256 amount) returns (uint256 shares)',
  'function withdraw(uint256 sharesToBurn) returns (uint256 amountUSD)',
  'function setTargetAllocation(uint256[4] newAllocationBps, string reasoning)',
  'event Deposited(address indexed member, uint256 amountUSD, uint256 sharesReceived, uint256 sharePrice, uint256 timestamp)',
  'event Withdrawn(address indexed member, uint256 sharesBurned, uint256 amountUSD, uint256 sharePrice, uint256 timestamp)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ============================================
// CONTRACT ADDRESS RESOLUTION
// ============================================

interface OasisPoolAddresses {
  communityPool: string;
  usdc: string;
}

const OASIS_POOL_ADDRESSES: Record<string, OasisPoolAddresses> = {
  // Sapphire testnet — CommunityPool not yet deployed separately
  // Using PaymentRouter as placeholder until CommunityPool specific deployment
  testnet: {
    communityPool: process.env.NEXT_PUBLIC_OASIS_COMMUNITY_POOL_ADDRESS || '',
    usdc: process.env.NEXT_PUBLIC_OASIS_USDC_ADDRESS || '0x0000000000000000000000000000000000000000',
  },
  mainnet: {
    communityPool: process.env.NEXT_PUBLIC_OASIS_MAINNET_COMMUNITY_POOL_ADDRESS || '',
    usdc: process.env.NEXT_PUBLIC_OASIS_MAINNET_USDC_ADDRESS || '0x0000000000000000000000000000000000000000',
  },
};

const OASIS_NETWORK = process.env.NEXT_PUBLIC_OASIS_NETWORK || 'testnet';

export function getOasisPoolAddresses(): OasisPoolAddresses {
  return OASIS_POOL_ADDRESSES[OASIS_NETWORK] || OASIS_POOL_ADDRESSES.testnet;
}

// ============================================
// TYPES
// ============================================

export interface OasisPoolStats {
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
  network: string;
}

export interface OasisMemberPosition {
  shares: string;
  valueUSD: string;
  percentage: number;
  isMember: boolean;
  depositedUSD: string;
  withdrawnUSD: string;
  joinedAt: Date | null;
}

export interface OasisDepositResult {
  success: boolean;
  txHash?: string;
  sharesReceived?: string;
  error?: string;
}

export interface OasisWithdrawResult {
  success: boolean;
  txHash?: string;
  amountWithdrawn?: string;
  error?: string;
}

// ============================================
// READ FUNCTIONS
// ============================================

/**
 * Get pool statistics from Oasis Sapphire CommunityPool
 */
export async function getOasisPoolStats(
  provider?: ethers.JsonRpcProvider | BrowserProvider
): Promise<OasisPoolStats> {
  const p = provider || getOasisSapphireProvider().provider;
  const addresses = getOasisPoolAddresses();

  if (!addresses.communityPool) {
    logger.warn('⚠️ [OasisPool] CommunityPool not deployed on this network');
    return {
      totalShares: '0',
      totalNAV: '0',
      memberCount: 0,
      sharePrice: '0',
      allocations: { BTC: 35, ETH: 30, SUI: 20, CRO: 15 },
      network: `oasis-sapphire-${OASIS_NETWORK}`,
    };
  }

  const contract = new ethers.Contract(addresses.communityPool, COMMUNITY_POOL_ABI, p);
  const stats = await contract.getPoolStats();

  return {
    totalShares: ethers.formatUnits(stats._totalShares, 18),
    totalNAV: ethers.formatUnits(stats._totalNAV, 6),
    memberCount: Number(stats._memberCount),
    // Contract returns (USDC_6dec × WAD) / Shares_18dec = 6 decimal result
    sharePrice: ethers.formatUnits(stats._sharePrice, 6),
    allocations: {
      BTC: Number(stats._allocations[0]) / 100,
      ETH: Number(stats._allocations[1]) / 100,
      SUI: Number(stats._allocations[2]) / 100,
      CRO: Number(stats._allocations[3]) / 100,
    },
    network: `oasis-sapphire-${OASIS_NETWORK}`,
  };
}

/**
 * Get member position from Oasis CommunityPool
 */
export async function getOasisMemberPosition(
  memberAddress: string,
  provider?: ethers.JsonRpcProvider | BrowserProvider
): Promise<OasisMemberPosition> {
  const p = provider || getOasisSapphireProvider().provider;
  const addresses = getOasisPoolAddresses();

  if (!addresses.communityPool) {
    return {
      shares: '0',
      valueUSD: '0',
      percentage: 0,
      isMember: false,
      depositedUSD: '0',
      withdrawnUSD: '0',
      joinedAt: null,
    };
  }

  const contract = new ethers.Contract(addresses.communityPool, COMMUNITY_POOL_ABI, p);

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

// ============================================
// WRITE FUNCTIONS (require signer)
// ============================================

/**
 * Deposit into Oasis CommunityPool
 */
export async function depositOasisPool(
  signer: Signer,
  amountUSD: number
): Promise<OasisDepositResult> {
  try {
    const addresses = getOasisPoolAddresses();
    if (!addresses.communityPool) {
      return { success: false, error: 'CommunityPool not deployed' };
    }

    const amount = ethers.parseUnits(amountUSD.toString(), 6);

    // Approve USDC spending if needed
    if (addresses.usdc !== '0x0000000000000000000000000000000000000000') {
      const usdc = new ethers.Contract(addresses.usdc, ERC20_ABI, signer);
      const signerAddress = await signer.getAddress();
      const allowance = await usdc.allowance(signerAddress, addresses.communityPool);
      if (allowance < amount) {
        const approveTx = await usdc.approve(addresses.communityPool, amount);
        await approveTx.wait();
      }
    }

    const pool = new ethers.Contract(addresses.communityPool, COMMUNITY_POOL_ABI, signer);
    const tx = await pool.deposit(amount);
    const receipt = await tx.wait();

    logger.info('✅ [OasisPool] Deposit successful', {
      amount: amountUSD,
      txHash: receipt.hash,
    });

    return {
      success: true,
      txHash: receipt.hash,
      sharesReceived: receipt.logs?.[0]?.data || '0',
    };
  } catch (e) {
    logger.error('❌ [OasisPool] Deposit failed', { error: String(e) });
    return { success: false, error: String(e) };
  }
}

/**
 * Withdraw from Oasis CommunityPool
 */
export async function withdrawOasisPool(
  signer: Signer,
  sharesToBurn: string
): Promise<OasisWithdrawResult> {
  try {
    const addresses = getOasisPoolAddresses();
    if (!addresses.communityPool) {
      return { success: false, error: 'CommunityPool not deployed' };
    }

    const pool = new ethers.Contract(addresses.communityPool, COMMUNITY_POOL_ABI, signer);
    const shares = ethers.parseUnits(sharesToBurn, 18);
    const tx = await pool.withdraw(shares);
    const receipt = await tx.wait();

    logger.info('✅ [OasisPool] Withdrawal successful', { txHash: receipt.hash });
    return {
      success: true,
      txHash: receipt.hash,
    };
  } catch (e) {
    logger.error('❌ [OasisPool] Withdrawal failed', { error: String(e) });
    return { success: false, error: String(e) };
  }
}

// ============================================
// UTILITY
// ============================================

/**
 * Check ROSE balance on Oasis
 */
export async function checkOasisRoseBalance(
  address: string,
  provider?: ethers.JsonRpcProvider
): Promise<{ balance: string; formatted: number }> {
  const p = provider || getOasisSapphireProvider().provider;
  const balance = await p.getBalance(address);
  return {
    balance: balance.toString(),
    formatted: parseFloat(ethers.formatEther(balance)),
  };
}
