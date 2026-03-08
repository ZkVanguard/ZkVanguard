/**
 * Test Setup
 * Global test configuration — NO MOCKS
 * 
 * All tests use real services. If a service is unavailable,
 * individual tests skip via runtime checks.
 */

// Reduce logger noise during tests
if (process.env.LOG_LEVEL === undefined) {
  process.env.LOG_LEVEL = 'error';
}

// Global test utilities (pure helpers, no mocking)
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
};
