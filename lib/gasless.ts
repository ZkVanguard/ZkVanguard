/**
 * Gasless Transaction Library
 * Makes ALL contract interactions gasless for users
 * Users sign messages, relayer pays gas
 */

import { ethers } from 'ethers';

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:8001';
const RELAYER_CONTRACT = process.env.NEXT_PUBLIC_RELAYER_CONTRACT || '0x9E5512b683d92290ccD20F483D20699658bcb9f3';

// EIP-712 Domain
const domain = {
  name: 'UniversalRelayer',
  version: '1',
  chainId: 338, // Cronos Testnet
  verifyingContract: RELAYER_CONTRACT
};

// EIP-712 Types
const types = {
  MetaTransaction: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
};

/**
 * Execute gasless transaction
 * @param signer - User's ethers signer
 * @param to - Target contract address
 * @param data - Encoded function call
 * @param value - ETH value (optional)
 * @param immediate - Skip batching (optional)
 */
export async function executeGasless(
  signer: ethers.Signer,
  to: string,
  data: string,
  value: bigint = 0n,
  immediate: boolean = false
): Promise<any> {
  try {
    const from = await signer.getAddress();
    
    // Get nonce from relayer contract
    const provider = signer.provider;
    const relayerContract = new ethers.Contract(
      RELAYER_CONTRACT,
      ['function nonces(address) view returns (uint256)'],
      provider
    );
    const nonce = await relayerContract.nonces(from);

    // Set deadline (5 minutes from now)
    const deadline = Math.floor(Date.now() / 1000) + 300;

    // Create message to sign
    const message = {
      from,
      to,
      value: value.toString(),
      data,
      nonce: nonce.toString(),
      deadline
    };

    // Sign with EIP-712
    console.log('📝 Signing gasless transaction...');
    const signature = await signer.signTypedData(domain, types, message);

    // Submit to relayer
    console.log('📤 Submitting to relayer (YOU PAY NO GAS)...');
    const endpoint = immediate ? '/api/relay/submit-immediate' : '/api/relay/submit';
    
    const response = await fetch(`${RELAYER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        value: value.toString(),
        data,
        deadline,
        signature
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Relayer request failed');
    }

    const result = await response.json();
    console.log('✅ Transaction submitted gaslessly!');
    
    if (immediate && result.userSaved) {
      console.log(`💰 You saved ${result.userSaved} TCRO in gas fees!`);
    }

    return result;

  } catch (error) {
    console.error('❌ Gasless transaction failed:', error);
    throw error;
  }
}

/**
 * Create portfolio (GASLESS)
 */
export async function createPortfolioGasless(
  signer: ethers.Signer,
  rwaManagerAddress: string,
  targetYield: bigint,
  riskTolerance: bigint
): Promise<any> {
  const iface = new ethers.Interface([
    'function createPortfolio(uint256 _targetYield, uint256 _riskTolerance) returns (uint256)'
  ]);

  const data = iface.encodeFunctionData('createPortfolio', [targetYield, riskTolerance]);
  
  return executeGasless(signer, rwaManagerAddress, data, 0n, true);
}

/**
 * Deposit asset (GASLESS)
 */
export async function depositAssetGasless(
  signer: ethers.Signer,
  rwaManagerAddress: string,
  portfolioId: bigint,
  asset: string,
  amount: bigint
): Promise<any> {
  const iface = new ethers.Interface([
    'function depositAsset(uint256 _portfolioId, address _asset, uint256 _amount)'
  ]);

  const data = iface.encodeFunctionData('depositAsset', [portfolioId, asset, amount]);
  
  return executeGasless(signer, rwaManagerAddress, data);
}

/**
 * Verify ZK proof (GASLESS)
 */
export async function verifyProofGasless(
  signer: ethers.Signer,
  zkVerifierAddress: string,
  proofType: string,
  a: [bigint, bigint],
  b: [[bigint, bigint], [bigint, bigint]],
  c: [bigint, bigint],
  publicSignals: bigint[]
): Promise<any> {
  const iface = new ethers.Interface([
    'function verifyProof(string calldata proofType, uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[] calldata publicSignals) returns (bool)'
  ]);

  const data = iface.encodeFunctionData('verifyProof', [proofType, a, b, c, publicSignals]);
  
  return executeGasless(signer, zkVerifierAddress, data, 0n, true);
}

/**
 * Process settlement (GASLESS)
 */
export async function processSettlementGasless(
  signer: ethers.Signer,
  paymentRouterAddress: string,
  portfolioId: bigint,
  payments: Array<{ recipient: string; amount: bigint; token: string }>
): Promise<any> {
  const iface = new ethers.Interface([
    'function processSettlement(uint256 _portfolioId, tuple(address recipient, uint256 amount, address token)[] _payments)'
  ]);

  const data = iface.encodeFunctionData('processSettlement', [portfolioId, payments]);
  
  return executeGasless(signer, paymentRouterAddress, data);
}

/**
 * Get user's gasless statistics
 */
export async function getUserGaslessStats(address: string): Promise<{
  gaslessTransactions: string;
  totalGasSaved: string;
  averagePerTx: string;
}> {
  try {
    const response = await fetch(`${RELAYER_URL}/api/relay/user/${address}`);
    if (!response.ok) {
      throw new Error('Failed to fetch user stats');
    }
    return response.json();
  } catch {
    // Silently return empty stats if relayer is offline
    return {
      gaslessTransactions: '0',
      totalGasSaved: '0',
      averagePerTx: '0'
    };
  }
}

/**
 * Get relayer status
 */
export async function getRelayerStatus(): Promise<{
  relayerAddress: string;
  balance: string;
  queueLength: number;
  totalGaslessTransactions: string;
  totalGasSaved: string;
  averageGasSaved: string;
}> {
  try {
    const response = await fetch(`${RELAYER_URL}/api/relay/status`);
    if (!response.ok) {
      throw new Error('Failed to fetch relayer status');
    }
    return response.json();
  } catch {
    // Silently return offline status if relayer is not running
    return {
      relayerAddress: '0x0000000000000000000000000000000000000000',
      balance: '0',
      queueLength: 0,
      totalGaslessTransactions: '0',
      totalGasSaved: '0',
      averageGasSaved: '0'
    };
  }
}

/**
 * Check if gasless is available
 */
export async function isGaslessAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${RELAYER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Estimate gas savings for a transaction
 */
export async function estimateGasSavings(
  provider: ethers.Provider,
  to: string,
  data: string,
  value: bigint = 0n
): Promise<string> {
  try {
    const gasEstimate = await provider.estimateGas({ to, data, value });
    const feeData = await provider.getFeeData();
    const gasCost = gasEstimate * (feeData.gasPrice || 0n);
    return ethers.formatEther(gasCost);
  } catch {
    return '0.05'; // Default estimate
  }
}
