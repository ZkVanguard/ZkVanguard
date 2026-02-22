/**
 * Community Pool Storage Layer
 * 
 * Provides persistent storage for community pool data
 * - Pool state (total assets, share price, allocations)
 * - User shares (deposits, withdrawals, ownership)
 * - Transaction history
 */

import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

// Storage paths
const STORAGE_DIR = path.join(process.cwd(), 'deployments');
const POOL_STATE_FILE = path.join(STORAGE_DIR, 'community-pool-state.json');
const POOL_SHARES_FILE = path.join(STORAGE_DIR, 'community-pool-shares.json');
const POOL_HISTORY_FILE = path.join(STORAGE_DIR, 'community-pool-history.json');

// Supported assets
export const SUPPORTED_ASSETS = ['BTC', 'ETH', 'SUI', 'CRO'] as const;
export type SupportedAsset = typeof SUPPORTED_ASSETS[number];

// Types
export interface PoolState {
  totalValueUSD: number;
  totalShares: number;
  sharePrice: number; // USD per share
  allocations: Record<SupportedAsset, {
    percentage: number;
    valueUSD: number;
    amount: number;
    price: number;
  }>;
  lastRebalance: number;
  lastAIDecision: {
    timestamp: number;
    reasoning: string;
    allocations: Record<SupportedAsset, number>;
  } | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserShares {
  walletAddress: string;
  shares: number;
  valueUSD: number;
  percentage: number; // Ownership percentage of pool
  deposits: {
    timestamp: number;
    amountUSD: number;
    sharesReceived: number;
    sharePrice: number;
    txHash?: string;
  }[];
  withdrawals: {
    timestamp: number;
    sharesBurned: number;
    amountUSD: number;
    sharePrice: number;
    txHash?: string;
  }[];
  joinedAt: number;
  updatedAt: number;
}

export interface PoolTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'REBALANCE' | 'AI_DECISION';
  walletAddress?: string;
  amountUSD?: number;
  shares?: number;
  sharePrice?: number;
  details?: any;
  timestamp: number;
  txHash?: string;
}

/**
 * Initialize storage directory
 * Note: On Vercel serverless, filesystem is read-only - use in-memory fallback
 */
let inMemoryPoolState: PoolState | null = null;
let inMemoryShares: UserShares[] = [];
let inMemoryHistory: PoolTransaction[] = [];

// Detect serverless environment (Vercel, AWS Lambda, etc.)
const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.NETLIFY
);

if (isServerless) {
  logger.info('[CommunityPool] Serverless environment detected - using in-memory storage');
}

async function ensureStorageDir() {
  if (isServerless) return; // Skip filesystem operations
  
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error: any) {
    // Ignore errors - will use in-memory if file operations fail
  }
}

/**
 * Get initial pool state
 */
