'use client';

import { useState, useEffect } from 'react';
import { Coins, Loader2, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';

// MockUSDC on Cronos Testnet - has public mint() with no access control
const MOCK_USDC_ADDRESS = '0x28217DAddC55e3C4831b4A48A00Ce04880786967' as `0x${string}`;

const MOCK_USDC_ABI = [
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

const MINT_AMOUNTS = [
  { label: '1,000 USDC', value: '1000' },
  { label: '10,000 USDC', value: '10000' },
  { label: '100,000 USDC', value: '100000' },
  { label: '1,000,000 USDC', value: '1000000' },
];

interface MockUSDCFaucetProps {
  compact?: boolean;
  onMintSuccess?: () => void;
}

export function MockUSDCFaucet({ compact = false, onMintSuccess }: MockUSDCFaucetProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [balance, setBalance] = useState<string>('0');
  const [selectedAmount, setSelectedAmount] = useState('10000');
  const [mintSuccess, setMintSuccess] = useState(false);

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
          address: MOCK_USDC_ADDRESS,
          abi: MOCK_USDC_ABI,
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
      address: MOCK_USDC_ADDRESS,
      abi: MOCK_USDC_ABI,
      functionName: 'mint',
      args: [address, amountInWei],
    });
  };

  const isBusy = isMintPending || isMintConfirming;

  if (!address) return null;

  // Compact mode — small inline button for use inside modals
  if (compact) {
    return (
      <div className="flex items-center gap-2 p-3 bg-[#FF9500]/5 border border-[#FF9500]/20 rounded-[12px]">
        <Coins className="w-4 h-4 text-[#FF9500] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[#1d1d1f]">
              MockUSDC: {parseFloat(balance).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            {mintSuccess ? (
              <span className="text-[11px] text-[#34C759] font-medium flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Minted!
              </span>
            ) : (
              <button
                onClick={handleMint}
                disabled={isBusy}
                className="text-[11px] font-semibold text-[#FF9500] hover:text-[#FF9500]/80 disabled:opacity-50 flex items-center gap-1"
              >
                {isBusy ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Minting...</>
                ) : (
                  <>+ Get {parseInt(selectedAmount).toLocaleString()} USDC</>
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
          <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Testnet USDC Faucet</h3>
          <p className="text-[12px] text-[#86868b]">Mint MockUSDC for testing hedges</p>
        </div>
      </div>

      {/* Current Balance */}
      <div className="p-3 bg-[#f5f5f7] rounded-[12px] flex items-center justify-between">
        <span className="text-[13px] text-[#86868b]">Your MockUSDC Balance</span>
        <span className="text-[15px] font-bold text-[#1d1d1f]">
          {parseFloat(balance).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
        </span>
      </div>

      {/* Amount Selection */}
      <div>
        <label className="block text-[12px] font-semibold text-[#86868b] mb-2">Mint Amount</label>
        <div className="grid grid-cols-2 gap-2">
          {MINT_AMOUNTS.map((amt) => (
            <button
              key={amt.value}
              onClick={() => setSelectedAmount(amt.value)}
              className={`px-3 py-2 rounded-[10px] text-[13px] font-medium transition-all ${
                selectedAmount === amt.value
                  ? 'bg-[#FF9500] text-white'
                  : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
              }`}
            >
              {amt.label}
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
            {isMintPending ? 'Confirm in Wallet...' : 'Minting...'}
          </>
        ) : mintSuccess ? (
          <>
            <CheckCircle className="w-4 h-4" />
            Minted Successfully!
          </>
        ) : (
          <>
            <Coins className="w-4 h-4" />
            Mint {parseInt(selectedAmount).toLocaleString()} MockUSDC
          </>
        )}
      </button>

      {/* Tx Link */}
      {mintHash && (
        <a
          href={`https://explorer.cronos.org/testnet3/tx/${mintHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-[12px] text-[#007AFF] hover:underline"
        >
          View on Explorer <ExternalLink className="w-3 h-3" />
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
        <p>MockUSDC: {MOCK_USDC_ADDRESS.substring(0, 10)}...{MOCK_USDC_ADDRESS.substring(38)}</p>
        <p>Cronos Testnet (Chain ID: 338) &bull; 6 decimals</p>
      </div>
    </div>
  );
}

export { MOCK_USDC_ADDRESS, MOCK_USDC_ABI };
