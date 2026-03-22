/**
 * Community Pool USDT Deposit API (AA/Gasless)
 * 
 * Enables gasless USDT deposits to the community pool using
 * ERC-4337 Account Abstraction with Pimlico/Candide paymasters.
 * 
 * Endpoints:
 * - GET  /api/community-pool/deposit-usdt - Get deposit quote
 * - POST /api/community-pool/deposit-usdt - Create deposit UserOp
 * - POST /api/community-pool/deposit-usdt?action=submit - Submit signed UserOp
 * 
 * Flow:
 * 1. Client calls GET to get deposit quote (gas estimate in USDT)
 * 2. Client calls POST to create unsigned UserOp
 * 3. Client signs the UserOp with their wallet
 * 4. Client calls POST with action=submit to submit signed UserOp
 * 5. Server returns txHash when confirmed on-chain
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { AAClient, estimateDepositCost, isSmartAccount } from '@/lib/services/aa-client';
import {
  getAAConfig,
  isAASupported,
  getSupportedAAChains,
  formatUSDT,
  parseUSDT,
  shouldUseX402,
  type PaymasterProvider,
} from '@/lib/config/aa-paymaster';
import { mutationLimiter, readLimiter, createRateLimiter } from '@/lib/security/rate-limiter';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Default chain is Sepolia for testing
const DEFAULT_CHAIN_ID = 11155111;

// Rate limiter for gas funding: 3 requests per address per hour
const fundGasLimiter = createRateLimiter({ maxRequests: 3, windowMs: 60 * 60 * 1000 });

// Max ETH to send for gas funding (testnet only)
const GAS_FUND_AMOUNT = ethers.parseEther('0.005');

// RPC URLs per chain for gas funding (direct URLs, not proxied)
const CHAIN_RPC_URLS: Record<number, string> = {
  11155111: 'https://rpc.sepolia.org',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
};

// Community pool addresses per chain
const COMMUNITY_POOL_ADDRESSES: Record<number, string> = {
  11155111: '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086', // Sepolia
  25: '0x2fBD41568d63B0D31c4FFc074c9a2e0c71AE5F29', // Cronos EVM mainnet (use x402)
  338: '0x15b8922e74f8A5e3Ad428483Eb08B76Ba6a21f60', // Cronos EVM testnet (use x402)
  388: '0x...', // Cronos zkEVM mainnet - TODO: Deploy
  282: '0x...', // Cronos zkEVM testnet - TODO: Deploy
  421614: '0xfd6B402b860aD57f1393E2b60E1D676b57e0E63B', // Arbitrum Sepolia
  42161: '0x...', // Arbitrum One - TODO: Deploy
};

/**
 * GET - Get deposit quote and supported chains
 */
export async function GET(request: NextRequest) {
  // Rate limit
  const limited = readLimiter.check(request);
  if (limited) return limited;
  
  const searchParams = request.nextUrl.searchParams;
  const chainId = parseInt(searchParams.get('chainId') || String(DEFAULT_CHAIN_ID));
  const amount = parseFloat(searchParams.get('amount') || '100');
  const provider = (searchParams.get('provider') || 'pimlico') as PaymasterProvider;
  
  try {
    // Check if this chain should use x402 instead of AA
    if (shouldUseX402(chainId)) {
      return NextResponse.json({
        success: false,
        error: `Chain ${chainId} doesn't support ERC-4337 bundlers`,
        useX402: true,
        x402Endpoint: '/api/x402/deposit',
        hint: 'Cronos EVM uses x402 protocol for gasless USDT deposits. Use the x402 endpoint instead.',
        supportedAAChains: getSupportedAAChains().filter(id => !shouldUseX402(id)),
      }, { status: 400 });
    }
    
    // Check if chain is supported
    if (!isAASupported(chainId)) {
      return NextResponse.json({
        success: false,
        error: `Chain ${chainId} not supported for AA deposits`,
        supportedChains: getSupportedAAChains(),
      }, { status: 400 });
    }
    
    // Get configuration
    const config = getAAConfig(chainId, provider);
    if (!config) {
      return NextResponse.json({
        success: false,
        error: 'Failed to get AA configuration',
      }, { status: 500 });
    }
    
    // Check if bundler URL is empty (fallback chain)
    if (!config.bundlerUrl) {
      return NextResponse.json({
        success: false,
        error: `Chain ${config.chainName} doesn't have bundler support`,
        useX402: true,
        x402Endpoint: '/api/x402/deposit',
        hint: 'Use x402 protocol for this chain',
      }, { status: 400 });
    }
    // Estimate deposit cost
    const costEstimate = await estimateDepositCost(chainId, amount);
    
    return NextResponse.json({
      success: true,
      quote: {
        chainId,
        chainName: config.chainName,
        provider,
        depositAmount: costEstimate.depositAmount,
        estimatedGasFee: costEstimate.estimatedGasFee,
        totalCost: costEstimate.totalCost,
        token: {
          symbol: config.paymasterToken.symbol,
          address: config.paymasterToken.address,
          decimals: config.paymasterToken.decimals,
        },
        maxFee: formatUSDT(config.transferMaxFee),
        entryPoint: config.entryPointAddress,
        paymaster: config.paymasterAddress,
      },
      supportedChains: getSupportedAAChains().map(id => {
        const cfg = getAAConfig(id, provider);
        return {
          chainId: id,
          chainName: cfg?.chainName,
          isTestnet: cfg?.isTestnet,
        };
      }),
    });
    
  } catch (error) {
    return safeErrorResponse(error, 'deposit-usdt GET');
  }
}

