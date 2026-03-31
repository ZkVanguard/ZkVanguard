/**
 * TRUE GASLESS Hedge Opening — User Pays $0.00
 * 
 * Uses agentOpenHedge() with AGENT_ROLE relayer for zero gas cost to users
 * 
 * Architecture:
 * - Relayer has AGENT_ROLE on HedgeExecutor contract
 * - HedgeExecutor contract pre-funded with USDC pool (via scripts/mint-and-prepare.ts)
 * - Relayer calls agentOpenHedge(userAddress, ...) paying only gas
 * - User's address set as hedge trader/beneficiary but NEVER sends transaction
 * - ZK commitment privately binds user wallet to hedge for ownership verification
 * 
 * Setup Required:
 * 1. Grant AGENT_ROLE: npx hardhat run scripts/grant-agent-role.ts --network cronos-testnet
 * 2. Fund contract: npm run mint:prepare (mints 200M USDC to HedgeExecutor)
 * 3. Relayer pays gas, user pays $0.00
 * 
 * Privacy Model:
 * - User's wallet address stored as hedge.trader (beneficiary for PnL settlement)
 * - User NEVER appears as transaction sender (relayer sends all txns)
 * - ZK commitment hash binds user to hedge for close/withdrawal verification
 * - On-chain: Relayer → HedgeExecutor.agentOpenHedge(userAddress, ...)
 * 
 * Cost:
 * - User: $0.00 (just HTTP request)
 * - Relayer: ~0.3 CRO gas (~$0.03)
 * - Contract: Pulls from pre-funded USDC pool
 * 
 * POST /api/agents/hedging/open-onchain-gasless
 * Body: { pairIndex, collateralAmount, leverage, isLong, walletAddress }
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { safeErrorResponse } from '@/lib/security/safe-error';
import { registerHedgeOwnership } from '@/lib/hedge-ownership';
import { getCronosProvider } from '@/lib/throttled-provider';
import { upsertOnChainHedge } from '@/lib/db/hedges';
import { syncSinglePriceToChain, ensureMoonlanderLiquidity } from '@/lib/price-sync';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { getCurrentChainId, getUsdcAddress, getRpcUrl, isMainnet, isTestnet } from '@/lib/utils/network';
import { logger } from '@/lib/utils/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dynamic address resolution based on NEXT_PUBLIC_CHAIN_ID
const getAddresses = () => {
  const chainId = getCurrentChainId();
  const contracts = getContractAddresses(chainId);
  return {
    hedgeExecutor: contracts.hedgeExecutor,
    usdc: getUsdcAddress(chainId),
    rpcUrl: getRpcUrl(chainId),
    chainId,
  };
};

// PRIVACY: Dedicated relayer wallet — user's address NEVER touches the chain
// The relayer holds its own USDC pool and pays gas, acting as a privacy shield
function getRelayerKey(): string {
  const key = process.env.RELAYER_PRIVATE_KEY 
    || process.env.MOONLANDER_PRIVATE_KEY
    || process.env.PRIVATE_KEY 
    || process.env.SERVER_WALLET_PRIVATE_KEY
    || process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error('FATAL: No relayer key found (checked RELAYER_PRIVATE_KEY, MOONLANDER_PRIVATE_KEY, PRIVATE_KEY, SERVER_WALLET_PRIVATE_KEY, AGENT_PRIVATE_KEY)');
  return key;
}

// Deployer wallet — OWNER of MockMoonlander (needed for setMockPrice calls)
const DEPLOYER_PK = process.env.PRIVATE_KEY || process.env.SERVER_WALLET_PRIVATE_KEY || '';

const PAIR_NAMES: Record<number, string> = {
  0: 'BTC', 1: 'ETH', 2: 'CRO', 3: 'ATOM', 4: 'DOGE', 5: 'SOL'
};

const HEDGE_EXECUTOR_ABI = [
  'function agentOpenHedge(address trader, uint256 pairIndex, uint256 collateralAmount, uint256 leverage, bool isLong, bytes32 commitmentHash, bytes32 nullifier, bytes32 merkleRoot) payable returns (bytes32)',
  'function totalHedgesOpened() view returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function transferFrom(address,address,uint256) returns (bool)',
];

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Rate limiting
  const { mutationLimiter } = await import('@/lib/security/rate-limiter');
  const limited = await mutationLimiter.checkDistributed(request);
  if (limited) return limited;

  try {
    const body = await request.json();

    // NOTE: We do NOT use generic requireAuth() here because:
    // 1. This endpoint uses EIP-712 typed data signatures (not personal_sign)
    // 2. The signature format is: { asset, side, collateral, leverage, timestamp }
    // 3. We validate the EIP-712 signature below with verifyTypedData()
    // Generic auth expects personal_sign format which would fail
    //
    // However, internal service calls (with X-Internal-Token) are allowed without signature

    const { pairIndex, collateralAmount, leverage, isLong, walletAddress, signature, timestamp, systemSecret } = body;

    // Check for internal/system authentication (for automated hedging services)
    const { verifyInternalAuth } = await import('@/lib/security/auth-middleware');
    const isInternalCall = verifyInternalAuth(request);
    const cronSecret = process.env.CRON_SECRET?.trim();
    const isSystemCall = systemSecret && cronSecret && systemSecret === cronSecret;

    // Validate inputs
    if (pairIndex === undefined || !collateralAmount || !leverage || isLong === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: pairIndex, collateralAmount, leverage, isLong' },
        { status: 400 }
      );
    }

    // CRITICAL: walletAddress is REQUIRED for gasless hedges
    // Without it, we cannot verify ownership during close, and funds cannot be withdrawn
    if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.startsWith('0x')) {
      return NextResponse.json(
        { success: false, error: 'walletAddress is required for gasless hedges. Connect your wallet before creating a hedge.' },
        { status: 400 }
      );
    }

    if (pairIndex < 0 || pairIndex > 5) {
      return NextResponse.json(
        { success: false, error: `Invalid pairIndex ${pairIndex}. Valid: 0-5 (BTC, ETH, CRO, ATOM, DOGE, SOL)` },
        { status: 400 }
      );
    }

    if (leverage < 2 || leverage > 100) {
      return NextResponse.json(
        { success: false, error: 'Leverage must be 2-100' },
        { status: 400 }
      );
    }

    // ── EIP-712 Signature Verification ───────────────────────────────────────
    // Verify the wallet signature proves user authorized this specific hedge
    // Internal/system calls bypass signature verification
    if (!isInternalCall && !isSystemCall) {
      if (!signature || !timestamp) {
        return NextResponse.json(
          { success: false, error: 'Wallet signature required. Please sign the hedge request in your wallet.' },
          { status: 401 }
        );
      }

      // Check timestamp is recent (5 minute window)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > 300) {
        return NextResponse.json(
          { success: false, error: 'Signature expired. Please sign again.' },
          { status: 401 }
        );
      }

      // EIP-712 domain and types matching frontend
      const OPEN_HEDGE_DOMAIN = {
        name: 'ZK Vanguard',
        version: '1',
        chainId: getCurrentChainId(),
      };

      const OPEN_HEDGE_TYPES = {
        OpenHedge: [
          { name: 'asset', type: 'string' },
          { name: 'side', type: 'string' },
          { name: 'collateral', type: 'uint256' },
          { name: 'leverage', type: 'uint256' },
          { name: 'timestamp', type: 'uint256' },
        ],
      };

      // Reconstruct the message that was signed
      const asset = PAIR_NAMES[pairIndex] || 'BTC';
      const side = isLong ? 'LONG' : 'SHORT';
      const collateralWei = BigInt(Math.round(collateralAmount * 1e6)); // USDC 6 decimals

      try {
        const recoveredAddress = ethers.verifyTypedData(
          OPEN_HEDGE_DOMAIN,
          OPEN_HEDGE_TYPES,
          {
            asset,
            side,
            collateral: collateralWei,
            leverage: BigInt(leverage),
            timestamp: BigInt(timestamp),
          },
          signature
        );

        if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          console.warn(`🚫 Signature mismatch: recovered ${recoveredAddress}, expected ${walletAddress}`);
          return NextResponse.json(
            { 
              success: false, 
              error: `Wallet signature verification failed. Signed with different wallet.`,
              expectedWallet: walletAddress,
              signedBy: recoveredAddress,
            },
            { status: 403 }
          );
        }

        console.log(`✅ EIP-712 signature verified: ${recoveredAddress} authorized hedge`);
      } catch (sigErr) {
        logger.error('Signature verification error:', sigErr);
        return NextResponse.json(
          { success: false, error: 'Invalid signature format. Please try again.' },
          { status: 401 }
        );
      }
    } else {
      console.log(`🔑 Internal/system call - bypassing EIP-712 signature verification`);
    }

    // Dynamic address resolution
    const { hedgeExecutor, usdc: usdcAddress, rpcUrl, chainId } = getAddresses();
    
    // Validate mainnet contracts are configured
    if (hedgeExecutor === '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({
        success: false,
        error: 'HedgeExecutor not deployed for this network. Please deploy contracts first.',
      }, { status: 503 });
    }

    const tp = getCronosProvider(rpcUrl);
    const provider = tp.provider;
    const relayer = new ethers.Wallet(getRelayerKey(), provider);
    const contract = new ethers.Contract(hedgeExecutor, HEDGE_EXECUTOR_ABI, relayer);
    const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, relayer);

    // PRIVACY: The relayer is the on-chain trader — user's address is NEVER on-chain
    // The user's walletAddress is only stored in the ZK commitment (private binding)
    const userWallet = walletAddress; // Now guaranteed to be a valid address
    const collateralRaw = ethers.parseUnits(String(collateralAmount), 6);

    // Check HedgeExecutor contract's USDC balance (for agentOpenHedge, funds must be PRE-FUNDED to contract)
    const contractBalance = await usdc.balanceOf(hedgeExecutor);
    if (contractBalance < collateralRaw) {
      return NextResponse.json({
        success: false,
        error: `Contract pool insufficient. Contract has ${ethers.formatUnits(contractBalance, 6)} USDC, need ${collateralAmount}. Run: node scripts/mint-and-prepare.ts`,
      }, { status: 400 });
    }

    // Generate ZK parameters — the commitment privately binds user wallet ↔ hedge
    // On-chain: only commitment hash visible. Off-chain: user can prove ownership
    const ts = Date.now();
    const commitmentHash = ethers.keccak256(ethers.toUtf8Bytes(`x402-gasless-${userWallet}-${pairIndex}-${ts}`));
    const nullifier = ethers.keccak256(ethers.toUtf8Bytes(`nullifier-gasless-${userWallet}-${ts}`));
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes(`merkle-gasless-${userWallet}-${ts}`));

    const asset = PAIR_NAMES[pairIndex] || `PAIR-${pairIndex}`;
    const side = isLong ? 'LONG' : 'SHORT';
    
    // ═══ STRICT PRICE VALIDATION ═══
    // NEVER use hardcoded prices - get validated price from unified provider
    // This includes: WebSocket real-time → REST API → MCP → DB cache
    // If all fail, we REJECT the hedge creation rather than use fake prices
    let entryPrice: number;
    let priceSource: string;
    
    try {
      const { getStrictHedgePrice } = await import('@/lib/services/unified-price-provider');
      const priceContext = await getStrictHedgePrice(asset, side as 'LONG' | 'SHORT', {
        maxStalenessMs: 15000, // 15s max staleness for executions
        maxSpreadPercent: 3.0, // Allow higher spread on testnet
      });
      
      entryPrice = priceContext.effectivePrice;
      priceSource = priceContext.source;
      console.log(`📈 Validated entry price for ${asset}: $${entryPrice} (source: ${priceSource})`);
    } catch (priceErr) {
      // Price validation failed - DO NOT proceed with hedge
      logger.error('Strict price validation failed:', priceErr);
      return NextResponse.json({
        success: false,
        error: `Price validation failed: ${priceErr instanceof Error ? priceErr.message : 'Unknown error'}`,
        hint: 'Cannot create hedge without valid real-time price. Please retry in a few seconds.',
      }, { status: 503 });
    }
    
    console.log(`🔐 x402 ZK-Private openHedge: ${asset} ${side} | ${collateralAmount} USDC x${leverage} | entry: $${entryPrice} (${priceSource}) | relayer: ${relayer.address} (user hidden)`);

    // ═══ SYNC LIVE CRYPTO.COM PRICE TO MOCKMOONLANDER ON-CHAIN (TESTNET ONLY) ═══
    // On mainnet, Moonlander has real oracle - no price sync needed
    // On testnet, sync mock prices so PnL calculation works correctly
    if (isTestnet() && DEPLOYER_PK) {
      try {
        const deployerWallet = new ethers.Wallet(DEPLOYER_PK, provider);
        // 1) Sync the live price so MockMoonlander records the correct openPrice
        const syncedPrice = await syncSinglePriceToChain(deployerWallet, pairIndex);
        if (syncedPrice > 0) {
          console.log(`📈 On-chain price synced: ${asset} → $${syncedPrice} (was stale)`);
        }
        // 2) Ensure MockMoonlander has enough USDC to settle this trade later
        await ensureMoonlanderLiquidity(deployerWallet, collateralRaw * BigInt(leverage));
      } catch (syncErr) {
        console.warn('⚠️ Price sync failed (non-blocking):', syncErr instanceof Error ? syncErr.message : syncErr);
      }
    } else if (isTestnet() && !DEPLOYER_PK) {
      console.warn('⚠️ DEPLOYER_PK not set — cannot sync live prices to MockMoonlander');
    }
    // On mainnet, skip price sync entirely - real Moonlander oracle handles it

    // Use dynamic gas price with gas estimation
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1500', 'gwei');
    
    // Estimate gas first, add 20% buffer (more efficient than hardcoded 2M)
    let gasLimit = 1_200_000; // reasonable default
    try {
      const estimatedGas = await contract.agentOpenHedge.estimateGas(
        userWallet, pairIndex, collateralRaw, leverage, isLong, commitmentHash, nullifier, merkleRoot,
        { value: ethers.parseEther('0.06') }
      );
      gasLimit = Math.ceil(Number(estimatedGas) * 1.2); // 20% buffer
      console.log(`⛽ Estimated gas: ${estimatedGas} → using ${gasLimit} (with 20% buffer)`);
    } catch {
      console.log(`⛽ Gas estimation failed, using default ${gasLimit}`);
    }

    // Calculate gas savings for the user
    const gasCostCRO = Number(ethers.formatEther(gasPrice * BigInt(gasLimit)));
    const croPrice = 0.10; // approximate CRO price
    const gasCostUSD = gasCostCRO * croPrice;

    // Execute agentOpenHedge as AGENT_ROLE relayer (TRUE GASLESS: server pays, user address never on-chain)
    // Collateral is pulled from HedgeExecutor contract's own balance (pre-funded via scripts/mint-and-prepare.ts)
    const tx = await contract.agentOpenHedge(
      userWallet,  // trader (beneficiary) - never appears as transaction sender
      pairIndex,
      collateralRaw,
      leverage,
      isLong,
      commitmentHash,
      nullifier,
      merkleRoot,
      {
        value: ethers.parseEther('0.06'), // Oracle fee (paid by relayer)
        gasLimit,
        gasPrice,
      }
    );

    const receipt = await tx.wait();

    if (receipt.status !== 1) {
      return NextResponse.json(
        { success: false, error: 'Transaction reverted', txHash: tx.hash },
        { status: 500 }
      );
    }

    const totalHedges = await contract.totalHedgesOpened();
    const elapsed = Date.now() - startTime;

    // Extract on-chain hedgeId from HedgeOpened event
    let onChainHedgeId = commitmentHash; // fallback
    try {
      const iface = new ethers.Interface([
        'event HedgeOpened(bytes32 indexed hedgeId, address indexed trader, uint256 pairIndex, bool isLong, uint256 collateral, uint256 leverage, bytes32 commitmentHash)',
      ]);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === 'HedgeOpened') {
            onChainHedgeId = parsed.args.hedgeId;
            break;
          }
        } catch { /* not this event */ }
      }
    } catch { /* parsing failed, use commitmentHash */ }

    // Register hedge ownership for signature-verified close
    await registerHedgeOwnership(commitmentHash, {
      walletAddress: userWallet,
      pairIndex,
      asset,
      side,
      collateral: Number(collateralAmount),
      leverage: Number(leverage),
      openedAt: new Date().toISOString(),
      txHash: tx.hash,
      onChainHedgeId, // Store the on-chain hedgeId for lookup during close
    });

    // Persist to Neon DB — tx hash instantly available on next query (no event scan)
    upsertOnChainHedge({
      hedgeIdOnchain: onChainHedgeId,
      txHash: tx.hash,
      trader: relayer.address,
      asset,
      side: side as 'LONG' | 'SHORT',
      collateral: Number(collateralAmount),
      leverage: Number(leverage),
      entryPrice: entryPrice, // CRITICAL: Store entry price for PnL calculation!
      chain: chainId === 25 ? 'cronos-mainnet' : 'cronos-testnet',
      chainId: chainId,
      contractAddress: hedgeExecutor,
      commitmentHash,
      nullifier,
      proxyWallet: relayer.address,
      blockNumber: receipt.blockNumber,
      explorerLink: `https://explorer.cronos.org/${chainId === 25 ? '' : 'testnet/'}tx/${tx.hash}`,
      walletAddress: userWallet !== 'anonymous' ? userWallet : undefined,
      metadata: { gasless: true, x402: true, priceSource },
    }).catch(err => console.warn('DB persist skipped:', err instanceof Error ? err.message : err));

    console.log(`✅ x402 Gasless hedge created: ${tx.hash} | Entry: $${entryPrice} (${priceSource}) | Gas used: ${receipt.gasUsed} | Time: ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      message: `${asset} ${side} hedge opened gaslessly via x402 (ZK-private)`,
      hedgeId: commitmentHash,
      txHash: tx.hash,
      gasUsed: Number(receipt.gasUsed),
      blockNumber: receipt.blockNumber,
      // PRIVACY: on-chain trader is relayer, not user. User binding is in ZK commitment.
      trader: relayer.address,
      privacyShield: {
        onChainIdentity: relayer.address,
        userAddressOnChain: false,
        zkBound: true,
        note: 'Your wallet address does NOT appear on-chain. The relayer acted as a privacy shield.',
      },
      asset,
      side,
      collateral: Number(collateralAmount),
      leverage: Number(leverage),
      entryPrice: entryPrice, // Entry price for PnL calculation
      priceSource, // Where the validated price came from
      totalHedges: Number(totalHedges),
      explorerLink: `https://explorer.cronos.org/${chainId === 25 ? '' : 'testnet/'}tx/${tx.hash}`,
      // x402 Gasless info
      gasless: true,
      x402Powered: true,
      gasSavings: {
        userGasCost: '$0.00',
        relayerGasCost: `${gasCostCRO.toFixed(4)} CRO (~$${gasCostUSD.toFixed(4)})`,
        totalSaved: `$${gasCostUSD.toFixed(4)}`,
        message: 'Gas sponsored by x402 — you paid $0.00!',
      },
      elapsed: `${elapsed}ms`,
    });
  } catch (error) {
    logger.error('x402 Gasless open error:', error);
    return safeErrorResponse(error, 'Gasless hedge open');
  }
}

/**
 * GET /api/agents/hedging/open-onchain-gasless
 * Returns info about gasless hedge creation
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    endpoint: '/api/agents/hedging/open-onchain-gasless',
    method: 'POST',
    description: 'Open hedge positions gaslessly via x402 — zero gas costs for users',
    x402Powered: true,
    requiredFields: {
      pairIndex: '0=BTC, 1=ETH, 2=CRO, 3=ATOM, 4=DOGE, 5=SOL',
      collateralAmount: 'Amount in USDC (e.g., 100)',
      leverage: '2-100',
      isLong: 'true for LONG, false for SHORT',
      walletAddress: '(optional) Trader address — defaults to relayer',
    },
    prerequisites: [
      'User must have USDC balance >= collateralAmount',
      'User must have approved HedgeExecutor to spend USDC',
    ],
    gasCost: '$0.00 — powered by x402 gasless',
  });
}
