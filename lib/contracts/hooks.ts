/**
 * React hooks for interacting with deployed smart contracts
 */

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useChainId } from 'wagmi';
import { getContractAddresses } from './addresses';
import { RWA_MANAGER_ABI, ZK_VERIFIER_ABI, PAYMENT_ROUTER_ABI } from './abis';

/**
 * Hook to read portfolio data from RWAManager
 */
export function usePortfolio(portfolioId: bigint) {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);

  return useReadContract({
    address: addresses.rwaManager,
    abi: RWA_MANAGER_ABI,
    functionName: 'getPortfolio',
    args: [portfolioId],
    query: {
      enabled: !!addresses.rwaManager && addresses.rwaManager !== '0x0000000000000000000000000000000000000000' && !!portfolioId,
      refetchInterval: 10000,
    },
  });
}

/**
 * Hook to read portfolio count
 */
export function usePortfolioCount() {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);

  return useReadContract({
    address: addresses.rwaManager,
    abi: RWA_MANAGER_ABI,
    functionName: 'portfolioCount',
    query: {
      enabled: !!addresses.rwaManager && addresses.rwaManager !== '0x0000000000000000000000000000000000000000',
      refetchInterval: 10000, // Refetch every 10 seconds
    },
  });
}

/**
 * Hook to create a new portfolio
 */
export function useCreatePortfolio() {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const createPortfolio = (targetYield: bigint, riskTolerance: bigint) => {
    writeContract({
      address: addresses.rwaManager,
      abi: RWA_MANAGER_ABI,
      functionName: 'createPortfolio',
      args: [targetYield, riskTolerance],
    });
  };

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  return {
    createPortfolio,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
  };
}

/**
 * Hook to check if proof type is supported
 */
export function useIsProofTypeSupported(proofType: string) {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);

  return useReadContract({
    address: addresses.zkVerifier,
    abi: ZK_VERIFIER_ABI,
    functionName: 'isProofTypeSupported',
    args: [proofType],
    query: {
      enabled: !!addresses.zkVerifier && addresses.zkVerifier !== '0x0000000000000000000000000000000000000000' && !!proofType,
    },
  });
}

/**
 * Hook to verify ZK proof on-chain
 */
export function useVerifyProof() {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const verifyProof = (
    proofType: string,
    a: [bigint, bigint],
    b: [[bigint, bigint], [bigint, bigint]],
    c: [bigint, bigint],
    publicSignals: bigint[]
  ) => {
    writeContract({
      address: addresses.zkVerifier,
      abi: ZK_VERIFIER_ABI,
      functionName: 'verifyProof',
      args: [proofType, a, b, c, publicSignals],
    });
  };

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  return {
    verifyProof,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
  };
}

/**
 * Hook to process settlement batch on-chain
 */
export function useProcessSettlement() {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);
  const { data: hash, writeContract, isPending, error } = useWriteContract();

  const processSettlement = (
    portfolioId: bigint,
    payments: Array<{ recipient: `0x${string}`; amount: bigint; token: `0x${string}` }>
  ) => {
    writeContract({
      address: addresses.paymentRouter,
      abi: PAYMENT_ROUTER_ABI,
      functionName: 'processSettlement',
      args: [portfolioId, payments],
    });
  };

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  return {
    processSettlement,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    error,
  };
}

/**
 * Get contract addresses for current chain
 */
export function useContractAddresses() {
  const chainId = useChainId();
  return getContractAddresses(chainId);
}
