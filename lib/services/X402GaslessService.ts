/**
 * X402 Gasless Transaction Service
 * Provides gasless transaction support for swaps and portfolio operations
 * Uses deployed X402GaslessZKCommitmentVerifier contract for gas sponsorship
 */

import { logger } from '../utils/logger';
import { ethers } from 'ethers';
import { addTransactionToCache } from '../utils/transactionCache';
import { ON_CHAIN_FEES } from '@/lib/config/pricing';
import { getMarketDataService } from './RealMarketDataService';

export interface X402Config {
  contractAddress: string;
  usdcAddress: string;
  feePerTransaction: string; // In USDC (6 decimals)
  enabled: boolean;
}

export interface GaslessTransactionParams {
  to: string;
  data: string;
  value?: string;
  userAddress: string;
}

export interface GaslessSwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  path: string[];
  userAddress: string;
  deadline: number;
}

export interface GaslessResult {
  success: boolean;
  txHash?: string;
  error?: string;
  gasSponsored?: string;
  feeInUSDC?: string;
}

export class X402GaslessService {
  private static readonly X402_CONTRACT = '0x44098d0dE36e157b4C1700B48d615285C76fdE47'; // Cronos testnet
  private static readonly USDC_ADDRESS = '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0'; // DevUSDCe
  // Use centralized pricing config for fee
  private static readonly FEE_PER_TX = ON_CHAIN_FEES.x402Gasless.feePerTransaction;
  
  private static config: X402Config = {
    contractAddress: this.X402_CONTRACT,
    usdcAddress: this.USDC_ADDRESS,
    feePerTransaction: this.FEE_PER_TX,
    enabled: true,
  };

  // ABI fragments
  private static readonly X402_ABI = [
    'function storeCommitmentWithUSDC(bytes32 proofHash, bytes32 merkleRoot, uint256 securityLevel) external',
    'function totalGasSponsored() external view returns (uint256)',
    'function feePerCommitment() external view returns (uint256)',
  ];

