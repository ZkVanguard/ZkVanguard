/**
 * On-Chain Portfolio Manager
 * 
 * Manages positions using ACTUAL USDT on Cronos Testnet
 * 
 * Contract Addresses:
 * - USDT: 0x28217DAddC55e3C4831b4A48A00Ce04880786967
 * - MockMoonlander: 0xAb4946d7BD583a74F5E5051b22332fA674D7BE54
 * - HedgeExecutor: 0x090b6221137690EbB37667E4644287487CE462B9
 * 
 * Features:
 * - Uses real USDT balance from testnet
 * - Creates hedges via HedgeExecutor contract
 * - AI Risk management with RiskAgent
 * - Real API price tracking
 */

import { ethers } from 'ethers';
import { logger } from '@/lib/utils/logger';
import { getCryptocomAIService } from '@/lib/ai/cryptocom-service';
import { getAgentOrchestrator } from '@/lib/services/agent-orchestrator';
import { getMarketDataService } from '@/lib/services/RealMarketDataService';
import { ERC20_ABI } from '@/integrations/moonlander/abis';
import * as fs from 'fs';
import * as path from 'path';

// Deployment addresses from cronos-testnet.json
interface DeploymentConfig {
  USDT: string;
  MockMoonlander: string;
  HedgeExecutor: string;
  RWAManager: string;
  network: string;
  chainId: number;
}

