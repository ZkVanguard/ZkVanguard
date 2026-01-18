/**
 * Moonlander On-Chain Client
 * 
 * Real integration with Moonlander perpetual futures on Cronos
 * Uses actual contract addresses from: https://docs.moonlander.trade/others/smart-contracts
 */

import { ethers, Contract, Wallet, Provider, Signer, parseUnits, formatUnits } from 'ethers';
import { logger } from '../../shared/utils/logger';
import { MOONLANDER_CONTRACTS, PAIR_INDEX, INDEX_TO_PAIR, NetworkType, PairSymbol } from './contracts';
import { MOONLANDER_ABI, ERC20_ABI } from './abis';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Trade {
  trader: string;
  pairIndex: bigint;
  index: bigint;
  initialPosToken: bigint;    // Collateral in token decimals
  positionSizeUsd: bigint;    // Position size in USD (scaled)
  openPrice: bigint;          // Entry price (scaled)
  buy: boolean;               // true = LONG, false = SHORT
  leverage: bigint;           // Leverage multiplier
  tp: bigint;                 // Take profit price
  sl: bigint;                 // Stop loss price
}

export interface Position {
  positionId: string;
  market: string;
  pairIndex: number;
  tradeIndex: number;
  side: 'LONG' | 'SHORT';
  size: string;               // Position size in USD
  collateral: string;         // Collateral amount
  entryPrice: string;
  markPrice: string;
  leverage: number;
  unrealizedPnL: string;
  liquidationPrice: string;
  takeProfit: string;
  stopLoss: string;
  timestamp: number;
}

export interface OpenTradeParams {
  pairIndex: number;          // Use PAIR_INDEX mapping
  collateralAmount: string;   // Amount in USDC (6 decimals)
  leverage: number;           // 2-1000x
  isLong: boolean;           
  takeProfit?: string;        // TP price (optional)
  stopLoss?: string;          // SL price (optional)
  slippagePercent?: number;   // Slippage tolerance (default 0.5%)
}

export interface CloseTradeParams {
  pairIndex: number;
  tradeIndex: number;
}

export interface UpdateTpSlParams {
  pairIndex: number;
  tradeIndex: number;
  takeProfit: string;
  stopLoss: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MOONLANDER ON-CHAIN CLIENT
// ═══════════════════════════════════════════════════════════════════════════

export class MoonlanderOnChainClient {
  private provider: Provider;
  private signer: Signer | null = null;
  private moonlanderContract: Contract | null = null;
  private collateralContract: Contract | null = null;
  private network: NetworkType;
  private contracts: typeof MOONLANDER_CONTRACTS.CRONOS_EVM;
  private initialized = false;

  constructor(
    providerOrRpc: Provider | string,
    network: NetworkType = 'CRONOS_EVM'
  ) {
    this.network = network;
    this.contracts = MOONLANDER_CONTRACTS[network];
    
    if (typeof providerOrRpc === 'string') {
      this.provider = new ethers.JsonRpcProvider(providerOrRpc);
    } else {
      this.provider = providerOrRpc;
    }

    logger.info('MoonlanderOnChainClient created', {
      network,
      moonlanderAddress: this.contracts.MOONLANDER,
    });
  }

