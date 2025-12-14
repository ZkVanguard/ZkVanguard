import { Chain } from 'wagmi';

export const CronoszkEVMTestnet: Chain = {
  id: 282,
  name: 'Cronos zkEVM Testnet',
  network: 'cronos-zkevm-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'zkTCRO',
    symbol: 'zkTCRO',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc-zkevm-testnet.cronos.org'],
      webSocket: ['wss://rpc-zkevm-testnet.cronos.org/ws'],
    },
    public: {
      http: ['https://rpc-zkevm-testnet.cronos.org'],
      webSocket: ['wss://rpc-zkevm-testnet.cronos.org/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Cronos zkEVM Explorer',
      url: 'https://explorer-zkevm-testnet.cronos.org',
    },
  },
  testnet: true,
};
