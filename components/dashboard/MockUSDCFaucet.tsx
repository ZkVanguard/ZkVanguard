'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Coins, Loader2, CheckCircle, AlertCircle, ExternalLink, AlertTriangle } from 'lucide-react';
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient, useChainId } from '@/lib/wdk/wdk-hooks';
import { useWallet } from '@/lib/hooks/useWallet';
import { formatUnits, parseUnits } from 'viem';
import { CHAIN_IDS, getExplorerUrl } from '@/lib/utils/network';

// TESTNET ONLY - Testnet USDC with public mint() function
// This component should ONLY be rendered on testnet (chainId 338)
// On mainnet, users must acquire real USDC through exchanges

// Testnet USDC address (has permissionless mint function)
const TESTNET_USDC_ADDRESS = '0x28217DAddC55e3C4831b4A48A00Ce04880786967' as `0x${string}`;

// Legacy export for backward compatibility (use getUsdcAddress from network.ts instead)
export const TESTNET_FAUCET_USDC_ADDRESS = TESTNET_USDC_ADDRESS;

const TESTNET_USDC_ABI = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
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
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

// Amount button values only — labels formatted at render time via
// Intl.NumberFormat(locale) so thousand separators respect the active locale.
const MINT_AMOUNTS = ['1000', '10000', '100000', '1000000'];

interface TestnetUSDCFaucetProps {
  compact?: boolean;
  onMintSuccess?: () => void;
}

