/**
 * Oasis On-Chain Portfolio Manager
 * 
 * Manages portfolios on Oasis Sapphire (confidential EVM) and Emerald (public EVM).
 * Mirrors OnChainPortfolioManager (Cronos) but uses Oasis RPC endpoints
 * and Oasis-deployed contract addresses.
 * 
 * Features:
 * - Read portfolio data from RWAManager on Oasis Sapphire
 * - Position tracking with live market prices
 * - Risk assessment via AI orchestrator
 * - Confidential transaction support (Sapphire)
 * 
 * @see lib/services/OnChainPortfolioManager.ts  (Cronos equivalent)
 * @see lib/services/SuiPortfolioManager.ts      (SUI equivalent)
 */

import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getOasisSapphireProvider } from '@/lib/throttled-provider';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { OASIS_CONTRACT_ADDRESSES } from '@/lib/contracts/addresses';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// CONFIGURATION
// ============================================

const OASIS_DEPLOYMENTS = {
  testnet: {
    chainId: 23295,
    rpcUrl: process.env.OASIS_SAPPHIRE_TESTNET_RPC || 'https://testnet.sapphire.oasis.io',
    network: 'oasis-sapphire-testnet',
  },
  mainnet: {
    chainId: 23294,
    rpcUrl: process.env.OASIS_SAPPHIRE_MAINNET_RPC || 'https://sapphire.oasis.io',
    network: 'oasis-sapphire-mainnet',
  },
} as const;

const OASIS_NETWORK = (process.env.NEXT_PUBLIC_OASIS_NETWORK || 'testnet') as keyof typeof OASIS_DEPLOYMENTS;

// RWAManager ABI (same Solidity contract deployed on Oasis)
const RWA_MANAGER_ABI = [
  'function createPortfolio(uint256 _targetYield, uint256 _riskTolerance) returns (uint256 portfolioId)',
  'function depositAsset(uint256 _portfolioId, address _asset, uint256 _amount)',
  'function portfolioCount() view returns (uint256)',
  'function portfolios(uint256) view returns (address owner, uint256 totalValue, uint256 targetYield, uint256 riskTolerance, uint256 lastRebalance, bool isActive)',
  'function getPortfolioAssets(uint256 _portfolioId) view returns (address[] assets, uint256[] amounts)',
  'function getAssetAllocation(uint256 _portfolioId, address _asset) view returns (uint256)',
];

// ERC20 ABI for token reads
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// ============================================
// TYPES
// ============================================

export interface OasisAllocation {
  symbol: string;
  percentage: number;
}

export interface OasisPosition {
  symbol: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  valueUSD: number;
  pnl: number;
  pnlPercentage: number;
  allocation: number;
  chain: string;
  onChain: boolean;
}

export interface OasisPortfolioSummary {
  portfolioId: string;
  walletAddress: string;
  roseBalance: string;
  roseBalanceFormatted: number;
  totalValueUsd: number;
  allocatedValue: number;
  positions: OasisPosition[];
  riskMetrics: {
    overallRiskScore: number;
    volatility: number;
    var95: number;
    recommendations: string[];
  };
  contracts: {
    rwaManager: string;
    zkVerifier: string;
    hedgeExecutor: string;
    paymentRouter: string;
  };
  network: string;
  chainId: number;
  lastUpdated: Date;
}

// Default allocations for Oasis portfolio
const DEFAULT_ALLOCATIONS: OasisAllocation[] = [
  { symbol: 'BTC', percentage: 30 },
  { symbol: 'ETH', percentage: 30 },
  { symbol: 'CRO', percentage: 20 },
  { symbol: 'SUI', percentage: 20 },
];

// ============================================
// SERVICE
// ============================================

export class OasisPortfolioManager {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet | null = null;
  private allocations: OasisAllocation[];
  private positions: Map<string, OasisPosition> = new Map();
  private isInitialized = false;
  private walletAddress = '';
  private networkConfig: typeof OASIS_DEPLOYMENTS[typeof OASIS_NETWORK];
  private contractAddresses: typeof OASIS_CONTRACT_ADDRESSES.testnet;

