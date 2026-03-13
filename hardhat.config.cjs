const { HardhatUserConfig } = require('hardhat/config');
require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-verify');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-gas-reporter');
require('hardhat-contract-sizer');
require('solidity-coverage');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const config = {
  'ts-node': {
    project: './tsconfig.hardhat.json'
  },
  solidity: {
    version: '0.8.22',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1,  // Minimum runs = smallest contract size
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
      gasPrice: 500000000000, // 500 gwei (minimum for testnet)
      timeout: 60000,
    },
    'cronos-mainnet': {
      chainId: 25,
      url: process.env.CRONOS_MAINNET_RPC || 'https://evm.cronos.org/',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 60000,
    },
    'oasis-emerald-testnet': {
      chainId: 42261,
      url: process.env.OASIS_EMERALD_TESTNET_RPC || 'https://testnet.emerald.oasis.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 60000,
    },
    'oasis-emerald-mainnet': {
      chainId: 42262,
      url: process.env.OASIS_EMERALD_MAINNET_RPC || 'https://emerald.oasis.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 60000,
    },
    'oasis-sapphire-testnet': {
      chainId: 23295,
      url: process.env.OASIS_SAPPHIRE_TESTNET_RPC || 'https://testnet.sapphire.oasis.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 60000,
    },
    'oasis-sapphire-mainnet': {
      chainId: 23294,
      url: process.env.OASIS_SAPPHIRE_MAINNET_RPC || 'https://sapphire.oasis.io',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 60000,
    },
    'arbitrum-sepolia': {
      chainId: 421614,
      url: process.env.ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 120000,
    },
    'arbitrum-one': {
      chainId: 42161,
      url: process.env.ARBITRUM_ONE_RPC || 'https://arb1.arbitrum.io/rpc',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: 'auto',
      timeout: 120000,
    },
  },
  etherscan: {
    apiKey: {
      'cronos-testnet': process.env.CRONOSCAN_API_KEY || '',
      'cronos-mainnet': process.env.CRONOSCAN_API_KEY || '',
      'oasis-emerald-testnet': 'no-api-key-needed',
      'oasis-emerald-mainnet': 'no-api-key-needed',
      'oasis-sapphire-testnet': 'no-api-key-needed',
      'oasis-sapphire-mainnet': 'no-api-key-needed',
      'arbitrum-sepolia': process.env.ARBISCAN_API_KEY || '',
      'arbitrum-one': process.env.ARBISCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'cronos-testnet',
        chainId: 338,
        urls: {
          apiURL: 'https://api-testnet.cronoscan.com/api',
          browserURL: 'https://explorer.cronos.org/testnet/',
        },
      },
      {
        network: 'cronos-mainnet',
        chainId: 25,
        urls: {
          apiURL: 'https://api.cronoscan.com/api',
          browserURL: 'https://explorer.cronos.org/',
        },
      },
      {
        network: 'oasis-emerald-testnet',
        chainId: 42261,
        urls: {
          apiURL: 'https://explorer.oasis.io/testnet/emerald/api',
          browserURL: 'https://explorer.oasis.io/testnet/emerald/',
        },
      },
      {
        network: 'oasis-emerald-mainnet',
        chainId: 42262,
        urls: {
          apiURL: 'https://explorer.oasis.io/mainnet/emerald/api',
          browserURL: 'https://explorer.oasis.io/mainnet/emerald/',
        },
      },
      {
        network: 'oasis-sapphire-testnet',
        chainId: 23295,
        urls: {
          apiURL: 'https://explorer.oasis.io/testnet/sapphire/api',
          browserURL: 'https://explorer.oasis.io/testnet/sapphire/',
        },
      },
      {
        network: 'oasis-sapphire-mainnet',
        chainId: 23294,
        urls: {
          apiURL: 'https://explorer.oasis.io/mainnet/sapphire/api',
          browserURL: 'https://explorer.oasis.io/mainnet/sapphire/',
        },
      },
      {
        network: 'arbitrum-sepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api-sepolia.arbiscan.io/api',
          browserURL: 'https://sepolia.arbiscan.io/',
        },
      },
      {
        network: 'arbitrum-one',
        chainId: 42161,
        urls: {
          apiURL: 'https://api.arbiscan.io/api',
          browserURL: 'https://arbiscan.io/',
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify.dev/server",
    browserUrl: "https://repo.sourcify.dev",
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

module.exports = config;
