'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Shield, TrendingDown, TrendingUp, AlertCircle, CheckCircle, Wallet, Copy, ExternalLink, Check, Coins, Loader2, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useChainId } from 'wagmi';
import { parseUnits, formatUnits, parseEther, keccak256, encodePacked } from 'viem';
import { trackSuccessfulTransaction } from '@/lib/utils/transactionTracker';
import { logger } from '@/lib/utils/logger';
import { MOCK_USDC_ADDRESS, MOCK_USDC_ABI } from './MockUSDCFaucet';
import { getContractAddresses } from '@/lib/contracts/addresses';
import { EXPLORER_URLS } from '@/lib/hooks/useNetwork';

// ── Asset → pairIndex mapping (must match HedgeExecutor) ────────
const PAIR_INDEX: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  CRO: 2,
  ATOM: 3,
  DOGE: 4,
  SOL: 5,
};

// ── Oracle fee required as msg.value ────────────────────────────
const ORACLE_FEE = parseEther('0.06'); // 0.06 tCRO

// ── Minimal ABIs ────────────────────────────────────────────────
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
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const HEDGE_EXECUTOR_ABI = [
  {
    type: 'function',
    name: 'openHedge',
    stateMutability: 'payable',
    inputs: [
      { name: 'pairIndex', type: 'uint256' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'leverage', type: 'uint256' },
      { name: 'isLong', type: 'bool' },
      { name: 'commitmentHash', type: 'bytes32' },
      { name: 'nullifier', type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [
      { name: 'hedgeId', type: 'bytes32' },
    ],
  },
] as const;

// ── Interfaces ──────────────────────────────────────────────────
interface HedgeInitialValues {
  asset?: string;
  side?: 'LONG' | 'SHORT';
  leverage?: number;
  size?: number;
  reason?: string;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
}

interface ManualHedgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableAssets?: string[];
  walletAddress?: string;
  initialValues?: HedgeInitialValues;
}

interface HedgeSuccess {
  hedgeId: string;
  txHash: string;
  asset: string;
  hedgeType: string;
  collateral: string;
  leverage: number;
  entryPrice: string;
}

type TxStep = 'idle' | 'checking' | 'approving' | 'approve-confirming' | 'opening' | 'open-confirming' | 'done' | 'error';

// ── Tx Hash Display with copy ───────────────────────────────────
function TxHashDisplay({ hash, label }: { hash: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-[#86868b]">{label}:</span>
      <div className="flex items-center gap-1">
        <code className="text-[11px] font-mono bg-[#f5f5f7] px-2 py-1 rounded text-[#1d1d1f]">
          {hash.substring(0, 10)}...{hash.substring(hash.length - 6)}
        </code>
        <button
          onClick={handleCopy}
          className="p-1.5 hover:bg-[#f5f5f7] rounded-md transition-colors group"
          title="Copy"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-[#34C759]" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-[#86868b] group-hover:text-[#007AFF]" />
          )}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ManualHedgeModal — client-side wallet signing
// ═══════════════════════════════════════════════════════════════
export function ManualHedgeModal({
  isOpen,
  onClose,
  availableAssets = ['BTC', 'ETH', 'CRO'],
  initialValues,
}: ManualHedgeModalProps) {
  // ── Form state ────────────────────────────────────────────────
  const [hedgeType, setHedgeType] = useState<'SHORT' | 'LONG'>('SHORT');
  const [asset, setAsset] = useState('BTC');
  const [collateralInput, setCollateralInput] = useState('10'); // USDC collateral amount
  const [leverage, setLeverage] = useState(2);
  const [entryPrice, setEntryPrice] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [reason, setReason] = useState('');

  // ── Apply initial values from AI recommendation ───────────────
  useEffect(() => {
    if (isOpen && initialValues) {
      console.log('[ManualHedgeModal] Applying initial values:', initialValues);
      if (initialValues.asset) setAsset(initialValues.asset);
      if (initialValues.side) setHedgeType(initialValues.side);
      if (initialValues.leverage) setLeverage(Math.max(1, Math.round(initialValues.leverage)));
      if (initialValues.size) setCollateralInput(initialValues.size.toString());
      if (initialValues.reason) setReason(initialValues.reason);
      if (initialValues.entryPrice) setEntryPrice(initialValues.entryPrice.toString());
      if (initialValues.targetPrice) setTargetPrice(initialValues.targetPrice.toString());
      if (initialValues.stopLoss) setStopLoss(initialValues.stopLoss.toString());
    }
  }, [isOpen, initialValues]);

  // ── Wallet / chain state ──────────────────────────────────────
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const explorerUrl = EXPLORER_URLS[chainId] || EXPLORER_URLS[338];
  const addresses = getContractAddresses(chainId);
  const hedgeExecutorAddress = addresses.hedgeExecutor as `0x${string}`;
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [currentAllowance, setCurrentAllowance] = useState<bigint>(0n);

  // ── Transaction state ─────────────────────────────────────────
  const [txStep, setTxStep] = useState<TxStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<HedgeSuccess | null>(null);

  // ── x402 Gasless mode toggle ──────────────────────────────────
  const [useGasless, setUseGasless] = useState(true); // Default to gasless
  const [gaslessSavings, setGaslessSavings] = useState<string | null>(null);

  // Store collateral for use in proceedToOpenHedge
  const [pendingCollateral, setPendingCollateral] = useState<string>('10');

  // ── Approve tx ────────────────────────────────────────────────
  const {
    writeContract: writeApprove,
    data: approveHash,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({ hash: approveHash });

  // ── OpenHedge tx ──────────────────────────────────────────────
  const {
    writeContract: writeOpenHedge,
    data: openHedgeHash,
    error: openError,
    reset: resetOpen,
  } = useWriteContract();

  const { isSuccess: isOpenConfirmed } =
    useWaitForTransactionReceipt({ hash: openHedgeHash });

  // ── Mint tx (inline faucet) ───────────────────────────────────
  const {
    writeContract: writeMint,
    isPending: isMintPending,
    error: mintError,
    reset: resetMint,
  } = useWriteContract();

  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed } =
    useWaitForTransactionReceipt({ hash: undefined }); // Tracks latest mint

  // Actually track the mint hash
  const {
    writeContract: writeMintTracked,
    data: mintTxHash,
    isPending: isMintPendingTracked,
    error: mintErrorTracked,
    reset: resetMintTracked,
  } = useWriteContract();

  const { isLoading: isMintConfirmingTracked, isSuccess: isMintConfirmedTracked } =
    useWaitForTransactionReceipt({ hash: mintTxHash });

  // ── Fetch USDC balance + allowance ────────────────────────────
  const fetchBalanceAndAllowance = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const [bal, allow] = await Promise.all([
        publicClient.readContract({
          address: MOCK_USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: MOCK_USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, hedgeExecutorAddress],
        }),
      ]);
      setUsdcBalance(formatUnits(bal, 6));
      setCurrentAllowance(allow);
    } catch {
      setUsdcBalance('0');
      setCurrentAllowance(0n);
    }
  }, [address, publicClient]);

  useEffect(() => {
    fetchBalanceAndAllowance();
  }, [fetchBalanceAndAllowance, isMintConfirmedTracked, isApproveConfirmed, isOpenConfirmed]);

  // ── Generate deterministic ZK commitment params ───────────────
  const generateZKParams = useCallback(() => {
    const timestamp = Date.now();
    const addr = address || '0x0000000000000000000000000000000000000000';
    const commitmentHash = keccak256(
      encodePacked(
        ['address', 'uint256', 'string'],
        [addr as `0x${string}`, BigInt(timestamp), `${asset}-${hedgeType}-${collateralInput}`]
      )
    );
    const nullifier = keccak256(
      encodePacked(
        ['bytes32', 'uint256'],
        [commitmentHash, BigInt(timestamp)]
      )
    );
    const merkleRoot = keccak256(
      encodePacked(
        ['bytes32', 'bytes32'],
        [commitmentHash, nullifier]
      )
    );
    return { commitmentHash, nullifier, merkleRoot };
  }, [address, asset, hedgeType, collateralInput]);

  // ── Proceed to openHedge (called after approval or directly) ──
  const proceedToOpenHedge = useCallback(() => {
    const pairIndex = PAIR_INDEX[asset] ?? 0;
    const collateralAmount = parseUnits(pendingCollateral, 6);
    const isLong = hedgeType === 'LONG';
    const { commitmentHash, nullifier, merkleRoot } = generateZKParams();

    logger.info('Calling openHedge', {
      component: 'ManualHedgeModal',
      data: { pairIndex, collateralAmount: collateralAmount.toString(), leverage, isLong },
    });

    writeOpenHedge({
      address: hedgeExecutorAddress,
      abi: HEDGE_EXECUTOR_ABI,
      functionName: 'openHedge',
      args: [
        BigInt(pairIndex),
        collateralAmount,
        BigInt(leverage),
        isLong,
        commitmentHash as `0x${string}`,
        nullifier as `0x${string}`,
        merkleRoot as `0x${string}`,
      ],
      value: ORACLE_FEE,
      gas: 2_000_000n, // openHedge uses ~1.1M gas; explicit limit prevents estimation failures
    });

    setTxStep('open-confirming');
  }, [asset, pendingCollateral, hedgeType, leverage, generateZKParams, writeOpenHedge]);

  // ── Handle approve confirmed → proceed to openHedge ───────────
  useEffect(() => {
    if (isApproveConfirmed && txStep === 'approve-confirming') {
      logger.info('Approval confirmed, proceeding to openHedge', { component: 'ManualHedgeModal' });
      setTxStep('opening');
      proceedToOpenHedge();
    }
  }, [isApproveConfirmed, txStep, proceedToOpenHedge]);

  // ── Handle openHedge confirmed ────────────────────────────────
  useEffect(() => {
    if (isOpenConfirmed && openHedgeHash && txStep === 'open-confirming') {
      logger.info('OpenHedge confirmed!', { component: 'ManualHedgeModal', data: { txHash: openHedgeHash } });
      setTxStep('done');

      const collateralAmount = parseFloat(pendingCollateral);

      setSuccess({
        hedgeId: openHedgeHash,
        txHash: openHedgeHash,
        asset,
        hedgeType,
        collateral: pendingCollateral,
        leverage,
        entryPrice: entryPrice || '0',
      });

      // Track transaction
      trackSuccessfulTransaction({
        hash: openHedgeHash,
        type: 'hedge',
        from: address || 'unknown',
        to: hedgeExecutorAddress,
        value: collateralAmount.toFixed(2),
        tokenSymbol: 'USDC',
        description: `${hedgeType} ${asset} hedge — ${collateralAmount} USDC × ${leverage}x`,
      });

      // Trigger UI refresh
      window.dispatchEvent(new Event('hedgeAdded'));
    }
  }, [isOpenConfirmed, openHedgeHash, txStep, pendingCollateral, asset, hedgeType, leverage, entryPrice, address]);

  // ── Handle tx errors ──────────────────────────────────────────
  useEffect(() => {
    if (approveError) {
      setError(`Approval failed: ${approveError.message.split('\n')[0]}`);
      setTxStep('error');
    }
  }, [approveError]);

  useEffect(() => {
    if (openError) {
      setError(`Hedge creation failed: ${openError.message.split('\n')[0]}`);
      setTxStep('error');
    }
  }, [openError]);

  // ── x402 Gasless create handler ────────────────────────────────
  const handleGaslessCreate = async () => {
    setError(null);
    setSuccess(null);

    if (!address) {
      setError('Please connect your wallet first');
      return;
    }

    const collateralAmount = parseFloat(collateralInput);
    if (!collateralInput || !entryPrice || !targetPrice || !stopLoss) {
      setError('Please fill in all required fields');
      return;
    }
    if (collateralAmount < 1) { setError('Minimum collateral is 1 USDC'); return; }
    if (leverage < 2 || leverage > 100) { setError('Leverage must be between 2x and 100x'); return; }

    const balNum = parseFloat(usdcBalance);
    if (balNum < collateralAmount) {
      setError(`Insufficient MockUSDC. Have ${balNum.toLocaleString()}, need ${collateralAmount.toLocaleString()}. Mint more below.`);
      return;
    }

    setPendingCollateral(collateralInput);
    setTxStep('checking');

    // Step 1: Ensure approval (still requires wallet signature — but no gas for the hedge itself)
    const requiredAmount = parseUnits(collateralInput, 6);
    if (currentAllowance < requiredAmount) {
      setTxStep('approving');
      writeApprove({
        address: MOCK_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [hedgeExecutorAddress, requiredAmount],
      });
      setTxStep('approve-confirming');
      // After approval confirms, the useEffect will call handleGaslessOpen
      return;
    }

    // Step 2: Call gasless server API
    await handleGaslessOpen();
  };

  const handleGaslessOpen = async () => {
    try {
      setTxStep('opening');

      const pairIndex = PAIR_INDEX[asset] ?? 0;
      const isLong = hedgeType === 'LONG';

      logger.info('Opening hedge via x402 gasless', {
        component: 'ManualHedgeModal',
        data: { pairIndex, collateral: pendingCollateral, leverage, isLong, gasless: true },
      });

      const res = await fetch('/api/agents/hedging/open-onchain-gasless', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairIndex,
          collateralAmount: pendingCollateral,
          leverage,
          isLong,
          walletAddress: address,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Gasless hedge creation failed');
        setTxStep('error');
        return;
      }

      setTxStep('done');
      setGaslessSavings(data.gasSavings?.totalSaved || '$0.00');

      setSuccess({
        hedgeId: data.hedgeId,
        txHash: data.txHash,
        asset,
        hedgeType,
        collateral: pendingCollateral,
        leverage,
        entryPrice: entryPrice || '0',
      });

      trackSuccessfulTransaction({
        hash: data.txHash,
        type: 'hedge',
        from: address || 'unknown',
        to: hedgeExecutorAddress,
        value: parseFloat(pendingCollateral).toFixed(2),
        tokenSymbol: 'USDC',
        description: `⚡ x402 Gasless ${hedgeType} ${asset} hedge — ${pendingCollateral} USDC × ${leverage}x`,
      });

      window.dispatchEvent(new Event('hedgeAdded'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gasless request failed');
      setTxStep('error');
    }
  };

  // ── Handle approve confirmed for gasless mode ─────────────────
  useEffect(() => {
    if (isApproveConfirmed && txStep === 'approve-confirming' && useGasless) {
      logger.info('Approval confirmed, proceeding to gasless open', { component: 'ManualHedgeModal' });
      handleGaslessOpen();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApproveConfirmed, txStep, useGasless]);

  // ── Main create handler ───────────────────────────────────────
  const handleCreate = async () => {
    if (useGasless) {
      return handleGaslessCreate();
    }

    setError(null);
    setSuccess(null);
    resetApprove();
    resetOpen();

    if (!address) {
      setError('Please connect your wallet first');
      return;
    }

    const collateralAmount = parseFloat(collateralInput);
    const entryNum = parseFloat(entryPrice);
    const targetNum = parseFloat(targetPrice);
    const stopNum = parseFloat(stopLoss);

    if (!collateralInput || !entryPrice || !targetPrice || !stopLoss) {
      setError('Please fill in all required fields');
      return;
    }

    if (collateralAmount < 1) {
      setError('Minimum collateral is 1 USDC');
      return;
    }

    if (leverage < 2 || leverage > 100) {
      setError('Leverage must be between 2x and 100x');
      return;
    }

    if (hedgeType === 'SHORT') {
      if (targetNum >= entryNum) {
        setError('For SHORT: Target price must be below entry price');
        return;
      }
      if (stopNum <= entryNum) {
        setError('For SHORT: Stop loss must be above entry price');
        return;
      }
    } else {
      if (targetNum <= entryNum) {
        setError('For LONG: Target price must be above entry price');
        return;
      }
      if (stopNum >= entryNum) {
        setError('For LONG: Stop loss must be below entry price');
        return;
      }
    }

    // Check USDC balance
    const balNum = parseFloat(usdcBalance);
    if (balNum < collateralAmount) {
      setError(`Insufficient MockUSDC. You have ${balNum.toLocaleString()} but need ${collateralAmount.toLocaleString()}. Mint more below.`);
      return;
    }

    const requiredAmount = parseUnits(collateralInput, 6);
    setPendingCollateral(collateralInput);
    setTxStep('checking');

    // Check if approval is needed
    if (currentAllowance < requiredAmount) {
      logger.info('Approval needed', {
        component: 'ManualHedgeModal',
        data: { currentAllowance: currentAllowance.toString(), required: requiredAmount.toString() },
      });
      setTxStep('approving');
      writeApprove({
        address: MOCK_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [hedgeExecutorAddress, requiredAmount],
      });
      setTxStep('approve-confirming');
    } else {
      // Already approved, go straight to openHedge
      setTxStep('opening');
      proceedToOpenHedge();
    }
  };

  // ── Inline mint (faucet) ──────────────────────────────────────
  const handleMint = (amount: string) => {
    if (!address) return;
    resetMintTracked();
    writeMintTracked({
      address: MOCK_USDC_ADDRESS,
      abi: MOCK_USDC_ABI,
      functionName: 'mint',
      args: [address, parseUnits(amount, 6)],
    });
  };

  const handleClose = () => {
    if (success) {
      setCollateralInput('10');
      setEntryPrice('');
      setTargetPrice('');
      setStopLoss('');
      setReason('');
      setSuccess(null);
      setTxStep('idle');
    }
    setError(null);
    onClose();
  };

  // ── Derived values ────────────────────────────────────────────
  const collateralNum = parseFloat(collateralInput) || 0;
  const entryNum = parseFloat(entryPrice) || 0;
  const targetNum = parseFloat(targetPrice) || 0;
  const notionalValue = collateralNum * leverage;

  const calculatePnL = () => {
    if (!collateralInput || !entryPrice || !targetPrice || entryNum === 0) return null;
    const priceDelta = hedgeType === 'SHORT'
      ? entryNum - targetNum
      : targetNum - entryNum;
    const pnl = (priceDelta / entryNum) * notionalValue;
    return pnl.toFixed(2);
  };

  const potentialPnL = calculatePnL();
  const isBusy = txStep !== 'idle' && txStep !== 'done' && txStep !== 'error';
  const isMintBusy = isMintPendingTracked || isMintConfirmingTracked;

  // ── Step labels ───────────────────────────────────────────────
  const stepLabel: Record<TxStep, string> = {
    idle: '',
    checking: 'Checking allowance...',
    approving: 'Approve MockUSDC in your wallet...',
    'approve-confirming': 'Waiting for approval confirmation...',
    opening: 'Sign openHedge in your wallet...',
    'open-confirming': 'Waiting for on-chain confirmation...',
    done: 'Hedge created on-chain!',
    error: 'Transaction failed',
  };

  const stepProgress: Record<TxStep, number> = {
    idle: 0, checking: 1, approving: 1, 'approve-confirming': 2,
    opening: 3, 'open-confirming': 3, done: 4, error: 0,
  };
  const progress = stepProgress[txStep];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-black/5 px-6 py-4 flex items-center justify-between rounded-t-[24px] z-10">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 ${success ? 'bg-[#34C759]' : 'bg-[#007AFF]'} rounded-[12px] flex items-center justify-center`}>
                    {success ? <CheckCircle className="w-5 h-5 text-white" /> : <Shield className="w-5 h-5 text-white" />}
                  </div>
                  <div>
                    <h2 className="text-[17px] font-semibold text-[#1d1d1f]">
                      {success ? 'Hedge Created On-Chain' : 'Create On-Chain Hedge'}
                    </h2>
                    <p className="text-[13px] text-[#86868b]">
                      {success ? (gaslessSavings ? 'x402 Gasless — Confirmed on Cronos' : 'Confirmed on Cronos Testnet') : (useGasless ? 'x402 Gasless — zero gas fees' : 'Sign with your wallet — on-chain execution')}
                    </p>
                  </div>
                </div>
                <button onClick={handleClose} className="p-2 hover:bg-[#f5f5f7] rounded-full transition-colors">
                  <X className="w-5 h-5 text-[#86868b]" />
                </button>
              </div>

              {/* ──────── SUCCESS VIEW ──────── */}
              {success ? (
                <div className="p-6 space-y-5">
                  <div className="flex flex-col items-center py-4">
                    <div className="w-16 h-16 bg-[#34C759]/10 rounded-full flex items-center justify-center mb-4">
                      <CheckCircle className="w-10 h-10 text-[#34C759]" />
                    </div>
                    <h3 className="text-[17px] font-semibold text-[#1d1d1f] mb-1">On-Chain Hedge Active</h3>
                    <p className="text-[13px] text-[#86868b] text-center">
                      Your {success.hedgeType} position on {success.asset} is live on the blockchain
                    </p>
                    {gaslessSavings && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#AF52DE]/10 rounded-full mt-2">
                        <Zap className="w-3.5 h-3.5 text-[#AF52DE]" />
                        <span className="text-[11px] font-semibold text-[#AF52DE]">x402 Gasless — You saved {gaslessSavings} in gas!</span>
                      </div>
                    )}
                  </div>

                  {/* On-Chain Badge */}
                  <div className="p-4 bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[12px] space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px]">⛓</span>
                      <span className="text-[13px] font-semibold text-[#FF9500]">ON-CHAIN VERIFIED</span>
                    </div>
                    <TxHashDisplay hash={success.txHash} label="Transaction" />
                    <a
                      href={`${explorerUrl}/tx/${success.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-[#007AFF]/10 hover:bg-[#007AFF]/20 text-[#007AFF] rounded-[8px] text-[12px] font-medium transition-colors"
                    >
                      View on Cronos Explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  {/* Position Details */}
                  <div className="p-4 bg-[#f5f5f7] rounded-[12px] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Type:</span>
                      <span className={`text-[12px] font-bold ${success.hedgeType === 'SHORT' ? 'text-[#FF3B30]' : 'text-[#34C759]'}`}>
                        {success.hedgeType}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Asset:</span>
                      <span className="text-[12px] font-semibold text-[#1d1d1f]">{success.asset}-PERP</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Collateral:</span>
                      <span className="text-[12px] font-semibold text-[#1d1d1f]">{parseFloat(success.collateral).toLocaleString()} USDC</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Leverage:</span>
                      <span className="text-[12px] font-semibold text-[#1d1d1f]">{success.leverage}x</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Notional:</span>
                      <span className="text-[12px] font-semibold text-[#1d1d1f]">
                        ${(parseFloat(success.collateral) * success.leverage).toLocaleString()} USDC
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">Signed by:</span>
                      <code className="text-[11px] font-mono bg-white px-2 py-0.5 rounded text-[#1d1d1f]">
                        {address?.substring(0, 8)}...{address?.substring((address?.length || 0) - 6)}
                      </code>
                    </div>
                  </div>

                  <button onClick={handleClose} className="w-full px-4 py-3 bg-[#007AFF] text-white rounded-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all">
                    Done
                  </button>
                </div>
              ) : (
                /* ──────── FORM VIEW ──────── */
                <div className="p-6 space-y-5">
                  {/* Progress Indicator */}
                  {isBusy && (
                    <div className="p-4 bg-[#007AFF]/5 border border-[#007AFF]/20 rounded-[12px]">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-5 h-5 border-2 border-[#007AFF]/30 border-t-[#007AFF] rounded-full animate-spin" />
                        <span className="text-[13px] font-semibold text-[#007AFF]">
                          {stepLabel[txStep]}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((s) => (
                          <div
                            key={s}
                            className={`h-1 flex-1 rounded-full transition-all ${
                              progress >= s ? 'bg-[#007AFF]' : 'bg-[#007AFF]/20'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="flex items-start gap-2 p-3 bg-[#FF3B30]/10 border border-[#FF3B30]/20 rounded-[12px]">
                      <AlertCircle className="w-4 h-4 text-[#FF3B30] mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-[13px] text-[#FF3B30] font-medium">{error}</p>
                        {txStep === 'error' && (
                          <button
                            onClick={() => { setTxStep('idle'); setError(null); }}
                            className="text-[12px] text-[#007AFF] mt-1 hover:underline"
                          >
                            Try again
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* x402 Gasless Toggle */}
                  <button
                    type="button"
                    onClick={() => setUseGasless(!useGasless)}
                    disabled={isBusy}
                    className={`w-full flex items-center justify-between p-3 rounded-[12px] border-2 transition-all ${
                      useGasless
                        ? 'border-[#AF52DE] bg-[#AF52DE]/5'
                        : 'border-[#e8e8ed] bg-[#f5f5f7] hover:border-[#AF52DE]/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Zap className={`w-4 h-4 ${useGasless ? 'text-[#AF52DE]' : 'text-[#86868b]'}`} />
                      <div className="text-left">
                        <span className={`text-[13px] font-semibold ${useGasless ? 'text-[#AF52DE]' : 'text-[#1d1d1f]'}`}>
                          x402 Gasless Mode
                        </span>
                        <p className="text-[11px] text-[#86868b]">
                          {useGasless ? 'Zero gas fees — server relays your transaction' : 'You pay gas from your CRO balance'}
                        </p>
                      </div>
                    </div>
                    <div className={`w-10 h-6 rounded-full transition-all flex items-center ${
                      useGasless ? 'bg-[#AF52DE] justify-end' : 'bg-[#e8e8ed] justify-start'
                    }`}>
                      <div className="w-5 h-5 bg-white rounded-full shadow-sm mx-0.5" />
                    </div>
                  </button>

                  {/* Wallet + Balance Bar */}
                  <div className="flex items-center gap-2 p-3 bg-[#f5f5f7] rounded-[12px]">
                    <Wallet className="w-4 h-4 text-[#007AFF]" />
                    <div className="flex-1 flex items-center justify-between">
                      <span className="text-[12px] text-[#86868b]">
                        {address ? `${address.substring(0, 8)}...${address.substring(address.length - 6)}` : 'Not connected'}
                      </span>
                      <span className="text-[12px] font-semibold text-[#1d1d1f]">
                        {parseFloat(usdcBalance).toLocaleString('en-US', { maximumFractionDigits: 2 })} MockUSDC
                      </span>
                    </div>
                  </div>

                  {/* Hedge Type */}
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Hedge Type <span className="text-[#FF3B30]">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setHedgeType('SHORT')}
                        disabled={isBusy}
                        className={`p-3 rounded-[12px] border-2 transition-all ${
                          hedgeType === 'SHORT' ? 'border-[#FF3B30] bg-[#FF3B30]/10' : 'border-[#e8e8ed] hover:border-[#FF3B30]/30'
                        }`}
                      >
                        <TrendingDown className={`w-5 h-5 mx-auto mb-1 ${hedgeType === 'SHORT' ? 'text-[#FF3B30]' : 'text-[#86868b]'}`} />
                        <div className={`text-[15px] font-semibold ${hedgeType === 'SHORT' ? 'text-[#FF3B30]' : 'text-[#1d1d1f]'}`}>SHORT</div>
                        <div className="text-[11px] text-[#86868b]">Profit from price drop</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setHedgeType('LONG')}
                        disabled={isBusy}
                        className={`p-3 rounded-[12px] border-2 transition-all ${
                          hedgeType === 'LONG' ? 'border-[#34C759] bg-[#34C759]/10' : 'border-[#e8e8ed] hover:border-[#34C759]/30'
                        }`}
                      >
                        <TrendingUp className={`w-5 h-5 mx-auto mb-1 ${hedgeType === 'LONG' ? 'text-[#34C759]' : 'text-[#86868b]'}`} />
                        <div className={`text-[15px] font-semibold ${hedgeType === 'LONG' ? 'text-[#34C759]' : 'text-[#1d1d1f]'}`}>LONG</div>
                        <div className="text-[11px] text-[#86868b]">Profit from price rise</div>
                      </button>
                    </div>
                  </div>

                  {/* Asset Selection */}
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Asset <span className="text-[#FF3B30]">*</span>
                    </label>
                    <select
                      value={asset}
                      onChange={(e) => setAsset(e.target.value)}
                      disabled={isBusy}
                      className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] bg-white text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                    >
                      {availableAssets.map((a) => (
                        <option key={a} value={a}>{a}-PERP</option>
                      ))}
                    </select>
                  </div>

                  {/* Collateral and Leverage */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                        Collateral (USDC) <span className="text-[#FF3B30]">*</span>
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        value={collateralInput}
                        onChange={(e) => setCollateralInput(e.target.value)}
                        placeholder="10"
                        disabled={isBusy}
                        className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#1d1d1f]"
                      />
                      <div className="mt-1 text-[10px] text-[#86868b]">
                        Min: 1 USDC &bull; Bal: {parseFloat(usdcBalance).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                        Leverage: {leverage}x
                      </label>
                      <input
                        type="range"
                        min="2"
                        max="50"
                        value={leverage}
                        onChange={(e) => setLeverage(parseInt(e.target.value))}
                        disabled={isBusy}
                        className="w-full mt-3"
                      />
                      <div className="mt-1 text-[10px] text-[#86868b]">
                        Notional: ${notionalValue.toLocaleString()} USDC
                      </div>
                    </div>
                  </div>

                  {/* Prices */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                        Entry Price (USD) <span className="text-[#FF3B30]">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        placeholder={asset === 'BTC' ? '95000' : asset === 'ETH' ? '3500' : '0.10'}
                        disabled={isBusy}
                        className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                        Target Price (USD) <span className="text-[#FF3B30]">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                        placeholder={hedgeType === 'SHORT' ? 'Lower than entry' : 'Higher than entry'}
                        disabled={isBusy}
                        className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                        Stop Loss (USD) <span className="text-[#FF3B30]">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(e.target.value)}
                        placeholder={hedgeType === 'SHORT' ? 'Higher than entry' : 'Lower than entry'}
                        disabled={isBusy}
                        className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b]"
                      />
                    </div>
                  </div>

                  {/* Reason */}
                  <div>
                    <label className="block text-[13px] font-semibold text-[#1d1d1f] mb-2">
                      Reason (Optional)
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why are you creating this hedge?"
                      rows={2}
                      disabled={isBusy}
                      className="w-full px-4 py-3 rounded-[12px] border border-[#e8e8ed] text-[15px] focus:outline-none focus:border-[#007AFF] transition-colors text-[#86868b] resize-none"
                    />
                  </div>

                  {/* Potential P&L Preview */}
                  {potentialPnL && (
                    <div className="p-4 bg-[#f5f5f7] rounded-[12px] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-[#86868b]">Potential P&L at Target:</span>
                        <span className={`text-[17px] font-bold ${parseFloat(potentialPnL) >= 0 ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                          {parseFloat(potentialPnL) >= 0 ? '+' : ''}{parseFloat(potentialPnL).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
                        </span>
                      </div>
                      <div className="text-[10px] text-[#86868b] space-y-0.5">
                        <div>Collateral: {collateralNum.toLocaleString()} USDC</div>
                        <div>Notional ({leverage}x): ${notionalValue.toLocaleString()} USDC</div>
                        <div>Oracle Fee: 0.06 tCRO (paid as msg.value)</div>
                      </div>
                    </div>
                  )}

                  {/* MockUSDC Faucet Inline */}
                  <div className="p-3 bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[12px] space-y-2">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-[#FF9500]" />
                      <span className="text-[12px] font-semibold text-[#FF9500]">Need Test USDC?</span>
                    </div>
                    <div className="flex gap-2">
                      {[
                        { label: '+1K', val: '1000' },
                        { label: '+10K', val: '10000' },
                        { label: '+100K', val: '100000' },
                        { label: '+1M', val: '1000000' },
                      ].map((m) => (
                        <button
                          key={m.val}
                          onClick={() => handleMint(m.val)}
                          disabled={isMintBusy || isBusy}
                          className="flex-1 px-2 py-1.5 bg-[#FF9500]/10 hover:bg-[#FF9500]/20 text-[#FF9500] rounded-[8px] text-[11px] font-semibold transition-colors disabled:opacity-50"
                        >
                          {isMintBusy ? '...' : m.label}
                        </button>
                      ))}
                    </div>
                    {isMintConfirmedTracked && (
                      <p className="text-[10px] text-[#34C759] font-medium">Minted successfully! Balance updated.</p>
                    )}
                    {mintErrorTracked && (
                      <p className="text-[10px] text-[#FF3B30] truncate">{mintErrorTracked.message.split('\n')[0]}</p>
                    )}
                  </div>

                  {/* Footer Buttons */}
                  <div className="sticky bottom-0 bg-white border-t border-black/5 px-6 py-4 flex gap-3 -mx-6 -mb-6 rounded-b-[24px]">
                    <button
                      onClick={handleClose}
                      disabled={isBusy}
                      className="flex-1 px-4 py-3 bg-[#f5f5f7] text-[#1d1d1f] rounded-[12px] font-semibold hover:bg-[#e8e8ed] transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={isBusy || !address}
                      className="flex-1 px-4 py-3 bg-[#007AFF] text-white rounded-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {txStep === 'approving' || txStep === 'approve-confirming'
                            ? 'Approving...'
                            : useGasless ? 'Creating (Gasless)...' : 'Creating...'}
                        </>
                      ) : (
                        <>
                          {useGasless ? <Zap className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                          {useGasless ? '⚡ Create Gasless Hedge' : 'Create On-Chain Hedge'}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
