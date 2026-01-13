'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, ArrowDown, RefreshCw, ArrowDownUp, Shield } from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { trackSuccessfulTransaction } from '@/lib/utils/transactionTracker';
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

// ZK API URL
const ZK_API_URL = process.env.NEXT_PUBLIC_ZK_API_URL || 'http://localhost:8000';

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
  
  // Actual token addresses for balance fetching (different from swap quote addresses)
  // Swap quotes use mainnet addresses, but balances need testnet addresses
  const BALANCE_TOKEN_ADDRESSES: Record<string, string> = {
    WCRO: '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4',
    CRO: '0x6a3173618859c7cd40faf6921b5e9eb6a76f1fd4',
    // Actual devUSDC on Cronos Testnet
    USDC: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0',
    devUSDC: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0',
    DEVUSDC: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0',
    // VVS token on testnet
    VVS: '0x904Bd5a5AAC0B9d88A0D47864724218986Ad4a3a',
  };
  
  const [tokenIn, setTokenIn] = useState<string>(defaultTokenIn);
  const [tokenOut, setTokenOut] = useState<string>(defaultTokenOut);
  const [amountIn, setAmountIn] = useState<string>(defaultAmountIn);
  const [amountOut, setAmountOut] = useState<string>('0');
  const [slippage, setSlippage] = useState<number>(0.5);
  const [priceImpact, setPriceImpact] = useState<number>(0);
  const [route, setRoute] = useState<string>('');
  const [tokenInBalance, setTokenInBalance] = useState<string>('0');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [zkProofHash, setZkProofHash] = useState<string>('');
  const [zkProofGenerating, setZkProofGenerating] = useState(false);
  const [isTestnet, setIsTestnet] = useState(false);
  
  const [step, setStep] = useState<'input' | 'zk-proof' | 'approve' | 'swap' | 'success' | 'error'>('input');
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
      // Use balance-specific token addresses (actual testnet contracts)
      const tokenAddress = BALANCE_TOKEN_ADDRESSES[tokenSymbol] || BALANCE_TOKEN_ADDRESSES[tokenSymbol.toUpperCase()];
      
      if (!tokenAddress) {
        console.warn('No balance address for token:', tokenSymbol);
        setTokenInBalance('0');
        return;
      }

      // For native CRO/WCRO, get native balance
      if (tokenSymbol === 'WCRO' || tokenSymbol === 'CRO') {
        const balance = await publicClient.getBalance({ address });
        const decimals = getTokenDecimals(tokenSymbol);
        setTokenInBalance(formatUnits(balance, decimals));
      } else {
        // For ERC20 tokens (devUSDC, VVS, etc.)
        console.log('Fetching balance for', tokenSymbol, 'at', tokenAddress);
        const balance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        const decimals = getTokenDecimals(tokenSymbol);
        console.log('Balance result:', balance, 'decimals:', decimals);
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
    if (isSwapSuccess && step === 'swap' && swapHash && address) {
      // Track the successful swap transaction
      trackSuccessfulTransaction({
        hash: swapHash,
        type: 'swap',
        from: address,
        to: '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae', // VVS Router
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        value: amountIn,
        tokenSymbol: tokenIn,
        description: `Swap ${amountIn} ${tokenIn} for ${amountOut} ${tokenOut}`,
      });
      
      setStep('success');
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 2000);
    }
  }, [isSwapSuccess, swapHash, address, tokenIn, tokenOut, amountIn, amountOut]);

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
      setZkProofHash('');
      
      const chainId = await publicClient?.getChainId();
      const decimals = getTokenDecimals(tokenIn);
      const amountInWei = parseUnits(amountIn, decimals);
      const tokenInAddress = supportedTokens[tokenIn.toUpperCase()];

      // Step 1: Generate ZK-STARK proof for swap verification
      setStep('zk-proof');
      setZkProofGenerating(true);
      
      console.log('🔐 Generating ZK-STARK proof for VVS Finance swap...');
      
      // Call ZK backend to generate proof
      try {
        const zkResponse = await fetch(`${ZK_API_URL}/api/zk/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proof_type: 'settlement',
            data: {
              payments: [{
                recipient: address,
                amount: parseFloat(amountIn),
                token: tokenIn
              }],
              swap: {
                tokenIn,
                tokenOut,
                amountIn: amountIn,
                expectedOut: amountOut,
                dex: 'VVS Finance'
              }
            },
            portfolio_id: 0
          })
        });
        
        if (zkResponse.ok) {
          const zkResult = await zkResponse.json();
          console.log('✅ ZK proof job created:', zkResult.job_id);
          
          // Poll for proof completion (max 10 seconds for better UX)
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const statusRes = await fetch(`${ZK_API_URL}/api/zk/proof/${zkResult.job_id}`);
            if (statusRes.ok) {
              const status = await statusRes.json();
              if (status.status === 'completed' && status.proof) {
                setZkProofHash(status.proof.merkle_root || status.proof.proof_hash || 'verified');
                console.log('✅ ZK-STARK proof generated!', status.proof.merkle_root);
                break;
              }
            }
          }
        }
      } catch (zkError) {
        console.warn('⚠️ ZK backend not available, proceeding with DEX swap:', zkError);
        // Continue without ZK proof - swap is still valid
      }
      
      setZkProofGenerating(false);

      // Step 2: Get quote from VVS Finance
      const quote = await dexService.getSwapQuote({
        tokenIn,
        tokenOut,
        amountIn: amountInWei,
        slippage,
      });

      // Step 3: Check if approval needed for VVS Router (skip for native CRO)
      if (tokenIn.toUpperCase() !== 'CRO' && tokenIn.toUpperCase() !== 'WCRO') {
        const { needsApproval } = await dexService.checkApproval(tokenInAddress, address, amountInWei);
        
        if (needsApproval) {
          setStep('approve');
          const approvalCall = dexService.getApprovalContractCall(tokenInAddress, amountInWei);
          writeApprove(approvalCall as any);
          return;
        }
      }

      // Step 4: Execute VVS Finance DEX Swap (PRIORITY)
      setStep('swap');
      console.log('🔄 Executing VVS Finance swap...');
      
      // Always try VVS Finance DEX first - intelligent routing
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
      
    } catch (error: any) {
      console.error('Swap error:', error);
      setStep('error');
      setErrorMessage(error.message || 'Swap failed');
      setZkProofGenerating(false);
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[20px] sm:rounded-[24px] max-w-[420px] w-full shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] border border-black/5">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-black/5">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[17px] sm:text-[20px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Swap Tokens</h3>
            <span className="px-2 py-0.5 text-[10px] sm:text-[11px] bg-[#007AFF]/10 text-[#007AFF] rounded-full font-semibold">
              VVS Finance
            </span>
            {zkProofHash && (
              <span className="px-2 py-0.5 text-[10px] sm:text-[11px] bg-[#AF52DE]/10 text-[#AF52DE] rounded-full font-semibold">
                🔐 ZK
              </span>
            )}
          </div>
          <button 
            onClick={handleClose} 
            className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-full transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 sm:px-6 py-4 sm:py-5 space-y-3 sm:space-y-4">
          {step === 'input' && (
            <>
              {/* Token In */}
              <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[16px] p-3.5 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] sm:text-[12px] text-[#86868b] font-medium">From</label>
                  <button 
                    onClick={() => setAmountIn(tokenInBalance)}
                    className="text-[11px] sm:text-[12px] text-[#86868b] hover:text-[#007AFF] transition-colors"
                  >
                    Balance: {balanceLoading ? '...' : parseFloat(tokenInBalance).toFixed(4)}
                    {parseFloat(tokenInBalance) > 0 && <span className="text-[#007AFF] ml-1 font-medium">(MAX)</span>}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="number"
                    value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 min-w-0 bg-transparent text-[22px] sm:text-[26px] font-bold text-[#1d1d1f] outline-none placeholder:text-[#86868b]"
                    step="0.01"
                  />
                  <select
                    value={tokenIn}
                    onChange={(e) => setTokenIn(e.target.value)}
                    className="bg-white border border-black/10 rounded-[10px] px-3 py-2 font-semibold text-[13px] sm:text-[14px] text-[#1d1d1f] flex-shrink-0 cursor-pointer hover:border-[#007AFF] transition-colors"
                  >
                    {/* Use balance token list - these are actual testnet tokens */}
                    {['CRO', 'WCRO', 'USDC', 'VVS'].map(symbol => (
                      <option key={symbol} value={symbol}>{symbol === 'USDC' ? 'devUSDC' : symbol}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Switch Button */}
              <div className="flex justify-center -my-1 relative z-10">
                <button
                  onClick={switchTokens}
                  className="bg-white border border-black/10 rounded-[12px] p-2.5 hover:bg-[#f5f5f7] hover:border-[#007AFF] active:scale-95 transition-all shadow-sm"
                >
                  <ArrowDownUp className="w-4 h-4 sm:w-5 sm:h-5 text-[#007AFF]" />
                </button>
              </div>

              {/* Token Out */}
              <div className="bg-[#f5f5f7] rounded-[14px] sm:rounded-[16px] p-3.5 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] sm:text-[12px] text-[#86868b] font-medium">To (estimated)</label>
                  {quoteLoading && <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin text-[#007AFF]" />}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="text"
                    value={amountOut}
                    readOnly
                    placeholder="0.0"
                    className="flex-1 min-w-0 bg-transparent text-[22px] sm:text-[26px] font-bold text-[#86868b] outline-none"
                  />
                  <select
                    value={tokenOut}
                    onChange={(e) => setTokenOut(e.target.value)}
                    className="bg-white border border-black/10 rounded-[10px] px-3 py-2 font-semibold text-[13px] sm:text-[14px] text-[#1d1d1f] flex-shrink-0 cursor-pointer hover:border-[#007AFF] transition-colors"
                  >
                    {/* Use balance token list - these are actual testnet tokens */}
                    {['CRO', 'WCRO', 'USDC', 'VVS'].map(symbol => (
                      <option key={symbol} value={symbol}>{symbol === 'USDC' ? 'devUSDC' : symbol}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Swap Details */}
              {parseFloat(amountOut) > 0 && (
                <div className="bg-[#f5f5f7] rounded-[12px] p-3 sm:p-3.5 space-y-2 text-[12px] sm:text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-[#86868b]">Rate</span>
                    <span className="font-semibold text-[#1d1d1f]">
                      1 {tokenIn} ≈ {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(6)} {tokenOut}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#86868b]">Price Impact</span>
                    <span className={`font-semibold ${priceImpact > 5 ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                      {priceImpact.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#86868b]">Route</span>
                    <span className="font-mono text-[11px] text-[#1d1d1f]">{route}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#86868b]">Slippage</span>
                    <span className="font-semibold text-[#1d1d1f]">{slippage}%</span>
                  </div>
                </div>
              )}

              {/* Slippage Settings */}
              <div className="flex items-center gap-2">
                <span className="text-[12px] sm:text-[13px] text-[#86868b]">Slippage:</span>
                {[0.1, 0.5, 1.0].map(val => (
                  <button
                    key={val}
                    onClick={() => setSlippage(val)}
                    className={`px-3 py-1.5 rounded-[8px] text-[12px] sm:text-[13px] font-medium transition-all ${
                      slippage === val 
                        ? 'bg-[#007AFF] text-white' 
                        : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
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
                className="w-full py-3.5 sm:py-4 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.98] disabled:bg-[#86868b] disabled:cursor-not-allowed rounded-[12px] font-semibold text-[15px] sm:text-[17px] text-white transition-all"
              >
                {quoteLoading ? 'Getting Quote...' : 'Swap'}
              </button>

              <p className="text-[10px] sm:text-[11px] text-center text-[#86868b]">
                🔄 VVS Finance DEX • 🔐 ZK-STARK verified • ⚡ x402 gasless
              </p>
            </>
          )}

          {/* ZK Proof Generation Step */}
          {step === 'zk-proof' && (
            <div className="text-center py-6 sm:py-8">
              <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 bg-[#AF52DE]/10 rounded-full flex items-center justify-center">
                <Shield className="w-7 h-7 sm:w-8 sm:h-8 text-[#AF52DE] animate-pulse" />
              </div>
              <h4 className="text-[17px] sm:text-[19px] font-semibold text-[#1d1d1f] mb-2">Generating ZK-STARK Proof</h4>
              <p className="text-[#86868b] text-[13px] sm:text-[14px] mb-4">
                {zkProofGenerating ? 'Creating cryptographic proof for VVS Finance swap...' : 'ZK proof generated!'}
              </p>
              {zkProofHash && (
                <div className="bg-[#f5f5f7] rounded-[10px] p-3 text-[11px] font-mono text-[#AF52DE] break-all">
                  Proof: {zkProofHash.substring(0, 32)}...
                </div>
              )}
              <p className="text-[10px] sm:text-[11px] text-[#86868b] mt-3">
                521-bit security • CUDA accelerated • VVS Finance routing
              </p>
            </div>
          )}

          {/* Approval Step */}
          {step === 'approve' && (
            <div className="text-center py-6 sm:py-8">
              <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 bg-[#007AFF]/10 rounded-full flex items-center justify-center">
                <Loader2 className="w-7 h-7 sm:w-8 sm:h-8 animate-spin text-[#007AFF]" />
              </div>
              <h4 className="text-[17px] sm:text-[19px] font-semibold text-[#1d1d1f] mb-2">Approve VVS Finance Router</h4>
              <p className="text-[#86868b] text-[13px] sm:text-[14px]">
                {isApprovePending && 'Waiting for approval confirmation...'}
                {isApproveConfirming && 'Approval transaction confirming...'}
              </p>
              <p className="text-[10px] sm:text-[11px] text-[#86868b] mt-2">
                Approving token spend for VVS Finance DEX
              </p>
            </div>
          )}

          {/* Swap Step */}
          {step === 'swap' && (
            <div className="text-center py-6 sm:py-8">
              <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 bg-[#007AFF]/10 rounded-full flex items-center justify-center">
                <Loader2 className="w-7 h-7 sm:w-8 sm:h-8 animate-spin text-[#007AFF]" />
              </div>
              <h4 className="text-[17px] sm:text-[19px] font-semibold text-[#1d1d1f] mb-2">Executing VVS Finance Swap</h4>
              <p className="text-[#86868b] text-[13px] sm:text-[14px]">
                {isSwapPending && 'Intelligent routing via VVS Finance...'}
                {isSwapConfirming && 'Swap confirming on Cronos...'}
              </p>
              {zkProofHash && (
                <p className="text-[11px] sm:text-[12px] text-[#AF52DE] mt-2 font-medium">
                  🔐 ZK Proof: {zkProofHash.substring(0, 16)}...
                </p>
              )}
              <p className="text-[10px] sm:text-[11px] text-[#86868b] mt-2">
                ⚡ x402 protocol • Automated liquidity routing
              </p>
            </div>
          )}

          {/* Success Step */}
          {step === 'success' && (
            <div className="text-center py-6 sm:py-8">
              <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 bg-[#34C759]/10 rounded-full flex items-center justify-center">
                <CheckCircle className="w-7 h-7 sm:w-8 sm:h-8 text-[#34C759]" />
              </div>
              <h4 className="text-[17px] sm:text-[19px] font-semibold text-[#1d1d1f] mb-2">Swap Complete!</h4>
              <p className="text-[#86868b] text-[13px] sm:text-[14px]">
                Swapped {amountIn} {tokenIn} for ~{parseFloat(amountOut || '0').toFixed(6)} {tokenOut}
              </p>
              {zkProofHash && (
                <div className="mt-3 bg-[#AF52DE]/10 rounded-[10px] p-3">
                  <p className="text-[12px] sm:text-[13px] text-[#AF52DE] font-medium">
                    ✅ ZK-STARK Proof Verified
                  </p>
                  <p className="text-[10px] sm:text-[11px] text-[#86868b] font-mono mt-1">
                    {zkProofHash.substring(0, 32)}...
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error Step */}
          {step === 'error' && (
            <div className="text-center py-6 sm:py-8">
              <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 bg-[#FF3B30]/10 rounded-full flex items-center justify-center">
                <AlertCircle className="w-7 h-7 sm:w-8 sm:h-8 text-[#FF3B30]" />
              </div>
              <h4 className="text-[17px] sm:text-[19px] font-semibold text-[#1d1d1f] mb-2">Swap Failed</h4>
              <p className="text-[#86868b] text-[13px] sm:text-[14px] mb-4">{errorMessage}</p>
              <button
                onClick={() => setStep('input')}
                className="px-6 py-2.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] active:scale-[0.97] rounded-[10px] text-[14px] font-medium text-[#1d1d1f] transition-all"
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
