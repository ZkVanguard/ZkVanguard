/**
 * Moonlander Contract Addresses
 * 
 * Official addresses from: https://docs.moonlander.trade/others/smart-contracts
 */

export const MOONLANDER_CONTRACTS = {
  // Cronos EVM (Mainnet)
  CRONOS_EVM: {
    CHAIN_ID: 25,
    RPC_URL: 'https://evm.cronos.org',
    EXPLORER: 'https://explorer.cronos.org',
    
    // Core contracts
    MOONLANDER: '0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9',  // Main trading contract
    MLP: '0xb4c70008528227e0545Db5BA4836d1466727DF13',         // Liquidity pool token
    FM: '0x37888159581ac2CdeA5Fb9C3ed50265a19EDe8Dd',          // Platform token
    CM: '0x5449239f7F6992D7d13fc4E02829aC90B2bEa6D1',          // Reward token
    
    // Staking contracts
    STAKED_FM_TRACKER: '0x7eC427359d3470128f2A6C3d4c141AF158ed3A04',
    STAKED_FM_DISTRIBUTOR: '0xB7Fe13C40D9E4cD4b549fD1766e4ef74ef06330d',
    FEE_FM_TRACKER: '0xbF438c48Eff2b47F4e77Ea72dbC6588aB4f849CC',
    FEE_FM_DISTRIBUTOR: '0x6F27c8aCeD67424D3E7c7F42997489586b21F2f6',
    STAKED_MLP_TRACKER: '0x071788084370497ED1Ac19C6711bd1d4Af0E9034',
    STAKED_MLP_DISTRIBUTOR: '0x8Dbebe40e6bE35cF1bE07b22Aa5fa11f4768917E',
    
    // Common tokens
    USDC: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59',  // Native USDC on Cronos
    WCRO: '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23',  // Wrapped CRO
  },
  
  // Cronos zkEVM
  CRONOS_ZKEVM: {
    CHAIN_ID: 388,
    RPC_URL: 'https://mainnet.zkevm.cronos.org',
    EXPLORER: 'https://explorer.zkevm.cronos.org',
    
    // Core contracts
    MOONLANDER: '0x02ae2e56bfDF1ee4667405eE7e959CD3fE717A05',
    MLP: '0xe8E4A973Bb36E1714c805F88e2eb3A89f195D04f',
  },
  
  // Cronos Testnet
  CRONOS_TESTNET: {
    CHAIN_ID: 338,
    RPC_URL: 'https://evm-t3.cronos.org',
    EXPLORER: 'https://explorer.cronos.org/testnet',
    
    // Use mainnet addresses for testing (or testnet-specific if available)
    MOONLANDER: '0xE6F6351fb66f3a35313fEEFF9116698665FBEeC9',
    MLP: '0xb4c70008528227e0545Db5BA4836d1466727DF13',
  },
} as const;

// Trading pair indices (based on Moonlander supported assets)
export const PAIR_INDEX = {
  'BTC-USD': 0,
  'ETH-USD': 1,
  'CRO-USD': 2,
  'ATOM-USD': 3,
  'DOGE-USD': 4,
  'SOL-USD': 5,
  'XRP-USD': 6,
  'LTC-USD': 7,
  'BNB-USD': 8,
  'MATIC-USD': 9,
  'AVAX-USD': 10,
  'LINK-USD': 11,
  'UNI-USD': 12,
  // Add more as supported by Moonlander
} as const;

// Reverse mapping for pair index to symbol
export const INDEX_TO_PAIR: Record<number, string> = Object.entries(PAIR_INDEX).reduce(
  (acc, [key, value]) => ({ ...acc, [value]: key }),
  {}
);

// Collateral tokens supported
export const COLLATERAL_TOKENS = {
  CRONOS_EVM: {
    USDC: '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59',
    USDT: '0x66e428c3f67a68878562e79A0234c1F83c208770',
  },
  CRONOS_ZKEVM: {
    USDC: '0xaa5b845F8C9c047779bEDf64829601d8B264076c', // zkUSDC
  },
} as const;

export type NetworkType = 'CRONOS_EVM' | 'CRONOS_ZKEVM' | 'CRONOS_TESTNET';
export type PairSymbol = keyof typeof PAIR_INDEX;