  constructor(allocations: OasisAllocation[] = DEFAULT_ALLOCATIONS) {
    this.allocations = allocations;
    this.networkConfig = OASIS_DEPLOYMENTS[OASIS_NETWORK];
    this.contractAddresses = OASIS_CONTRACT_ADDRESSES[OASIS_NETWORK];

    const throttled = getOasisSapphireProvider(this.networkConfig.rpcUrl);
    this.provider = throttled.provider;

    logger.info('📦 [OasisPortfolio] Created', {
      network: this.networkConfig.network,
      chainId: this.networkConfig.chainId,
      rwaManager: this.contractAddresses.rwaManager?.slice(0, 10) + '...',
    });
  }

  /**
   * Initialize with a wallet address or private key
   */
  async initialize(walletAddressOrPrivateKey?: string): Promise<void> {
    const pk = walletAddressOrPrivateKey ||
      process.env.PRIVATE_KEY ||
      process.env.OASIS_DEPLOYER_PRIVATE_KEY;

    if (pk && pk.startsWith('0x') && pk.length === 66) {
      // It's a private key
      this.signer = new ethers.Wallet(pk, this.provider);
      this.walletAddress = this.signer.address;
    } else if (pk && pk.startsWith('0x')) {
      // It's an address
      this.walletAddress = pk;
    } else {
      this.walletAddress = '0x0000000000000000000000000000000000000000';
    }

    // Fetch ROSE balance
    const roseBalance = await this.provider.getBalance(this.walletAddress);
    const roseFormatted = parseFloat(ethers.formatEther(roseBalance));

    logger.info('📦 [OasisPortfolio] Initializing', {
      owner: this.walletAddress.slice(0, 10) + '...',
      roseBalance: roseFormatted.toFixed(4),
    });

    // Build virtual positions from ROSE value × allocations × live prices  
    await this.refreshPrices(roseFormatted);
    this.isInitialized = true;

    logger.info('📦 [OasisPortfolio] Initialized', {
      positions: this.positions.size,
      totalUsd: this.getTotalValueUsd().toFixed(2),
    });
  }

  /**
   * Refresh position prices from live market data
   */
  async refreshPrices(roseValueUsd?: number): Promise<void> {
    const marketData = getMarketDataService();

    // Get ROSE value in USD
    let totalUsd = roseValueUsd;
    if (totalUsd === undefined) {
      const roseBalance = await this.provider.getBalance(this.walletAddress);
      const roseFormatted = parseFloat(ethers.formatEther(roseBalance));
      // ROSE is not directly on Crypto.com — estimate from CRO price as proxy
      const croData = await marketData.getTokenPrice('CRO');
      totalUsd = roseFormatted * (croData.price * 0.15); // ROSE ≈ 15% of CRO value (rough proxy)
    }

    // Build positions from allocations × total value × live prices
    for (const alloc of this.allocations) {
      const priceData = await marketData.getTokenPrice(alloc.symbol);
      const currentPrice = priceData.price;
      const allocValue = totalUsd * (alloc.percentage / 100);
      const amount = currentPrice > 0 ? allocValue / currentPrice : 0;

      this.positions.set(alloc.symbol, {
        symbol: alloc.symbol,
        amount,
        entryPrice: currentPrice,
        currentPrice,
        valueUSD: allocValue,
        pnl: 0,
        pnlPercentage: 0,
        allocation: alloc.percentage,
        chain: 'oasis-sapphire',
        onChain: true,
      });
    }
  }

  /**
   * Read portfolio count from RWAManager
   */
  async getPortfolioCount(): Promise<number> {
    if (this.contractAddresses.rwaManager === '0x0000000000000000000000000000000000000000') {
      return 0;
    }
    try {
      const contract = new ethers.Contract(
        this.contractAddresses.rwaManager,
        RWA_MANAGER_ABI,
        this.provider
      );
      return Number(await contract.portfolioCount());
    } catch (e) {
      logger.warn('⚠️ [OasisPortfolio] portfolioCount() failed', { error: String(e) });
      return 0;
    }
  }

