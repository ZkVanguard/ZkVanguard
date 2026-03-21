import { useState, useCallback } from 'react';
import { useAccount, useSignMessage } from './wdk-hooks';
import { ethers } from 'ethers';

interface UserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
}

interface DepositResponse {
  userOp: UserOperation;
  userOpHash: string;
}

export function useSmartAccount() {
  const { address, chain } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const depositWithGasless = useCallback(async (amount: string) => {
    setLoading(true);
    setError(null);
    try {
      if (!address || !chain) throw new Error('Wallet not connected');

      // 1. Get UserOp from Server
      const response = await fetch('/api/community-pool/deposit-usdt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smartAccountAddress: address,
          amount,
          chainId: chain?.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create UserOp');
      }

      const { userOp, userOpHash } = await response.json();
      
      if (!userOpHash) {
        throw new Error('API did not return UserOpHash');
      }

      // 2. Sign the UserOp Hash
      // Sign the raw 32-byte hash.
      const signature = await signMessageAsync({
        message: ethers.getBytes(userOpHash)
      });
      if (!signature) throw new Error('Failed to sign message');
      
      // 3. Submit the Signed UserOp
      userOp.signature = signature;

      const submitResponse = await fetch('/api/community-pool/deposit-usdt?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userOp,
          signature,
          chainId: chain?.id,
        }),
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json();
        throw new Error(errorData.error || 'Failed to submit UserOp');
      }

      const result = await submitResponse.json();
      return result.txHash;
    } catch (err: any) {
      console.error('Gasless deposit failed:', err);
      setError(err.message || 'Gasless deposit failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [address, chain, signMessageAsync]);

  return {
    depositWithGasless,
    loading,
    error
  };
}
