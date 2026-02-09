/**
 * Seed on-chain hedges into Neon DB
 * Reads all hedges from HedgeExecutor contract and persists them with tx hashes
 */
const { Pool } = require('pg');
const { ethers } = require('ethers');
const fs = require('fs');

const H = '0x090b6221137690EbB37667E4644287487CE462B9';
const DEPLOYER = '0xb9966f1007E4aD3A37D29949162d68b0dF8Eb51c';
const RELAYER = '0xb61C1cF5152015E66d547F9c1c45cC592a870D10';
const PAIRS = ['BTC', 'ETH', 'CRO', 'ATOM', 'DOGE', 'SOL'];
const STATUS_NAMES = ['pending', 'active', 'closed', 'liquidated', 'cancelled'];

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const provider = new ethers.JsonRpcProvider('https://evm-t3.cronos.org/');
  const contract = new ethers.Contract(H, [
    'function getUserHedges(address) view returns (bytes32[])',
    'function hedges(bytes32) view returns (bytes32,address,uint256,uint256,uint256,uint256,bool,bytes32,bytes32,uint256,uint256,int256,uint8)',
  ], provider);

  // 1. Get all hedge IDs
  const deployerIds = [...await contract.getUserHedges(DEPLOYER)];
  const relayerIds = [...await contract.getUserHedges(RELAYER)];
  const allIds = [...new Set([...deployerIds, ...relayerIds])];
  console.log(`Found ${allIds.length} unique hedges on-chain`);

  // 2. Collect tx hashes from deployment file
  const txMap = {};
  try {
    const deploy = JSON.parse(fs.readFileSync('deployments/cronos-testnet.json', 'utf-8'));
    for (const d of (deploy.demoHedges || [])) {
      if (d.hedgeId && d.txHash) {
        txMap[d.hedgeId] = { hash: d.txHash, block: null };
      }
    }
    console.log(`From deployment file: ${Object.keys(txMap).length} tx hashes`);
  } catch {}

  // 3. Scan event logs for tx hashes (last 200k blocks)
  const latest = await provider.getBlockNumber();
  const startBlock = Math.max(0, latest - 200000);
  console.log(`Scanning blocks ${startBlock} to ${latest}...`);

  for (let from = startBlock; from <= latest; from += 2000) {
    const to = Math.min(from + 1999, latest);
    try {
      const logs = await provider.getLogs({ address: H, fromBlock: from, toBlock: to });
      for (const l of logs) {
        if (l.topics[1]) {
          txMap[l.topics[1]] = { hash: l.transactionHash, block: l.blockNumber };
        }
      }
    } catch {}
  }
  console.log(`Total tx hashes available: ${Object.keys(txMap).length}`);

  // 4. Upsert each hedge
  const sql = `
    INSERT INTO hedges (
      order_id, wallet_address, asset, market, side,
      size, notional_value, leverage, simulation_mode,
      tx_hash, on_chain, chain, chain_id, contract_address,
      hedge_id_onchain, commitment_hash, nullifier,
      block_number, explorer_link, status
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, false,
      $9, true, $10, $11, $12,
      $13, $14, $15,
      $16, $17, $18
    )
    ON CONFLICT (order_id) DO UPDATE SET
      tx_hash = COALESCE(EXCLUDED.tx_hash, hedges.tx_hash),
      on_chain = true,
      hedge_id_onchain = EXCLUDED.hedge_id_onchain,
      block_number = COALESCE(EXCLUDED.block_number, hedges.block_number),
      explorer_link = COALESCE(EXCLUDED.explorer_link, hedges.explorer_link),
      commitment_hash = COALESCE(EXCLUDED.commitment_hash, hedges.commitment_hash),
      nullifier = COALESCE(EXCLUDED.nullifier, hedges.nullifier),
      contract_address = COALESCE(EXCLUDED.contract_address, hedges.contract_address),
      chain = COALESCE(EXCLUDED.chain, hedges.chain),
      updated_at = CURRENT_TIMESTAMP
  `;

  let inserted = 0;
  let errors = 0;

  for (const id of allIds) {
    try {
      const d = await contract.hedges(id);
      const pairIndex = Number(d[2]);
      const collateral = Number(ethers.formatUnits(d[4], 6));
      const leverage = Number(d[5]);
      const isLong = d[6];
      const status = Number(d[12]);
      const asset = PAIRS[pairIndex] || 'UNKNOWN';
      const commitHash = d[7] === ethers.ZeroHash ? null : d[7];
      const nullifier = d[8] === ethers.ZeroHash ? null : d[8];
      const tx = txMap[id];

      await pool.query(sql, [
        id,                                    // order_id
        d[1],                                  // wallet_address (trader)
        asset,                                 // asset
        `${asset}/USD`,                        // market
        isLong ? 'LONG' : 'SHORT',            // side
        collateral,                            // size
        collateral * leverage,                 // notional_value
        leverage,                              // leverage
        tx?.hash || null,                      // tx_hash
        'cronos-testnet',                      // chain
        338,                                   // chain_id
        H,                                     // contract_address
        id,                                    // hedge_id_onchain
        commitHash,                            // commitment_hash
        nullifier,                             // nullifier
        tx?.block || null,                     // block_number
        tx ? `https://explorer.cronos.org/testnet/tx/${tx.hash}` : null, // explorer_link
        STATUS_NAMES[status] || 'active',      // status
      ]);
      inserted++;

      const icon = tx?.hash ? '✅' : '⚠️';
      console.log(`${icon} ${id.slice(0, 12)} ${asset} ${isLong ? 'LONG' : 'SHORT'} ${collateral} USDC x${leverage} | tx: ${tx?.hash?.slice(0, 12) || 'MISSING'}`);
    } catch (e) {
      errors++;
      console.log(`❌ ${id.slice(0, 12)}: ${e.message.slice(0, 100)}`);
    }
  }

  console.log(`\n=== SEED COMPLETE ===`);
  console.log(`Inserted/updated: ${inserted} | Errors: ${errors}`);

  // Verify
  const check = await pool.query(
    "SELECT COUNT(*) as total, COUNT(tx_hash) as with_tx, COUNT(CASE WHEN on_chain THEN 1 END) as on_chain_count FROM hedges"
  );
  console.log('DB state:', check.rows[0]);

  await pool.end();
})();
