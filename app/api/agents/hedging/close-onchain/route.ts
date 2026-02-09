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

    // ── Signature verification ──────────────────────────────────────
    // Look up who owns this hedge
    const ownerEntry = getHedgeOwner(hedgeId);

    if (ownerEntry) {
      // Hedge has a registered owner → require EIP-712 signature
      if (!signature || !walletAddress) {
        return NextResponse.json(
          { success: false, error: 'Wallet signature required to close this hedge. Provide signature and walletAddress.' },
          { status: 401 }
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
          return NextResponse.json(
            { success: false, error: 'Signature does not match hedge owner. You can only close your own hedges.' },
            { status: 403 }
          );
        }

        console.log(`✅ Signature verified: ${recoveredAddress} owns hedge ${hedgeId.slice(0, 18)}...`);
      } catch (sigErr) {
        console.error('Signature verification error:', sigErr);
        return NextResponse.json(
          { success: false, error: 'Invalid signature format' },
          { status: 401 }
        );
      }
    } else {
      // Legacy hedge (opened before ownership registry) — allow close without signature
      // but log a warning
      console.warn(`⚠️ No ownership record for hedge ${hedgeId.slice(0, 18)}... — allowing legacy close`);
    }

    const tp = getCronosProvider(RPC_URL);
    const provider = tp.provider;
    const wallet = new ethers.Wallet(DEPLOYER_PK, provider);
    const contract = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, wallet);
    const usdc = new ethers.Contract(MOCK_USDC, USDC_ABI, provider);

    // Read hedge details before closing
    const hedge = await contract.hedges(hedgeId);
    const status = Number(hedge.status);
    const trader = hedge.trader;
    const collateral = Number(ethers.formatUnits(hedge.collateralAmount, 6));
    const pairIndex = Number(hedge.pairIndex);
    const leverage = Number(hedge.leverage);
    const isLong = hedge.isLong;

    if (status !== 1) { // Not ACTIVE
      const STATUS_NAMES = ['PENDING', 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];
      return NextResponse.json(
        { success: false, error: `Hedge is ${STATUS_NAMES[status] || 'unknown'}, not ACTIVE` },
        { status: 400 }
      );
    }

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
    removeHedgeOwnership(hedgeId);

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
