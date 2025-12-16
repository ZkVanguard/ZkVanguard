#!/usr/bin/env node
/**
 * Gasless Transaction Relayer Service
 * Accepts signed meta-transactions from users and submits them on-chain
 * Users pay ZERO gas fees!
 */

const { ethers } = require('hardhat');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = process.env.RELAYER_PORT || 8001;
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const RELAYER_CONTRACT_ADDRESS = process.env.RELAYER_CONTRACT_ADDRESS || '0x9E5512b683d92290ccD20F483D20699658bcb9f3';

// In-memory queue for batching
const txQueue = [];
const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 5000; // 5 seconds

let relayerContract;
let relayerSigner;

/**
 * Initialize relayer
 */
async function initializeRelayer() {
  console.log('\n🚀 Starting Gasless Transaction Relayer');
  console.log('========================================\n');

  // Connect to network
  const provider = new ethers.JsonRpcProvider(
    process.env.CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org'
  );

  // Setup relayer wallet
  relayerSigner = new ethers.Wallet(
    RELAYER_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    provider
  );

  console.log('📍 Relayer Address:', relayerSigner.address);
  
  const balance = await provider.getBalance(relayerSigner.address);
  console.log('💰 Relayer Balance:', ethers.formatEther(balance), 'TCRO');

  // Load deployed contract
  const RelayerFactory = await ethers.getContractFactory('UniversalRelayer');
  relayerContract = RelayerFactory.attach(RELAYER_CONTRACT_ADDRESS).connect(relayerSigner);

  console.log('📜 Relayer Contract:', RELAYER_CONTRACT_ADDRESS);
  console.log('\n✅ Relayer initialized successfully');
  console.log('⚡ Ready to process gasless transactions!\n');
}

/**
 * Submit meta-transaction (GASLESS for user)
 */
app.post('/api/relay/submit', async (req, res) => {
  try {
    const { from, to, value, data, deadline, signature } = req.body;

    console.log(`📝 New meta-transaction from ${from}`);
    console.log(`   Target: ${to}`);
    console.log(`   Value: ${value || 0}`);

    // Validate
    if (!from || !to || !data || !deadline || !signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if sponsored
    const isSponsored = await relayerContract.isContractSponsored(to);
    if (!isSponsored) {
      return res.status(403).json({ 
        error: 'Contract not sponsored for gasless transactions' 
      });
    }

    // Add to batch queue for efficiency
    txQueue.push({ from, to, value: value || 0, data, deadline, signature });

    // If queue is full, process immediately
    if (txQueue.length >= BATCH_SIZE) {
      await processBatch();
    }

    res.json({
      success: true,
      message: 'Transaction queued for gasless execution',
      queuePosition: txQueue.length,
      estimatedTime: Math.ceil(txQueue.length / BATCH_SIZE) * (BATCH_TIMEOUT / 1000)
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Submit immediate transaction (not batched)
 */
app.post('/api/relay/submit-immediate', async (req, res) => {
  try {
    const { from, to, value, data, deadline, signature } = req.body;

    console.log(`⚡ Immediate meta-transaction from ${from}`);

    const startTime = Date.now();

    // Execute transaction
    const tx = await relayerContract.executeMetaTransaction(
      from,
      to,
      value || 0,
      data,
      deadline,
      signature
    );

    console.log(`   TX submitted: ${tx.hash}`);
    
    const receipt = await tx.wait();
    const duration = Date.now() - startTime;

    const gasUsed = receipt.gasUsed;
    const gasCost = gasUsed * tx.gasPrice;

    console.log(`   ✅ Confirmed in ${duration}ms`);
    console.log(`   Gas used: ${gasUsed}`);
    console.log(`   Gas cost: ${ethers.formatEther(gasCost)} TCRO (PAID BY RELAYER)`);

    res.json({
      success: true,
      txHash: tx.hash,
      gasUsed: gasUsed.toString(),
      gasCostInTCRO: ethers.formatEther(gasCost),
      userSaved: ethers.formatEther(gasCost),
      duration: duration
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process batched transactions (MAXIMUM GAS SAVINGS)
 */
async function processBatch() {
  if (txQueue.length === 0) return;

  const batch = txQueue.splice(0, BATCH_SIZE);
  console.log(`\n📦 Processing batch of ${batch.length} transactions`);

  try {
    const startTime = Date.now();

    const froms = batch.map(tx => tx.from);
    const tos = batch.map(tx => tx.to);
    const values = batch.map(tx => tx.value);
    const datas = batch.map(tx => tx.data);
    const deadlines = batch.map(tx => tx.deadline);
    const signatures = batch.map(tx => tx.signature);

    const tx = await relayerContract.executeBatch(
      froms, tos, values, datas, deadlines, signatures
    );

    const receipt = await tx.wait();
    const duration = Date.now() - startTime;

    const gasUsed = receipt.gasUsed;
    const gasCost = gasUsed * tx.gasPrice;
    const perTxGas = gasUsed / BigInt(batch.length);

    console.log(`   ✅ Batch confirmed in ${duration}ms`);
    console.log(`   Total gas: ${gasUsed}`);
    console.log(`   Per TX gas: ${perTxGas}`);
    console.log(`   Total cost: ${ethers.formatEther(gasCost)} TCRO`);
    console.log(`   Per user: ${ethers.formatEther(gasCost / BigInt(batch.length))} TCRO SAVED`);

  } catch (error) {
    console.error('❌ Batch processing error:', error.message);
    // Re-queue failed transactions
    txQueue.unshift(...batch);
  }
}

/**
 * Get relayer status
 */
app.get('/api/relay/status', async (req, res) => {
  try {
    const balance = await relayerSigner.provider.getBalance(relayerSigner.address);
    const stats = await relayerContract.getGaslessStats();

    res.json({
      relayerAddress: relayerSigner.address,
      balance: ethers.formatEther(balance),
      queueLength: txQueue.length,
      totalGaslessTransactions: stats[0].toString(),
      totalGasSaved: ethers.formatEther(stats[1]),
      averageGasSaved: ethers.formatEther(stats[2]),
      batchSize: BATCH_SIZE,
      batchTimeout: BATCH_TIMEOUT
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get user's gasless statistics
 */
app.get('/api/relay/user/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const stats = await relayerContract.getUserStats(address);

    res.json({
      address,
      gaslessTransactions: stats[0].toString(),
      totalGasSaved: ethers.formatEther(stats[1]),
      averagePerTx: stats[0] > 0 ? ethers.formatEther(stats[1] / stats[0]) : '0'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get domain separator for signing
 */
app.get('/api/relay/domain', async (req, res) => {
  try {
    const domain = await relayerContract.getDomainSeparator();
    res.json({ domainSeparator: domain });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'gasless-relayer' });
});

// Start batch processor
setInterval(processBatch, BATCH_TIMEOUT);

// Start server
async function start() {
  try {
    await initializeRelayer();
    
    app.listen(PORT, () => {
      console.log(`🌐 Relayer API running on http://localhost:${PORT}`);
      console.log(`📖 API Documentation:`);
      console.log(`   POST   /api/relay/submit           - Submit gasless transaction`);
      console.log(`   POST   /api/relay/submit-immediate - Submit immediate (no batch)`);
      console.log(`   GET    /api/relay/status           - Relayer status`);
      console.log(`   GET    /api/relay/user/:address    - User statistics`);
      console.log(`   GET    /api/relay/domain           - Domain separator`);
      console.log(`   GET    /health                     - Health check`);
      console.log(`\n✅ Gasless transactions enabled! Users pay ZERO gas! 🎉\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start relayer:', error);
    process.exit(1);
  }
}

start();
