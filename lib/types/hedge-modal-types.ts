/**
 * Manual Hedge Modal Types & Constants
 *
 * Extracted from ManualHedgeModal.tsx to reduce file size
 * and allow shared imports without pulling in the full component.
 */

import { parseEther } from 'viem';

// ── Asset → pairIndex mapping (must match HedgeExecutor) ────────
export const PAIR_INDEX: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  CRO: 2,
  ATOM: 3,
  DOGE: 4,
  SOL: 5,
};

// ── Oracle fee required as msg.value ────────────────────────────
export const ORACLE_FEE = parseEther('0.06'); // 0.06 tCRO

// ── Minimal ABIs ────────────────────────────────────────────────
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const HEDGE_EXECUTOR_ABI = [
  {
    type: 'function',
    name: 'openHedge',
    stateMutability: 'payable',
    inputs: [
      { name: 'pairIndex', type: 'uint256' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'leverage', type: 'uint256' },
      { name: 'isLong', type: 'bool' },
      { name: 'commitmentHash', type: 'bytes32' },
      { name: 'nullifier', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [
      { name: 'hedgeId', type: 'bytes32' },
    ],
  },
] as const;

// ── Interfaces ──────────────────────────────────────────────────
export interface HedgeInitialValues {
  asset?: string;
  side?: 'LONG' | 'SHORT';
  leverage?: number;
  size?: number;
  reason?: string;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
}

export interface ManualHedgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableAssets?: string[];
  walletAddress?: string;
  initialValues?: HedgeInitialValues;
}

export interface HedgeSuccess {
  hedgeId: string;
  txHash: string;
  asset: string;
  hedgeType: string;
  collateral: string;
  leverage: number;
  entryPrice: string;
}

export type TxStep = 'idle' | 'checking' | 'signing' | 'approving' | 'approve-confirming' | 'opening' | 'open-confirming' | 'done' | 'error';
