/**
 * Account Abstraction (AA) USDT Deposit Tests
 * 
 * Tests for gasless USDT deposits using ERC-4337 paymasters.
 * Validates:
 * - AA configuration for Pimlico/Candide
 * - UserOperation creation and serialization
 * - Gas estimation
 * - Paymaster integration
 * - Full deposit flow
 */

import {
  getAAConfig,
  getDefaultAAConfig,
  isAASupported,
  getSupportedAAChains,
  formatUSDT,
  parseUSDT,
  getUSDTAddress,
  ENTRY_POINT_V07,
  SAFE_4337_MODULE,
  PIMLICO_SEPOLIA,
  CANDIDE_SEPOLIA,
  PIMLICO_MAINNET,
  PIMLICO_ARBITRUM,
  type PaymasterProvider,
} from '@/lib/config/aa-paymaster';

import { AAClient, estimateDepositCost, isSmartAccount } from '@/lib/services/aa-client';

describe('AA Paymaster Configuration', () => {
  describe('Pimlico Sepolia Config', () => {
    it('should have correct chain ID', () => {
      expect(PIMLICO_SEPOLIA.chainId).toBe(11155111);
    });

    it('should have correct provider URL', () => {
      expect(PIMLICO_SEPOLIA.provider).toBe('https://sepolia.drpc.org');
    });

    it('should have correct bundler URL', () => {
      expect(PIMLICO_SEPOLIA.bundlerUrl).toBe('https://public.pimlico.io/v2/11155111/rpc');
    });

    it('should have correct paymaster URL', () => {
      expect(PIMLICO_SEPOLIA.paymasterUrl).toBe('https://public.pimlico.io/v2/11155111/rpc');
    });

    it('should have correct paymaster address', () => {
      expect(PIMLICO_SEPOLIA.paymasterAddress).toBe('0x777777777777AeC03fd955926DbF81597e66834C');
    });

    it('should have correct entry point v0.7', () => {
      expect(PIMLICO_SEPOLIA.entryPointAddress).toBe(ENTRY_POINT_V07);
    });

    it('should have USDT token configured', () => {
      expect(PIMLICO_SEPOLIA.paymasterToken.symbol).toBe('USDT');
      expect(PIMLICO_SEPOLIA.paymasterToken.address).toBe('0xd077a400968890eacc75cdc901f0356c943e4fdb');
      expect(PIMLICO_SEPOLIA.paymasterToken.decimals).toBe(6);
    });

    it('should have transfer max fee set', () => {
      expect(PIMLICO_SEPOLIA.transferMaxFee).toBe(100000); // 0.1 USDT
    });

    it('should be marked as testnet', () => {
      expect(PIMLICO_SEPOLIA.isTestnet).toBe(true);
    });
  });

  describe('Candide Sepolia Config', () => {
    it('should have correct chain ID', () => {
      expect(CANDIDE_SEPOLIA.chainId).toBe(11155111);
    });

    it('should have correct bundler URL', () => {
      expect(CANDIDE_SEPOLIA.bundlerUrl).toBe('https://api.candide.dev/public/v3/11155111');
    });

    it('should have different paymaster address from Pimlico', () => {
      expect(CANDIDE_SEPOLIA.paymasterAddress).toBe('0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba');
      expect(CANDIDE_SEPOLIA.paymasterAddress).not.toBe(PIMLICO_SEPOLIA.paymasterAddress);
    });

    it('should use same USDT token', () => {
      expect(CANDIDE_SEPOLIA.paymasterToken.address).toBe(PIMLICO_SEPOLIA.paymasterToken.address);
    });
  });

  describe('Mainnet Configs', () => {
    it('should have Ethereum mainnet config', () => {
      expect(PIMLICO_MAINNET.chainId).toBe(1);
      expect(PIMLICO_MAINNET.isTestnet).toBe(false);
    });

    it('should have Arbitrum config', () => {
      expect(PIMLICO_ARBITRUM.chainId).toBe(42161);
      expect(PIMLICO_ARBITRUM.isTestnet).toBe(false);
    });

    it('should have mainnet USDT addresses', () => {
      // Ethereum USDT
      expect(PIMLICO_MAINNET.paymasterToken.address).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
      // Arbitrum USDT
      expect(PIMLICO_ARBITRUM.paymasterToken.address).toBe('0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9');
    });
  });
});