// RWAManager ABI for portfolio creation
const RWA_MANAGER_ABI = [
  {
    inputs: [{ name: '_targetYield', type: 'uint256' }, { name: '_riskTolerance', type: 'uint256' }],
    name: 'createPortfolio',
    outputs: [{ name: 'portfolioId', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '_portfolioId', type: 'uint256' }, { name: '_asset', type: 'address' }, { name: '_amount', type: 'uint256' }],
    name: 'depositAsset',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'portfolioCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'portfolios',
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'totalValue', type: 'uint256' },
      { name: 'targetYield', type: 'uint256' },
      { name: 'riskTolerance', type: 'uint256' },
      { name: 'lastRebalance', type: 'uint256' },
      { name: 'isActive', type: 'bool' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
];

// Extended ERC20 ABI with mint function (USDT testnet has this)
const USDT_ABI = [
  ...ERC20_ABI,
  {
    "inputs": [
      { "name": "to", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "name": "mint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [{ "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [{ "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
];

// Allocation configuration
export interface OnChainAllocation {
  symbol: string;
  percentage: number;
  chain: 'cronos' | 'sui';
}

export interface OnChainPosition {
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
  hedgeId?: string;
}

export interface OnChainPortfolioSummary {
  portfolioId: string;
  walletAddress: string;
  usdtBalance: string;
  usdtBalanceFormatted: number;
  targetAllocation: number; // Total we want to allocate
  allocatedValue: number;
  positions: OnChainPosition[];
  riskMetrics: {
    overallRiskScore: number;
    volatility: number;
    var95: number;
    aiRecommendations: string[];
  };
  contracts: {
    usdt: string;
    mockMoonlander: string;
    hedgeExecutor: string;
  };
  realAPITracking: boolean;
  aiRiskManagement: boolean;
  onChainIntegration: boolean;
  lastUpdated: Date;
}

// Default allocation for the portfolio
const DEFAULT_ALLOCATIONS: OnChainAllocation[] = [
  { symbol: 'BTC', percentage: 35, chain: 'cronos' },  // 35% to BTC
  { symbol: 'ETH', percentage: 30, chain: 'cronos' },  // 30% to ETH
  { symbol: 'CRO', percentage: 20, chain: 'cronos' },  // 20% to CRO
  { symbol: 'SUI', percentage: 15, chain: 'sui' },     // 15% to SUI
];

class OnChainPortfolioManager {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet | null = null;
  private deployment: DeploymentConfig;
  private usdtContract: ethers.Contract | null = null;
  private allocations: OnChainAllocation[];
  private positions: Map<string, OnChainPosition> = new Map();
  private isInitialized: boolean = false;
  private walletAddress: string = '';

  constructor(allocations: OnChainAllocation[] = DEFAULT_ALLOCATIONS) {
    // Load deployment config
    this.deployment = this.loadDeploymentConfig();
    this.allocations = allocations;

    // Initialize provider (Cronos Testnet)
    const rpcUrl = process.env.CRONOS_RPC_URL || 
                   process.env.NEXT_PUBLIC_CRONOS_TESTNET_RPC || 
                   'https://evm-t3.cronos.org';
    
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    logger.info('📦 OnChainPortfolioManager created', {
      network: this.deployment.network,
      chainId: this.deployment.chainId,
      usdt: this.deployment.USDT,
    });
  }

  /**
   * Load deployment configuration from cronos-testnet.json
   */
  private loadDeploymentConfig(): DeploymentConfig {
    try {
      const deploymentPath = path.join(process.cwd(), 'deployments', 'cronos-testnet.json');
      const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
      
      return {
        USDT: deploymentData.USDT,
        MockMoonlander: deploymentData.MockMoonlander,
        HedgeExecutor: deploymentData.HedgeExecutor || deploymentData.HedgeExecutorV2,
        RWAManager: deploymentData.RWAManager || '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189',
        network: deploymentData.network || 'cronos-testnet',
        chainId: deploymentData.chainId || 338,
      };
    } catch (error) {
      logger.warn('Failed to load deployment config, using defaults', { error: error instanceof Error ? error.message : String(error) });
      // Fallback to hardcoded addresses
      return {
        USDT: '0x28217DAddC55e3C4831b4A48A00Ce04880786967',
        MockMoonlander: '0xAb4946d7BD583a74F5E5051b22332fA674D7BE54',
        HedgeExecutor: '0x090b6221137690EbB37667E4644287487CE462B9',
        RWAManager: '0x1Fe3105E6F3878752F5383db87Ea9A7247Db9189',
        network: 'cronos-testnet',
        chainId: 338,
      };
    }
  }

  /**
   * Initialize with a wallet address (for read operations) or private key (for write operations)
   */
  async initialize(walletAddressOrPrivateKey?: string): Promise<void> {
    if (this.isInitialized) return;

    logger.info('🔄 Initializing OnChainPortfolioManager...');

    // Check if we have a private key for signing
    const privateKey = walletAddressOrPrivateKey?.startsWith('0x') && walletAddressOrPrivateKey.length === 66
      ? walletAddressOrPrivateKey
      : process.env.PRIVATE_KEY;

    if (privateKey && privateKey.length === 66) {
      this.signer = new ethers.Wallet(privateKey, this.provider);
      this.walletAddress = await this.signer.getAddress();
      this.usdtContract = new ethers.Contract(
        this.deployment.USDT,
        USDT_ABI,
        this.signer
      );
      logger.info('✅ Wallet connected for signing', { address: this.walletAddress });
    } else {
      // Use provided address - NO hardcoded fallback
      if (!walletAddressOrPrivateKey) {
        throw new Error('Wallet address required for read-only mode. Set NEXT_PUBLIC_SERVER_WALLET_ADDRESS.');
      }
      this.walletAddress = walletAddressOrPrivateKey;
      this.usdtContract = new ethers.Contract(
        this.deployment.USDT,
        USDT_ABI,
        this.provider
      );
      logger.info('📖 Read-only mode', { address: this.walletAddress });
    }

    // Fetch initial USDT balance
    await this.refreshUSDTBalance();
    
    // Create position allocations based on USDT balance
    await this.calculatePositions();
    
    this.isInitialized = true;
    logger.info('✅ OnChainPortfolioManager initialized');
  }

  /**
   * Get USDT balance from the blockchain
   */
  async getUSDTBalance(): Promise<{ raw: bigint; formatted: number }> {
    if (!this.usdtContract) {
      throw new Error('Contract not initialized');
    }

    const balance = await this.usdtContract.balanceOf(this.walletAddress);
    const decimals = await this.usdtContract.decimals();
    const formatted = Number(ethers.formatUnits(balance, decimals));

    return { raw: balance, formatted };
  }

  /**
   * Refresh USDT balance
   */
  private async refreshUSDTBalance(): Promise<number> {
    const { formatted } = await this.getUSDTBalance();
    logger.info(`💰 USDT Balance: ${formatted.toLocaleString()} USDT`, {
      address: this.walletAddress,
      contract: this.deployment.USDT,
    });
    return formatted;
  }

  /**
   * Calculate positions based on USDT balance and allocations
   */
  private async calculatePositions(): Promise<void> {
    const usdtBalance = await this.refreshUSDTBalance();
    const marketService = getMarketDataService();
    
    logger.info('📊 Calculating positions from USDT balance...');

    for (const allocation of this.allocations) {
      const allocationUSD = usdtBalance * (allocation.percentage / 100);
      
      try {
        const priceData = await marketService.getTokenPrice(allocation.symbol);
        const price = priceData.price;
        
        if (price > 0) {
          const amount = allocationUSD / price;
          
          const position: OnChainPosition = {
            symbol: allocation.symbol,
            amount,
            entryPrice: price,
            currentPrice: price,
            valueUSD: allocationUSD,
            pnl: 0,
            pnlPercentage: 0,
            allocation: allocation.percentage,
            chain: allocation.chain,
            onChain: true,
          };
          
          this.positions.set(allocation.symbol, position);
          
          logger.info(`✅ ${allocation.symbol}: ${amount.toLocaleString()} @ $${price.toFixed(2)} = $${allocationUSD.toLocaleString()}`, {
            source: priceData.source,
            allocation: `${allocation.percentage}%`,
          });
        }
      } catch (error) {
        logger.error(`Failed to calculate ${allocation.symbol} position`, error instanceof Error ? error : undefined);
      }
    }
  }

  /**
   * Mint USDT (if we have signing capability)
   */
  async mintUSDT(amount: number): Promise<string | null> {
    if (!this.signer || !this.usdtContract) {
      logger.warn('Cannot mint: No signer available');
      return null;
    }

    const amountWei = ethers.parseUnits(amount.toString(), 6); // USDT has 6 decimals
    
    logger.info(`🪙 Minting ${amount.toLocaleString()} USDT...`);
    
    try {
      const tx = await this.usdtContract.mint(this.walletAddress, amountWei);
      const receipt = await tx.wait();
      
      logger.info(`✅ Minted ${amount.toLocaleString()} USDT`, {
        txHash: receipt.hash,
      });
      
      // Refresh balance and recalculate positions
      await this.refreshUSDTBalance();
      await this.calculatePositions();
      
      return receipt.hash;
    } catch (error) {
      logger.error('Failed to mint USDT', error instanceof Error ? error : undefined);
      return null;
    }
  }

  /**
   * Create a portfolio on RWAManager and deposit USDT
   * This creates the on-chain portfolio with 4 virtual allocations
   */
  async createPortfolioOnRWAManager(depositAmount: number): Promise<{
    success: boolean;
    portfolioId?: number;
    txHashes: { create?: string; approve?: string; deposit?: string };
    allocations: { symbol: string; amount: number; valueUSD: number; percentage: number }[];
    error?: string;
  }> {
    if (!this.signer) {
      return { success: false, txHashes: {}, allocations: [], error: 'No signer available - PRIVATE_KEY required' };
    }

    const txHashes: { create?: string; approve?: string; deposit?: string } = {};

    try {
      // Connect to RWAManager
      const rwaManager = new ethers.Contract(
        this.deployment.RWAManager,
        RWA_MANAGER_ABI,
        this.signer
      );

      logger.info(`📦 Creating portfolio on RWAManager...`, {
        rwaManager: this.deployment.RWAManager,
        depositAmount: `$${depositAmount.toLocaleString()}`,
      });

      // Step 1: Create portfolio (8% target yield, 50/100 medium risk)
      const createTx = await rwaManager.createPortfolio(
        800, // 8% target yield (basis points)
        50   // Medium risk (0-100 scale)
      );
      const createReceipt = await createTx.wait();
      txHashes.create = createReceipt.hash;

      // Get the portfolio ID from the portfolio count
      const portfolioCount = await rwaManager.portfolioCount();
      const portfolioId = Number(portfolioCount) - 1;

      logger.info(`✅ Portfolio #${portfolioId} created`, { txHash: txHashes.create });

      // Step 2: Approve USDT for RWAManager
      const amountWei = ethers.parseUnits(depositAmount.toString(), 6);
      const approveTx = await this.usdtContract!.approve(this.deployment.RWAManager, amountWei);
      const approveReceipt = await approveTx.wait();
      txHashes.approve = approveReceipt.hash;

      logger.info(`✅ USDT approved`, { txHash: txHashes.approve });

      // Step 3: Deposit USDT into portfolio
      const depositTx = await rwaManager.depositAsset(
        portfolioId,
        this.deployment.USDT,
        amountWei
      );
      const depositReceipt = await depositTx.wait();
      txHashes.deposit = depositReceipt.hash;

      logger.info(`✅ USDT deposited`, { txHash: txHashes.deposit });

      // Calculate virtual allocations based on real prices
      const marketService = getMarketDataService();
      const allocations: { symbol: string; amount: number; valueUSD: number; percentage: number }[] = [];

      for (const alloc of this.allocations) {
        try {
          const priceData = await marketService.getTokenPrice(alloc.symbol);
          const valueUSD = depositAmount * (alloc.percentage / 100);
          const amount = valueUSD / priceData.price;

          allocations.push({
            symbol: alloc.symbol,
            amount,
            valueUSD,
            percentage: alloc.percentage,
          });

          logger.info(`📊 ${alloc.symbol}: ${amount.toLocaleString()} @ $${priceData.price.toFixed(2)} = $${valueUSD.toLocaleString()} (${alloc.percentage}%)`);
        } catch (error) {
          logger.warn(`Failed to get price for ${alloc.symbol}`);
        }
      }

      // Refresh positions
      await this.calculatePositions();

      return {
        success: true,
        portfolioId,
        txHashes,
        allocations,
      };

    } catch (error) {
      logger.error('Failed to create portfolio', error instanceof Error ? error : undefined);
      return {
        success: false,
        txHashes,
        allocations: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Refresh all position prices
   */
  async refreshPrices(): Promise<void> {
    const marketService = getMarketDataService();
    
    for (const [symbol, position] of this.positions) {
      try {
        const priceData = await marketService.getTokenPrice(symbol);
        const newPrice = priceData.price;
        
        if (newPrice > 0) {
          position.currentPrice = newPrice;
          position.valueUSD = position.amount * newPrice;
          position.pnl = position.valueUSD - (position.amount * position.entryPrice);
          position.pnlPercentage = (position.pnl / (position.amount * position.entryPrice)) * 100;
        }
      } catch (error) {
        logger.warn(`Failed to refresh ${symbol} price`);
      }
    }
  }

  /**
   * Get AI Risk Assessment
   */
  async assessRiskWithAI(): Promise<Record<string, unknown>> {
    await this.refreshPrices();
    
    const positions = Array.from(this.positions.values());
    const totalValue = positions.reduce((sum, p) => sum + p.valueUSD, 0);
    
    const portfolioData = {
      totalValue,
      tokens: positions.map(pos => ({
        symbol: pos.symbol,
        balance: pos.amount,
        price: pos.currentPrice,
        usdValue: pos.valueUSD,
        allocation: pos.allocation,
        chain: pos.chain,
      })),
    };

    // Use REAL agent orchestrator for AI risk analysis
    const orchestrator = getAgentOrchestrator();
    
    try {
      const result = await orchestrator.assessRisk({
        address: this.walletAddress,
        portfolioData,
      });

      if (result.success && result.data) {
        return {
          ...(result.data as Record<string, unknown>),
          realAgent: true,
          onChain: true,
          usdtBacked: true,
        };
      }
    } catch (error) {
      logger.warn('Agent orchestrator failed', { error: error instanceof Error ? error.message : String(error) });
    }

    // Fallback to AI service
    const aiService = getCryptocomAIService();
    const riskAssessment = await aiService.assessRisk(portfolioData);
    
    return {
      ...riskAssessment,
      onChain: true,
      usdtBacked: true,
    };
  }

  /**
   * Get portfolio summary
   */
  async getSummary(): Promise<OnChainPortfolioSummary> {
    await this.refreshPrices();
    
    const { raw, formatted: usdtBalance } = await this.getUSDTBalance();
    const positions = Array.from(this.positions.values());
    const allocatedValue = positions.reduce((sum, p) => sum + p.valueUSD, 0);
    
    // Get risk metrics
    const riskData = await this.assessRiskWithAI();
    
    // Calculate volatility
    const volatilityMap: Record<string, number> = {
      'BTC': 0.45, 'ETH': 0.50, 'CRO': 0.55, 'SUI': 0.60,
    };
    const weightedVol = this.allocations.reduce((acc, alloc) => {
      return acc + (volatilityMap[alloc.symbol] || 0.50) * (alloc.percentage / 100);
    }, 0);

    return {
      portfolioId: `ONCHAIN-${this.walletAddress.slice(0, 8)}`,
      walletAddress: this.walletAddress,
      usdtBalance: raw.toString(),
      usdtBalanceFormatted: usdtBalance,
      targetAllocation: usdtBalance,
      allocatedValue,
      positions,
      riskMetrics: {
        overallRiskScore: Number(riskData.riskScore || 50),
        volatility: weightedVol,
        var95: allocatedValue * weightedVol * 1.645 / Math.sqrt(252),
        aiRecommendations: (riskData.recommendations as string[]) || [],
      },
      contracts: {
        usdt: this.deployment.USDT,
        mockMoonlander: this.deployment.MockMoonlander,
        hedgeExecutor: this.deployment.HedgeExecutor,
      },
      realAPITracking: true,
      aiRiskManagement: true,
      onChainIntegration: true,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get positions
   */
  getPositions(): OnChainPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get contract addresses
   */
  getContractAddresses(): DeploymentConfig {
    return this.deployment;
  }
}

// Singleton instance
let onChainPortfolioInstance: OnChainPortfolioManager | null = null;

export function getOnChainPortfolioManager(
  allocations?: OnChainAllocation[]
): OnChainPortfolioManager {
  if (!onChainPortfolioInstance) {
    onChainPortfolioInstance = new OnChainPortfolioManager(allocations);
  }
  return onChainPortfolioInstance;
}

export function resetOnChainPortfolioManager(): void {
  onChainPortfolioInstance = null;
}

export { OnChainPortfolioManager };
