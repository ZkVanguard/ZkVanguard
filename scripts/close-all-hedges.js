/**
 * Close all active hedges directly using the relayer
 * For gasless hedges, the relayer is the on-chain owner and can close them
 */
require('dotenv').config({ path: '.env.local' });
const { ethers } = require('ethers');

const RPC_URL = 'https://evm-t3.cronos.org';
const HEDGE_EXECUTOR = '0x090b6221137690EbB37667E4644287487CE462B9';
const RELAYER_PK = process.env.RELAYER_PRIVATE_KEY || '0x05dd15c75542f4ecdffb076bae5401f74f22f819b509c841c9ed3cff0b13005d';

const HEDGE_EXECUTOR_ABI = [
  'function getUserHedges(address) view returns (bytes32[])',
  'function hedges(bytes32) view returns (bytes32 hedgeId, address trader, uint256 pairIndex, uint256 tradeIndex, uint256 collateralAmount, uint256 leverage, bool isLong, bytes32 commitmentHash, bytes32 nullifier, uint256 openTimestamp, uint256 closeTimestamp, int256 realizedPnl, uint8 status)',
  'function closeHedge(bytes32 hedgeId) external',
  'event HedgeClosed(bytes32 indexed hedgeId, address indexed trader, int256 pnl, uint256 duration)',
];

const PAIRS = ['BTC', 'ETH', 'CRO', 'ATOM', 'DOGE', 'SOL'];
const STATUSES = ['PENDING', 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];

async function main() {
  console.log('=== CLOSE ALL ACTIVE HEDGES ===\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const relayer = new ethers.Wallet(RELAYER_PK, provider);
  const contract = new ethers.Contract(HEDGE_EXECUTOR, HEDGE_EXECUTOR_ABI, relayer);

  console.log('Relayer address:', relayer.address);

  // Get all hedges for the relayer
  const hedgeIds = await contract.getUserHedges(relayer.address);
  console.log(`Found ${hedgeIds.length} total hedges for relayer\n`);

  // Filter active ones
  const activeHedges = [];
  for (const id of hedgeIds) {
    const h = await contract.hedges(id);
    const status = Number(h[12]);
    if (status === 1) { // ACTIVE
      const pair = PAIRS[Number(h[2])] || 'UNKNOWN';
      const side = h[6] ? 'LONG' : 'SHORT';
      const collateral = ethers.formatUnits(h[4], 6);
      activeHedges.push({ id, pair, side, collateral });
      console.log(`  ACTIVE: ${pair} ${side} (${collateral} USDC) - ${id.slice(0, 20)}...`);
    }
  }

  if (activeHedges.length === 0) {
    console.log('\nNo active hedges to close!');
    return;
  }

  console.log(`\nClosing ${activeHedges.length} active hedges...\n`);

  // Close each active hedge
  for (const h of activeHedges) {
    console.log(`Closing ${h.pair} ${h.side}...`);
    try {
      const tx = await contract.closeHedge(h.id, {
        gasLimit: 500000,
        gasPrice: ethers.parseUnits('5000', 'gwei'), // Cronos requires high gas price
      });
      console.log(`  TX submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      
      // Parse events
      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed && parsed.name === 'HedgeClosed') {
            const pnl = ethers.formatUnits(parsed.args.pnl, 6);
            console.log(`  ✅ Closed! PnL: ${pnl} USDC`);
          }
        } catch {}
      }
    } catch (err) {
      console.log(`  ❌ Failed: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log('\n=== DONE ===');

  // Also update DB status
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);

  console.log('\nUpdating database...');
  await sql`UPDATE hedges SET status = 'closed', updated_at = NOW() WHERE status = 'active'`;
  await sql`DELETE FROM hedge_ownership`;
  console.log('Database updated: all hedges marked closed, ownership cleared');
}

main().catch(console.error);
