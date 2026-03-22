/**
 * Account Abstraction (AA) Client Service
 * 
 * Handles ERC-4337 UserOperation creation, signing, and submission
 * for gasless USDT deposits via Pimlico/Candide paymasters.
 * 
 * Flow:
 * 1. User signs approval for USDT transfer to paymaster
 * 2. Create UserOperation for deposit to community pool
 * 3. Get paymaster signature (pays gas in exchange for USDT)
 * 4. Submit to bundler
 * 5. Wait for on-chain execution
 */

import { ethers } from 'ethers';
import {
  AAPaymasterConfig,
  UserOperation,
  GasEstimation,
  PaymasterQuote,
  getAAConfig,
  ENTRY_POINT_V07,
  parseUSDT,
  formatUSDT,
} from '@/lib/config/aa-paymaster';
import { logger } from '@/lib/utils/logger';

// ============================================================================
// ABI DEFINITIONS
// ============================================================================

/**
 * ERC-20 ABI for USDT interactions
 */
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

/**
 * EntryPoint v0.7 ABI (minimal)
 */
const ENTRY_POINT_ABI = [
  'function handleOps(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address payable beneficiary) external',
  'function getNonce(address sender, uint192 key) external view returns (uint256)',
  'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) external view returns (bytes32)',
];

/**
 * Community Pool ABI for USDT deposits
 */
const COMMUNITY_POOL_ABI = [
  'function depositUSDT(uint256 amount) external returns (uint256 sharesReceived)',
  'function deposit(uint256 amountUSD) external returns (uint256 sharesReceived)',
  'event Deposited(address indexed member, uint256 amountUSD, uint256 sharesReceived, uint256 sharePrice, uint256 timestamp)',
];

// ============================================================================
// BUNDLER/PAYMASTER RPC CLIENT
// ============================================================================

/**
 * JSON-RPC client for bundler/paymaster interactions
 */
class BundlerRPCClient {
  private bundlerUrl: string;
  private paymasterUrl: string;
  
  constructor(config: AAPaymasterConfig) {
    this.bundlerUrl = config.bundlerUrl;
    this.paymasterUrl = config.paymasterUrl;
  }
  
