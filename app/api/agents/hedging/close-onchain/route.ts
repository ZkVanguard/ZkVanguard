/**
 * On-Chain Close & Withdraw Hedge Position
 * Calls HedgeExecutor.closeHedge() which:
 * 1. Closes the trade on MockMoonlander
 * 2. Calculates realized PnL
 * 3. Transfers collateral ± PnL back to the trader's wallet
 * 
 * POST /api/agents/hedging/close-onchain
 * Body: { hedgeId: bytes32 }
 */
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const MOCK_USDC = '0x28217DAddC55e3C4831b4A48A00Ce04880786967';
const RPC_URL = 'https://evm-t3.cronos.org';
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY || '0x7af57dd2889cb16393ff945b87a8ce670aea2950179c425a572059017636b18d';

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
  try {
    const body = await request.json();
    const { hedgeId } = body;

    if (!hedgeId) {
      return NextResponse.json(
        { success: false, error: 'Missing hedgeId (bytes32)' },
        { status: 400 }
      );
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1 });
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

    // Execute on-chain closeHedge — this triggers fund withdrawal back to trader
    console.log(`Closing hedge on-chain: ${hedgeId.slice(0, 18)}... | ${PAIR_NAMES[pairIndex]} ${isLong ? 'LONG' : 'SHORT'} | ${collateral} USDC x${leverage}`);

    const tx = await contract.closeHedge(hedgeId, {
      gasLimit: 2_000_000,
      gasPrice: ethers.parseUnits('5000', 'gwei'),
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

    console.log(`✅ Hedge closed: ${STATUS_NAMES[closedStatus]} | PnL: ${realizedPnl} | Returned: ${fundsReturned} USDC | Tx: ${tx.hash}`);

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
