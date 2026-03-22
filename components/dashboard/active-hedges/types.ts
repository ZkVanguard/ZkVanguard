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
  walletVerified?: boolean;
  zkVerified?: boolean;
  walletBindingHash?: string;
  commitmentHash?: string;
  onChain?: boolean;
  chain?: string;
  contractAddress?: string;
  hedgeId?: string;
  proxyWallet?: string;
  proxyVault?: string;
}

export interface CloseReceipt {
  success: boolean;
  asset: string;
  side: string;
  collateral: number;
  leverage: number;
  realizedPnl: number;
  fundsReturned: number;
  balanceBefore: number;
  balanceAfter: number;
  txHash: string;
  explorerLink: string;
  trader: string;
  gasless: boolean;
  gasSavings?: { userGasCost: string; relayerGasCost: string; totalSaved: string };
  elapsed?: string;
  finalStatus: string;
  error?: string;
}

export interface PerformanceStats {
  totalHedges: number;
  activeHedges: number;
  winRate: number;
  totalPnL: number;
  avgHoldTime: string;
  bestTrade: number;
  worstTrade: number;
}

export interface AIRecommendation {
  strategy: string;
  confidence: number;
  expectedReduction: number;
  description: string;
  actions: {
    action: string;
    asset: string;
    size: number;
    leverage: number;
    protocol: string;
    reason: string;
  }[];
  agentSource?: string;
}