/**
 * POST - Create or submit USDT deposit UserOp
 */
export async function POST(request: NextRequest) {
  // Rate limit
  const limited = mutationLimiter.check(request);
  if (limited) return limited;
  
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  
  try {
    const body = await request.json();
    
    // Extract common params
    const {
      chainId = DEFAULT_CHAIN_ID,
      provider = 'pimlico',
      walletAddress,
      smartAccountAddress,
      amount,
      factory,
      factoryData,
    } = body;
    
    // Validate chain support
    if (!isAASupported(chainId)) {
      return NextResponse.json({
        success: false,
        error: `Chain ${chainId} not supported for AA deposits`,
        supportedChains: getSupportedAAChains(),
      }, { status: 400 });
    }
    
    // Create AA client
    const client = AAClient.forChain(chainId, provider);
    if (!client) {
      return NextResponse.json({
        success: false,
        error: 'Failed to create AA client',
      }, { status: 500 });
    }
    
    // Get community pool address
    const communityPoolAddress = COMMUNITY_POOL_ADDRESSES[chainId];
    if (!communityPoolAddress || communityPoolAddress === '0x...') {
      return NextResponse.json({
        success: false,
        error: `Community pool not deployed on chain ${chainId}`,
        hint: 'Use Cronos testnet (chainId: 338) for testing',
      }, { status: 400 });
    }
    
    switch (action) {
      case 'submit': {
        /**
         * Submit a signed UserOperation
         */
        const { userOp, signature } = body;
        
        if (!userOp || !signature) {
          return NextResponse.json({
            success: false,
            error: 'userOp and signature required',
          }, { status: 400 });
        }
        
        // Add signature to UserOp
        const signedUserOp = {
          ...userOp,
          signature,
          nonce: BigInt(userOp.nonce),
          callGasLimit: BigInt(userOp.callGasLimit),
          verificationGasLimit: BigInt(userOp.verificationGasLimit),
          preVerificationGas: BigInt(userOp.preVerificationGas),
          maxFeePerGas: BigInt(userOp.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(userOp.maxPriorityFeePerGas),
          paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit
            ? BigInt(userOp.paymasterVerificationGasLimit)
            : undefined,
          paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit
            ? BigInt(userOp.paymasterPostOpGasLimit)
            : undefined,
        };
        
        // Submit to bundler
        logger.info('[DepositUSDT] Submitting signed UserOp', {
          sender: signedUserOp.sender,
          chainId,
        });
        
        const userOpHash = await client.submitUserOp(signedUserOp);
        
        // Wait for confirmation (with timeout)
        const result = await client.waitForUserOp(userOpHash, 120000); // 2 min timeout
        
        logger.info('[DepositUSDT] UserOp completed', {
          success: result.success,
          txHash: result.txHash,
          gasCost: result.gasCost.toString(),
        });
        
        return NextResponse.json({
          success: result.success,
          txHash: result.txHash,
          userOpHash,
          gasCostUSDT: formatUSDT(result.gasCost),
          message: result.success
            ? `Successfully deposited USDT to community pool`
            : 'Deposit transaction failed',
        });
      }
      
      case 'check-balance': {
        /**
         * Check USDT balance and allowance
         */
        const accountAddress = smartAccountAddress || walletAddress;
        if (!accountAddress) {
          return NextResponse.json({
            success: false,
            error: 'walletAddress or smartAccountAddress required',
          }, { status: 400 });
        }
        
        const balance = await client.getUSDTBalance(accountAddress);
        const allowance = await client.getUSDTAllowance(accountAddress);
        const config = client.getConfig();
        
        return NextResponse.json({
          success: true,
          balance: formatUSDT(balance),
          allowance: formatUSDT(allowance),
          token: {
            symbol: config.paymasterToken.symbol,
            address: config.paymasterToken.address,
          },
          hasEnoughForDeposit: amount ? balance >= parseUSDT(amount) : undefined,
        });
      }

      case 'fund-gas': {
        /**
         * Fund a WDK wallet with a small amount of ETH for gas.
         * This enables EOA wallets (that hold USDT but no ETH) to execute
         * deposit transactions. Testnet only.
         */
        const limited = fundGasLimiter.check(request);
        if (limited) return limited;

        const targetAddress = walletAddress || smartAccountAddress;
        if (!targetAddress || !ethers.isAddress(targetAddress)) {
          return NextResponse.json({
            success: false,
            error: 'Valid walletAddress required',
          }, { status: 400 });
        }

        // Only allow on testnets
        const allowedTestnets = [11155111, 421614]; // Sepolia, Arbitrum Sepolia
        if (!allowedTestnets.includes(chainId)) {
          return NextResponse.json({
            success: false,
            error: 'Gas funding is only available on testnets',
          }, { status: 400 });
        }

        const serverPrivateKey = process.env.PRIVATE_KEY || process.env.SERVER_PRIVATE_KEY;
        if (!serverPrivateKey) {
          return NextResponse.json({
            success: false,
            error: 'Server wallet not configured',
          }, { status: 500 });
        }

        const rpcUrl = CHAIN_RPC_URLS[chainId];
        if (!rpcUrl) {
          return NextResponse.json({
            success: false,
            error: `No RPC configured for chain ${chainId}`,
          }, { status: 400 });
        }

        try {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const serverWallet = new ethers.Wallet(serverPrivateKey, provider);

          // Check if the target already has enough ETH for gas
          const targetBalance = await provider.getBalance(targetAddress);
          const minGasNeeded = ethers.parseEther('0.001');
          if (targetBalance >= minGasNeeded) {
            return NextResponse.json({
              success: true,
              message: 'Wallet already has sufficient ETH for gas',
              balance: ethers.formatEther(targetBalance),
              funded: false,
            });
          }

          // Check server wallet balance
          const serverBalance = await serverWallet.provider!.getBalance(serverWallet.address);
          if (serverBalance < GAS_FUND_AMOUNT + ethers.parseEther('0.001')) {
            logger.error('[FundGas] Server wallet insufficient balance', {
              serverAddress: serverWallet.address,
              balance: ethers.formatEther(serverBalance),
            });
            return NextResponse.json({
              success: false,
              error: 'Gas funding temporarily unavailable',
            }, { status: 503 });
          }

          // Send the funding transaction
          logger.info('[FundGas] Sending gas funding', {
            to: targetAddress,
            amount: ethers.formatEther(GAS_FUND_AMOUNT),
            chainId,
          });

          const tx = await serverWallet.sendTransaction({
            to: targetAddress,
            value: GAS_FUND_AMOUNT,
          });

          // Wait for confirmation
          const receipt = await tx.wait(1);

          logger.info('[FundGas] Gas funding confirmed', {
            txHash: receipt?.hash,
            to: targetAddress,
          });

          return NextResponse.json({
            success: true,
            funded: true,
            txHash: receipt?.hash,
            amount: ethers.formatEther(GAS_FUND_AMOUNT),
            message: `Funded ${ethers.formatEther(GAS_FUND_AMOUNT)} ETH for gas`,
          });

        } catch (fundError: any) {
          logger.error('[FundGas] Failed to fund gas', { error: fundError.message });
          return NextResponse.json({
            success: false,
            error: 'Failed to send gas funding',
          }, { status: 500 });
        }
      }

      case 'update-prices': {
        /**
         * Update Pyth oracle prices before a deposit.
         * Fetches latest price data from Pyth Hermes API and pushes on-chain.
         * Uses the server wallet to pay the update fee.
         */
        const serverPrivateKey = process.env.PRIVATE_KEY || process.env.SERVER_PRIVATE_KEY;
        if (!serverPrivateKey) {
          return NextResponse.json({
            success: false,
            error: 'Server wallet not configured',
          }, { status: 500 });
        }

        const rpcUrl = CHAIN_RPC_URLS[chainId];
        if (!rpcUrl) {
          return NextResponse.json({
            success: false,
            error: `No RPC configured for chain ${chainId}`,
          }, { status: 400 });
        }

        // Pyth oracle addresses per chain
        const PYTH_ORACLE_ADDRESSES: Record<number, string> = {
          11155111: '0xDd24F84d36BF92C65F92307595335bdFab5Bbd21', // Sepolia
          421614: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C', // Arbitrum Sepolia
        };

        const pythAddress = PYTH_ORACLE_ADDRESSES[chainId];
        if (!pythAddress) {
          // No Pyth oracle on this chain — skip silently
          return NextResponse.json({ success: true, skipped: true, reason: 'No Pyth oracle on this chain' });
        }

        // Price IDs for BTC, ETH, SUI, CRO (must match contract asset config)
        const PYTH_PRICE_IDS = [
          'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
          'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
          '23199c2bcb1303f667e733b9934db9eca5991e765b45f5ed18bc4b231415f2fe',
          '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
        ];

        try {
          // Fetch latest VAA from Pyth Hermes
          const hermesUrl = 'https://hermes.pyth.network/v2/updates/price/latest?ids[]=' + PYTH_PRICE_IDS.join('&ids[]=');
          const hermesResp = await fetch(hermesUrl);
          if (!hermesResp.ok) {
            throw new Error(`Hermes API returned ${hermesResp.status}`);
          }
          const hermesData = await hermesResp.json();

          if (!hermesData?.binary?.data?.length) {
            throw new Error('No price update data from Hermes');
          }

          const updateData = hermesData.binary.data.map((d: string) => '0x' + d);

          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const serverWallet = new ethers.Wallet(serverPrivateKey, provider);

          const pythAbi = [
            'function updatePriceFeeds(bytes[] calldata updateData) external payable',
            'function getUpdateFee(bytes[] calldata updateData) view returns (uint256)',
          ];
          const pyth = new ethers.Contract(pythAddress, pythAbi, serverWallet);

          const fee = await pyth.getUpdateFee(updateData);
          const tx = await pyth.updatePriceFeeds(updateData, { value: fee });
          const receipt = await tx.wait(1);

          logger.info('[UpdatePrices] Pyth prices updated', { txHash: receipt?.hash, chainId });

          return NextResponse.json({
            success: true,
            txHash: receipt?.hash,
            message: 'Oracle prices updated',
          });
        } catch (priceError: any) {
          logger.error('[UpdatePrices] Failed to update prices', { error: priceError.message });
          // Non-fatal: prices might still be fresh enough
          return NextResponse.json({
            success: false,
            error: 'Price update failed, deposit may still succeed if prices are recent',
            details: priceError.message,
          }, { status: 200 }); // 200 so frontend doesn't block
        }
      }
      
      default: {
        /**
         * Create unsigned UserOperation for deposit
         */
        if (!smartAccountAddress) {
          return NextResponse.json({
            success: false,
            error: 'smartAccountAddress required',
            hint: 'For EOA wallets, first deploy a Safe smart account',
          }, { status: 400 });
        }
        
        if (!amount || amount <= 0) {
          return NextResponse.json({
            success: false,
            error: 'Valid amount required (in USDT)',
          }, { status: 400 });
        }
        
        // Check if it's actually a smart account
        const config = client.getConfig();
        const provider = new ethers.JsonRpcProvider(config.provider);
        const isSmart = await isSmartAccount(provider, smartAccountAddress);
        
        // If not deployed, we need factory params to deploy it
        if (!isSmart && !factory) {
          return NextResponse.json({
            success: false,
            error: 'Address is not a deployed smart account',
            hint: 'Provide factory and factoryData to deploy a counteracttual account',
          }, { status: 400 });
        }
        
        // Check USDT balance
        const balance = await client.getUSDTBalance(smartAccountAddress);
        const amountWei = parseUSDT(amount);
        
        // If deploying a new account, we might be funding it in this text (not implemented)
        // Or users are expected to fund the counterfactual address first.
        // We throw if balance is insufficient
        if (balance < amountWei) {
          // If it's a new deployment, check if walletAddress (EOA) has funds and warn user
          if (factory && walletAddress) {
             const eoaBalance = await client.getUSDTBalance(walletAddress);
             if (eoaBalance >= amountWei) {
                 return NextResponse.json({
                    success: false,
                    error: 'Insufficient USDT balance on Safe',
                    hint: `You must transfer USDT to your Safe address (${smartAccountAddress}) first. Your EOA has ${formatUSDT(eoaBalance)} USDT but cannot use it directly for AA gasless deposit.`,
                    safeAddress: smartAccountAddress,
                    eoaBalance: formatUSDT(eoaBalance)
                 }, { status: 400 });
             }
          }

          return NextResponse.json({
            success: false,
            error: 'Insufficient USDT balance',
            balance: formatUSDT(balance),
            required: amount.toString(),
            safeAddress: smartAccountAddress 
          }, { status: 400 });
        }
        
        // Create UserOp
        logger.info('[DepositUSDT] Creating deposit UserOp', {
          smartAccount: smartAccountAddress,
          amount,
          chainId,
        });
        
        const { userOp, estimatedGas, paymasterQuote } = await client.createDepositUserOp({
          smartAccountAddress,
          communityPoolAddress,
          amountUSDT: amountWei,
          factory,
          factoryData,
        });
        
        // Calculate UserOp hash for signing
        const entryPoint = new ethers.Contract(
          config.entryPointAddress,
          [
            'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)'
          ],
          provider
        );

        // Pack UserOp for v0.7 EntryPoint
        const accountGasLimits = ethers.concat([
          ethers.zeroPadValue(ethers.toBeHex(userOp.verificationGasLimit || 0n), 16),
          ethers.zeroPadValue(ethers.toBeHex(userOp.callGasLimit || 0n), 16),
        ]);
        
        const gasFees = ethers.concat([
          ethers.zeroPadValue(ethers.toBeHex(userOp.maxPriorityFeePerGas || 0n), 16),
          ethers.zeroPadValue(ethers.toBeHex(userOp.maxFeePerGas || 0n), 16),
        ]);

        let paymasterAndData = '0x';
        if (userOp.paymaster) {
             paymasterAndData = ethers.concat([
                userOp.paymaster,
                ethers.zeroPadValue(ethers.toBeHex(userOp.paymasterVerificationGasLimit || 0n), 16),
                ethers.zeroPadValue(ethers.toBeHex(userOp.paymasterPostOpGasLimit || 0n), 16),
                userOp.paymasterData || '0x'
             ]);
        }
        
        let initCode = '0x';
        if (userOp.factory) {
            initCode = ethers.concat([userOp.factory, userOp.factoryData || '0x']);
        }
        
        const packedUserOp = {
            sender: userOp.sender,
            nonce: userOp.nonce,
            initCode: initCode,
            callData: userOp.callData,
            accountGasLimits: accountGasLimits,
            preVerificationGas: userOp.preVerificationGas,
            gasFees: gasFees,
            paymasterAndData: paymasterAndData,
            signature: userOp.signature || '0x',
        };

        const userOpHash = await entryPoint.getUserOpHash(packedUserOp);
        
        // Serialize UserOp for client
        const serializedUserOp = {
          sender: userOp.sender,
          nonce: userOp.nonce?.toString(),
          factory: userOp.factory,
          factoryData: userOp.factoryData,
          callData: userOp.callData,
          callGasLimit: userOp.callGasLimit?.toString(),
          verificationGasLimit: userOp.verificationGasLimit?.toString(),
          preVerificationGas: userOp.preVerificationGas?.toString(),
          maxFeePerGas: userOp.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: userOp.maxPriorityFeePerGas?.toString(),
          paymaster: userOp.paymaster,
          paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit?.toString(),
          paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit?.toString(),
          paymasterData: userOp.paymasterData,
        };
        
        return NextResponse.json({
          success: true,
          userOp: serializedUserOp,
          userOpHash: userOpHash,
          gas: {
            preVerificationGas: estimatedGas.preVerificationGas.toString(),
            verificationGasLimit: estimatedGas.verificationGasLimit.toString(),
            callGasLimit: estimatedGas.callGasLimit.toString(),
          },
          paymaster: {
            address: paymasterQuote.paymaster,
            tokenCost: formatUSDT(paymasterQuote.tokenCost),
            tokenSymbol: paymasterQuote.tokenSymbol,
          },
          instructions: {
            step1: 'Sign the userOpHash with your smart account',
            step2: 'POST to this endpoint with action=submit, userOp, and signature',
          },
          chainId,
          communityPoolAddress,
        });
      }
    }
    
  } catch (error) {
    return safeErrorResponse(error, 'deposit-usdt POST');
  }
}