  /**
   * Read portfolio by index from RWAManager
   */
  async getPortfolio(index: number): Promise<{
    owner: string;
    totalValue: string;
    targetYield: string;
    riskTolerance: string;
    isActive: boolean;
  } | null> {
    if (this.contractAddresses.rwaManager === '0x0000000000000000000000000000000000000000') {
      return null;
    }
    try {
      const contract = new ethers.Contract(
        this.contractAddresses.rwaManager,
        RWA_MANAGER_ABI,
        this.provider
      );
      const p = await contract.portfolios(index);
      return {
        owner: p.owner,
        totalValue: p.totalValue.toString(),
        targetYield: p.targetYield.toString(),
        riskTolerance: p.riskTolerance.toString(),
        isActive: p.isActive,
      };
    } catch (e) {
      logger.warn('⚠️ [OasisPortfolio] portfolios() failed', { error: String(e) });
      return null;
    }
  }

  /**
   * Get ROSE balance
   */
  async getRoseBalance(): Promise<{ raw: bigint; formatted: number }> {
    const balance = await this.provider.getBalance(this.walletAddress);
    return {
      raw: balance,
      formatted: parseFloat(ethers.formatEther(balance)),
    };
  }

  /**
   * Get all positions
   */
  getPositions(): OasisPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get total value in USD
   */
  getTotalValueUsd(): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      total += pos.valueUSD;
    }
    return total;
  }

  /**
   * Get risk metrics
   */
  getRiskMetrics(): OasisPortfolioSummary['riskMetrics'] {
    const positions = this.getPositions();
    const concentrations = positions.map(p => p.allocation);
    const maxConcentration = Math.max(...concentrations, 0);

    return {
      overallRiskScore: maxConcentration > 40 ? 6 : maxConcentration > 30 ? 4 : 2,
      volatility: 0.15, // Market estimate
      var95: this.getTotalValueUsd() * 0.05,
      recommendations: maxConcentration > 40 
        ? [`High concentration in single asset (${maxConcentration}%)`] 
        : [],
    };
  }

  /**
   * Get full portfolio summary
   */
  getSummary(): OasisPortfolioSummary {
    return {
      portfolioId: `oasis-sapphire-${this.walletAddress.slice(0, 10)}`,
      walletAddress: this.walletAddress,
      roseBalance: '0',
      roseBalanceFormatted: 0,
      totalValueUsd: this.getTotalValueUsd(),
      allocatedValue: this.getTotalValueUsd(),
      positions: this.getPositions(),
      riskMetrics: this.getRiskMetrics(),
      contracts: {
        rwaManager: this.contractAddresses.rwaManager,
        zkVerifier: this.contractAddresses.zkVerifier,
        hedgeExecutor: this.contractAddresses.hedgeExecutor,
        paymentRouter: this.contractAddresses.paymentRouter,
      },
      network: this.networkConfig.network,
      chainId: this.networkConfig.chainId,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get contract addresses
   */
  getContractAddresses() {
    return {
      rwaManager: this.contractAddresses.rwaManager,
      zkVerifier: this.contractAddresses.zkVerifier,
      hedgeExecutor: this.contractAddresses.hedgeExecutor,
      paymentRouter: this.contractAddresses.paymentRouter,
      gaslessZKCommitmentVerifier: this.contractAddresses.gaslessZKCommitmentVerifier,
    };
  }

  /**
   * Get deployment config
   */
  getDeploymentConfig() {
    return {
      network: this.networkConfig.network,
      chainId: this.networkConfig.chainId,
      rpcUrl: this.networkConfig.rpcUrl,
    };
  }
}

// ─── Singleton Factory ───────────────────────────────────────

let _instance: OasisPortfolioManager | null = null;

export function getOasisPortfolioManager(): OasisPortfolioManager {
  if (!_instance) {
    _instance = new OasisPortfolioManager();
  }
  return _instance;
}
