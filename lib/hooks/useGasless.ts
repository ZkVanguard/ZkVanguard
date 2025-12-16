/**
 * React Hook for Gasless Transactions
 * Makes all contract interactions 100% free for users
 */

import { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { walletClientToSigner } from '@/lib/contracts/utils';
import { 
  executeGasless,
  createPortfolioGasless,
  depositAssetGasless,
  verifyProofGasless,
  processSettlementGasless,
  getUserGaslessStats,
  getRelayerStatus,
  isGaslessAvailable,
  estimateGasSavings
} from '../gasless';

export function useGasless() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const signer = walletClient ? walletClientToSigner(walletClient) : null;
  
  const [isAvailable, setIsAvailable] = useState(false);
  const [userStats, setUserStats] = useState({
    gaslessTransactions: '0',
    totalGasSaved: '0',
    averagePerTx: '0'
  });
  const [relayerStatus, setRelayerStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check gasless availability
  useEffect(() => {
    const checkAvailability = async () => {
      const available = await isGaslessAvailable();
      setIsAvailable(available);
    };
    checkAvailability();
    const interval = setInterval(checkAvailability, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  // Load user stats
  useEffect(() => {
    if (address) {
      getUserGaslessStats(address)
        .then(setUserStats)
        .catch(() => {}); // Silent fail
    }
  }, [address]);

  // Load relayer status
  useEffect(() => {
    getRelayerStatus()
      .then(setRelayerStatus)
      .catch(() => {}); // Silent fail
  }, []);

  /**
   * Execute any gasless transaction
   */
  const execute = async (
    to: string,
    data: string,
    value: bigint = 0n,
    immediate: boolean = false
  ) => {
    if (!signer) throw new Error('No signer available');
    if (!isAvailable) throw new Error('Gasless service unavailable');

    setLoading(true);
    setError(null);

    try {
      const result = await executeGasless(signer, to, data, value, immediate);
      
      // Refresh user stats
      if (address) {
        const stats = await getUserGaslessStats(address);
        setUserStats(stats);
      }

      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Create portfolio WITHOUT paying gas
   */
  const createPortfolio = async (
    rwaManagerAddress: string,
    targetYield: bigint,
    riskTolerance: bigint
  ) => {
    if (!signer) throw new Error('No signer available');
    if (!isAvailable) throw new Error('Gasless service unavailable');

    setLoading(true);
    setError(null);

    try {
      const result = await createPortfolioGasless(
        signer,
        rwaManagerAddress,
        targetYield,
        riskTolerance
      );

      // Refresh stats
      if (address) {
        const stats = await getUserGaslessStats(address);
        setUserStats(stats);
      }

      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Deposit asset WITHOUT paying gas
   */
  const depositAsset = async (
    rwaManagerAddress: string,
    portfolioId: bigint,
    asset: string,
    amount: bigint
  ) => {
    if (!signer) throw new Error('No signer available');
    if (!isAvailable) throw new Error('Gasless service unavailable');

    setLoading(true);
    setError(null);

    try {
      const result = await depositAssetGasless(
        signer,
        rwaManagerAddress,
        portfolioId,
        asset,
        amount
      );

      // Refresh stats
      if (address) {
        const stats = await getUserGaslessStats(address);
        setUserStats(stats);
      }

      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Verify ZK proof WITHOUT paying gas
   */
  const verifyProof = async (
    zkVerifierAddress: string,
    proofType: string,
    a: [bigint, bigint],
    b: [[bigint, bigint], [bigint, bigint]],
    c: [bigint, bigint],
    publicSignals: bigint[]
  ) => {
    if (!signer) throw new Error('No signer available');
    if (!isAvailable) throw new Error('Gasless service unavailable');

    setLoading(true);
    setError(null);

    try {
      const result = await verifyProofGasless(
        signer,
        zkVerifierAddress,
        proofType,
        a,
        b,
        c,
        publicSignals
      );

      // Refresh stats
      if (address) {
        const stats = await getUserGaslessStats(address);
        setUserStats(stats);
      }

      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Process settlement WITHOUT paying gas
   */
  const processSettlement = async (
    paymentRouterAddress: string,
    portfolioId: bigint,
    payments: Array<{ recipient: string; amount: bigint; token: string }>
  ) => {
    if (!signer) throw new Error('No signer available');
    if (!isAvailable) throw new Error('Gasless service unavailable');

    setLoading(true);
    setError(null);

    try {
      const result = await processSettlementGasless(
        signer,
        paymentRouterAddress,
        portfolioId,
        payments
      );

      // Refresh stats
      if (address) {
        const stats = await getUserGaslessStats(address);
        setUserStats(stats);
      }

      return result;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Estimate how much gas user will save
   */
  const estimateSavings = async (
    to: string,
    data: string,
    value: bigint = 0n
  ): Promise<string> => {
    if (!signer || !signer.provider) return '0';
    return estimateGasSavings(signer.provider, to, data, value);
  };

  return {
    // State
    isAvailable,
    loading,
    error,
    userStats,
    relayerStatus,

    // Actions
    execute,
    createPortfolio,
    depositAsset,
    verifyProof,
    processSettlement,
    estimateSavings,

    // Helper
    gaslessSavings: userStats.totalGasSaved,
    transactionCount: userStats.gaslessTransactions
  };
}
