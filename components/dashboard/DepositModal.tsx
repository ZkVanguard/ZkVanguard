'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Coins, ExternalLink, Zap } from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { getContractAddresses } from '../../lib/contracts/addresses';
import { RWA_MANAGER_ABI } from '../../lib/contracts/abis';
import { trackSuccessfulTransaction } from '@/lib/utils/transactionTracker';
import { X402GaslessService } from '../../lib/services/X402GaslessService';
import { ethers } from 'ethers';

// Cronos Testnet tokens ONLY (verified contract addresses)
const TESTNET_TOKENS = [
  { 
    symbol: 'devUSDC', 
    name: 'DevUSDCe (Testnet)',
    address: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0' as `0x${string}`,
    decimals: 6,
    description: 'Testnet USDC for development'
  },
  { 
    symbol: 'WCRO', 
    name: 'Wrapped CRO (Testnet)',
    address: '0x6a3173618859C7cd40fAF6921b5E9eB6A76f1fD4' as `0x${string}`,
    decimals: 18,
    description: 'Wrapped version of tCRO'
  },
];

// ERC20 ABI for approve and balanceOf
const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolioId: number;
  targetYield: number;
  riskTolerance: number;
  onSuccess?: () => void;
}

export function DepositModal({ 
  isOpen, 
  onClose, 
  portfolioId, 
  targetYield, 
  riskTolerance,
  onSuccess 
}: DepositModalProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [selectedToken, setSelectedToken] = useState(TESTNET_TOKENS[0]);
  const [amount, setAmount] = useState('');
  const [tokenBalance, setTokenBalance] = useState<string>('0');
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [step, setStep] = useState<'input' | 'approve' | 'deposit' | 'success' | 'error'>('input');
  const [errorMessage, setErrorMessage] = useState('');

  const addresses = getContractAddresses(338);
  const rwaManagerAddress = addresses.rwaManager as `0x${string}`;

  // Approve transaction
  const { 
    writeContract: writeApprove, 
    data: approveHash,
    isPending: isApprovePending,
    error: approveError 
  } = useWriteContract();

  // Deposit transaction
  const { 
    writeContract: writeDeposit, 
    data: depositHash,
    isPending: isDepositPending,
    error: depositError 
  } = useWriteContract();

  // Wait for approve confirmation
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = 
    useWaitForTransactionReceipt({ hash: approveHash });

  // Wait for deposit confirmation
  const { isLoading: isDepositConfirming, isSuccess: isDepositSuccess } = 
    useWaitForTransactionReceipt({ hash: depositHash });

  // Fetch token balance and allowance
  useEffect(() => {
    async function fetchBalanceAndAllowance() {
      if (!address || !publicClient) return;

      try {
        const balance = await publicClient.readContract({
          address: selectedToken.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setTokenBalance(formatUnits(balance, selectedToken.decimals));

        const currentAllowance = await publicClient.readContract({
          address: selectedToken.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, rwaManagerAddress],
        });
        setAllowance(currentAllowance);
      } catch (error) {
        console.error('Failed to fetch balance:', error);
        setTokenBalance('0');
      }
    }

    if (isOpen) {
      fetchBalanceAndAllowance();
    }
  }, [address, selectedToken, isOpen, publicClient, rwaManagerAddress]);

  // Handle approve success - proceed to deposit
  useEffect(() => {
    if (isApproveSuccess && step === 'approve' && approveHash && address) {
      // Track the approval transaction
      trackSuccessfulTransaction({
        hash: approveHash,
        type: 'approve',
        from: address,
        to: selectedToken.address,
        value: amount,
        tokenSymbol: selectedToken.symbol,
        description: `Approve ${selectedToken.symbol} for Portfolio #${portfolioId}`,
      });
      handleDeposit();
    }
  }, [isApproveSuccess, approveHash, address, step]);

  // Handle deposit success
  useEffect(() => {
    if (isDepositSuccess && depositHash && address) {
      // Track the successful deposit transaction
      trackSuccessfulTransaction({
        hash: depositHash,
        type: 'deposit',
        from: address,
        to: rwaManagerAddress,
        value: amount,
        tokenSymbol: selectedToken.symbol,
        description: `Deposit ${amount} ${selectedToken.symbol} to Portfolio #${portfolioId}`,
      });
      
      setStep('success');
      onSuccess?.();
    }
  }, [isDepositSuccess, depositHash, address, amount, selectedToken.symbol, portfolioId, rwaManagerAddress]);

  // Handle errors
  useEffect(() => {
    if (approveError) {
      setErrorMessage(approveError.message || 'Approval failed');
      setStep('error');
    }
    if (depositError) {
      setErrorMessage(depositError.message || 'Deposit failed');
      setStep('error');
    }
  }, [approveError, depositError]);

  const handleApprove = () => {
    if (!amount) return;
    
    const amountInWei = parseUnits(amount, selectedToken.decimals);
    setStep('approve');

    writeApprove({
      address: selectedToken.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [rwaManagerAddress, amountInWei],
    });
  };

  const handleDeposit = () => {
    if (!amount) return;
    
    const amountInWei = parseUnits(amount, selectedToken.decimals);
    setStep('deposit');

    writeDeposit({
      address: rwaManagerAddress,
      abi: RWA_MANAGER_ABI,
      functionName: 'depositAsset',
      args: [BigInt(portfolioId), selectedToken.address, amountInWei],
    });
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) return;

    const amountInWei = parseUnits(amount, selectedToken.decimals);
    
    // Check if we need approval first
    if (allowance < amountInWei) {
      handleApprove();
    } else {
      handleDeposit();
    }
  };

  const needsApproval = amount && parseFloat(amount) > 0 && 
    allowance < parseUnits(amount || '0', selectedToken.decimals);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl border border-[#e8e8ed] w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#e8e8ed]">
          <div>
            <h2 className="text-xl font-bold">Fund Portfolio #{portfolioId}</h2>
            <p className="text-sm text-[#86868b] mt-1">
              {targetYield}% yield target • {riskTolerance}/100 risk
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[#F5F5F7] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'input' && (
            <>
              {/* Token Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                  Select Token
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TESTNET_TOKENS.slice(0, 6).map((token) => (
                    <button
                      key={token.symbol}
                      onClick={() => setSelectedToken(token)}
                      className={`p-3 rounded-lg border transition-all ${
                        selectedToken.symbol === token.symbol
                          ? 'border-cyan-500 bg-cyan-500/10'
                          : 'border-gray-600 hover:border-gray-500 bg-[#f5f5f7]'
                      }`}
                    >
                      <div className="text-sm font-semibold">{token.symbol}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#1d1d1f] mb-2">
                  Amount
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-[#f5f5f7] border border-gray-600 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                  <button
                    onClick={() => setAmount(tokenBalance)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#007AFF] hover:text-cyan-300"
                  >
                    MAX
                  </button>
                </div>
                <div className="flex justify-between mt-2 text-sm">
                  <span className="text-[#86868b]">Available:</span>
                  <span className="text-[#1d1d1f]">
                    {parseFloat(tokenBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })} {selectedToken.symbol}
                  </span>
                </div>
              </div>

              {/* Info Box */}
              <div className="bg-[#f5f5f7] rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Coins className="w-5 h-5 text-[#007AFF] mt-0.5" />
                  <div className="text-sm">
                    <p className="text-[#1d1d1f] mb-1">
                      Depositing to smart contract portfolio
                    </p>
                    <p className="text-gray-500 text-xs">
                      Tokens will be transferred to the RWAManager contract for automated strategy execution.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleSubmit}
                disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > parseFloat(tokenBalance)}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold transition-all"
              >
                {needsApproval ? `Approve & Deposit ${selectedToken.symbol}` : `Deposit ${selectedToken.symbol}`}
              </button>

              {parseFloat(tokenBalance) === 0 && (
                <p className="text-center text-[#FF9500] text-sm mt-3">
                  You don't have any {selectedToken.symbol}. Try a different token or get testnet tokens first.
                </p>
              )}
            </>
          )}

          {(step === 'approve' || step === 'deposit') && (
            <div className="text-center py-8">
              <Loader2 className="w-16 h-16 text-[#007AFF] animate-spin mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">
                {step === 'approve' ? 'Approving Token...' : 'Depositing...'}
              </h3>
              <p className="text-[#86868b] mb-4">
                {step === 'approve' 
                  ? 'Please confirm the approval in your wallet'
                  : 'Please confirm the deposit in your wallet'}
              </p>
              {(isApproveConfirming || isDepositConfirming) && (
                <p className="text-sm text-[#007AFF]">
                  Waiting for confirmation...
                </p>
              )}
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <CheckCircle className="w-16 h-16 text-[#34C759] mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Deposit Successful!</h3>
              <p className="text-[#86868b] mb-4">
                {amount} {selectedToken.symbol} has been deposited to Portfolio #{portfolioId}
              </p>
              {depositHash && (
                <a
                  href={`https://explorer.cronos.org/testnet/tx/${depositHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-[#007AFF] hover:text-cyan-300"
                >
                  View Transaction <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <button
                onClick={onClose}
                className="w-full mt-6 py-3 bg-[#F5F5F7] border border-[#E5E5EA] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-lg font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-8">
              <AlertCircle className="w-16 h-16 text-[#FF3B30] mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Transaction Failed</h3>
              <p className="text-[#86868b] mb-4 text-sm break-words">
                {errorMessage.slice(0, 200)}
              </p>
              <button
                onClick={() => {
                  setStep('input');
                  setErrorMessage('');
                }}
                className="w-full py-3 bg-[#F5F5F7] border border-[#E5E5EA] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-lg font-semibold transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
