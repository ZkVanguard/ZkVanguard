import { defineChain } from 'viem';

// Cronos EVM Mainnet (Required for Cronos x402 Paytech Hackathon)
export const CronosMainnet = defineChain({
  id: 25,
  name: 'Cronos',
  nativeCurrency: {
    decimals: 18,
    name: 'Cronos',
    symbol: 'CRO',
  },
  rpcUrls: {
    default: {
      http: ['https://evm.cronos.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Cronoscan',
      url: 'https://explorer.cronos.org',
    },
  },
  testnet: false,
});

// Cronos EVM Testnet (For Development & Testing)
export const CronosTestnet = defineChain({
  id: 338,
  name: 'Cronos Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Test Cronos',
    symbol: 'tCRO',
  },
  rpcUrls: {
    default: {
      http: ['https://evm-t3.cronos.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Cronos Testnet Explorer',
      url: 'https://explorer.cronos.org/testnet',
    },
  },
  testnet: true,
});