  /**
   * Make a JSON-RPC call to the bundler
   */
  private async rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
    });
    
    const result = await response.json();
    if (result.error) {
      throw new Error(`RPC Error: ${result.error.message || JSON.stringify(result.error)}`);
    }
    return result.result;
  }
  
  /**
   * Get supported entry points from bundler
   */
  async getSupportedEntryPoints(): Promise<string[]> {
    return this.rpc(this.bundlerUrl, 'eth_supportedEntryPoints', []) as Promise<string[]>;
  }
  
  /**
   * Estimate UserOperation gas
   */
  async estimateUserOperationGas(
    userOp: Partial<UserOperation>,
    entryPoint: string
  ): Promise<GasEstimation> {
    const result = await this.rpc(this.bundlerUrl, 'eth_estimateUserOperationGas', [
      this.serializeUserOp(userOp),
      entryPoint,
    ]) as {
      preVerificationGas: string;
      verificationGasLimit: string;
      callGasLimit: string;
      paymasterVerificationGasLimit?: string;
      paymasterPostOpGasLimit?: string;
    };
    
    return {
      preVerificationGas: BigInt(result.preVerificationGas),
      verificationGasLimit: BigInt(result.verificationGasLimit),
      callGasLimit: BigInt(result.callGasLimit),
      paymasterVerificationGasLimit: result.paymasterVerificationGasLimit 
        ? BigInt(result.paymasterVerificationGasLimit) 
        : undefined,
      paymasterPostOpGasLimit: result.paymasterPostOpGasLimit
        ? BigInt(result.paymasterPostOpGasLimit)
        : undefined,
    };
  }
  
  /**
   * Get paymaster quote for USDT gas payment
   */
  async getPaymasterQuote(
    userOp: Partial<UserOperation>,
    entryPoint: string,
    tokenAddress: string
  ): Promise<PaymasterQuote> {
    // Pimlico paymaster sponsorship request
    const result = await this.rpc(this.paymasterUrl, 'pm_sponsorUserOperation', [
      this.serializeUserOp(userOp),
      entryPoint,
      {
        token: tokenAddress,
        sponsorshipPolicyId: 'sp_usdt_gas', // Optional policy ID
      },
    ]) as {
      paymaster: string;
      paymasterData: string;
      paymasterVerificationGasLimit: string;
      paymasterPostOpGasLimit: string;
      preVerificationGas?: string;
      verificationGasLimit?: string;
      callGasLimit?: string;
    };
    
    return {
      paymaster: result.paymaster,
      paymasterData: result.paymasterData,
      paymasterVerificationGasLimit: BigInt(result.paymasterVerificationGasLimit || '0'),
      paymasterPostOpGasLimit: BigInt(result.paymasterPostOpGasLimit || '0'),
      tokenCost: 0n, // Will be calculated from paymaster data
      tokenSymbol: 'USDT',
    };
  }
  
  /**
   * Submit UserOperation to bundler
   */
  async sendUserOperation(
    userOp: UserOperation,
    entryPoint: string
  ): Promise<string> {
    return this.rpc(this.bundlerUrl, 'eth_sendUserOperation', [
      this.serializeUserOp(userOp),
      entryPoint,
    ]) as Promise<string>;
  }
  
  /**
   * Get UserOperation receipt by hash
   */
  async getUserOperationReceipt(userOpHash: string): Promise<{
    success: boolean;
    actualGasCost: bigint;
    actualGasUsed: bigint;
    receipt: {
      transactionHash: string;
      blockNumber: number;
      status: number;
    };
  } | null> {
    const result = await this.rpc(this.bundlerUrl, 'eth_getUserOperationReceipt', [
      userOpHash,
    ]) as {
      success: boolean;
      actualGasCost: string;
      actualGasUsed: string;
      receipt: {
        transactionHash: string;
        blockNumber: string;
        status: string;
      };
    } | null;
    
    if (!result) return null;
    
    return {
      success: result.success,
      actualGasCost: BigInt(result.actualGasCost),
      actualGasUsed: BigInt(result.actualGasUsed),
      receipt: {
        transactionHash: result.receipt.transactionHash,
        blockNumber: parseInt(result.receipt.blockNumber, 16),
        status: parseInt(result.receipt.status, 16),
      },
    };
  }
  
  /**
   * Wait for UserOperation to be included on-chain
   */
  async waitForUserOperation(
    userOpHash: string,
    timeoutMs: number = 60000,
    pollIntervalMs: number = 2000
  ): Promise<{
    success: boolean;
    txHash: string;
    gasCost: bigint;
  }> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const receipt = await this.getUserOperationReceipt(userOpHash);
      
      if (receipt) {
        return {
          success: receipt.success && receipt.receipt.status === 1,
          txHash: receipt.receipt.transactionHash,
          gasCost: receipt.actualGasCost,
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new Error(`UserOperation timeout after ${timeoutMs}ms`);
  }
  
  /**
   * Serialize UserOperation for RPC
   */
  private serializeUserOp(userOp: Partial<UserOperation>): Record<string, string> {
    const serialized: Record<string, string> = {};
    
    if (userOp.sender) serialized.sender = userOp.sender;
    if (userOp.nonce !== undefined) serialized.nonce = '0x' + userOp.nonce.toString(16);
    if (userOp.factory) serialized.factory = userOp.factory;
    if (userOp.factoryData) serialized.factoryData = userOp.factoryData;
    if (userOp.callData) serialized.callData = userOp.callData;
    if (userOp.callGasLimit !== undefined) serialized.callGasLimit = '0x' + userOp.callGasLimit.toString(16);
    if (userOp.verificationGasLimit !== undefined) serialized.verificationGasLimit = '0x' + userOp.verificationGasLimit.toString(16);
    if (userOp.preVerificationGas !== undefined) serialized.preVerificationGas = '0x' + userOp.preVerificationGas.toString(16);
    if (userOp.maxFeePerGas !== undefined) serialized.maxFeePerGas = '0x' + userOp.maxFeePerGas.toString(16);
    if (userOp.maxPriorityFeePerGas !== undefined) serialized.maxPriorityFeePerGas = '0x' + userOp.maxPriorityFeePerGas.toString(16);
    if (userOp.paymaster) serialized.paymaster = userOp.paymaster;
    if (userOp.paymasterVerificationGasLimit !== undefined) serialized.paymasterVerificationGasLimit = '0x' + userOp.paymasterVerificationGasLimit.toString(16);
    if (userOp.paymasterPostOpGasLimit !== undefined) serialized.paymasterPostOpGasLimit = '0x' + userOp.paymasterPostOpGasLimit.toString(16);
    if (userOp.paymasterData) serialized.paymasterData = userOp.paymasterData;
    if (userOp.signature) serialized.signature = userOp.signature;
    
    return serialized;
  }
}

