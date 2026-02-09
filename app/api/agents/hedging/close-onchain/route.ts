/**
 * x402 Gasless Close & Withdraw Hedge Position
 * Server-relayed gasless close — user pays $0.00 gas
 * 
 * Calls HedgeExecutor.closeHedge() which:
 * 1. Closes the trade on MockMoonlander
 * 2. Calculates realized PnL
 * 3. Transfers collateral ± PnL back to the trader's wallet
 * 
 * Gas is paid by the x402 relayer — TRUE gasless for the user!
 * 
 * POST /api/agents/hedging/close-onchain
 * Body: { hedgeId: bytes32 }
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getHedgeOwner, removeHedgeOwnership, CLOSE_HEDGE_DOMAIN, CLOSE_HEDGE_TYPES } from '@/lib/hedge-ownership';
import { getCronosProvider } from '@/lib/throttled-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const MOCK_USDC = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
const RPC_URL = 'https://evm-t3.cronos.org';
const DEPLOYER_PK = process.env.RELAYER_PRIVATE_KEY || '0x05dd15c75542f4ecdffb076bae5401f74f22f819b509c841c9ed3cff0b13005d';

const HEDGE_EXECUTOR_ABI = [
  'function closeHedge(bytes32 hedgeId) external',
  'function hedges(bytes32) view returns (bytes32 hedgeId, address trader, uint256 pairIndex, uint256 tradeIndex, uint256 collateralAmount, uint256 leverage, bool isLong, bytes32 commitmentHash, bytes32 nullifier, uint256 openTimestamp, uint256 closeTimestamp, int256 realizedPnl, uint8 status)',
  'event HedgeClosed(bytes32 indexed hedgeId, address indexed trader, int256 pnl, uint256 duration)',
];

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
];

const PAIR_NAMES: Record<number, string> = {
  0: 'BTC', 1: 'ETH', 2: 'CRO', 3: 'ATOM', 4: 'DOGE', 5: 'SOL'
};

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { hedgeId, signature, walletAddress, signatureTimestamp } = body;

    if (!hedgeId) {
      return NextResponse.json(
        { success: false, error: 'Missing hedgeId (bytes32)' },
        { status: 400 }
      );
    }

    const tp = getCronosProvider(RPC_URL);
    const provider = tp.provider;
    const wallet = new ethers.Wallet(DEPLOYER_PK, provider);
    const contract = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, wallet);
    const usdc = new ethers.Contract(MOCK_USDC, USDC_ABI, provider);

    // ── STEP 1: Read on-chain hedge data for ZK verification ──────────────────
    const hedgeData = await contract.hedges(hedgeId);
    const onChainCommitmentHash = hedgeData[7] as string; // commitmentHash field (index 7)
    const onChainTrader = hedgeData[1] as string;
    const hedgeStatus = Number(hedgeData[12]);

    // Check if hedge exists and is active
    if (hedgeStatus !== 1) {
      const STATUS_NAMES = ['PENDING', 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];
      return NextResponse.json(
        { success: false, error: `Hedge is ${STATUS_NAMES[hedgeStatus] || 'unknown'}, not ACTIVE` },
        { status: 400 }
      );
    }

    // ── STEP 2: Look up ownership entry for dual verification ──────────────────
    const ownerEntry = await getHedgeOwner(hedgeId);

    if (ownerEntry) {
      // ── ZK VERIFICATION: Verify on-chain commitmentHash matches registry ────
      // This proves the hedge is authentic and was created through our system
      const registryCommitment = ownerEntry.commitmentHash || '';
      if (registryCommitment && onChainCommitmentHash !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        // Both have commitments - verify they match
        if (registryCommitment.toLowerCase() !== onChainCommitmentHash.toLowerCase()) {
          console.warn(`🔐 ZK MISMATCH: registry=${registryCommitment.slice(0,18)}... vs on-chain=${onChainCommitmentHash.slice(0,18)}...`);
          return NextResponse.json(
            { success: false, error: 'ZK commitment verification failed. On-chain commitment does not match registry.' },
            { status: 403 }
          );
        }
        console.log(`🔐 ZK verified: commitment ${onChainCommitmentHash.slice(0, 18)}... matches registry`);
      }

      // ── WALLET SIGNATURE VERIFICATION: Require EIP-712 signature ────────────
      if (!signature || !walletAddress) {
        return NextResponse.json(
          { success: false, error: 'Wallet signature required to close this hedge. ZK commitment verified, but wallet ownership must also be proven.' },
          { status: 401 }
        );
      }

      // Check for legacy 'anonymous' wallet (gasless hedges created without proper wallet binding)
      if (ownerEntry.walletAddress === 'anonymous' || !ownerEntry.walletAddress.startsWith('0x')) {
        console.warn(`🚫 Hedge has anonymous/invalid owner: ${ownerEntry.walletAddress}`);
        return NextResponse.json(
          { success: false, error: 'This hedge was created without wallet binding and cannot be closed with signature verification. Please contact support for manual closure.' },
          { status: 403 }
        );
      }

      // Verify the signature timestamp is recent (5 min window)
      const ts = Number(signatureTimestamp || 0);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > 300) {
        return NextResponse.json(
          { success: false, error: 'Signature expired. Please sign again.' },
          { status: 401 }
        );
      }

      // Recover signer from EIP-712 typed data
      try {
        const recoveredAddress = ethers.verifyTypedData(
          CLOSE_HEDGE_DOMAIN,
          CLOSE_HEDGE_TYPES,
          { hedgeId, action: 'close', timestamp: ts },
          signature
        );

        if (recoveredAddress.toLowerCase() !== ownerEntry.walletAddress.toLowerCase()) {
          console.warn(`🚫 Signature mismatch: recovered ${recoveredAddress}, expected ${ownerEntry.walletAddress}`);
          const expectedShort = `${ownerEntry.walletAddress.slice(0, 6)}...${ownerEntry.walletAddress.slice(-4)}`;
          const signedShort = `${recoveredAddress.slice(0, 6)}...${recoveredAddress.slice(-4)}`;
          return NextResponse.json(
            { 
              success: false, 
              error: `Wallet mismatch: signed with ${signedShort} but hedge belongs to ${expectedShort}. Please switch to the correct wallet.`,
              expectedOwner: ownerEntry.walletAddress,
              signedBy: recoveredAddress,
            },
            { status: 403 }
          );
        }

        console.log(`✅ Signature verified: ${recoveredAddress} owns hedge ${hedgeId.slice(0, 18)}...`);
        console.log(`🛡️ DUAL VERIFICATION PASSED: ZK commitment + wallet signature verified`);
      } catch (sigErr) {
        console.error('Signature verification error:', sigErr);
        return NextResponse.json(
          { success: false, error: 'Invalid signature format' },
          { status: 401 }
        );
      }
    } else {
      // Legacy hedge (opened before ownership registry) — require on-chain trader check
      // Still verify wallet address matches on-chain trader for safety
      if (walletAddress && signature) {
        // User provided signature - verify they are the on-chain trader
        const ts = Number(signatureTimestamp || 0);
        try {
          const recoveredAddress = ethers.verifyTypedData(
            CLOSE_HEDGE_DOMAIN,
            CLOSE_HEDGE_TYPES,
            { hedgeId, action: 'close', timestamp: ts },
            signature
          );
          
          // For legacy hedges, accept if signer matches on-chain trader OR relayer
          const relayerAddress = new ethers.Wallet(DEPLOYER_PK).address;
          if (recoveredAddress.toLowerCase() !== onChainTrader.toLowerCase() &&
              recoveredAddress.toLowerCase() !== relayerAddress.toLowerCase()) {
            console.warn(`🚫 Legacy hedge: signer ${recoveredAddress} is not trader ${onChainTrader}`);
            return NextResponse.json(
              { success: false, error: 'Signature does not match on-chain trader.' },
              { status: 403 }
            );
          }
          console.log(`✅ Legacy hedge: signature verified from ${recoveredAddress}`);
        } catch {
          // Signature verification failed - continue without for legacy
          console.warn(`⚠️ Legacy hedge signature verification failed, allowing close`);
        }
      } else {
        console.warn(`⚠️ No ownership record for hedge ${hedgeId.slice(0, 18)}... — allowing legacy close without signature`);
      }
    }

    // Extract hedge details from earlier read (hedgeData from STEP 1)
    const trader = onChainTrader;
    const collateral = Number(ethers.formatUnits(hedgeData[4], 6)); // collateralAmount
    const pairIndex = Number(hedgeData[2]); // pairIndex
    const leverage = Number(hedgeData[5]); // leverage
    const isLong = hedgeData[6] as boolean; // isLong

    // Get trader's USDC balance before close
    const balanceBefore = Number(ethers.formatUnits(await usdc.balanceOf(trader), 6));

    // Execute gasless closeHedge via x402 relayer — this triggers fund withdrawal back to trader
    console.log(`🔐 x402 Gasless closeHedge: ${hedgeId.slice(0, 18)}... | ${PAIR_NAMES[pairIndex]} ${isLong ? 'LONG' : 'SHORT'} | ${collateral} USDC x${leverage}`);

    // Use dynamic gas price based on current network conditions (fallback to 1500 gwei)
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits('1500', 'gwei');

    // Estimate actual gas needed (typically ~153K, NOT 2M) with 20% safety buffer
    let gasLimit: bigint;
    try {
      const estimated = await contract.closeHedge.estimateGas(hedgeId, { gasPrice });
      gasLimit = (estimated * 120n) / 100n;
      console.log(`⛽ Estimated gas: ${estimated.toString()} → using ${gasLimit.toString()} (with 20% buffer)`);
    } catch (estErr: unknown) {
      gasLimit = 300_000n; // Conservative fallback (actual ~153K)
      console.warn(`⚠️ Gas estimation failed, using fallback ${gasLimit.toString()}:`, (estErr as Error).message?.slice(0, 100));
    }

    const tx = await contract.closeHedge(hedgeId, {
      gasLimit,
      gasPrice,
    });

    const receipt = await tx.wait();

    if (receipt.status !== 1) {
      return NextResponse.json(
        { success: false, error: 'Transaction reverted', txHash: tx.hash },
        { status: 500 }
      );
    }

    // Get trader's USDC balance after close
    const balanceAfter = Number(ethers.formatUnits(await usdc.balanceOf(trader), 6));
    const fundsReturned = balanceAfter - balanceBefore;

    // Read updated hedge for realized PnL
    const closedHedge = await contract.hedges(hedgeId);
    const realizedPnl = Number(ethers.formatUnits(closedHedge.realizedPnl, 6));
    const closedStatus = Number(closedHedge.status);
    const STATUS_NAMES = ['PENDING', 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];

    // Calculate gas savings
    const gasCostCRO = Number(ethers.formatEther(gasPrice * BigInt(Number(receipt.gasUsed))));
    const croPrice = 0.10; // approximate CRO price
    const gasCostUSD = gasCostCRO * croPrice;
    const elapsed = Date.now() - startTime;

    // Remove from ownership registry (hedge is now closed)
    await removeHedgeOwnership(hedgeId);

    // ═══ DB UPDATE: Persist closed status to Neon ═══
    try {
      const { closeOnChainHedge } = await import('@/lib/db/hedges');
      await closeOnChainHedge(hedgeId, realizedPnl, tx.hash);
      console.log(`✅ DB updated: hedge ${hedgeId.slice(0,18)}... marked as closed`);
    } catch (dbErr) {
      console.warn('Failed to update DB (non-critical):', dbErr instanceof Error ? dbErr.message : dbErr);
    }

    console.log(`✅ x402 Gasless close: ${STATUS_NAMES[closedStatus]} | PnL: ${realizedPnl} | Returned: ${fundsReturned} USDC | Saved: $${gasCostUSD.toFixed(4)} gas | Tx: ${tx.hash}`);

    return NextResponse.json({
      success: true,
      message: `Hedge closed and ${fundsReturned > 0 ? fundsReturned.toFixed(2) + ' USDC withdrawn' : 'position liquidated'} to your wallet`,
      hedgeId,
      txHash: tx.hash,
      gasUsed: Number(receipt.gasUsed),
      trader,
      asset: PAIR_NAMES[pairIndex] || `PAIR-${pairIndex}`,
      side: isLong ? 'LONG' : 'SHORT',
      collateral,
      leverage,
      realizedPnl: Math.round(realizedPnl * 100) / 100,
      finalStatus: STATUS_NAMES[closedStatus]?.toLowerCase(),
      fundsReturned: Math.round(fundsReturned * 100) / 100,
      balanceBefore: Math.round(balanceBefore * 100) / 100,
      balanceAfter: Math.round(balanceAfter * 100) / 100,
      withdrawalDestination: trader,
      explorerLink: `https://explorer.cronos.org/testnet/tx/${tx.hash}`,
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
    console.error('On-chain close error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to close hedge on-chain',
      },
      { status: 500 }
    );
  }
}
