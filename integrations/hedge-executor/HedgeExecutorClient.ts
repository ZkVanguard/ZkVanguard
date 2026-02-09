/**
 * On-Chain HedgeExecutor Client
 * Interacts with HedgeExecutor.sol for atomic on-chain hedge execution
 * Replaces the off-chain MoonlanderClient REST API for hedge operations
 */

import { ethers } from 'ethers';
import { logger } from '@shared/utils/logger';
import HedgeExecutorABI from '../../contracts/abi/HedgeExecutor.json';

export interface OnChainHedgeResult {
  hedgeId: string;
  txHash: string;
  pairIndex: number;
  collateralAmount: string;
  leverage: number;
  isLong: boolean;
  openPrice: string;
  commitmentHash: string;
  status: 'ACTIVE' | 'CLOSED' | 'FAILED';
}

export interface HedgeExecutorConfig {
  contractAddress: string;
  collateralTokenAddress: string;
  provider: ethers.Provider;
  signer: ethers.Wallet | ethers.Signer;
  gasLimitOverride?: number;
}

// Pair index mapping
const PAIR_INDEX: Record<string, number> = {
  'BTC-USD': 0, 'BTC/USDC': 0,
  'ETH-USD': 1, 'ETH/USDC': 1,
  'CRO-USD': 2, 'CRO/USDC': 2,
  'ATOM-USD': 3, 'ATOM/USDC': 3,
  'DOGE-USD': 4, 'DOGE/USDC': 4,
  'SOL-USD': 5, 'SOL/USDC': 5,
};

export class HedgeExecutorClient {
  private contract: ethers.Contract;
  private collateralToken: ethers.Contract;
  private config: HedgeExecutorConfig;
  private cachedDecimals: number | null = null; // Token decimals are immutable

  constructor(config: HedgeExecutorConfig) {
    this.config = config;
    this.contract = new ethers.Contract(
      config.contractAddress,
      HedgeExecutorABI,
      config.signer
    );
    this.collateralToken = new ethers.Contract(
      config.collateralTokenAddress,
      [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function balanceOf(address account) view returns (uint256)',
        'function decimals() view returns (uint8)',
      ],
      config.signer
    );
  }

