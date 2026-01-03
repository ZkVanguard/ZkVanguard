/**
 * Test Setup
 * Global test configuration and mocks
 */

import { jest } from '@jest/globals';

// Mock environment variables
if (process.env.LOG_LEVEL === undefined) {
  process.env.LOG_LEVEL = 'error'; // Reduce noise in tests
}

// Mock ethers provider for tests
(global as any).mockProvider = {
  getCode: jest.fn().mockResolvedValue('0x1234'),
  getNetwork: jest.fn().mockResolvedValue({ chainId: 338, name: 'cronos-testnet' }),
  getBlockNumber: jest.fn().mockResolvedValue(1000000),
};

// Mock Moonlander API responses
(global as any).mockMoonlanderAPI = {
  getMarketInfo: jest.fn().mockResolvedValue({
    market: 'BTC-USD-PERP',
    markPrice: '45000',
    fundingRate: '0.0001',
    maxLeverage: 10,
  }),
  getPositions: jest.fn().mockResolvedValue([]),
  placeOrder: jest.fn().mockResolvedValue({
    orderId: 'order-123',
    status: 'FILLED',
    avgFillPrice: '45000',
  }),
};

// Mock VVS API responses
(global as any).mockVVSAPI = {
  getQuote: jest.fn().mockResolvedValue({
    amountOut: '1000',
    priceImpact: 0.5,
    executionPrice: '1.0',
  }),
  swap: jest.fn().mockResolvedValue({
    txHash: '0xabc123',
    amountOut: '1000',
  }),
};

// Mock MCP API responses
(global as any).mockMCPAPI = {
  getPrice: jest.fn().mockResolvedValue({
    symbol: 'BTC',
    price: 45000,
    timestamp: Date.now(),
  }),
  getHistoricalPrices: jest.fn().mockResolvedValue(
    Array.from({ length: 30 }, (_, i) => ({
      timestamp: Date.now() - i * 24 * 60 * 60 * 1000,
      price: 45000 + Math.random() * 2000 - 1000,
    }))
  ),
};

// Mock x402 API responses
(global as any).mockX402API = {
  executeGaslessTransfer: jest.fn().mockResolvedValue({
    transactionId: 'x402-tx-123',
    status: 'COMPLETED',
  }),
  executeBatchTransfers: jest.fn().mockResolvedValue({
    transactionId: 'x402-batch-123',
    status: 'COMPLETED',
  }),
};

// Global test utilities
(global as any).testUtils = {
  // Wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  // Generate random address
  randomAddress: () => {
    const hex = '0123456789abcdef';
    let address = '0x';
    for (let i = 0; i < 40; i++) {
      address += hex[Math.floor(Math.random() * 16)];
    }
    return address;
  },

  // Generate random wallet
  randomWallet: () => ({
    address: (global as any).testUtils.randomAddress(),
    privateKey: '0x' + '0123456789abcdef'.repeat(4),
  }),

  // Mock task result
  mockTaskResult: (success: boolean = true, data: any = {}) => ({
    success,
    data,
    error: null,
  }),

  // Mock agent
  mockAgent: (id: string, type: string, capabilities: string[]) => ({
    id,
    type,
    capabilities,
    isBusy: () => false,
    isShutdown: () => false,
    getCapabilities: () => capabilities,
    getTaskLoad: () => 0,
    getAgentInfo: () => ({ id, type, capabilities, load: 0, status: 'idle' }),
    addTask: jest.fn().mockResolvedValue({ success: true }),
    shutdown: jest.fn().mockResolvedValue(undefined),
  }),
};
