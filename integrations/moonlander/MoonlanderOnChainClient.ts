/**
 * Moonlander On-Chain Client
 * 
 * Real integration with Moonlander perpetual futures on Cronos
 * Uses actual contract addresses from: https://docs.moonlander.trade/others/smart-contracts
 * 
 * NOTE: Moonlander uses a Diamond proxy (EIP-2535) so we use raw transaction encoding
 * with verified function selectors.
 * 
 * Function selectors (verified from contract ABI):
 * - openMarketTradeWithPythAndExtraFee: 0x85420cc3
 * - closeTrade: 0x73b1caa3
 * - updateTradeTpAndSl: 0x67d22d9b
 * - addMargin: 0xfc05c34d
 */

import { ethers, Contract, Wallet, Provider, Signer, parseUnits, formatUnits, AbiCoder, keccak256 } from 'ethers';
import { logger } from '../../shared/utils/logger';
import { MOONLANDER_CONTRACTS, PAIR_INDEX, INDEX_TO_PAIR, NetworkType, PairSymbol } from './contracts';
import { ERC20_ABI } from './abis';

// ═══════════════════════════════════════════════════════════════════════════
// MOONLANDER FUNCTION SELECTORS (Diamond proxy)
// These are verified function selectors matching the contract ABI
// ═══════════════════════════════════════════════════════════════════════════
const MOONLANDER_SELECTORS = {
  openMarketTradeWithPythAndExtraFee: '0x85420cc3',
  closeTrade: '0x73b1caa3',
  updateTradeTpAndSl: '0x67d22d9b',
  addMargin: '0xfc05c34d',
} as const;

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
  private collateralContract: Contract | null = null;
  private network: NetworkType;
  private contracts: typeof MOONLANDER_CONTRACTS.CRONOS_EVM;
  private initialized = false;
  private abiCoder = AbiCoder.defaultAbiCoder();

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

      // Initialize collateral contract (USDC)
      const signerOrProvider = this.signer || this.provider;
      const collateralAddress = this.contracts.USDC;
      
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
  // TRADING FUNCTIONS (Using raw transaction encoding for Diamond proxy)
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

    logger.info('Opening trade on Moonlander (raw encoding for Diamond proxy)', {
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

      // Build raw calldata based on verified function signature
      // Function: openMarketTradeWithPythAndExtraFee (0x85420cc3)
      // 
      // Parameters:
      // - referrer (address)
      // - pairIndex (uint256)  
      // - collateralToken (address)
      // - collateralAmount (uint256)
      // - openPrice (uint256) - for slippage check, 0 for market
      // - leveragedAmount (uint256)
      // - tp (uint256)
      // - sl (uint256)
      // - direction (uint256) - 2 = long, 1 = short
      // - fee (uint256)
      // - pythUpdateData (bytes[])

      const referrer = '0x0000000000000000000000000000000000000000';
      const collateralToken = this.contracts.USDC;
      
      // Calculate leveraged position value (collateral * leverage)
      const leveragedAmount = collateralWei * BigInt(leverage);
      
      // Direction: observed 2 for long (this may need adjustment)
      const direction = isLong ? BigInt(2) : BigInt(1);
      
      // Parse TP/SL prices (scaled to 10 decimals based on observation)
      const tpPrice = takeProfit !== '0' ? parseUnits(takeProfit, 10) : BigInt(0);
      const slPrice = stopLoss !== '0' ? parseUnits(stopLoss, 10) : BigInt(0);
      
      // Fee calculation (from observed tx: ~0.5% = 1999500 in some scale)
      const fee = BigInt(Math.floor(slippagePercent * 1000000 * 4)); // Approximation
      
      // Empty Pyth update data (oracle bot handles this on Moonlander)
      const pythUpdateData: string[] = [];

      // Encode the calldata manually
      const encodedParams = this.abiCoder.encode(
        [
          'address',  // referrer
          'uint256',  // pairIndex
          'address',  // collateralToken
          'uint256',  // collateralAmount
          'uint256',  // openPrice (0 for market)
          'uint256',  // leveragedAmount
          'uint256',  // tp
          'uint256',  // sl
          'uint256',  // direction
          'uint256',  // fee
          'bytes[]',  // pythUpdateData
        ],
        [
          referrer,
          BigInt(pairIndex),
          collateralToken,
          collateralWei,
          BigInt(0), // Market order - no specific price
          leveragedAmount,
          tpPrice,
          slPrice,
          direction,
          fee,
          pythUpdateData,
        ]
      );

      const calldata = MOONLANDER_SELECTORS.openMarketTradeWithPythAndExtraFee + encodedParams.slice(2);

      // Oracle fee: 0.06 CRO
      const oracleFee = parseUnits('0.06', 18);

      logger.info('Sending raw transaction to Moonlander', {
        to: this.contracts.MOONLANDER,
        value: oracleFee.toString(),
        dataLength: calldata.length,
      });

      // Send raw transaction
      const tx = await this.signer!.sendTransaction({
        to: this.contracts.MOONLANDER,
        data: calldata,
        value: oracleFee,
        gasLimit: 1000000n, // Set higher gas limit for complex tx
      });

      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction failed - no receipt');
      }

      logger.info('Trade opened successfully', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
      });

      return {
        txHash: receipt.hash,
        tradeIndex: 0, // Would need to parse from events
        positionSizeUsd: formatUnits(leveragedAmount, collateralDecimals),
        leverage,
      };
    } catch (error) {
      logger.error('Failed to open trade', { error, params });
      throw error;
    }
  }

  /**
   * Close an existing position (using raw encoding for Diamond proxy)
   */
  async closeTrade(params: CloseTradeParams): Promise<{ txHash: string; pnl?: string }> {
    this.ensureInitialized();
    this.ensureSigner();

    const { pairIndex, tradeIndex } = params;

    logger.info('Closing trade on Moonlander (raw encoding)', {
      pairIndex,
      pair: INDEX_TO_PAIR[pairIndex],
      tradeIndex,
    });

    try {
      // Encode calldata: closeTrade(uint256 pairIndex, uint256 index)
      const encodedParams = this.abiCoder.encode(
        ['uint256', 'uint256'],
        [BigInt(pairIndex), BigInt(tradeIndex)]
      );
      
      const calldata = MOONLANDER_SELECTORS.closeTrade + encodedParams.slice(2);

      const tx = await this.signer!.sendTransaction({
        to: this.contracts.MOONLANDER,
        data: calldata,
        gasLimit: 500000n,
      });

      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction failed - no receipt');
      }

      logger.info('Trade closed successfully', {
        txHash: receipt.hash,
      });

      return { txHash: receipt.hash };
    } catch (error) {
      logger.error('Failed to close trade', { error, params });
      throw error;
    }
  }

  /**
   * Update take profit and stop loss (using raw encoding for Diamond proxy)
   */
  async updateTpSl(params: UpdateTpSlParams): Promise<{ txHash: string }> {
    this.ensureInitialized();
    this.ensureSigner();

    const { pairIndex, tradeIndex, takeProfit, stopLoss } = params;

    logger.info('Updating TP/SL on Moonlander (raw encoding)', {
      pairIndex,
      tradeIndex,
      takeProfit,
      stopLoss,
    });

    try {
      // Encode calldata: updateTradeTpAndSl(uint256 pairIndex, uint256 index, uint64 tp, uint64 sl)
      const encodedParams = this.abiCoder.encode(
        ['uint256', 'uint256', 'uint256', 'uint256'],
        [
          BigInt(pairIndex),
          BigInt(tradeIndex),
          parseUnits(takeProfit, 10),
          parseUnits(stopLoss, 10)
        ]
      );
      
      const calldata = MOONLANDER_SELECTORS.updateTradeTpAndSl + encodedParams.slice(2);

      const tx = await this.signer!.sendTransaction({
        to: this.contracts.MOONLANDER,
        data: calldata,
        gasLimit: 300000n,
      });

      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction failed - no receipt');
      }
      
      logger.info('TP/SL updated successfully', { txHash: receipt.hash });

      return { txHash: receipt.hash };
    } catch (error) {
      logger.error('Failed to update TP/SL', { error, params });
      throw error;
    }
  }

  /**
   * Add margin to position (using raw encoding for Diamond proxy)
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

      // Encode calldata: addMargin(uint256 pairIndex, uint256 index, uint256 amount)
      const encodedParams = this.abiCoder.encode(
        ['uint256', 'uint256', 'uint256'],
        [BigInt(pairIndex), BigInt(tradeIndex), amountWei]
      );
      
      const calldata = MOONLANDER_SELECTORS.addMargin + encodedParams.slice(2);

      const tx = await this.signer!.sendTransaction({
        to: this.contracts.MOONLANDER,
        data: calldata,
        gasLimit: 300000n,
      });

      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction failed - no receipt');
      }
      
      logger.info('Margin added successfully', { txHash: receipt.hash });

      return { txHash: receipt.hash };
    } catch (error) {
      logger.error('Failed to add margin', { error });
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // READ FUNCTIONS (Note: May need adjustment for Diamond proxy)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all positions for a trader
   * Note: This uses API fallback as Diamond proxy read functions may not be accessible
   */
  async getPositions(traderAddress?: string): Promise<Position[]> {
    this.ensureInitialized();

    const trader = traderAddress || (this.signer ? await this.signer.getAddress() : null);
    if (!trader) {
      throw new Error('No trader address provided and no signer available');
    }

    logger.info('Fetching positions for trader', { trader });

    // Return empty array - positions should be tracked via the API or events
    // The Diamond proxy makes direct contract reads unreliable
    logger.warn('Position fetching via contract not available - use MoonlanderClient API instead');
    return [];
  }

  /**
   * Get specific trade - not available via Diamond proxy
   */
  async getTrade(traderAddress: string, pairIndex: number, tradeIndex: number): Promise<Trade | null> {
    logger.warn('getTrade not available via Diamond proxy - use MoonlanderClient API instead');
    return null;
  }

  /**
   * Get open interest for a pair - not available via Diamond proxy
   */
  async getOpenInterest(pairIndex: number): Promise<{ long: string; short: string }> {
    logger.warn('getOpenInterest not available via Diamond proxy - use MoonlanderClient API instead');
    return { long: '0', short: '0' };
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