export function MockUSDCFaucet({ compact = false, onMintSuccess }: TestnetUSDCFaucetProps) {
  const t = useTranslations('dashboard.usdcFaucet');
  const locale = useLocale();
  const formatAmount = (v: string | number) => new Intl.NumberFormat(locale).format(Number(v));
  const { evmAddress, isSUI } = useWallet();
  const address = evmAddress as `0x${string}` | undefined;
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const isTestnet = chainId === CHAIN_IDS.CRONOS_TESTNET;
  const _explorerUrl = getExplorerUrl(chainId);

  const [balance, setBalance] = useState<string>('0');
  const [selectedAmount, setSelectedAmount] = useState('10000');
  const [mintSuccess, setMintSuccess] = useState(false);

  // MAINNET GUARD - This faucet only works on testnet
  if (!isTestnet) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-amber-100">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-800">{t('mainnet.title')}</h3>
            <p className="text-sm text-amber-600">{t('mainnet.subtitle')}</p>
          </div>
        </div>
        <p className="text-xs text-amber-700 mt-2">
          {t.rich('mainnet.body', {
            exchange: (chunks) => (
              <a href="https://crypto.com/exchange" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-900">
                {chunks}
              </a>
            ),
            dex: (chunks) => (
              <a href="https://vvs.finance" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-900">
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>
    );
  }

  const {
    writeContract: writeMint,
    data: mintHash,
    isPending: isMintPending,
    error: mintError,
    reset: resetMint,
  } = useWriteContract();

  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed } =
    useWaitForTransactionReceipt({ hash: mintHash });

  // Fetch balance
  useEffect(() => {
    async function fetchBalance() {
      if (!address || !publicClient) return;
      try {
        const bal = await publicClient.readContract({
          address: TESTNET_USDC_ADDRESS,
          abi: TESTNET_USDC_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        setBalance(formatUnits(bal, 6));
      } catch {
        setBalance('0');
      }
    }
    fetchBalance();
  }, [address, publicClient, isMintConfirmed]);

  // Handle mint confirmed
  useEffect(() => {
    if (isMintConfirmed) {
      setMintSuccess(true);
      onMintSuccess?.();
      setTimeout(() => setMintSuccess(false), 4000);
    }
  }, [isMintConfirmed, onMintSuccess]);

  const handleMint = () => {
    if (!address) return;
    resetMint();
    setMintSuccess(false);

    const amountInWei = parseUnits(selectedAmount, 6);
    writeMint({
      address: TESTNET_USDC_ADDRESS,
      abi: TESTNET_USDC_ABI,
      functionName: 'mint',
      args: [address, amountInWei],
    });
  };

  const isBusy = isMintPending || isMintConfirming;

  // Not connected to EVM
  if (!address) {
    // If connected to SUI, show message
    if (isSUI) {
      return (
        <div className="text-center py-6 px-4 bg-[#4DA2FF]/5 border border-[#4DA2FF]/20 rounded-[16px]">
          <Coins className="w-8 h-8 text-[#4DA2FF] mx-auto mb-2" />
          <p className="text-sm text-[#4DA2FF] font-medium">{t('sui.title')}</p>
          <p className="text-xs text-[#86868B] mt-1">{t('sui.body')}</p>
        </div>
      );
    }
    return null;
  }

  const formattedBalance = formatAmount(parseFloat(balance).toFixed(2));

  // Compact mode — small inline button for use inside modals
  if (compact) {
    return (
      <div className="flex items-center gap-2 p-3 bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[12px]">
        <Coins className="w-4 h-4 text-[#FF9500] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[#1d1d1f]">
              {t('compact.balance', { balance: formattedBalance })}
            </span>
            {mintSuccess ? (
              <span className="text-[11px] text-[#34C759] font-medium flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {t('compact.minted')}
              </span>
            ) : (
              <button
                onClick={handleMint}
                disabled={isBusy}
                className="text-[11px] font-semibold text-[#FF9500] hover:text-[#FF9500]/80 disabled:opacity-50 flex items-center gap-1"
              >
                {isBusy ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> {t('compact.minting')}</>
                ) : (
                  <>{t('compact.getUsdc', { amount: formatAmount(selectedAmount) })}</>
                )}
              </button>
            )}
          </div>
          {mintError && (
            <p className="text-[10px] text-[#FF3B30] mt-1 truncate">{mintError.message.split('\n')[0]}</p>
          )}
        </div>
      </div>
    );
  }

  // Full faucet card
  return (
    <div className="bg-white rounded-[20px] border border-[#e8e8ed] p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-[#FF9500]/10 rounded-[12px] flex items-center justify-center">
          <Coins className="w-5 h-5 text-[#FF9500]" />
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-[#1d1d1f]">{t('title')}</h3>
          <p className="text-[12px] text-[#86868b]">{t('subtitle')}</p>
        </div>
      </div>

      {/* Current Balance */}
      <div className="p-3 bg-[#f5f5f7] rounded-[12px] flex items-center justify-between">
        <span className="text-[13px] text-[#86868b]">{t('balanceLabel')}</span>
        <span className="text-[15px] font-bold text-[#1d1d1f]">
          {formattedBalance} {t('amountSuffix')}
        </span>
      </div>

      {/* Amount Selection */}
      <div>
        <label className="block text-[12px] font-semibold text-[#86868b] mb-2">{t('mintAmount')}</label>
        <div className="grid grid-cols-2 gap-2">
          {MINT_AMOUNTS.map((value) => (
            <button
              key={value}
              onClick={() => setSelectedAmount(value)}
              className={`px-3 py-2 rounded-[10px] text-[13px] font-medium transition-all ${
                selectedAmount === value
                  ? 'bg-[#FF9500] text-white'
                  : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
              }`}
            >
              {formatAmount(value)} {t('amountSuffix')}
            </button>
          ))}
        </div>
      </div>

      {/* Mint Button */}
      <button
        onClick={handleMint}
        disabled={isBusy}
        className="w-full px-4 py-3 bg-[#FF9500] text-white rounded-[12px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isBusy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {isMintPending ? t('confirmInWallet') : t('minting')}
          </>
        ) : mintSuccess ? (
          <>
            <CheckCircle className="w-4 h-4" />
            {t('mintedSuccess')}
          </>
        ) : (
          <>
            <Coins className="w-4 h-4" />
            {t('mintButton', { amount: formatAmount(selectedAmount) })}
          </>
        )}
      </button>

      {/* Tx Link */}
      {mintHash && (
        <a
          href={`https://explorer.cronos.org/testnet/tx/${mintHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-[12px] text-[#007AFF] hover:underline"
        >
          {t('viewExplorer')} <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {/* Error */}
      {mintError && (
        <div className="flex items-start gap-2 p-3 bg-[#FF3B30]/10 border border-[#FF3B30]/20 rounded-[12px]">
          <AlertCircle className="w-4 h-4 text-[#FF3B30] mt-0.5 flex-shrink-0" />
          <p className="text-[12px] text-[#FF3B30]">{mintError.message.split('\n')[0]}</p>
        </div>
      )}

      {/* Contract Info */}
      <div className="text-[10px] text-[#86868b] text-center space-y-0.5">
        <p>{t('contractAddress', { addr: `${TESTNET_USDC_ADDRESS.substring(0, 10)}...${TESTNET_USDC_ADDRESS.substring(38)}` })}</p>
        <p>{t('contractInfo')}</p>
      </div>
    </div>
  );
}

// Re-export ABI for backward compatibility (address is exported above)
export { TESTNET_USDC_ABI };