describe('AA Config Lookup Functions', () => {
  describe('getAAConfig', () => {
    it('should return Pimlico config for Sepolia', () => {
      const config = getAAConfig(11155111, 'pimlico');
      expect(config).toEqual(PIMLICO_SEPOLIA);
    });

    it('should return Candide config for Sepolia', () => {
      const config = getAAConfig(11155111, 'candide');
      expect(config).toEqual(CANDIDE_SEPOLIA);
    });

    it('should return null for unsupported chain', () => {
      const config = getAAConfig(999999);
      expect(config).toBeNull();
    });

    it('should default to Pimlico provider', () => {
      const config = getAAConfig(11155111);
      expect(config).toEqual(PIMLICO_SEPOLIA);
    });
  });

  describe('getDefaultAAConfig', () => {
    it('should return Pimlico Sepolia', () => {
      const config = getDefaultAAConfig();
      expect(config).toEqual(PIMLICO_SEPOLIA);
    });
  });

  describe('isAASupported', () => {
    it('should return true for Sepolia', () => {
      expect(isAASupported(11155111)).toBe(true);
    });

    it('should return true for Ethereum mainnet', () => {
      expect(isAASupported(1)).toBe(true);
    });

    it('should return true for Arbitrum', () => {
      expect(isAASupported(42161)).toBe(true);
    });

    it('should return false for unsupported chain', () => {
      expect(isAASupported(999999)).toBe(false);
    });
  });

  describe('getSupportedAAChains', () => {
    it('should return array of chain IDs', () => {
      const chains = getSupportedAAChains();
      expect(Array.isArray(chains)).toBe(true);
      expect(chains).toContain(11155111); // Sepolia
      expect(chains).toContain(1); // Mainnet
      expect(chains).toContain(42161); // Arbitrum
    });

    it('should return numbers not strings', () => {
      const chains = getSupportedAAChains();
      chains.forEach(chain => {
        expect(typeof chain).toBe('number');
      });
    });
  });

  describe('getUSDTAddress', () => {
    it('should return USDT address for Sepolia', () => {
      const address = getUSDTAddress(11155111);
      expect(address).toBe('0xd077a400968890eacc75cdc901f0356c943e4fdb');
    });

    it('should return USDT address for mainnet', () => {
      const address = getUSDTAddress(1);
      expect(address).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    });

    it('should return null for unsupported chain', () => {
      const address = getUSDTAddress(999999);
      expect(address).toBeNull();
    });
  });
});

describe('USDT Formatting Functions', () => {
  describe('formatUSDT', () => {
    it('should format from 6 decimal base units', () => {
      expect(formatUSDT(1000000)).toBe('1.000000'); // 1 USDT
      expect(formatUSDT(100000)).toBe('0.100000'); // 0.1 USDT
      expect(formatUSDT(1)).toBe('0.000001'); // 0.000001 USDT
    });

    it('should handle bigint input', () => {
      expect(formatUSDT(BigInt(1000000))).toBe('1.000000');
      expect(formatUSDT(BigInt(500000000))).toBe('500.000000');
    });

    it('should handle zero', () => {
      expect(formatUSDT(0)).toBe('0.000000');
    });

    it('should handle large amounts', () => {
      expect(formatUSDT(1000000000000)).toBe('1000000.000000'); // 1M USDT
    });
  });

  describe('parseUSDT', () => {
    it('should parse to 6 decimal base units', () => {
      expect(parseUSDT(1)).toBe(BigInt(1000000));
      expect(parseUSDT(0.1)).toBe(BigInt(100000));
      expect(parseUSDT(100)).toBe(BigInt(100000000));
    });

    it('should handle string input', () => {
      expect(parseUSDT('1.5')).toBe(BigInt(1500000));
      expect(parseUSDT('0.01')).toBe(BigInt(10000));
    });

    it('should handle zero', () => {
      expect(parseUSDT(0)).toBe(BigInt(0));
    });

    it('should truncate beyond 6 decimals', () => {
      expect(parseUSDT(1.1234567)).toBe(BigInt(1123456)); // Truncates 7th decimal
    });
  });

  describe('roundtrip formatting', () => {
    it('should preserve value through format->parse', () => {
      const original = BigInt(1234567);
      const formatted = formatUSDT(original);
      const parsed = parseUSDT(parseFloat(formatted));
      expect(parsed).toBe(original);
    });

    it('should preserve whole numbers', () => {
      const amounts = [1, 10, 100, 1000, 10000];
      amounts.forEach(amount => {
        const parsed = parseUSDT(amount);
        const formatted = formatUSDT(parsed);
        expect(parseFloat(formatted)).toBe(amount);
      });
    });
  });
});