  /**
   * Open an on-chain hedge position atomically
   */
  async openHedge(params: {
    market: string;
    side: 'LONG' | 'SHORT';
    collateralAmount: string; // in USDC (human-readable)
    leverage: number;
    commitmentHash?: string;
    nullifier?: string;
  }): Promise<OnChainHedgeResult> {
    const { market, side, collateralAmount, leverage } = params;

    const pairIndex = PAIR_INDEX[market] ?? 0;
    const isLong = side === 'LONG';
    const decimals = await this.collateralToken.decimals();
    const amount = ethers.parseUnits(collateralAmount, decimals);

    // Generate commitment hash and nullifier if not provided
    const commitmentHash = params.commitmentHash
      ? params.commitmentHash
      : ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'bool', 'uint256', 'uint256'],
            [pairIndex, isLong, amount, Date.now()]
          )
        );

    const nullifier = params.nullifier
      ? params.nullifier
      : ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'uint256'],
            [commitmentHash, Date.now()]
          )
        );

    const merkleRoot = ethers.ZeroHash;

    // Ensure approval
    const signerAddr = await (this.config.signer as ethers.Wallet).getAddress();
    const allowance = await this.collateralToken.allowance(
      signerAddr,
      this.config.contractAddress
    );
    if (allowance < amount) {
      logger.info('Approving collateral token for HedgeExecutor', { amount: collateralAmount });
      const approveTx = await this.collateralToken.approve(
        this.config.contractAddress,
        ethers.MaxUint256
      );
      await approveTx.wait();
    }

    // Open hedge on-chain
    logger.info('Opening on-chain hedge', {
      market,
      side,
      collateralAmount,
      leverage,
      pairIndex,
    });

    const tx = await this.contract.openHedge(
      pairIndex,
      amount,
      leverage,
      isLong,
      commitmentHash,
      nullifier,
      merkleRoot,
      { gasLimit: this.config.gasLimitOverride || 500_000 }
    );

    const receipt = await tx.wait();

    // Parse HedgeOpened event
    const hedgeEvent = receipt.logs
      .map((log: any) => {
        try {
          return this.contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === 'HedgeOpened');

    const hedgeId = hedgeEvent?.args?.hedgeId || commitmentHash;

    logger.info('On-chain hedge opened', {
      hedgeId,
      txHash: receipt.hash,
      market,
      side,
    });

    return {
      hedgeId,
      txHash: receipt.hash,
      pairIndex,
      collateralAmount,
      leverage,
      isLong,
      openPrice: hedgeEvent?.args?.openPrice?.toString() || '0',
      commitmentHash,
      status: 'ACTIVE',
    };
  }

  /**
   * Close an on-chain hedge position
   */
  async closeHedge(hedgeId: string): Promise<{
    txHash: string;
    pnl: string;
    closePrice: string;
  }> {
    logger.info('Closing on-chain hedge', { hedgeId });

    const tx = await this.contract.closeHedge(
      hedgeId,
      { gasLimit: this.config.gasLimitOverride || 400_000 }
    );
    const receipt = await tx.wait();

    // Parse HedgeClosed event
    const closeEvent = receipt.logs
      .map((log: any) => {
        try {
          return this.contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === 'HedgeClosed');

    return {
      txHash: receipt.hash,
      pnl: closeEvent?.args?.realizedPnl?.toString() || '0',
      closePrice: closeEvent?.args?.closePrice?.toString() || '0',
    };
  }

  /**
   * Agent opens hedge on behalf of a user (gasless via relayer)
   */
  async agentOpenHedge(params: {
    trader: string;
    market: string;
    side: 'LONG' | 'SHORT';
    collateralAmount: string;
    leverage: number;
  }): Promise<OnChainHedgeResult> {
    const { trader, market, side, collateralAmount, leverage } = params;

    const pairIndex = PAIR_INDEX[market] ?? 0;
    const isLong = side === 'LONG';
    const decimals = await this.collateralToken.decimals();
    const amount = ethers.parseUnits(collateralAmount, decimals);

    const commitmentHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'bool', 'uint256', 'uint256'],
        [trader, pairIndex, isLong, amount, Date.now()]
      )
    );
    const nullifier = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint256'],
        [commitmentHash, Date.now()]
      )
    );

    const tx = await this.contract.agentOpenHedge(
      trader,
      pairIndex,
      amount,
      leverage,
      isLong,
      commitmentHash,
      nullifier,
      ethers.ZeroHash,
      { gasLimit: this.config.gasLimitOverride || 600_000 }
    );

    const receipt = await tx.wait();
    const hedgeEvent = receipt.logs
      .map((log: any) => {
        try {
          return this.contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === 'HedgeOpened');

    return {
      hedgeId: hedgeEvent?.args?.hedgeId || commitmentHash,
      txHash: receipt.hash,
      pairIndex,
      collateralAmount,
      leverage,
      isLong,
      openPrice: hedgeEvent?.args?.openPrice?.toString() || '0',
      commitmentHash,
      status: 'ACTIVE',
    };
  }

  /**
   * Get hedge position info from on-chain
   */
  async getHedge(hedgeId: string): Promise<{
    trader: string;
    pairIndex: number;
    collateralAmount: string;
    leverage: number;
    isLong: boolean;
    openPrice: string;
    status: string;
  } | null> {
    try {
      const pos = await this.contract.hedges(hedgeId);
      if (pos.trader === ethers.ZeroAddress) return null;

      const statusMap = ['PENDING', 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];
      return {
        trader: pos.trader,
        pairIndex: Number(pos.pairIndex),
        collateralAmount: ethers.formatUnits(pos.collateralAmount, 6),
        leverage: Number(pos.leverage),
        isLong: pos.isLong,
        openPrice: pos.openTimestamp.toString(),
        status: statusMap[Number(pos.status)] || 'UNKNOWN',
      };
    } catch {
      return null;
    }
  }

  /**
   * Get protocol stats
   */
  async getStats(): Promise<{
    totalHedgesOpened: number;
    totalHedgesClosed: number;
    totalCollateralLocked: string;
    totalPnlRealized: string;
    accumulatedFees: string;
  }> {
    const [opened, closed, locked, pnl, fees] = await Promise.all([
      this.contract.totalHedgesOpened(),
      this.contract.totalHedgesClosed(),
      this.contract.totalCollateralLocked(),
      this.contract.totalPnlRealized(),
      this.contract.accumulatedFees(),
    ]);

    return {
      totalHedgesOpened: Number(opened),
      totalHedgesClosed: Number(closed),
      totalCollateralLocked: ethers.formatUnits(locked, 6),
      totalPnlRealized: ethers.formatUnits(pnl, 6),
      accumulatedFees: ethers.formatUnits(fees, 6),
    };
  }
}