function getInitialPoolState(): PoolState {
  const now = Date.now();
  return {
    totalValueUSD: 0,
    totalShares: 0,
    sharePrice: 1.0, // Start at $1 per share
    allocations: {
      BTC: { percentage: 35, valueUSD: 0, amount: 0, price: 0 },
      ETH: { percentage: 30, valueUSD: 0, amount: 0, price: 0 },
      SUI: { percentage: 20, valueUSD: 0, amount: 0, price: 0 },
      CRO: { percentage: 15, valueUSD: 0, amount: 0, price: 0 },
    },
    lastRebalance: now,
    lastAIDecision: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get pool state
 */
export async function getPoolState(): Promise<PoolState> {
  await ensureStorageDir();
  
  // Use in-memory on serverless
  if (isServerless) {
    if (!inMemoryPoolState) {
      inMemoryPoolState = getInitialPoolState();
    }
    return inMemoryPoolState;
  }
  
  try {
    const data = await fs.readFile(POOL_STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Return initial state if file doesn't exist
    const initialState = getInitialPoolState();
    await savePoolState(initialState);
    return initialState;
  }
}

/**
 * Save pool state
 */
export async function savePoolState(state: PoolState): Promise<void> {
  state.updatedAt = Date.now();
  
  // Use in-memory on serverless
  if (isServerless) {
    inMemoryPoolState = state;
    logger.info('[CommunityPool] Pool state saved (in-memory)');
    return;
  }
  
  await ensureStorageDir();
  await fs.writeFile(POOL_STATE_FILE, JSON.stringify(state, null, 2));
  logger.info('[CommunityPool] Pool state saved');
}

/**
 * Get all user shares
 */
export async function getAllUserShares(): Promise<UserShares[]> {
  // Use in-memory on serverless
  if (isServerless) {
    return inMemoryShares;
  }
  
  await ensureStorageDir();
  
  try {
    const data = await fs.readFile(POOL_SHARES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

/**
 * Get user shares by wallet address
 */
export async function getUserShares(walletAddress: string): Promise<UserShares | null> {
  const allShares = await getAllUserShares();
  return allShares.find(s => s.walletAddress.toLowerCase() === walletAddress.toLowerCase()) || null;
}

/**
 * Save user shares
 */
export async function saveUserShares(userShares: UserShares): Promise<void> {
  const allShares = await getAllUserShares();
  const existingIndex = allShares.findIndex(
    s => s.walletAddress.toLowerCase() === userShares.walletAddress.toLowerCase()
  );
  
  userShares.updatedAt = Date.now();
  
  if (existingIndex >= 0) {
    allShares[existingIndex] = userShares;
  } else {
    allShares.push(userShares);
  }
  
  // Use in-memory on serverless
  if (isServerless) {
    inMemoryShares = allShares;
    logger.info(`[CommunityPool] User shares saved (in-memory) for ${userShares.walletAddress}`);
    return;
  }
  
  await ensureStorageDir();
  await fs.writeFile(POOL_SHARES_FILE, JSON.stringify(allShares, null, 2));
  logger.info(`[CommunityPool] User shares saved for ${userShares.walletAddress}`);
}

/**
 * Get pool transaction history
 */
export async function getPoolHistory(limit: number = 50): Promise<PoolTransaction[]> {
  // Use in-memory on serverless
  if (isServerless) {
    return inMemoryHistory.slice(-limit).reverse();
  }
  
  await ensureStorageDir();
  
  try {
    const data = await fs.readFile(POOL_HISTORY_FILE, 'utf-8');
    const history: PoolTransaction[] = JSON.parse(data);
    return history.slice(-limit).reverse(); // Most recent first
  } catch (error) {
    return [];
  }
}

/**
 * Add transaction to pool history
 */
export async function addPoolTransaction(tx: Omit<PoolTransaction, 'id'>): Promise<PoolTransaction> {
  const transaction: PoolTransaction = {
    ...tx,
    id: `pool-tx-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  };
  
  // Use in-memory on serverless
  if (isServerless) {
    inMemoryHistory.push(transaction);
    // Keep last 1000 transactions
    if (inMemoryHistory.length > 1000) {
      inMemoryHistory = inMemoryHistory.slice(-1000);
    }
    logger.info(`[CommunityPool] Transaction recorded (in-memory): ${transaction.type}`);
    return transaction;
  }
  
  await ensureStorageDir();
  
  const history = await getPoolHistory(1000); // Get all history
  history.reverse(); // Back to chronological order
  history.push(transaction);
  
  // Keep last 1000 transactions
  const trimmed = history.slice(-1000);
  await fs.writeFile(POOL_HISTORY_FILE, JSON.stringify(trimmed, null, 2));
  
  logger.info(`[CommunityPool] Transaction recorded: ${transaction.type}`);
  return transaction;
}

/**
 * Calculate user ownership percentage
 */
export function calculateOwnership(userShares: number, totalShares: number): number {
  if (totalShares === 0) return 0;
  return (userShares / totalShares) * 100;
}

/**
 * Get top shareholders
 */
export async function getTopShareholders(limit: number = 10): Promise<{ address: string; shares: number; percentage: number }[]> {
  const allShares = await getAllUserShares();
  const poolState = await getPoolState();
  
  return allShares
    .filter(u => u.shares > 0)
    .sort((a, b) => b.shares - a.shares)
    .slice(0, limit)
    .map(u => ({
      address: u.walletAddress,
      shares: u.shares,
      percentage: calculateOwnership(u.shares, poolState.totalShares),
    }));
}