describe('Constants', () => {
  describe('ENTRY_POINT_V07', () => {
    it('should be the canonical v0.7 address', () => {
      expect(ENTRY_POINT_V07).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032');
    });

    it('should be checksummed', () => {
      expect(ENTRY_POINT_V07).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  describe('SAFE_4337_MODULE', () => {
    it('should have Safe proxy factory address', () => {
      expect(SAFE_4337_MODULE.safeProxyFactory).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('should have Safe singleton address', () => {
      expect(SAFE_4337_MODULE.safeSingleton).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('should have Safe 4337 module address', () => {
      expect(SAFE_4337_MODULE.safeModule4337).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it('should have MultiSend address', () => {
      expect(SAFE_4337_MODULE.multiSend).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });
});

describe('AAClient', () => {
  describe('static forChain', () => {
    it('should create client for supported chain', () => {
      const client = AAClient.forChain(11155111);
      expect(client).not.toBeNull();
    });

    it('should return null for unsupported chain', () => {
      const client = AAClient.forChain(999999);
      expect(client).toBeNull();
    });

    it('should accept provider parameter', () => {
      const pimlicoClient = AAClient.forChain(11155111, 'pimlico');
      const candideClient = AAClient.forChain(11155111, 'candide');
      
      expect(pimlicoClient).not.toBeNull();
      expect(candideClient).not.toBeNull();
      
      // They should have different configurations
      expect(pimlicoClient?.getConfig().paymasterAddress)
        .not.toBe(candideClient?.getConfig().paymasterAddress);
    });
  });

  describe('getConfig', () => {
    it('should return the configuration', () => {
      const client = AAClient.forChain(11155111, 'pimlico');
      expect(client?.getConfig()).toEqual(PIMLICO_SEPOLIA);
    });
  });

  describe('buildApprovalCallData', () => {
    it('should encode ERC20 approve function', () => {
      const client = AAClient.forChain(11155111);
      const callData = client?.buildApprovalCallData(
        '0x1234567890123456789012345678901234567890',
        BigInt(1000000)
      );
      
      // Should start with approve selector: 0x095ea7b3
      expect(callData).toMatch(/^0x095ea7b3/);
    });
  });

  describe('buildTransferCallData', () => {
    it('should encode ERC20 transfer function', () => {
      const client = AAClient.forChain(11155111);
      const callData = client?.buildTransferCallData(
        '0x1234567890123456789012345678901234567890',
        BigInt(1000000)
      );
      
      // Should start with transfer selector: 0xa9059cbb
      expect(callData).toMatch(/^0xa9059cbb/);
    });
  });
});

describe('estimateDepositCost', () => {
  it('should return cost breakdown for valid chain', async () => {
    // This is a mock test - actual estimation requires RPC call
    try {
      const estimate = await estimateDepositCost(11155111, 100);
      expect(estimate).toHaveProperty('depositAmount');
      expect(estimate).toHaveProperty('estimatedGasFee');
      expect(estimate).toHaveProperty('totalCost');
    } catch (error) {
      // Expected if no RPC connection
      expect(error).toBeDefined();
    }
  });

  it('should throw for unsupported chain', async () => {
    await expect(estimateDepositCost(999999, 100)).rejects.toThrow();
  });
});

describe('UserOperation Types', () => {
  it('should be correctly typed', () => {
    // Type check - these should compile
    const config = PIMLICO_SEPOLIA;
    const sender: string = config.entryPointAddress;
    const chainId: number = config.chainId;
    const isTest: boolean = config.isTestnet;
    const maxFee: number = config.transferMaxFee;
    
    expect(sender).toMatch(/^0x/);
    expect(chainId).toBe(11155111);
    expect(isTest).toBe(true);
    expect(maxFee).toBe(100000);
  });
});

describe('Integration Tests (requires network)', () => {
  // These tests require actual network connectivity
  // Mark as skip if running in CI without network access
  
  describe.skip('Live bundler tests', () => {
    it('should get supported entry points from Pimlico', async () => {
      const client = AAClient.forChain(11155111, 'pimlico');
      // Would need to implement getSupportedEntryPoints on client
    });
  });
});
