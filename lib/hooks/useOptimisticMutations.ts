/**
 * Optimistic Mutation Hooks
 * 
 * Provides instant UI feedback for on-chain operations by:
 * 1. Immediately showing pending state
 * 2. Rolling back on failure
 * 3. Confirming on success
 * 
 * This eliminates perceived latency for hedge execution, swaps, etc.
 */

import { useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { logger } from '@/lib/utils/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface HedgePosition {
  id: string;
  type: 'SHORT' | 'LONG';
  asset: string;
  size: number;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  capitalUsed: number;
  pnl: number;
  pnlPercent: number;
  status: 'active' | 'closed' | 'triggered' | 'pending' | 'liquidated' | 'cancelled';
  openedAt: Date;
  closedAt?: Date;
  reason: string;
  txHash?: string;
  walletAddress?: string;
}

export interface CreateHedgeInput {
  asset: string;
  side: 'LONG' | 'SHORT';
  collateral: number;
  leverage: number;
  reason?: string;
  walletAddress: string;
}

export interface CloseHedgeInput {
  hedgeId: string;
  signature: string;
  timestamp: number;
}

interface HedgeResponse {
  success: boolean;
  hedge?: HedgePosition;
  txHash?: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIMISTIC HEDGE CREATION
// ═══════════════════════════════════════════════════════════════════════════════

type HedgeCreateContext = {
  previousHedges: HedgePosition[] | undefined;
  optimisticHedge: HedgePosition;
};

export function useOptimisticHedgeCreate(
  options?: Omit<UseMutationOptions<HedgeResponse, Error, CreateHedgeInput, HedgeCreateContext>, 'mutationFn'>
) {
  const queryClient = useQueryClient();

  return useMutation<HedgeResponse, Error, CreateHedgeInput, HedgeCreateContext>({
    mutationFn: async (input: CreateHedgeInput): Promise<HedgeResponse> => {
      const response = await fetch('/api/agents/hedging/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: input.asset,
          side: input.side,
          notionalValue: input.collateral,
          leverage: input.leverage,
          reason: input.reason,
          walletAddress: input.walletAddress,
          autoApprovalEnabled: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Hedge execution failed: ${response.status}`);
      }

      return response.json();
    },

    // ═══ OPTIMISTIC UPDATE ═══
    onMutate: async (newHedge): Promise<HedgeCreateContext> => {
      logger.info('[OptimisticHedge] Creating optimistic hedge', { asset: newHedge.asset });

      // Cancel any in-flight queries for hedges
      await queryClient.cancelQueries({ queryKey: ['hedges'] });
      await queryClient.cancelQueries({ queryKey: ['hedges', 'active'] });

      // Snapshot current state for rollback
      const previousHedges = queryClient.getQueryData<HedgePosition[]>(['hedges', 'active']);

      // Create optimistic hedge with pending status
      const optimisticHedge: HedgePosition = {
        id: `pending-${Date.now()}`,
        type: newHedge.side,
        asset: newHedge.asset,
        size: newHedge.collateral * newHedge.leverage,
        leverage: newHedge.leverage,
        entryPrice: 0, // Will be filled by API
        currentPrice: 0,
        targetPrice: 0,
        stopLoss: 0,
        capitalUsed: newHedge.collateral,
        pnl: 0,
        pnlPercent: 0,
        status: 'pending',
        openedAt: new Date(),
        reason: newHedge.reason || 'Manual hedge',
        walletAddress: newHedge.walletAddress,
      };

      // Optimistically add to cache
      queryClient.setQueryData<HedgePosition[]>(['hedges', 'active'], (old = []) => [
        optimisticHedge,
        ...old,
      ]);

      // Emit event for other components
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hedgePending', { detail: optimisticHedge }));
      }

      return { previousHedges, optimisticHedge };
    },

    // ═══ ERROR ROLLBACK ═══
    onError: (err, newHedge, context) => {
      logger.error('[OptimisticHedge] Rolling back due to error', err);

      // Restore previous state
      if (context?.previousHedges) {
        queryClient.setQueryData(['hedges', 'active'], context.previousHedges);
      }

      // Emit failure event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hedgeFailed', { detail: { error: err.message } }));
      }
    },

    // ═══ SUCCESS CONFIRMATION ═══
    onSuccess: (data, input, context) => {
      logger.info('[OptimisticHedge] Hedge confirmed', { txHash: data.txHash });

      // Update optimistic hedge with real data
      if (data.hedge && context?.optimisticHedge) {
        queryClient.setQueryData<HedgePosition[]>(['hedges', 'active'], (old = []) =>
          old.map((h) =>
            h.id === context.optimisticHedge.id
              ? { ...data.hedge!, status: 'active' as const }
              : h
          )
        );
      }

      // Emit success event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hedgeAdded', { detail: data.hedge }));
      }
    },

    // ═══ ALWAYS: Sync with server ═══
    onSettled: () => {
      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: ['hedges'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    },

    ...options,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIMISTIC HEDGE CLOSE
// ═══════════════════════════════════════════════════════════════════════════════

type HedgeCloseContext = {
  previousHedges: HedgePosition[] | undefined;
};

export function useOptimisticHedgeClose(
  options?: Omit<UseMutationOptions<HedgeResponse, Error, CloseHedgeInput, HedgeCloseContext>, 'mutationFn'>
) {
  const queryClient = useQueryClient();

  return useMutation<HedgeResponse, Error, CloseHedgeInput, HedgeCloseContext>({
    mutationFn: async (input: CloseHedgeInput): Promise<HedgeResponse> => {
      const response = await fetch('/api/agents/hedging/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`Close hedge failed: ${response.status}`);
      }

      return response.json();
    },

    onMutate: async ({ hedgeId }): Promise<HedgeCloseContext> => {
      logger.info('[OptimisticHedge] Closing hedge optimistically', { hedgeId });

      await queryClient.cancelQueries({ queryKey: ['hedges', 'active'] });

      const previousHedges = queryClient.getQueryData<HedgePosition[]>(['hedges', 'active']);

      // Optimistically update status to 'closed'
      queryClient.setQueryData<HedgePosition[]>(['hedges', 'active'], (old = []) =>
        old.map((h) => (h.id === hedgeId ? { ...h, status: 'closed' as const } : h))
      );

      return { previousHedges };
    },

    onError: (err, input, context) => {
      logger.error('[OptimisticHedge] Close failed, rolling back', err);

      if (context?.previousHedges) {
        queryClient.setQueryData(['hedges', 'active'], context.previousHedges);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['hedges'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    },

    ...options,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIMISTIC POSITION UPDATE (for swaps)
// ═══════════════════════════════════════════════════════════════════════════════

interface Position {
  symbol: string;
  balance: string;
  balanceUSD: string;
  price: string;
  change24h: number;
}

interface PositionsData {
  address: string;
  totalValue: number;
  positions: Position[];
  lastUpdated: number;
}

interface SwapInput {
  fromToken: string;
  toToken: string;
  amount: number;
  expectedOutput: number;
  walletAddress: string;
}

interface SwapResponse {
  success: boolean;
  txHash?: string;
  actualOutput?: number;
  error?: string;
}

type SwapContext = {
  previousData: PositionsData | undefined;
};

export function useOptimisticSwap(
  options?: Omit<UseMutationOptions<SwapResponse, Error, SwapInput, SwapContext>, 'mutationFn'>
) {
  const queryClient = useQueryClient();

  return useMutation<SwapResponse, Error, SwapInput, SwapContext>({
    mutationFn: async (input: SwapInput): Promise<SwapResponse> => {
      const response = await fetch('/api/x402/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`Swap failed: ${response.status}`);
      }

      return response.json();
    },

    onMutate: async (swap): Promise<SwapContext> => {
      logger.info('[OptimisticSwap] Executing optimistic swap', {
        from: swap.fromToken,
        to: swap.toToken,
      });

      await queryClient.cancelQueries({ queryKey: ['positions'] });

      const previousData = queryClient.getQueryData<PositionsData>(['positions', swap.walletAddress]);

      // Optimistically update positions
      if (previousData) {
        const updatedPositions = previousData.positions.map((pos) => {
          if (pos.symbol === swap.fromToken) {
            const newBalance = parseFloat(pos.balance) - swap.amount;
            return {
              ...pos,
              balance: newBalance.toString(),
              balanceUSD: (newBalance * parseFloat(pos.price)).toFixed(2),
            };
          }
          if (pos.symbol === swap.toToken) {
            const newBalance = parseFloat(pos.balance) + swap.expectedOutput;
            return {
              ...pos,
              balance: newBalance.toString(),
              balanceUSD: (newBalance * parseFloat(pos.price)).toFixed(2),
            };
          }
          return pos;
        });

        queryClient.setQueryData(['positions', swap.walletAddress], {
          ...previousData,
          positions: updatedPositions,
          lastUpdated: Date.now(),
        });
      }

      return { previousData };
    },

    onError: (err, swap, context) => {
      logger.error('[OptimisticSwap] Swap failed, rolling back', err);

      if (context?.previousData) {
        queryClient.setQueryData(['positions', swap.walletAddress], context.previousData);
      }
    },

    onSettled: (data, error, swap) => {
      // Refetch positions to get actual balances
      queryClient.invalidateQueries({ queryKey: ['positions', swap.walletAddress] });
    },

    ...options,
  });
}
