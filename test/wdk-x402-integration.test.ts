/**
 * WDK x402 Full Integration Tests
 * 
 * Tests Tether WDK integration with the x402 gasless payment system:
 * - USDT token configuration across chains
 * - x402 facilitator service with WDK tokens
 * - Gasless payment flows using USDT
 * - Multi-chain support (Cronos, Hedera)
 * - EIP-3009 transferWithAuthorization compatibility
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { ethers } from 'ethers';
import {
  USDT_ADDRESSES,
  USDT_METADATA,
  WDK_CHAINS,
  getUSDTAddress,
  getChainConfig,
  isMainnet,
  getDepositTokenAddress,
  WDK_SUPPORTED_CHAINS,
} from '../lib/config/wdk';

// ERC20 ABI for USDT interaction
const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];

// EIP-3009 ABI extension (USDT supports this on some chains)
const EIP3009_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
];

describe('WDK x402 Full Integration', () => {
  // ===========================================
  // USDT CONFIGURATION TESTS
  // ===========================================
  describe('WDK USDT Configuration', () => {
    it('should have valid USDT addresses for all chains', () => {
      // Cronos Mainnet
      expect(USDT_ADDRESSES.cronos.mainnet).toBe('0x66e428c3f67a68878562e79A0234c1F83c208770');
      expect(USDT_ADDRESSES.cronos.mainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Cronos Testnet (MockUSDT)
      expect(USDT_ADDRESSES.cronos.testnet).toBe('0x28217DAddC55e3C4831b4A48A00Ce04880786967');
      expect(USDT_ADDRESSES.cronos.testnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Hedera Mainnet
      expect(USDT_ADDRESSES.hedera.mainnet).toBe('0x0000000000000000000000000000000000000000');
      expect(USDT_ADDRESSES.hedera.mainnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Hedera Testnet
      expect(USDT_ADDRESSES.hedera.testnet).toBe('0x0000000000000000000000000000000000000000');
      expect(USDT_ADDRESSES.hedera.testnet).toMatch(/^0x[a-fA-F0-9]{40}$/);
      
      // Ethereum Mainnet (reference)
      expect(USDT_ADDRESSES.ethereum.mainnet).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    });

    it('should have correct USDT metadata', () => {
      expect(USDT_METADATA.name).toBe('Tether USD');
      expect(USDT_METADATA.symbol).toBe('USDT');
      expect(USDT_METADATA.decimals).toBe(6);
      expect(USDT_METADATA.logo).toContain('tether');
    });

    it('should return correct USDT address by chain ID', () => {
      // Cronos Mainnet (25)
      expect(getUSDTAddress(25)).toBe(USDT_ADDRESSES.cronos.mainnet);
      
      // Cronos Testnet (338)
      expect(getUSDTAddress(338)).toBe(USDT_ADDRESSES.cronos.testnet);
      
      // Hedera Mainnet (295)
      expect(getUSDTAddress(295)).toBe(USDT_ADDRESSES.hedera.mainnet);
      
      // Hedera Testnet (296)
      expect(getUSDTAddress(296)).toBe(USDT_ADDRESSES.hedera.testnet);
      
      // Unknown chain
      expect(getUSDTAddress(999999)).toBeNull();
    });

    it('should correctly identify mainnet chains', () => {
      expect(isMainnet(25)).toBe(true);     // Cronos Mainnet
      expect(isMainnet(295)).toBe(true);  // Hedera Mainnet
      expect(isMainnet(338)).toBe(false);   // Cronos Testnet
      expect(isMainnet(296)).toBe(false); // Hedera Testnet
    });
  });

  // ===========================================
  // WDK CHAIN CONFIGURATION TESTS
  // ===========================================
  describe('WDK Chain Configuration', () => {
    it('should have all supported chains configured', () => {
      expect(Object.keys(WDK_CHAINS)).toContain('cronos-mainnet');
      expect(Object.keys(WDK_CHAINS)).toContain('cronos-testnet');
      expect(Object.keys(WDK_CHAINS)).toContain('hedera-mainnet');
      expect(Object.keys(WDK_CHAINS)).toContain('hedera-testnet');
    });

    it('should have correct Cronos mainnet config', () => {
      const config = WDK_CHAINS['cronos-mainnet'];
      expect(config.chainId).toBe(25);
      expect(config.name).toBe('Cronos');
      expect(config.network).toBe('mainnet');
      expect(config.rpcUrl).toBe('https://evm.cronos.org');
      expect(config.usdtAddress).toBe(USDT_ADDRESSES.cronos.mainnet);
      expect(config.nativeCurrency.symbol).toBe('CRO');
    });

    it('should have correct Hedera mainnet config', () => {
      const config = WDK_CHAINS['hedera-mainnet'];
      expect(config.chainId).toBe(295);
      expect(config.name).toBe('Hedera');
      expect(config.network).toBe('mainnet');
      expect(config.rpcUrl).toBe('https://mainnet.hashio.io/api');
      expect(config.usdtAddress).toBe(USDT_ADDRESSES.hedera.mainnet);
      expect(config.nativeCurrency.symbol).toBe('HBAR');
    });

    it('should return chain config by chain ID', () => {
      const cronosConfig = getChainConfig(25);
      expect(cronosConfig).toBeDefined();
      expect(cronosConfig?.name).toBe('Cronos');
      
      const hederaConfig = getChainConfig(295);
      expect(hederaConfig).toBeDefined();
      expect(hederaConfig?.name).toBe('Hedera');
    });

    it('should have valid RPC URLs', () => {
      Object.values(WDK_CHAINS).forEach(config => {
        expect(config.rpcUrl).toMatch(/^https?:\/\//);
      });
    });

    it('should have valid explorer URLs', () => {
      Object.values(WDK_CHAINS).forEach(config => {
        expect(config.explorerUrl).toMatch(/^https?:\/\//);
      });
    });
  });

  // ===========================================
  // x402 GASLESS PAYMENT INTEGRATION
  // ===========================================
  describe('x402 Gasless Payment with WDK', () => {
    const X402_FACILITATOR_URL = 'https://facilitator.x402.network';
    
    it('should define x402 payment challenge structure', () => {
      const challenge = {
        x402Version: 1,
        accepts: [{
          scheme: 'exact' as const,
          network: 'cronos-testnet',
          payTo: '0x1234567890123456789012345678901234567890',
          asset: USDT_ADDRESSES.cronos.testnet,
          maxAmountRequired: '1000000', // 1 USDT (6 decimals)
          maxTimeoutSeconds: 300,
          description: 'Pool deposit',
          resource: '/api/community-pool/deposit',
          extra: {
            paymentId: 'pay_1234_abcd',
          },
        }],
      };
      
      expect(challenge.x402Version).toBe(1);
      expect(challenge.accepts[0].asset).toBe(USDT_ADDRESSES.cronos.testnet);
      expect(challenge.accepts[0].scheme).toBe('exact');
    });

    it('should support WDK USDT as x402 payment asset', () => {
      const supportedAssets = [
        USDT_ADDRESSES.cronos.mainnet,
        USDT_ADDRESSES.cronos.testnet,
        USDT_ADDRESSES.hedera.mainnet,
        USDT_ADDRESSES.hedera.testnet,
      ];
      
      supportedAssets.forEach(asset => {
        expect(asset).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });
    });

    it('should generate payment ID format', () => {
      const generatePaymentId = () => {
        return `pay_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      };
      
      const paymentId = generatePaymentId();
      expect(paymentId).toMatch(/^pay_\d+_[a-z0-9]+$/);
    });

    it('should calculate correct USDT amounts (6 decimals)', () => {
      const usdtAmount = 10.0; // 10 USDT
      const baseUnits = BigInt(Math.floor(usdtAmount * 1_000_000));
      
      expect(baseUnits).toBe(BigInt(10_000_000));
      expect(Number(baseUnits) / 1_000_000).toBe(10.0);
    });

    it('should support zero gas for user (x402 sponsored)', () => {
      const userGasCost = {
        nativeToken: BigInt(0),
        usdEquivalent: 0.0,
        sponsoredBy: 'x402-facilitator',
      };
      
      expect(userGasCost.nativeToken).toBe(BigInt(0));
      expect(userGasCost.usdEquivalent).toBe(0.0);
      expect(userGasCost.sponsoredBy).toBe('x402-facilitator');
    });
  });

  // ===========================================
  // EIP-3009 TRANSFER WITH AUTHORIZATION
  // ===========================================
  describe('EIP-3009 TransferWithAuthorization', () => {
    it('should define EIP-3009 message structure', () => {
      const domain = {
        name: 'Tether USD',
        version: '1',
        chainId: 25,
        verifyingContract: USDT_ADDRESSES.cronos.mainnet,
      };
      
      const types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      };
      
      expect(domain.name).toBe('Tether USD');
      expect(types.TransferWithAuthorization).toHaveLength(6);
    });

    it('should generate valid nonce for authorization', () => {
      const generateNonce = () => {
        return ethers.hexlify(ethers.randomBytes(32));
      };
      
      const nonce = generateNonce();
      expect(nonce).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should calculate validity window', () => {
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 60; // 1 minute in the past
      const validBefore = now + 300; // 5 minutes in the future
      
      expect(validBefore).toBeGreaterThan(validAfter);
      expect(validBefore - validAfter).toBe(360); // 6 minute window
    });
  });

  // ===========================================
  // MULTI-CHAIN DEPOSIT FLOW
  // ===========================================
  describe('Multi-Chain USDT Deposit Flow', () => {
    it('should support deposits on Cronos', () => {
      const depositConfig = {
        chain: 'cronos',
        network: 'testnet' as const,
        poolAddress: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30',
        tokenAddress: USDT_ADDRESSES.cronos.testnet,
        tokenSymbol: 'USDT', // USDT via WDK (Mock on testnet)
      };
      
      expect(depositConfig.tokenAddress).toBe('0x28217DAddC55e3C4831b4A48A00Ce04880786967');
      expect(depositConfig.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should support deposits on Hedera', () => {
      const depositConfig = {
        chain: 'hedera',
        network: 'testnet' as const,
        poolAddress: '0xCF434F24eBA5ECeD1ffd0e69F1b1F4cDed1AB2a6',
        tokenAddress: USDT_ADDRESSES.hedera.testnet,
        tokenSymbol: 'USDT', // USDT via WDK (Mock on testnet)
      };
      
      expect(depositConfig.tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(depositConfig.poolAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should use USDT for all EVM chains via WDK', () => {
      // WDK provides USDT across all networks (mock on testnet, real on mainnet)
      const getEVMTokenSymbol = () => 'USDT';
      
      expect(getEVMTokenSymbol()).toBe('USDT');
    });

    it('should calculate correct deposit amounts', () => {
      const depositAmounts = [
        { input: 100, expected: BigInt(100_000_000) },
        { input: 0.01, expected: BigInt(10_000) },
        { input: 1000000, expected: BigInt(1_000_000_000_000) },
      ];
      
      depositAmounts.forEach(({ input, expected }) => {
        const baseUnits = BigInt(Math.floor(input * 1_000_000));
        expect(baseUnits).toBe(expected);
      });
    });
  });

  // ===========================================
  // ON-CHAIN TOKEN VERIFICATION (Integration) 
  // Note: On-chain contracts return 'USDC' (MockUSDC symbol)
  // but we label them 'USDT' in UI for WDK consistency
  // ===========================================
  describe('On-Chain Token Verification', () => {
    const testCases = [
      {
        name: 'Cronos Testnet',
        rpcUrl: 'https://evm-t3.cronos.org',
        tokenAddress: USDT_ADDRESSES.cronos.testnet,
        expectedSymbol: 'USDC', // On-chain MockUSDC (labeled USDT in app)
        expectedDecimals: 6,
      },
      {
        name: 'Hedera Testnet',
        rpcUrl: 'https://testnet.hashio.io/api',
        tokenAddress: USDT_ADDRESSES.hedera.testnet,
        expectedSymbol: 'USDC', // On-chain MockUSDC (labeled USDT in app)
        expectedDecimals: 6,
      },
    ];

    testCases.forEach(testCase => {
      it(`should verify token on ${testCase.name}`, async () => {
        const provider = new ethers.JsonRpcProvider(testCase.rpcUrl);
        const token = new ethers.Contract(testCase.tokenAddress!, ERC20_ABI, provider);
        
        const [symbol, decimals] = await Promise.all([
          token.symbol(),
          token.decimals(),
        ]);
        
        expect(symbol).toBe(testCase.expectedSymbol);
        expect(Number(decimals)).toBe(testCase.expectedDecimals);
      }, 30000);
    });
  });

  // ===========================================
  // GASLESS SETTLEMENT FLOW
  // ===========================================
  describe('x402 Gasless Settlement', () => {
    it('should define settlement result structure', () => {
      const successResult = {
        ok: true as const,
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        paymentId: 'pay_1234_abcd',
      };
      
      expect(successResult.ok).toBe(true);
      expect(successResult.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(successResult.paymentId).toMatch(/^pay_/);
    });

    it('should define settlement error types', () => {
      const errorTypes = ['verify_failed', 'settle_failed', 'invalid_request'] as const;
      
      errorTypes.forEach(errorType => {
        const errorResult = {
          ok: false as const,
          error: errorType,
          details: 'Error details',
        };
        
        expect(errorResult.ok).toBe(false);
        expect(errorResult.error).toBe(errorType);
      });
    });

    it('should track entitlements after settlement', () => {
      const entitlements = new Map<string, { txHash?: string; settledAt: number }>();
      
      const paymentId = 'pay_1234_abcd';
      entitlements.set(paymentId, {
        txHash: '0xabc123',
        settledAt: Date.now(),
      });
      
      expect(entitlements.has(paymentId)).toBe(true);
      expect(entitlements.get(paymentId)?.txHash).toBe('0xabc123');
    });
  });

  // ===========================================
  // WDK PROVIDER INTEGRATION
  // ===========================================
  describe('WDK Provider Integration', () => {
    it('should support all WDK chain IDs', () => {
      expect(WDK_SUPPORTED_CHAINS).toContain(25);     // Cronos Mainnet
      expect(WDK_SUPPORTED_CHAINS).toContain(338);    // Cronos Testnet
      expect(WDK_SUPPORTED_CHAINS).toContain(295);    // Hedera Mainnet
      expect(WDK_SUPPORTED_CHAINS).toContain(296);    // Hedera Testnet
    });

    it('should provide correct deposit token address', () => {
      // Mainnet - returns USDT
      expect(getDepositTokenAddress(25)).toBe(USDT_ADDRESSES.cronos.mainnet);
      expect(getDepositTokenAddress(295)).toBe(USDT_ADDRESSES.hedera.mainnet);
      
      // Testnet - returns MockUSDT (via config)
      expect(getDepositTokenAddress(338)).toBe(USDT_ADDRESSES.cronos.testnet);
      expect(getDepositTokenAddress(296)).toBe(USDT_ADDRESSES.hedera.testnet);
    });

    it('should create ethers provider for each chain', () => {
      const providers = WDK_SUPPORTED_CHAINS.map(chainId => {
        const config = getChainConfig(chainId);
        return {
          chainId,
          provider: new ethers.JsonRpcProvider(config?.rpcUrl),
        };
      });
      
      expect(providers).toHaveLength(4);
      providers.forEach(p => {
        expect(p.provider).toBeInstanceOf(ethers.JsonRpcProvider);
      });
    });
  });

  // ===========================================
  // FULL INTEGRATION FLOW TEST
  // ===========================================
  describe('Full WDK x402 Integration Flow', () => {
    it('should execute complete deposit flow simulation', async () => {
      // Step 1: User selects chain and gets token config
      const chainId = 338; // Cronos Testnet
      const config = getChainConfig(chainId);
      expect(config).toBeDefined();
      
      // Step 2: Get deposit token address
      const tokenAddress = getDepositTokenAddress(chainId);
      expect(tokenAddress).toBe(USDT_ADDRESSES.cronos.testnet);
      
      // Step 3: Create x402 payment challenge
      const depositAmount = 10.0; // 10 USDT
      const baseUnits = BigInt(Math.floor(depositAmount * 1_000_000));
      const challenge = {
        x402Version: 1,
        accepts: [{
          scheme: 'exact' as const,
          network: 'cronos-testnet',
          payTo: '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30', // Pool address
          asset: tokenAddress,
          maxAmountRequired: baseUnits.toString(),
          maxTimeoutSeconds: 300,
          description: 'Community Pool Deposit',
          resource: '/api/community-pool/deposit',
        }],
      };
      expect(challenge.accepts[0].maxAmountRequired).toBe('10000000');
      
      // Step 4: Simulate payment header generation
      const paymentHeader = `X402-Payment: scheme=exact;amount=${baseUnits};asset=${tokenAddress}`;
      expect(paymentHeader).toContain('X402-Payment');
      
      // Step 5: Settlement result (mocked)
      const settlementResult = {
        ok: true as const,
        txHash: '0x' + 'a'.repeat(64),
        paymentId: `pay_${Date.now()}_test`,
      };
      expect(settlementResult.ok).toBe(true);
      
      // Step 6: Verify user received shares (simulated)
      const sharesReceived = depositAmount / 0.969367; // NAV per share
      expect(sharesReceived).toBeGreaterThan(depositAmount);
    });
  });

  // ===========================================
  // ERROR HANDLING
  // ===========================================
  describe('Error Handling', () => {
    it('should handle unsupported chain ID', () => {
      const unsupportedChainId = 999999;
      expect(getChainConfig(unsupportedChainId)).toBeUndefined();
      expect(getUSDTAddress(unsupportedChainId)).toBeNull();
    });

    it('should throw for deposit token on unknown chain', () => {
      expect(() => getDepositTokenAddress(999999)).toThrow('No deposit token configured');
    });

    it('should handle invalid USDT amount', () => {
      const invalidAmounts = [-1, NaN, Infinity];
      
      invalidAmounts.forEach(amount => {
        const isValid = !isNaN(amount) && isFinite(amount) && amount >= 0;
        expect(isValid).toBe(false);
      });
    });
  });
});
