export interface StrategyConfig {
  name: string;
  targetYield: number;
  riskTolerance: number;
  rebalanceFrequency: 'daily' | 'weekly' | 'monthly';
  hedgingEnabled: boolean;
  maxDrawdown: number;
  concentrationLimit: number;
  autoApprovalEnabled: boolean;
  autoApprovalThreshold: number;
  privateStrategy: {
    entryPoints?: number[];
    exitRules?: string[];
    riskParams?: Record<string, number>;
  };
}

export interface AssetFilter {
  minMarketCap?: number;
  maxVolatility?: number;
  allowedCategories: string[];
  excludedAssets: string[];
  minLiquidity?: number;
}

export interface AdvancedPortfolioCreatorProps {
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  hideTrigger?: boolean;
}

export type AIPreset = 'conservative' | 'balanced' | 'aggressive' | 'custom';
