/**
 * React hooks for interacting with deployed smart contracts
 */

import { useState, useEffect } from 'react';
import { logger } from '@/lib/utils/logger';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useChainId } from 'wagmi';
import { getContractAddresses } from './addresses';
import { RWA_MANAGER_ABI, ZK_VERIFIER_ABI, PAYMENT_ROUTER_ABI } from './abis';

// In-memory cache for user portfolios (60s TTL)
const portfolioCache = new Map<string, { data: UserPortfolio[]; timestamp: number }>();
const PORTFOLIO_CACHE_TTL = 60000; // 60 seconds

interface UserPortfolio {
  id: number;
  owner: string;
  totalValue: bigint;
  targetYield: bigint;
  riskTolerance: bigint;
  lastRebalance: bigint;
  isActive: boolean;
  txHash: string | null;
}

interface PortfolioData {
  owner: string;
  totalValue: bigint;
  targetYield: bigint;
  riskTolerance: bigint;
  lastRebalance: bigint;
  isActive: boolean;
}

interface PortfolioEvent {
  args?: { portfolioId?: bigint; [key: string]: unknown } | bigint[];
  transactionHash: string;
}

/**
 * Hook to read portfolio data from RWAManager
 */
export function usePortfolio(portfolioId: bigint) {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);

  return useReadContract({
    address: addresses.rwaManager,
    abi: RWA_MANAGER_ABI,
    functionName: 'portfolios',
    args: [portfolioId],
    query: {
      enabled: !!addresses.rwaManager && addresses.rwaManager !== '0x0000000000000000000000000000000000000000' && !!portfolioId,
      refetchInterval: 10000,
    },
  });
}

/**
 * Hook to read portfolio assets from RWAManager
 */
export function usePortfolioAssets(portfolioId: bigint) {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);

  return useReadContract({
    address: addresses.rwaManager,
    abi: RWA_MANAGER_ABI,
    functionName: 'getPortfolioAssets',
    args: [portfolioId],
    query: {
      enabled: !!addresses.rwaManager && addresses.rwaManager !== '0x0000000000000000000000000000000000000000' && portfolioId !== undefined,
      refetchInterval: 10000,
    },
  });
}

/**
 * Hook to read total portfolio count from contract
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
 * Hook to get portfolios owned by the connected wallet
 */
export function useUserPortfolios(userAddress?: string) {
  const chainId = useChainId();
  const addresses = getContractAddresses(chainId);
  const { data: totalCount } = usePortfolioCount();
  const [userPortfolios, setUserPortfolios] = useState<UserPortfolio[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchUserPortfolios() {
      if (!userAddress || !totalCount || !addresses.rwaManager) {
        setUserPortfolios([]);
        setIsLoading(false);
        return;
      }

      // Check cache first
      const cacheKey = `portfolios-${userAddress}-${totalCount}`;
      const cached = portfolioCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < PORTFOLIO_CACHE_TTL) {
        logger.debug(`Using cached portfolios for ${userAddress}`, { component: 'hooks' });
        setUserPortfolios(cached.data);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      logger.info(`Fetching portfolios for ${userAddress}`, { component: 'hooks' });
      const startTime = Date.now();

      try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(
          process.env.NEXT_PUBLIC_CRONOS_RPC_URL || 'https://evm-t3.cronos.org'
        );
        
        const contract = new ethers.Contract(
          addresses.rwaManager,
          RWA_MANAGER_ABI,
          provider
        );

        const count = Number(totalCount);
        const portfolios = [];
        
        // Fetch PortfolioCreated events to get transaction hashes
        // Cronos RPC has a 2000 block limit, so we need to query in chunks
        const events: PortfolioEvent[] = [];
        try {
          const currentBlock = await provider.getBlockNumber();
          const portfolioCreatedFilter = contract.filters.PortfolioCreated();
          
          // OPTIMIZATION: Reduced from 50k to 20k blocks (covers ~2-3 days on Cronos)
          const CHUNK_SIZE = 1900; // Slightly under 2000 to be safe
          const TOTAL_BLOCKS = 20000; // Reduced from 50000
          const fromBlockStart = Math.max(0, currentBlock - TOTAL_BLOCKS);
          
          logger.debug(`Querying events from block ${fromBlockStart} to ${currentBlock} in chunks`, { component: 'hooks' });
          
          // OPTIMIZATION: Query chunks in parallel (3 at a time)
          const chunks: Array<{ fromBlock: number; toBlock: number }> = [];
          for (let fromBlock = fromBlockStart; fromBlock < currentBlock; fromBlock += CHUNK_SIZE) {
            const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
            chunks.push({ fromBlock, toBlock });
          }
          
          // Process chunks in batches of 3
          for (let i = 0; i < chunks.length; i += 3) {
            const batch = chunks.slice(i, i + 3);
            const batchPromises = batch.map(({ fromBlock, toBlock }) => 
              contract.queryFilter(portfolioCreatedFilter, fromBlock, toBlock)
                .catch((err: unknown) => {
                  logger.warn(`Failed to query blocks ${fromBlock}-${toBlock}`, { component: 'hooks', error: String(err) });
                  return [];
                })
            );
            const batchResults = await Promise.all(batchPromises);
            events.push(...batchResults.flat());
          }
          
          logger.debug(`Found ${events.length} PortfolioCreated events`, { component: 'hooks' });
        } catch (eventErr) {
          logger.error('Event query failed', eventErr, { component: 'hooks' });
        }
        
        // Create a map of portfolioId -> txHash
        const txHashMap: Record<number, string> = {};
        for (const event of events) {
          const portfolioId = Number(event.args?.[0] || event.args?.portfolioId);
          const txHash = event.transactionHash;
          txHashMap[portfolioId] = txHash;
        }
        
        // OPTIMIZATION: Check portfolios in parallel batches of 5
        const portfolioPromises = [];
        for (let i = 0; i < count; i++) {
          portfolioPromises.push(
            contract.portfolios(i)
              .then((portfolio: PortfolioData) => ({ i, portfolio }))
              .catch((err: unknown) => {
                logger.warn(`Error fetching portfolio ${i}`, { component: 'hooks', error: String(err) });
                return null;
              })
          );
        }
        
        // Process in batches of 5
        for (let i = 0; i < portfolioPromises.length; i += 5) {
          const batch = portfolioPromises.slice(i, i + 5);
          const results = await Promise.all(batch);
          
          for (const result of results) {
            if (result && result.portfolio.owner.toLowerCase() === userAddress.toLowerCase()) {
              const txHash = txHashMap[result.i] || null;
              portfolios.push({
                id: result.i,
                owner: result.portfolio.owner,
                totalValue: result.portfolio.totalValue,
                targetYield: result.portfolio.targetYield,
                riskTolerance: result.portfolio.riskTolerance,
                lastRebalance: result.portfolio.lastRebalance,
                isActive: result.portfolio.isActive,
                txHash,
              });
            }
          }
        }
        
        // Cache the results
        portfolioCache.set(cacheKey, { data: portfolios, timestamp: Date.now() });
        logger.info(`Fetched ${portfolios.length} portfolios in ${Date.now() - startTime}ms`, { component: 'hooks' });
        
        setUserPortfolios(portfolios);
      } catch (error) {
        logger.error('Error fetching user portfolios', error, { component: 'hooks' });
        setUserPortfolios([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchUserPortfolios();
  }, [userAddress, totalCount, addresses.rwaManager]);

  return {
    data: userPortfolios,
    count: userPortfolios.length,
    isLoading,
  };
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