// ============================================================================
// AA CLIENT
// ============================================================================

/**
 * Account Abstraction Client for gasless USDT deposits
 */
export class AAClient {
  private config: AAPaymasterConfig;
  private provider: ethers.JsonRpcProvider;
  private bundlerClient: BundlerRPCClient;
  
  constructor(config: AAPaymasterConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.provider);
    this.bundlerClient = new BundlerRPCClient(config);
  }
  
  /**
   * Create an AA client for a specific chain
   */
  static forChain(chainId: number, paymasterProvider: 'pimlico' | 'candide' = 'pimlico'): AAClient | null {
    const config = getAAConfig(chainId, paymasterProvider);
    if (!config) return null;
    return new AAClient(config);
  }
  
  /**
   * Get the USDT contract
   */
  getUSDTContract(): ethers.Contract {
    return new ethers.Contract(
      this.config.paymasterToken.address,
      ERC20_ABI,
      this.provider
    );
  }
  
  /**
   * Check USDT balance
   */
  async getUSDTBalance(address: string): Promise<bigint> {
    const usdt = this.getUSDTContract();
    return usdt.balanceOf(address);
  }
  
  /**
   * Check USDT allowance for paymaster
   */
  async getUSDTAllowance(owner: string): Promise<bigint> {
    const usdt = this.getUSDTContract();
    return usdt.allowance(owner, this.config.paymasterAddress);
  }
  
  /**
   * Get current nonce for a smart account
   */
  async getNonce(smartAccountAddress: string): Promise<bigint> {
    const entryPoint = new ethers.Contract(
      ENTRY_POINT_V07,
      ENTRY_POINT_ABI,
      this.provider
    );
    return entryPoint.getNonce(smartAccountAddress, 0);
  }
  
  /**
   * Get current gas prices
   */
  async getGasPrices(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    const feeData = await this.provider.getFeeData();
    return {
      maxFeePerGas: feeData.maxFeePerGas || BigInt(50e9), // 50 gwei fallback
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || BigInt(2e9), // 2 gwei fallback
    };
  }
  
  /**
   * Build USDT approval calldata
   */
  buildApprovalCallData(spender: string, amount: bigint): string {
    const iface = new ethers.Interface(ERC20_ABI);
    return iface.encodeFunctionData('approve', [spender, amount]);
  }
  
  /**
   * Build USDT transfer calldata
   */
  buildTransferCallData(to: string, amount: bigint): string {
    const iface = new ethers.Interface(ERC20_ABI);
    return iface.encodeFunctionData('transfer', [to, amount]);
  }
  
  /**
   * Build community pool deposit calldata
   */
  buildDepositCallData(communityPoolAddress: string, amountUSD: bigint): string {
    const iface = new ethers.Interface(COMMUNITY_POOL_ABI);
    return iface.encodeFunctionData('depositUSDT', [amountUSD]);
  }
  
  async createDepositUserOp(params: {
    smartAccountAddress: string;
    communityPoolAddress: string;
    amountUSDT: bigint;
    approveFirst?: boolean;
    factory?: string;
    factoryData?: string;
    permit?: any; // Placeholder for future permit implementation
  }): Promise<{
    userOp: Partial<UserOperation>;
    estimatedGas: GasEstimation;
    paymasterQuote: PaymasterQuote;
  }> {
    const { smartAccountAddress, communityPoolAddress, amountUSDT, approveFirst, factory, factoryData, permit } = params;
    
    // Safety check for unsignable permit requests
    if (permit) {
        throw new Error("Permit-based deposits require funding Safe account first.");
    }

    // Build calldata
      // For Safe accounts, we'd use the MultiSend contract
      // For simplicity, just deposit here (assumes approval already done)
      callData = this.buildDepositCallData(communityPoolAddress, amountUSDT);
    } else {
      callData = this.buildDepositCallData(communityPoolAddress, amountUSDT);
    }
    
    // Get nonce
    const nonce = await this.getNonce(smartAccountAddress);
    
    // Get gas prices
    const gasPrices = await this.getGasPrices();
    
    // Build partial UserOp
    const userOp: Partial<UserOperation> = {
      sender: smartAccountAddress,
      nonce,
      callData,
      maxFeePerGas: gasPrices.maxFeePerGas,
      maxPriorityFeePerGas: gasPrices.maxPriorityFeePerGas,
      signature: '0x', // Placeholder
      factory,
      factoryData,
    };
    
    // Estimate gas
    const estimatedGas = await this.bundlerClient.estimateUserOperationGas(
      userOp,
      ENTRY_POINT_V07
    );
    
    // Add gas limits to userOp
    userOp.preVerificationGas = estimatedGas.preVerificationGas;
    userOp.verificationGasLimit = estimatedGas.verificationGasLimit;
    userOp.callGasLimit = estimatedGas.callGasLimit;
    
    // Get paymaster quote
    const paymasterQuote = await this.bundlerClient.getPaymasterQuote(
      userOp,
      ENTRY_POINT_V07,
      this.config.paymasterToken.address
    );
    
    // Add paymaster data to userOp
    userOp.paymaster = paymasterQuote.paymaster;
    userOp.paymasterData = paymasterQuote.paymasterData;
    userOp.paymasterVerificationGasLimit = paymasterQuote.paymasterVerificationGasLimit;
    userOp.paymasterPostOpGasLimit = paymasterQuote.paymasterPostOpGasLimit;
    
    return {
      userOp,
      estimatedGas,
      paymasterQuote,
    };
  }
  
  /**
   * Submit a signed UserOperation
   */
  async submitUserOp(userOp: UserOperation): Promise<string> {
    return this.bundlerClient.sendUserOperation(userOp, ENTRY_POINT_V07);
  }
  
  /**
   * Wait for UserOperation to complete
   */
  async waitForUserOp(userOpHash: string, timeoutMs: number = 60000): Promise<{
    success: boolean;
    txHash: string;
    gasCost: bigint;
  }> {
    return this.bundlerClient.waitForUserOperation(userOpHash, timeoutMs);
  }
  
  /**
   * Execute a full USDT deposit flow
   * 1. Create UserOp
   * 2. Sign (externally provided)
   * 3. Submit
   * 4. Wait for confirmation
   */
  async executeDeposit(params: {
    smartAccountAddress: string;
    communityPoolAddress: string;
    amountUSDT: number;
    signUserOp: (userOpHash: string) => Promise<string>;
  }): Promise<{
    success: boolean;
    txHash: string;
    userOpHash: string;
    gasCostUSDT: string;
    sharesReceived?: number;
  }> {
    const { smartAccountAddress, communityPoolAddress, amountUSDT, signUserOp } = params;
    
    logger.info('[AAClient] Starting USDT deposit flow', {
      smartAccount: smartAccountAddress,
      pool: communityPoolAddress,
      amount: amountUSDT,
    });
    
    try {
      // 1. Create UserOp
      const amountWei = parseUSDT(amountUSDT);
      const { userOp, estimatedGas, paymasterQuote } = await this.createDepositUserOp({
        smartAccountAddress,
        communityPoolAddress,
        amountUSDT: amountWei,
      });
      
      logger.info('[AAClient] UserOp created', {
        estimatedGas: {
          preVerification: estimatedGas.preVerificationGas.toString(),
          verification: estimatedGas.verificationGasLimit.toString(),
          call: estimatedGas.callGasLimit.toString(),
        },
        paymaster: paymasterQuote.paymaster,
      });
      
      // 2. Calculate UserOp hash for signing
      const entryPoint = new ethers.Contract(
        ENTRY_POINT_V07,
        ENTRY_POINT_ABI,
        this.provider
      );
      
      // Pack the UserOp for hashing
      const packedUserOp = this.packUserOp(userOp as UserOperation);
      const userOpHash = await entryPoint.getUserOpHash(packedUserOp);
      
      // 3. Get signature from user
      const signature = await signUserOp(userOpHash);
      userOp.signature = signature;
      
      // 4. Submit to bundler
      const submittedHash = await this.submitUserOp(userOp as UserOperation);
      logger.info('[AAClient] UserOp submitted', { userOpHash: submittedHash });
      
      // 5. Wait for on-chain confirmation
      const result = await this.waitForUserOp(submittedHash);
      
      logger.info('[AAClient] UserOp completed', {
        success: result.success,
        txHash: result.txHash,
        gasCost: formatUSDT(result.gasCost),
      });
      
      return {
        success: result.success,
        txHash: result.txHash,
        userOpHash: submittedHash,
        gasCostUSDT: formatUSDT(result.gasCost),
      };
      
    } catch (error) {
      logger.error('[AAClient] Deposit failed', { error });
      throw error;
    }
  }
  
  /**
   * Pack UserOperation for EntryPoint
   */
  private packUserOp(userOp: UserOperation): {
    sender: string;
    nonce: bigint;
    initCode: string;
    callData: string;
    accountGasLimits: string;
    preVerificationGas: bigint;
    gasFees: string;
    paymasterAndData: string;
    signature: string;
  } {
    // Pack gas limits: callGasLimit (16 bytes) | verificationGasLimit (16 bytes)
    const accountGasLimits = ethers.concat([
      ethers.zeroPadValue(ethers.toBeHex(userOp.callGasLimit), 16),
      ethers.zeroPadValue(ethers.toBeHex(userOp.verificationGasLimit), 16),
    ]);
    
    // Pack gas fees: maxFeePerGas (16 bytes) | maxPriorityFeePerGas (16 bytes)
    const gasFees = ethers.concat([
      ethers.zeroPadValue(ethers.toBeHex(userOp.maxFeePerGas), 16),
      ethers.zeroPadValue(ethers.toBeHex(userOp.maxPriorityFeePerGas), 16),
    ]);
    
    // Pack init code
    const initCode = userOp.factory 
      ? ethers.concat([userOp.factory, userOp.factoryData || '0x'])
      : '0x';
    
    // Pack paymaster data
    let paymasterAndData = '0x';
    if (userOp.paymaster) {
      const paymasterGasLimits = ethers.concat([
        ethers.zeroPadValue(ethers.toBeHex(userOp.paymasterVerificationGasLimit || 0n), 16),
        ethers.zeroPadValue(ethers.toBeHex(userOp.paymasterPostOpGasLimit || 0n), 16),
      ]);
      paymasterAndData = ethers.concat([
        userOp.paymaster,
        paymasterGasLimits,
        userOp.paymasterData || '0x',
      ]);
    }
    
    return {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode,
      callData: userOp.callData,
      accountGasLimits,
      preVerificationGas: userOp.preVerificationGas,
      gasFees,
      paymasterAndData,
      signature: userOp.signature,
    };
  }
  
  /**
   * Get configuration
   */
  getConfig(): AAPaymasterConfig {
    return this.config;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if an address is a smart account (has code)
 */
export async function isSmartAccount(
  provider: ethers.Provider,
  address: string
): Promise<boolean> {
  const code = await provider.getCode(address);
  return code !== '0x';
}

/**
 * Estimate total USDT cost for a deposit
 */
export async function estimateDepositCost(
  chainId: number,
  amountUSDT: number
): Promise<{
  depositAmount: string;
  estimatedGasFee: string;
  totalCost: string;
}> {
  const client = AAClient.forChain(chainId);
  if (!client) {
    throw new Error(`Chain ${chainId} not supported for AA`);
  }
  
  // Gas fee estimate (rough)
  const gasPrices = await client.getGasPrices();
  const estimatedGasUnits = 200000n; // Typical deposit gas
  const gasCostWei = estimatedGasUnits * gasPrices.maxFeePerGas;
  
  // Convert to USDT (rough estimate)
  // In reality, paymaster provides exact quote
  const gasCostUSDT = Number(gasCostWei) / 1e18 * 2000; // Assuming ETH ~ $2000
  
  return {
    depositAmount: amountUSDT.toFixed(6),
    estimatedGasFee: gasCostUSDT.toFixed(6),
    totalCost: (amountUSDT + gasCostUSDT).toFixed(6),
  };
}

export default AAClient;
