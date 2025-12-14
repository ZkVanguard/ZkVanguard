import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import 'hardhat-gas-reporter';
import 'hardhat-contract-sizer';
import 'solidity-coverage';
import * as dotenv from 'dotenv';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: process.env.FORK_CRONOS
        ? {
            url: process.env.CRONOS_MAINNET_RPC || 'https://evm.cronos.org/',
            blockNumber: parseInt(process.env.FORK_BLOCK_NUMBER || '0'),
          }
        : undefined,
    },
    'cronos-testnet': {
      chainId: 338,
      url: process.env.CRONOS_TESTNET_RPC || 'https://evm-t3.cronos.org/',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 5000000000000, // 5000 gwei
      timeout: 60000,
    },
    'cronos-mainnet': {
      chainId: 25,
      url: process.env.CRONOS_MAINNET_RPC || 'https://evm.cronos.org/',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 60000,
    },
  },
  etherscan: {
    apiKey: {
      'cronos-testnet': process.env.CRONOSCAN_API_KEY || '',
      'cronos-mainnet': process.env.CRONOSCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'cronos-testnet',
        chainId: 338,
        urls: {
          apiURL: 'https://api-testnet.cronoscan.com/api',
          browserURL: 'https://testnet.cronoscan.com/',
        },
      },
      {
        network: 'cronos-mainnet',
        chainId: 25,
        urls: {
          apiURL: 'https://api.cronoscan.com/api',
          browserURL: 'https://cronoscan.com/',
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    outputFile: 'gas-report.txt',
    noColors: true,
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
  paths: {
    sources: './contracts',
    tests: './test/unit/contracts',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 120000,
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
};

export default config;
