/**
 * Mainnet Deployment Cost Estimator
 * 
 * Calculates exact CRO/USD costs for deploying all contracts to Cronos Mainnet
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// Contract initcode sizes from Hardhat compilation (in KiB)
const CONTRACT_SIZES_KIB = {
  // Core contracts to deploy
  HedgeExecutor: 12.351,           // UUPS Upgradeable - largest
  RWAManager: 9.256,               // Core portfolio manager
  ZKProxyVault: 8.314,             // Escrow vault
  PaymentRouter: 7.324,            // x402 payments
  ZKPaymaster: 5.959,              // Gasless transactions
  ZKHedgeCommitment: 4.953,        // Privacy commitments
  X402GaslessZKCommitmentVerifier: 4.272,
  GaslessZKCommitmentVerifier: 2.944,
  ZKSTARKVerifier: 2.550,
  
  // NOT needed on mainnet (mock contracts)
  // MockMoonlander: 4.317,  // Using real Moonlander
  // MockUSDC: 2.773,        // Using real USDC
};

// Cronos Mainnet gas settings
const MAINNET_GAS_PRICE_GWEI = 5000; // Cronos uses 5000 gwei base
const CRO_PRICE_USD = 0.078; // Update with current price

async function estimateCosts() {
  console.log('\n' + '═'.repeat(70));
  console.log('💰 CRONOS MAINNET DEPLOYMENT COST ESTIMATOR');
  console.log('═'.repeat(70));
  
  // Get current mainnet gas price
  const provider = new ethers.JsonRpcProvider('https://evm.cronos.org');
  let currentGasPrice: bigint;
  
  try {
    const feeData = await provider.getFeeData();
    currentGasPrice = feeData.gasPrice || BigInt(MAINNET_GAS_PRICE_GWEI * 1e9);
    console.log(`\n📊 Current Mainnet Gas Price: ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei`);
  } catch (e) {
    currentGasPrice = BigInt(MAINNET_GAS_PRICE_GWEI * 1e9);
    console.log(`\n📊 Using default gas price: ${MAINNET_GAS_PRICE_GWEI} gwei`);
  }
  
  console.log(`💱 CRO Price: $${CRO_PRICE_USD} USD`);
  
  console.log('\n' + '─'.repeat(70));
  console.log('CONTRACT DEPLOYMENT COSTS');
  console.log('─'.repeat(70));
  
  let totalGas = BigInt(0);
  let totalCRO = 0;
  
  const results: Array<{
    contract: string;
    sizeKiB: number;
    gasEstimate: bigint;
    croCost: number;
    usdCost: number;
  }> = [];
  
  for (const [contract, sizeKiB] of Object.entries(CONTRACT_SIZES_KIB)) {
    // Gas estimation: ~200 gas per byte for contract deployment
    // initcode size in bytes = KiB * 1024
    const sizeBytes = sizeKiB * 1024;
    
    // Deployment gas = 21000 (base) + 200 * bytecode_size + ~32000 (CREATE2) + constructor gas
    // For typical contracts: ~300-400 gas per byte including all operations
    const gasPerByte = 350; // Conservative estimate
    const baseGas = 21000 + 32000; // Base tx + CREATE overhead
    const constructorGas = 100000; // Constructor execution estimate
    
    const gasEstimate = BigInt(Math.ceil(baseGas + (sizeBytes * gasPerByte) + constructorGas));
    
    // Cost in CRO
    const gasCostWei = gasEstimate * currentGasPrice;
    const gasCostCRO = Number(ethers.formatEther(gasCostWei));
    const gasCostUSD = gasCostCRO * CRO_PRICE_USD;
    
    results.push({
      contract,
      sizeKiB,
      gasEstimate,
      croCost: gasCostCRO,
      usdCost: gasCostUSD
    });
    
    totalGas += gasEstimate;
    totalCRO += gasCostCRO;
    
    console.log(`\n📦 ${contract}`);
    console.log(`   Size: ${sizeKiB.toFixed(3)} KiB (${Math.ceil(sizeBytes)} bytes)`);
    console.log(`   Gas:  ${gasEstimate.toLocaleString()}`);
    console.log(`   Cost: ${gasCostCRO.toFixed(4)} CRO ($${gasCostUSD.toFixed(2)} USD)`);
  }
  
  const totalUSD = totalCRO * CRO_PRICE_USD;
  
  console.log('\n' + '═'.repeat(70));
  console.log('📊 DEPLOYMENT SUMMARY');
  console.log('═'.repeat(70));
  console.log(`\nContracts to deploy: ${Object.keys(CONTRACT_SIZES_KIB).length}`);
  console.log(`Total initcode:      ${Object.values(CONTRACT_SIZES_KIB).reduce((a, b) => a + b, 0).toFixed(2)} KiB`);
  console.log(`Total gas:           ${totalGas.toLocaleString()}`);
  console.log(`\n💰 TOTAL DEPLOYMENT COST:`);
  console.log(`   ${totalCRO.toFixed(2)} CRO`);
  console.log(`   $${totalUSD.toFixed(2)} USD`);
  
  // Add buffer for configuration transactions
  const configTxs = 10; // Role grants, initializations, etc.
  const configGasPerTx = 100000;
  const configTotalGas = BigInt(configTxs * configGasPerTx);
  const configCRO = Number(ethers.formatEther(configTotalGas * currentGasPrice));
  const configUSD = configCRO * CRO_PRICE_USD;
  
  console.log(`\n⚙️ CONFIGURATION TRANSACTIONS (~${configTxs} txs):`);
  console.log(`   ${configCRO.toFixed(2)} CRO ($${configUSD.toFixed(2)} USD)`);
  
  const grandTotalCRO = totalCRO + configCRO;
  const grandTotalUSD = grandTotalCRO * CRO_PRICE_USD;
  
  // Add 20% safety buffer
  const safetyBuffer = 1.2;
  const recommendedCRO = grandTotalCRO * safetyBuffer;
  const recommendedUSD = recommendedCRO * CRO_PRICE_USD;
  
  console.log('\n' + '═'.repeat(70));
  console.log('💵 RECOMMENDED WALLET BALANCE (with 20% buffer):');
  console.log('═'.repeat(70));
  console.log(`\n   ${recommendedCRO.toFixed(0)} CRO`);
  console.log(`   $${recommendedUSD.toFixed(2)} USD`);
  
  console.log('\n' + '─'.repeat(70));
  console.log('📝 NOTES:');
  console.log('─'.repeat(70));
  console.log('• Does NOT include Moonlander/USDC (existing mainnet contracts)');
  console.log('• Does NOT include SUI deployment (~$5-10 in SUI gas)');
  console.log('• Proxy contracts (HedgeExecutor) have additional upgrade costs');
  console.log('• Gas prices can spike during high network activity');
  console.log('• Configuration txs: role grants, approvals, initializers');
  console.log('═'.repeat(70) + '\n');
  
  return {
    contracts: results,
    totalCRO: recommendedCRO,
    totalUSD: recommendedUSD
  };
}

estimateCosts()
  .then((result) => {
    console.log('✅ Estimation complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
