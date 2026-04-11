import type { SimulationScenario, PortfolioState } from './types';

export const RISK_POLICY = {
  maxDrawdown: 0.08,
  hedgeRatio: 0.50,
  allowedInstruments: ['BTC-PERP', 'ETH-PERP', 'CRO-PERP', 'USDC'],
  varThreshold: 0.05,
  predictiveThreshold: 0.60,
};

export const HISTORICAL_SNAPSHOTS = {
  'trump-tariff-crash': {
    timestamp: '2025-10-10T18:47:00-05:00',
    prices: {
      BTC: { before: 91750, after: 84050, change: -8.4 },
      ETH: { before: 3420, after: 3037, change: -11.2 },
      CRO: { before: 0.142, after: 0.1195, change: -15.8 },
    },
    polymarket: [
      { question: 'Will Trump announce major China tariffs in October 2025?', probBefore: 34, probAfter: 94, volume: 12400000, timeToSpike: '4 minutes' },
      { question: 'Will China retaliate with counter-tariffs by Monday?', probBefore: 22, probAfter: 78, volume: 4200000, timeToSpike: '18 minutes' },
      { question: 'Will BTC drop below $85,000 this week?', probBefore: 15, probAfter: 71, volume: 8900000, timeToSpike: '7 minutes' },
    ],
    kalshi: [
      { question: 'Trade war escalation in Q4 2025', probBefore: 45, probAfter: 82, volume: 8100000 },
      { question: 'US-China trade deal collapse', probBefore: 28, probAfter: 67, volume: 3400000 },
    ],
    predictit: [
      { question: 'Major economic policy change by year end', probBefore: 41, probAfter: 89, volume: 2300000 },
    ],
    marketData: {
      btcVolatility: { before: 22, peak: 75, after: 52 },
      totalLiquidations: 2100000000,
      affectedAccounts: 127000,
      vixCrypto: { before: 24, peak: 89, after: 61 },
    },
    delphiConsensus: {
      before: 0.34,
      after: 0.91,
      confidence: 'HIGH',
      sources: ['polymarket', 'kalshi', 'predictit', 'metaculus'],
    },
  },
};

export const scenarios: SimulationScenario[] = [
  {
    id: 'trump-tariff-crash',
    name: '🇺🇸 Trump Tariff Shock (Oct 2025)',
    description: 'REAL EVENT: President Trump announces 100% tariffs on Chinese imports. Bitcoin plunges 8.4% in hours.',
    type: 'tariff',
    duration: 45,
    priceChanges: [
      { symbol: 'BTC', change: -8.4 },
      { symbol: 'ETH', change: -11.2 },
      { symbol: 'CRO', change: -15.8 },
    ],
    eventData: {
      date: 'October 10, 2025 - 6:47 PM EST',
      headline: 'BREAKING: Trump Imposes 100% Tariffs on Chinese Imports',
      source: 'Polymarket • Kalshi • PredictIt • Delphi • Crypto.com API',
      marketContext: 'Markets closed for the week. Asian markets set to open in turmoil. Crypto markets react immediately as 24/7 liquidity absorbs panic selling.',
      liquidations: '$2.1 billion in leveraged positions liquidated within 4 hours. 127,000 trader accounts affected.',
      predictionData: {
        polymarket: { question: 'Trump tariff announcement', before: 34, after: 94, volume: 12400000 },
        kalshi: { question: 'Trade war escalation Q4', before: 45, after: 82, volume: 8100000 },
        predictit: { question: 'Major economic policy change', before: 41, after: 89, volume: 2300000 },
        consensus: 0.91,
      },
      priceAtEvent: [
        { symbol: 'BTC', price: 91750 },
        { symbol: 'ETH', price: 3420 },
        { symbol: 'CRO', price: 0.142 },
      ],
    },
  },
  {
    id: 'flash-crash',
    name: 'Flash Crash (-40%)',
    description: 'Simulates a sudden market crash like the May 2021 crypto crash',
    type: 'crash',
    duration: 30,
    priceChanges: [
      { symbol: 'BTC', change: -40 },
      { symbol: 'ETH', change: -45 },
      { symbol: 'CRO', change: -50 },
    ],
  },
  {
    id: 'high-volatility',
    name: 'High Volatility Storm',
    description: 'Extreme price swings in both directions',
    type: 'volatility',
    duration: 45,
    priceChanges: [
      { symbol: 'BTC', change: -25 },
      { symbol: 'ETH', change: 30 },
      { symbol: 'CRO', change: -35 },
    ],
  },
  {
    id: 'gradual-recovery',
    name: 'Market Recovery',
    description: 'Portfolio recovery after a dip with AI-optimized rebalancing',
    type: 'recovery',
    duration: 60,
    priceChanges: [
      { symbol: 'BTC', change: 25 },
      { symbol: 'ETH', change: 35 },
      { symbol: 'CRO', change: 45 },
    ],
  },
  {
    id: 'stress-test',
    name: 'Full Stress Test',
    description: 'Complete stress test: crash → hedge → stabilize → recover',
    type: 'stress',
    duration: 90,
    priceChanges: [
      { symbol: 'BTC', change: -30 },
      { symbol: 'ETH', change: -35 },
      { symbol: 'CRO', change: -40 },
    ],
  },
];

export const initialPortfolio: PortfolioState = {
  totalValue: 150000000,
  cash: 7500000,
  positions: [
    { symbol: 'BTC', amount: 820, value: 75235000, price: 91750, pnl: 0, pnlPercent: 0 },
    { symbol: 'ETH', amount: 13450, value: 45999000, price: 3420, pnl: 0, pnlPercent: 0 },
    { symbol: 'CRO', amount: 150000000, value: 21300000, price: 0.142, pnl: 0, pnlPercent: 0 },
  ],
  riskScore: 42,
  volatility: 0.22,
};
