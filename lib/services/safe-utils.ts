import { ethers } from 'ethers';
import { SAFE_CONFIG } from '@/lib/config/aa-paymaster';

/**
 * Utility for Safe (Gnosis Safe) operations like address prediction
 * and initCode generation for UserOperations.
 */
export class SafeUtils {
  
  /**
   * Calculate Safe address counterfactually
   */
  static async getSafeAddress(
    owner: string, 
    chainId: number, 
    saltNonce: number = 0
  ): Promise<{ address: string; factory: string; factoryData: string }> {
    const config = SAFE_CONFIG[chainId as keyof typeof SAFE_CONFIG];
    if (!config) throw new Error(`Safe config not found for chain ${chainId}`);
    
    // Encode setup call data based on 1.3.0/1.4.1 Safe interface
    const setupData = SafeUtils.encodeSetupCall(owner, chainId);
    
    // Create proxy creation code for Safe Proxy Factory 1.3.0
    // The proxy creation code for the official Safe Proxy Factory 1.3.0 is:
    // 0x603d603760003960376000f3fe602b60045260006000600c6101000a81549061010002900460205260206000f3
    // Wait, that's the runtime code of the proxy? No.
    // The ProxyFactory uses:
    // assembly {
    //   let ptr := mload(0x40)
    //   mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
    //   mstore(add(ptr, 0x14), shl(0x60, singleton))
    //   mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
    //   proxy := create2(0, ptr, 0x37, salt)
    // }
    // The creation code is 0x3d602d80600a3d3981f3363d3d373d3d3d363d73 + singleton + 5af43d82803e903d91602b57fd5bf3
    
    // Safe Proxy Factory 1.3.0 Proxy Creation Code
    // Fetched from 0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2 on Sepolia
    const PROXY_CREATION_CODE = '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea2646970667358221220d1429297349653a4918076d650332de1a1068c5f3e07c5c82360c277770b955264736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564';
    
    // deploymentData = proxyCreationCode + uint256(singleton)
    // Note: Use solidityPacked to ensure correct concatenation without extra length prefixes for the bytes
    // But proxyCreationCode is bytes, so solidityPacked is safer? 
    // Actually creationCode is just bytes. Singleton is address.
    
    const deploymentData = ethers.solidityPacked(
        ['bytes', 'uint256'],
        [PROXY_CREATION_CODE, config.safeSingleton]
    );
    
    const salt = ethers.solidityPackedKeccak256(
      ['bytes32', 'uint256'],
      [ethers.keccak256(setupData), saltNonce]
    );
        
    const initCodeHash = ethers.keccak256(deploymentData);
    
    const address = ethers.getCreate2Address(
      config.safeProxyFactory,
      salt,
      initCodeHash
    );

    // Encode the factory call for initCode
    const factoryInterface = new ethers.Interface([
        'function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) returns (address proxy)'
    ]);
    
    // factoryData = functionSelector + params
    // factory = factoryAddress
    // initCode = factory + factoryData
    const encodedFactoryCall = factoryInterface.encodeFunctionData('createProxyWithNonce', [
        config.safeSingleton,
        setupData,
        saltNonce
    ]);

    return {
        address,
        factory: config.safeProxyFactory,
        factoryData: encodedFactoryCall
    };
  }

  /**
   * Encode setup() call for single owner Safe
   */
  static encodeSetupCall(owner: string, chainId: number): string {
    const config = SAFE_CONFIG[chainId as keyof typeof SAFE_CONFIG];
    
    const iface = new ethers.Interface([
      'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)'
    ]);
    
    return iface.encodeFunctionData('setup', [
      [owner],
      1, // threshold
      ethers.ZeroAddress,
      '0x',
      config.fallbackHandler,
      ethers.ZeroAddress,
      0,
      ethers.ZeroAddress
    ]);
  }

  /**
   * Encode MultiSend transaction
   * transactions format: operation(1)to(20)value(32)dataLength(32)data(bytes)
   */
  static encodeMultiSend(transactions: Array<{ to: string, value: bigint, data: string, operation?: number }>): string {
    let packed = '0x';
    
    for (const tx of transactions) {
      const operation = tx.operation || 0; // 0 = Call, 1 = DelegateCall
      const to = tx.to.toLowerCase().replace('0x', '');
      const value = tx.value.toString(16).padStart(64, '0');
      const data = tx.data.replace('0x', '');
      const dataLength = (data.length / 2).toString(16).padStart(64, '0');
      
      const txEncoded =
        operation.toString(16).padStart(2, '0') +
        to +
        value +
        dataLength +
        data;
        
      packed += txEncoded;
    }

    const iface = new ethers.Interface(['function multiSend(bytes transactions)']);
    return iface.encodeFunctionData('multiSend', [packed]);
  }

  /**
   * Encode executeUserOp for Safe 4337 Module
   * function executeUserOp(address to, uint256 value, bytes calldata data, uint8 operation)
   */
  static encodeExecuteUserOp(to: string, value: bigint, data: string, operation: number): string {
    const iface = new ethers.Interface([
      'function executeUserOp(address to, uint256 value, bytes calldata data, uint8 operation)'
    ]);
    return iface.encodeFunctionData('executeUserOp', [to, value, data, operation]);
  }
}