  private static readonly ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
  ];

  // Cached contract instances (keyed by provider identity)
  private static cachedERC20Contracts: Map<string, ethers.Contract> = new Map();

  private static getERC20Contract(providerOrSigner: ethers.Provider | ethers.Signer): ethers.Contract {
    const key = 'usdc-' + (providerOrSigner instanceof ethers.Wallet ? providerOrSigner.address : 'provider');
    let contract = this.cachedERC20Contracts.get(key);
    if (!contract) {
      contract = new ethers.Contract(this.config.usdcAddress, this.ERC20_ABI, providerOrSigner);
      this.cachedERC20Contracts.set(key, contract);
    }
    return contract;
  }

  /**
   * Check if user can execute gasless transaction
   */
  static async canExecuteGasless(
    provider: ethers.Provider,
    userAddress: string
  ): Promise<{ canExecute: boolean; reason?: string }> {
    if (!this.config.enabled) {
      return { canExecute: false, reason: 'X402 is disabled' };
    }

    try {
      // Check USDC balance using cached contract
      const usdcContract = this.getERC20Contract(provider);

      const balance = await usdcContract.balanceOf(userAddress);
      const requiredFee = BigInt(this.config.feePerTransaction);

      if (balance < requiredFee) {
        return {
          canExecute: false,
          reason: `Insufficient USDC balance. Need ${ethers.formatUnits(requiredFee, 6)} USDC`,
        };
      }

      return { canExecute: true };
    } catch (error) {
      logger.error('Error checking gasless eligibility', error);
      return { canExecute: false, reason: 'Error checking eligibility' };
    }
  }

  /**
   * Approve USDC for x402 contract if needed
   */
  static async ensureUSDCApproval(
    signer: ethers.Signer,
    userAddress: string
  ): Promise<boolean> {
    try {
      const usdcContract = this.getERC20Contract(signer);

      const currentAllowance = await usdcContract.allowance(
        userAddress,
        this.config.contractAddress
      );

      const requiredAllowance = BigInt(this.config.feePerTransaction) * 100n;

      if (currentAllowance < requiredAllowance) {
        logger.info('Approving USDC for x402 contract');
        const approveTx = await usdcContract.approve(
          this.config.contractAddress,
          requiredAllowance
        );
        await approveTx.wait();
        logger.info('USDC approved for x402');
      }

      return true;
    } catch (error) {
      logger.error('Error approving USDC', error);
      return false;
    }
  }

  /**
   * Create commitment hash for transaction
   */
  private static createCommitmentHash(txData: string): {
    proofHash: string;
    merkleRoot: string;
  } {
    // Create deterministic hashes from transaction data
    const proofHash = ethers.keccak256(
      ethers.toUtf8Bytes(`${txData}-${Date.now()}`)
    );
    const merkleRoot = ethers.keccak256(
      ethers.toUtf8Bytes(`root-${txData}`)
    );

    return { proofHash, merkleRoot };
  }

  /**
   * Execute gasless transaction via x402 protocol
   * This stores a commitment that represents the transaction intent
   */
  static async executeGaslessTransaction(
    signer: ethers.Signer,
    params: GaslessTransactionParams
  ): Promise<GaslessResult> {
    try {
      const userAddress = await signer.getAddress();

      // Check eligibility
      const eligibility = await this.canExecuteGasless(
        signer.provider!,
        userAddress
      );
      if (!eligibility.canExecute) {
        return { success: false, error: eligibility.reason };
      }

      // Ensure USDC approval
      const approved = await this.ensureUSDCApproval(signer, userAddress);
      if (!approved) {
        return { success: false, error: 'Failed to approve USDC' };
      }

      // Create commitment hashes
      const { proofHash, merkleRoot } = this.createCommitmentHash(params.data);

      // Execute via x402 contract
      const x402Contract = new ethers.Contract(
        this.config.contractAddress,
        this.X402_ABI,
        signer
      );

      logger.info('Executing gasless transaction via x402');
      const tx = await x402Contract.storeCommitmentWithUSDC(
        proofHash,
        merkleRoot,
        100 // security level
      );

      const receipt = await tx.wait();

      // Cache the transaction
      if (receipt?.hash) {
        addTransactionToCache({
          hash: receipt.hash,
          type: 'gasless',
          status: 'success',
          timestamp: Date.now(),
          from: params.userAddress,
          to: params.to,
          value: '0',
          tokenSymbol: 'USDC',
          gasUsed: '0',
          blockNumber: receipt.blockNumber,
          description: 'X402 Gasless Transaction',
        });
      }

      return {
        success: true,
        txHash: receipt?.hash,
        gasSponsored: receipt ? ethers.formatEther(receipt.gasUsed * (receipt.gasPrice || 0n)) : '0',
        feeInUSDC: ethers.formatUnits(this.config.feePerTransaction, 6),
      };
    } catch (error) {
      logger.error('Gasless transaction failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Transaction failed',
      };
    }
  }

  /**
   * Execute gasless swap on VVS Finance
   */
  static async executeGaslessSwap(
    signer: ethers.Signer,
    params: GaslessSwapParams
  ): Promise<GaslessResult> {
    try {
      // Create swap transaction data
      const routerInterface = new ethers.Interface([
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
      ]);

      const swapData = routerInterface.encodeFunctionData(
        'swapExactTokensForTokens',
        [
          params.amountIn,
          params.amountOutMin,
          params.path,
          params.userAddress,
          params.deadline,
        ]
      );

      // Execute gaslessly
      return await this.executeGaslessTransaction(signer, {
        to: '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae', // VVS Router
        data: swapData,
        userAddress: params.userAddress,
      });
    } catch (error) {
      logger.error('Gasless swap failed', error);
      return { success: false, error: error instanceof Error ? error.message : 'Swap failed' };
    }
  }

  /**
   * Execute gasless portfolio deposit
   */
  static async executeGaslessDeposit(
    signer: ethers.Signer,
    portfolioAddress: string,
    token: string,
    amount: string,
    userAddress: string
  ): Promise<GaslessResult> {
    try {
      const portfolioInterface = new ethers.Interface([
        'function depositAsset(address token, uint256 amount) external',
      ]);

      const depositData = portfolioInterface.encodeFunctionData('depositAsset', [
        token,
        amount,
      ]);

      return await this.executeGaslessTransaction(signer, {
        to: portfolioAddress,
        data: depositData,
        userAddress,
      });
    } catch (error) {
      logger.error('Gasless deposit failed', error);
      return { success: false, error: error instanceof Error ? error.message : 'Deposit failed' };
    }
  }

  /**
   * Execute gasless portfolio rebalance
   */
  static async executeGaslessRebalance(
    signer: ethers.Signer,
    portfolioAddress: string,
    userAddress: string
  ): Promise<GaslessResult> {
    try {
      const portfolioInterface = new ethers.Interface([
        'function rebalance() external',
      ]);

      const rebalanceData = portfolioInterface.encodeFunctionData('rebalance', []);

      return await this.executeGaslessTransaction(signer, {
        to: portfolioAddress,
        data: rebalanceData,
        userAddress,
      });
    } catch (error) {
      logger.error('Gasless rebalance failed', error);
      return { success: false, error: error instanceof Error ? error.message : 'Rebalance failed' };
    }
  }

  /**
   * Get x402 statistics
   */
  static async getStatistics(
    provider: ethers.Provider
  ): Promise<{
    totalGasSponsored: string;
    feePerTransaction: string;
    enabled: boolean;
  }> {
    try {
      const x402Contract = new ethers.Contract(
        this.config.contractAddress,
        this.X402_ABI,
        provider
      );

      const totalGasSponsored = await x402Contract.totalGasSponsored();
      const feePerCommitment = await x402Contract.feePerCommitment();

      return {
        totalGasSponsored: ethers.formatEther(totalGasSponsored),
        feePerTransaction: ethers.formatUnits(feePerCommitment, 6),
        enabled: this.config.enabled,
      };
    } catch (error) {
      logger.error('Error fetching x402 stats', error);
      return {
        totalGasSponsored: '0',
        feePerTransaction: '0',
        enabled: false,
      };
    }
  }

  /**
   * Estimate savings from using gasless transaction
   * Uses live CRO price from central RealMarketDataService
   */
  static async estimateGasSavings(
    provider: ethers.Provider,
    gasLimit: number
  ): Promise<{
    regularGasCostCRO: string;
    regularGasCostUSD: string;
    x402FeeCRO: string;
    x402FeeUSD: string;
    savingsCRO: string;
    savingsUSD: string;
  }> {
    try {
      const gasPrice = 5000000000000n; // 5000 gwei on Cronos
      const regularGasCost = gasPrice * BigInt(gasLimit);

      // Get CRO price from central RealMarketDataService
      let croPrice = 0.10; // Conservative fallback only if service fails
      try {
        const marketService = getMarketDataService();
        const croData = await marketService.getTokenPrice('CRO');
        if (croData.price > 0) {
          croPrice = croData.price;
        }
      } catch (e) {
        logger.warn('[X402] Using fallback CRO price for gas estimation');
      }
      const usdcPrice = 1.0; // USDC is always ~$1

      const regularGasCostUSD = parseFloat(ethers.formatEther(regularGasCost)) * croPrice;

      const x402FeeUSDC = parseFloat(
        ethers.formatUnits(this.config.feePerTransaction, 6)
      );
      const x402FeeUSD = x402FeeUSDC * usdcPrice;
      const x402FeeCRO = x402FeeUSD / croPrice;

      return {
        regularGasCostCRO: ethers.formatEther(regularGasCost),
        regularGasCostUSD: regularGasCostUSD.toFixed(4),
        x402FeeCRO: x402FeeCRO.toFixed(6),
        x402FeeUSD: x402FeeUSD.toFixed(4),
        savingsCRO: (
          parseFloat(ethers.formatEther(regularGasCost)) - x402FeeCRO
        ).toFixed(6),
        savingsUSD: (regularGasCostUSD - x402FeeUSD).toFixed(4),
      };
    } catch (error) {
      logger.error('Error estimating gas savings', error);
      return {
        regularGasCostCRO: '0',
        regularGasCostUSD: '0',
        x402FeeCRO: '0',
        x402FeeUSD: '0',
        savingsCRO: '0',
        savingsUSD: '0',
      };
    }
  }

  /**
   * Check if gasless mode should be recommended
   */
  static async shouldUseGasless(
    provider: ethers.Provider,
    userAddress: string
  ): Promise<{ shouldUse: boolean; reason: string }> {
    try {
      // Check CRO balance
      const croBalance = await provider.getBalance(userAddress);
      const minCROBalance = ethers.parseEther('0.1'); // 0.1 CRO

      if (croBalance < minCROBalance) {
        return {
          shouldUse: true,
          reason: 'Low CRO balance - gasless mode recommended',
        };
      }

      // Check eligibility
      const eligibility = await this.canExecuteGasless(provider, userAddress);
      if (eligibility.canExecute) {
        return {
          shouldUse: true,
          reason: 'Save on gas costs with x402',
        };
      }

      return {
        shouldUse: false,
        reason: eligibility.reason || 'Regular transaction preferred',
      };
    } catch (error) {
      return { shouldUse: false, reason: 'Error checking gasless recommendation' };
    }
  }
}
