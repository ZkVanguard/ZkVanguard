'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, ArrowDown, RefreshCw, ArrowDownUp } from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { getVVSFinanceService } from '../../lib/services/VVSFinanceService';

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTokenIn?: string;
  defaultTokenOut?: string;
  defaultAmountIn?: string;
  onSuccess?: () => void;
}

export function SwapModal({ 
  isOpen, 
  onClose, 
  defaultTokenIn = 'WCRO',
  defaultTokenOut = 'USDC',
  defaultAmountIn = '',
  onSuccess 
}: SwapModalProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const dexService = getVVSFinanceService(338);
  const supportedTokens = dexService.getSupportedTokens();
  
  const [tokenIn, setTokenIn] = useState<string>(defaultTokenIn);
  const [tokenOut, setTokenOut] = useState<string>(defaultTokenOut);
  const [amountIn, setAmountIn] = useState<string>(defaultAmountIn);
  const [amountOut, setAmountOut] = useState<string>('0');
  const [slippage, setSlippage] = useState<number>(0.5);
  const [priceImpact, setPriceImpact] = useState<number>(0);
  const [route, setRoute] = useState<string>('');
  const [tokenInBalance, setTokenInBalance] = useState<string>('0');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isTestnet, setIsTestnet] = useState(false);
  
  const [step, setStep] = useState<'input' | 'approve' | 'swap' | 'success' | 'error'>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Check if on testnet for badge display
  useEffect(() => {
    publicClient?.getChainId().then(chainId => {
      setIsTestnet(chainId === 338);
    });
  }, [publicClient]);

  // ERC20 balanceOf ABI
  const ERC20_BALANCE_ABI = [
    {
      type: 'function',
      name: 'balanceOf',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    },
  ] as const;

  // Fetch token balance
  const fetchTokenBalance = async (tokenSymbol: string) => {
    if (!publicClient || !address) {
      setTokenInBalance('0');
      return;
    }

    try {
      setBalanceLoading(true);
      const tokenAddress = supportedTokens[tokenSymbol];
      
      if (!tokenAddress) {
        setTokenInBalance('0');
        return;
      }

      // For native CRO/WCRO, get native balance
      if (tokenSymbol === 'WCRO' || tokenSymbol === 'CRO') {
        const balance = await publicClient.getBalance({ address });
        const decimals = getTokenDecimals(tokenSymbol);
        setTokenInBalance(formatUnits(balance, decimals));
      } else {
        // For ERC20 tokens
        const balance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        const decimals = getTokenDecimals(tokenSymbol);
        setTokenInBalance(formatUnits(balance as bigint, decimals));
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
      setTokenInBalance('0');
    } finally {
      setBalanceLoading(false);
    }
  };

  // Fetch balance when tokenIn changes or modal opens
  useEffect(() => {
    if (isOpen && tokenIn) {
      fetchTokenBalance(tokenIn);
    }
  }, [isOpen, tokenIn, address]);

  // Update tokens when modal opens with new defaults
  useEffect(() => {
    if (isOpen) {
      // Normalize token names (all uppercase for lookup)
      const normalizeToken = (token: string) => {
        const upper = token.toUpperCase();
        if (upper === 'DEVUSDC') return 'USDC'; // Display as USDC
        if (upper === 'CRO') return 'WCRO';
        return upper;
      };
      setTokenIn(normalizeToken(defaultTokenIn));
      setTokenOut(normalizeToken(defaultTokenOut));
      setStep('input');
      setErrorMessage('');
    }
  }, [isOpen, defaultTokenIn, defaultTokenOut]);

  // Get token decimals
  const getTokenDecimals = (symbol: string): number => {
    if (symbol === 'devUSDC' || symbol === 'USDC' || symbol === 'USDT') return 6;
    return 18; // Default for WCRO, CRO, etc.
  };

  // Approval transaction
  const { 
    writeContract: writeApprove, 
    data: approveHash,
    isPending: isApprovePending,
    error: approveError 
  } = useWriteContract();

  const { 
    isLoading: isApproveConfirming, 
    isSuccess: isApproveSuccess 
  } = useWaitForTransactionReceipt({ hash: approveHash });

  // Swap transaction
  const { 
    writeContract: writeSwap, 
    data: swapHash,
    isPending: isSwapPending,
    error: swapError 
  } = useWriteContract();

  const { 
    isLoading: isSwapConfirming, 
    isSuccess: isSwapSuccess 
  } = useWaitForTransactionReceipt({ hash: swapHash });

  // Get quote when amount changes
  useEffect(() => {
    if (!amountIn || parseFloat(amountIn) === 0) {
      setAmountOut('0');
      return;
    }

    const fetchQuote = async () => {
      try {
        setQuoteLoading(true);
        const decimals = getTokenDecimals(tokenIn);
        const amountInWei = parseUnits(amountIn, decimals);

        const quote = await dexService.getSwapQuote({
          tokenIn,
          tokenOut,
          amountIn: amountInWei,
          slippage,
        });

        const outDecimals = getTokenDecimals(tokenOut);
        setAmountOut(formatUnits(quote.amountOut, outDecimals));
        setPriceImpact(quote.priceImpact);
        setRoute(quote.route);
      } catch (error) {
        console.error('Failed to get quote:', error);
        setAmountOut('0');
      } finally {
        setQuoteLoading(false);
      }
    };

    const debounce = setTimeout(fetchQuote, 500);
    return () => clearTimeout(debounce);
  }, [amountIn, tokenIn, tokenOut, slippage]);

  // Handle approval success
  useEffect(() => {
    if (isApproveSuccess && step === 'approve') {
      setStep('swap');
      executeSwap();
    }
  }, [isApproveSuccess]);

  // Handle swap success
  useEffect(() => {
    if (isSwapSuccess && step === 'swap') {
      setStep('success');
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 2000);
    }
  }, [isSwapSuccess]);

  // Handle errors
  useEffect(() => {
    if (approveError && step === 'approve') {
      setStep('error');
      setErrorMessage(approveError.message);
    }
    if (swapError && step === 'swap') {
      setStep('error');
      setErrorMessage(swapError.message);
    }
  }, [approveError, swapError]);

  const handleSwap = async () => {
    if (!address || !amountIn || parseFloat(amountIn) === 0) return;

    try {
      setErrorMessage('');
      setIsDemoMode(false);
      
      // Check if on testnet - VVS Finance only exists on mainnet
      const chainId = await publicClient?.getChainId();
      if (chainId === 338) {
        // Testnet demo mode - show success without actual swap
        setIsDemoMode(true);
        setStep('swap');
        setTimeout(() => {
          setStep('success');
          setTimeout(() => {
            onSuccess?.();
            handleClose();
          }, 2000);
        }, 1500);
        return;
      }

      const decimals = getTokenDecimals(tokenIn);
      const amountInWei = parseUnits(amountIn, decimals);

      // Get quote
      const quote = await dexService.getSwapQuote({
        tokenIn,
        tokenOut,
        amountIn: amountInWei,
        slippage,
      });

      // Check if approval needed (skip for native CRO)
      const tokenInAddress = supportedTokens[tokenIn.toUpperCase()];
      if (tokenIn.toUpperCase() !== 'CRO' && tokenIn.toUpperCase() !== 'WCRO') {
        const { needsApproval } = await dexService.checkApproval(tokenInAddress, address, amountInWei);
        
        if (needsApproval) {
          setStep('approve');
          const approvalCall = dexService.getApprovalContractCall(tokenInAddress, amountInWei);
          writeApprove(approvalCall as any);
          return;
        }
      }

      // Execute swap directly
      setStep('swap');
      await executeSwap();
    } catch (error: any) {
      setStep('error');
      setErrorMessage(error.message);
    }
  };

  const executeSwap = async () => {
    if (!address || !amountIn) return;

    const decimals = getTokenDecimals(tokenIn);
    const amountInWei = parseUnits(amountIn, decimals);

    const quote = await dexService.getSwapQuote({
      tokenIn,
      tokenOut,
      amountIn: amountInWei,
      slippage,
    });

    const swapCall = dexService.getSwapContractCall(
      {
        tokenIn,
        tokenOut,
        amountIn: amountInWei,
        slippage,
        recipient: address,
      },
      quote
    );

    writeSwap(swapCall as any);
  };

  const handleClose = () => {
    setStep('input');
    setAmountIn('');
    setAmountOut('0');
    setErrorMessage('');
    onClose();
  };

  const switchTokens = () => {
    const temp = tokenIn;
    setTokenIn(tokenOut);
    setTokenOut(temp);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl max-w-md w-full border border-gray-700 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold">Swap Tokens</h3>
            {isTestnet && (
              <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
                Demo Mode
              </span>
            )}
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {step === 'input' && (
            <>
              {/* Token In */}
              <div className="bg-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-400">From</label>
                  <button 
                    onClick={() => setAmountIn(tokenInBalance)}
                    className="text-xs text-gray-500 hover:text-cyan-400 transition-colors"
                  >
                    Balance: {balanceLoading ? '...' : parseFloat(tokenInBalance).toFixed(4)}
                    {parseFloat(tokenInBalance) > 0 && <span className="text-cyan-400 ml-1">(MAX)</span>}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="number"
                    value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 min-w-0 bg-transparent text-2xl font-bold outline-none"
                    step="0.01"
                  />
                  <select
                    value={tokenIn}
                    onChange={(e) => setTokenIn(e.target.value)}
                    className="bg-gray-700 rounded-lg px-3 py-2 font-semibold text-sm flex-shrink-0"
                  >
                    {Object.keys(supportedTokens).map(symbol => (
                      <option key={symbol} value={symbol}>{symbol}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Switch Button */}
              <div className="flex justify-center -my-2 relative z-10">
                <button
                  onClick={switchTokens}
                  className="bg-gray-800 border-4 border-gray-900 rounded-xl p-2 hover:bg-gray-700 transition-colors"
                >
                  <ArrowDownUp className="w-5 h-5" />
                </button>
              </div>

              {/* Token Out */}
              <div className="bg-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-400">To (estimated)</label>
                  {quoteLoading && <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={amountOut}
                    readOnly
                    placeholder="0.0"
                    className="flex-1 min-w-0 bg-transparent text-2xl font-bold outline-none text-gray-400"
                  />
                  <select
                    value={tokenOut}
                    onChange={(e) => setTokenOut(e.target.value)}
                    className="bg-gray-700 rounded-lg px-3 py-2 font-semibold text-sm flex-shrink-0"
                  >
                    {Object.keys(supportedTokens).map(symbol => (
                      <option key={symbol} value={symbol}>{symbol}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Swap Details */}
              {parseFloat(amountOut) > 0 && (
                <div className="bg-gray-800 rounded-lg p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Rate</span>
                    <span className="font-semibold">
                      1 {tokenIn} ≈ {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(6)} {tokenOut}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Price Impact</span>
                    <span className={`font-semibold ${priceImpact > 5 ? 'text-red-400' : 'text-green-400'}`}>
                      {priceImpact.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Route</span>
                    <span className="font-mono text-xs">{route}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Slippage</span>
                    <span className="font-semibold">{slippage}%</span>
                  </div>
                </div>
              )}

              {/* Slippage Settings */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Slippage:</span>
                {[0.1, 0.5, 1.0].map(val => (
                  <button
                    key={val}
                    onClick={() => setSlippage(val)}
                    className={`px-3 py-1 rounded-lg text-sm ${
                      slippage === val 
                        ? 'bg-cyan-600 text-white' 
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>

              {/* Swap Button */}
              <button
                onClick={handleSwap}
                disabled={!amountIn || parseFloat(amountIn) === 0 || quoteLoading}
                className="w-full py-4 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-700 hover:to-emerald-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed rounded-xl font-bold text-lg transition-all"
              >
                {quoteLoading ? 'Getting Quote...' : 'Swap'}
              </button>

              <p className="text-xs text-center text-gray-500">
                ⚡ Gasless via x402 protocol • Powered by VVS Finance
              </p>
            </>
          )}

          {/* Approval Step */}
          {step === 'approve' && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-cyan-400" />
              <h4 className="text-lg font-semibold mb-2">Approve Token Spending</h4>
              <p className="text-gray-400 text-sm">
                {isApprovePending && 'Waiting for approval confirmation...'}
                {isApproveConfirming && 'Approval transaction confirming...'}
              </p>
            </div>
          )}

          {/* Swap Step */}
          {step === 'swap' && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-cyan-400" />
              <h4 className="text-lg font-semibold mb-2">
                {isDemoMode ? 'Processing Demo Swap...' : 'Executing Swap'}
              </h4>
              <p className="text-gray-400 text-sm">
                {isDemoMode && 'Simulating transaction...'}
                {!isDemoMode && isSwapPending && 'Waiting for swap confirmation...'}
                {!isDemoMode && isSwapConfirming && 'Swap transaction confirming...'}
              </p>
            </div>
          )}

          {/* Success Step */}
          {step === 'success' && (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-400" />
              <h4 className="text-lg font-semibold mb-2">
                {isDemoMode ? '✨ Demo Swap Complete!' : 'Swap Successful!'}
              </h4>
              <p className="text-gray-400 text-sm">
                {isDemoMode ? (
                  <>Simulated swap of {amountIn} {tokenIn} for ~{parseFloat(amountOut || '0').toFixed(6)} {tokenOut}</>
                ) : (
                  <>Swapped {amountIn} {tokenIn} for {parseFloat(amountOut).toFixed(6)} {tokenOut}</>
                )}
              </p>
              {isDemoMode && (
                <p className="text-xs text-amber-400 mt-2">
                  🔶 Testnet Mode - Real swaps available on Mainnet
                </p>
              )}
            </div>
          )}

          {/* Error Step */}
          {step === 'error' && (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
              <h4 className="text-lg font-semibold mb-2">Swap Failed</h4>
              <p className="text-gray-400 text-sm mb-4">{errorMessage}</p>
              <button
                onClick={() => setStep('input')}
                className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
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