  /**
   * Initialize client with signer for transactions
   */
  async initialize(signerOrPrivateKey?: Signer | string): Promise<void> {
    try {
      // Setup signer
      if (signerOrPrivateKey) {
        if (typeof signerOrPrivateKey === 'string') {
          this.signer = new Wallet(signerOrPrivateKey, this.provider);
        } else {
          this.signer = signerOrPrivateKey;
        }
      }

      // Initialize contracts
      const signerOrProvider = this.signer || this.provider;
      
      this.moonlanderContract = new Contract(
        this.contracts.MOONLANDER,
        MOONLANDER_ABI,
        signerOrProvider
      );

      // Get collateral token address from contract
      let collateralAddress: string;
      try {
        collateralAddress = await this.moonlanderContract.collateral();
      } catch {
        // Fallback to USDC
        collateralAddress = this.network === 'CRONOS_EVM' 
          ? MOONLANDER_CONTRACTS.CRONOS_EVM.USDC 
          : MOONLANDER_CONTRACTS.CRONOS_ZKEVM.MOONLANDER; // placeholder
      }

      this.collateralContract = new Contract(
        collateralAddress,
        ERC20_ABI,
        signerOrProvider
      );

      this.initialized = true;
      
      const address = this.signer ? await this.signer.getAddress() : 'read-only';
      logger.info('MoonlanderOnChainClient initialized', {
        network: this.network,
        address,
        collateral: collateralAddress,
      });
    } catch (error) {
      logger.error('Failed to initialize MoonlanderOnChainClient', { error });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRADING FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Open a new perpetual position
   */
  async openTrade(params: OpenTradeParams): Promise<{
    txHash: string;
    tradeIndex: number;
    positionSizeUsd: string;
    leverage: number;
  }> {
    this.ensureInitialized();
    this.ensureSigner();

    const {
      pairIndex,
      collateralAmount,
      leverage,
      isLong,
      takeProfit = '0',
      stopLoss = '0',
      slippagePercent = 0.5,
    } = params;

    logger.info('Opening trade on Moonlander', {
      pairIndex,
      pair: INDEX_TO_PAIR[pairIndex],
      collateral: collateralAmount,
      leverage,
      isLong,
    });

    try {
      // Get trader address
      const trader = await this.signer!.getAddress();

      // Parse collateral (USDC has 6 decimals)
      const collateralDecimals = await this.collateralContract!.decimals();
      const collateralWei = parseUnits(collateralAmount, collateralDecimals);

      // Calculate position size in USD
      const positionSizeUsd = collateralWei * BigInt(leverage);

      // Approve collateral if needed
      const allowance = await this.collateralContract!.allowance(trader, this.contracts.MOONLANDER);
      if (allowance < collateralWei) {
        logger.info('Approving collateral...', { amount: collateralAmount });
        const approveTx = await this.collateralContract!.approve(
          this.contracts.MOONLANDER,
          ethers.MaxUint256
        );
        await approveTx.wait();
        logger.info('Collateral approved');
      }

      // Get current trade count to determine index
      const tradeCount = await this.moonlanderContract!.openTradesCount(trader, pairIndex);
      const tradeIndex = Number(tradeCount);

      // Build trade struct
      const trade = {
        trader,
        pairIndex: BigInt(pairIndex),
        index: BigInt(tradeIndex),
        initialPosToken: collateralWei,
        positionSizeUsd,
        openPrice: BigInt(0), // Will be set by oracle
        buy: isLong,
        leverage: BigInt(leverage),
        tp: parseUnits(takeProfit, 10), // Price scaled to 10 decimals
        sl: parseUnits(stopLoss, 10),
      };

      // Slippage as percentage (0.5% = 50 in basis points scaled)
      const slippageP = BigInt(Math.floor(slippagePercent * 100));

      // Execute trade (requires Pyth price update, sending 0.06 CRO for oracle fee)
      const oracleFee = parseUnits('0.06', 18); // 0.06 CRO
      
      const tx = await this.moonlanderContract!.openMarketTradeWithPythAndExtraFee(
        trade,
        0, // orderType: 0 = market
        slippageP,
        [], // Empty pyth update data - oracle will fetch
        { value: oracleFee }
      );

      const receipt = await tx.wait();
      
      logger.info('Trade opened successfully', {
        txHash: receipt.hash,
        tradeIndex,
        positionSizeUsd: formatUnits(positionSizeUsd, collateralDecimals),
      });

      return {
        txHash: receipt.hash,
        tradeIndex,
        positionSizeUsd: formatUnits(positionSizeUsd, collateralDecimals),
        leverage,
      };
    } catch (error) {
      logger.error('Failed to open trade', { error, params });
      throw error;
    }
  }

  /**
   * Close an existing position
   */
  async closeTrade(params: CloseTradeParams): Promise<{ txHash: string; pnl?: string }> {
    this.ensureInitialized();
    this.ensureSigner();

    const { pairIndex, tradeIndex } = params;

    logger.info('Closing trade on Moonlander', {
      pairIndex,
      pair: INDEX_TO_PAIR[pairIndex],
      tradeIndex,
    });

    try {
      const tx = await this.moonlanderContract!.closeTrade(
        BigInt(pairIndex),
        BigInt(tradeIndex)
      );

      const receipt = await tx.wait();
      
      // Parse TradeClosed event for PnL
      let pnl: string | undefined;
      for (const log of receipt.logs) {
        try {
          const parsed = this.moonlanderContract!.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          if (parsed?.name === 'TradeClosed') {
            pnl = parsed.args.pnl?.toString();
          }
        } catch {
          // Not a matching event
        }
      }

      logger.info('Trade closed successfully', {
        txHash: receipt.hash,
        pnl,
      });

      return { txHash: receipt.hash, pnl };
    } catch (error) {
      logger.error('Failed to close trade', { error, params });
      throw error;
    }
  }

  /**
   * Update take profit and stop loss
   */
  async updateTpSl(params: UpdateTpSlParams): Promise<{ txHash: string }> {
    this.ensureInitialized();
    this.ensureSigner();

    const { pairIndex, tradeIndex, takeProfit, stopLoss } = params;

    logger.info('Updating TP/SL on Moonlander', {
      pairIndex,
      tradeIndex,
      takeProfit,
      stopLoss,
    });

    try {
      const tx = await this.moonlanderContract!.updateTradeTpAndSl(
        BigInt(pairIndex),
        BigInt(tradeIndex),
        parseUnits(takeProfit, 10),
        parseUnits(stopLoss, 10)
      );

      const receipt = await tx.wait();
      
      logger.info('TP/SL updated successfully', { txHash: receipt.hash });

      return { txHash: receipt.hash };
    } catch (error) {
      logger.error('Failed to update TP/SL', { error, params });
      throw error;
    }
  }

  /**
   * Add margin to position
   */
  async addMargin(
    pairIndex: number,
    tradeIndex: number,
    amount: string
  ): Promise<{ txHash: string }> {
    this.ensureInitialized();
    this.ensureSigner();

    logger.info('Adding margin to position', { pairIndex, tradeIndex, amount });

    try {
      const trader = await this.signer!.getAddress();
      const decimals = await this.collateralContract!.decimals();
      const amountWei = parseUnits(amount, decimals);

      // Approve if needed
      const allowance = await this.collateralContract!.allowance(trader, this.contracts.MOONLANDER);
      if (allowance < amountWei) {
        const approveTx = await this.collateralContract!.approve(
          this.contracts.MOONLANDER,
          ethers.MaxUint256
        );
        await approveTx.wait();
      }

      const tx = await this.moonlanderContract!.addMargin(
        BigInt(pairIndex),
        BigInt(tradeIndex),
        amountWei
      );

      const receipt = await tx.wait();
      
      logger.info('Margin added successfully', { txHash: receipt.hash });

      return { txHash: receipt.hash };
    } catch (error) {
      logger.error('Failed to add margin', { error });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // READ FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all positions for a trader
   */
  async getPositions(traderAddress?: string): Promise<Position[]> {
    this.ensureInitialized();

    const trader = traderAddress || (this.signer ? await this.signer.getAddress() : null);
    if (!trader) {
      throw new Error('No trader address provided and no signer available');
    }

    logger.info('Fetching positions for trader', { trader });

    try {
      const trades: Trade[] = await this.moonlanderContract!.getTradesForTrader(trader);
      const positions: Position[] = [];

      for (const trade of trades) {
        if (trade.positionSizeUsd === BigInt(0)) continue; // Skip closed trades

        const pairIndex = Number(trade.pairIndex);
        const market = INDEX_TO_PAIR[pairIndex] || `PAIR-${pairIndex}`;
        
        // Calculate approximate values
        const decimals = await this.collateralContract!.decimals();
        
        positions.push({
          positionId: `${trader}-${pairIndex}-${trade.index}`,
          market: `${market}-PERP`,
          pairIndex,
          tradeIndex: Number(trade.index),
          side: trade.buy ? 'LONG' : 'SHORT',
          size: formatUnits(trade.positionSizeUsd, decimals),
          collateral: formatUnits(trade.initialPosToken, decimals),
          entryPrice: formatUnits(trade.openPrice, 10),
          markPrice: '0', // Would need oracle call
          leverage: Number(trade.leverage),
          unrealizedPnL: '0', // Would need mark price
          liquidationPrice: '0', // Would need calculation
          takeProfit: formatUnits(trade.tp, 10),
          stopLoss: formatUnits(trade.sl, 10),
          timestamp: Date.now(),
        });
      }

      logger.info('Fetched positions', { count: positions.length });
      return positions;
    } catch (error) {
      logger.error('Failed to fetch positions', { error });
      throw error;
    }
  }

  /**
   * Get specific trade
   */
  async getTrade(traderAddress: string, pairIndex: number, tradeIndex: number): Promise<Trade | null> {
    this.ensureInitialized();

    try {
      const trade = await this.moonlanderContract!.getTrade(
        traderAddress,
        BigInt(pairIndex),
        BigInt(tradeIndex)
      );

      if (trade.positionSizeUsd === BigInt(0)) {
        return null; // Closed or non-existent
      }

      return trade;
    } catch (error) {
      logger.error('Failed to get trade', { error });
      return null;
    }
  }

  /**
   * Get open interest for a pair
   */
  async getOpenInterest(pairIndex: number): Promise<{ long: string; short: string }> {
    this.ensureInitialized();

    try {
      const [longOI, shortOI] = await Promise.all([
        this.moonlanderContract!.openInterest(BigInt(pairIndex), true),
        this.moonlanderContract!.openInterest(BigInt(pairIndex), false),
      ]);

      const decimals = await this.collateralContract!.decimals();
      
      return {
        long: formatUnits(longOI, decimals),
        short: formatUnits(shortOI, decimals),
      };
    } catch (error) {
      logger.error('Failed to get open interest', { error });
      return { long: '0', short: '0' };
    }
  }

  /**
   * Get collateral balance
   */
  async getCollateralBalance(address?: string): Promise<string> {
    this.ensureInitialized();

    const account = address || (this.signer ? await this.signer.getAddress() : null);
    if (!account) {
      throw new Error('No address provided');
    }

    try {
      const balance = await this.collateralContract!.balanceOf(account);
      const decimals = await this.collateralContract!.decimals();
      return formatUnits(balance, decimals);
    } catch (error) {
      logger.error('Failed to get collateral balance', { error });
      return '0';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Convert market symbol to pair index
   */
  getPairIndex(symbol: string): number {
    // Clean up symbol
    const clean = symbol.toUpperCase()
      .replace('-PERP', '')
      .replace('-USD', '')
      .replace('_USD', '');
    
    const pairSymbol = `${clean}-USD` as PairSymbol;
    
    if (pairSymbol in PAIR_INDEX) {
      return PAIR_INDEX[pairSymbol];
    }
    
    throw new Error(`Unknown trading pair: ${symbol}`);
  }

  /**
   * Get trader address
   */
  async getTraderAddress(): Promise<string | null> {
    if (!this.signer) return null;
    return this.signer.getAddress();
  }

  /**
   * Check if client has signer
   */
  hasSigner(): boolean {
    return this.signer !== null;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MoonlanderOnChainClient not initialized. Call initialize() first.');
    }
  }

  private ensureSigner(): void {
    if (!this.signer) {
      throw new Error('No signer available. Initialize with private key or signer for write operations.');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

let clientInstance: MoonlanderOnChainClient | null = null;

export function getMoonlanderOnChainClient(
  network: NetworkType = 'CRONOS_EVM'
): MoonlanderOnChainClient {
  if (!clientInstance) {
    const rpcUrl = MOONLANDER_CONTRACTS[network].RPC_URL;
    clientInstance = new MoonlanderOnChainClient(rpcUrl, network);
  }
  return clientInstance;
}

export async function createMoonlanderClient(
  privateKey: string,
  network: NetworkType = 'CRONOS_EVM'
): Promise<MoonlanderOnChainClient> {
  const client = getMoonlanderOnChainClient(network);
  await client.initialize(privateKey);
  return client;
}
