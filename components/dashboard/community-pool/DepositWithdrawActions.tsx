'use client';

import React, { memo, useMemo } from 'react';
import { Plus, Minus, Wallet, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PoolSummary, UserPosition, ChainKey, TxStatus } from './types';
import { getDepositTokenInfo } from '@/lib/contracts/community-pool-config';
import { WdkWalletConnect } from '@/components/WdkWalletConnect';

interface DepositWithdrawActionsProps {
  selectedChain: ChainKey;
  poolData: PoolSummary;
  userPosition: UserPosition | null;
  chainConfig: any;
  poolDeployed: boolean;
  communityPoolAddress: string;
  suiPoolStateId: string | null;
  network: 'mainnet' | 'testnet';
  isFirstDeposit?: boolean;
  isChainMismatch?: boolean;
  userUsdtBalance?: number;
  // EVM state
  showDeposit: boolean;
  showWithdraw: boolean;
  depositAmount: string;
  withdrawShares: string;
  actionLoading: boolean;
  isPending: boolean;
  isConfirming: boolean;
  txStatus: TxStatus;
  address: string | undefined;
  // Wallet type
  activeWalletType?: 'evm' | 'sui' | null;
  // SUI state
  suiIsConnected: boolean;
  suiAddress: string | null;
  suiBalance: string;
  suiDepositAmount: string;
  suiWithdrawShares: string;
  suiNetwork: string;
  suiIsWrongNetwork: boolean;
  // Handlers
  onShowDeposit: (show: boolean) => void;
  onShowWithdraw: (show: boolean) => void;
  onDepositAmountChange: (value: string) => void;
  onWithdrawSharesChange: (value: string) => void;
  onSuiDepositAmountChange: (value: string) => void;
  onSuiWithdrawSharesChange: (value: string) => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  onSuiDeposit: () => void;
  onSuiWithdraw: () => void;
}

export const DepositWithdrawActions = memo(function DepositWithdrawActions({
  selectedChain,
  poolData,
  userPosition,
  chainConfig,
  poolDeployed,
  communityPoolAddress,
  suiPoolStateId,
  network = 'testnet',
  isFirstDeposit = false,
  isChainMismatch = false,
  userUsdtBalance = 0,
  showDeposit,
  showWithdraw,
  depositAmount,
  withdrawShares,
  actionLoading,
  isPending,
  isConfirming,
  txStatus,
  address,
  activeWalletType,
  suiIsConnected,
  suiAddress,
  suiBalance,
  suiDepositAmount,
  suiWithdrawShares,
  suiNetwork,
  suiIsWrongNetwork,
  onShowDeposit,
  onShowWithdraw,
  onDepositAmountChange,
  onWithdrawSharesChange,
  onSuiDepositAmountChange,
  onSuiWithdrawSharesChange,
  onDeposit,
  onWithdraw,
  onSuiDeposit,
  onSuiWithdraw,
}: DepositWithdrawActionsProps) {
  const isSui = selectedChain === 'sui';
  const minDeposit = isFirstDeposit ? 100 : 10;
  
  // User connects via WDK self-custodial wallet
  const effectiveAddress = address;
  const evmConnected = !!effectiveAddress;
  
  // Get deposit token info based on chain and network (USDT for mainnet, USDC for testnet)
  const tokenInfo = useMemo(() => 
    getDepositTokenInfo(selectedChain, network),
    [selectedChain, network]
  );


  if (isSui) {
    return (
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="space-y-4">
          {/* SUI Pool Header */}
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">💧</span>
                <h4 className="font-semibold text-gray-900 dark:text-white">SUI Community Pool</h4>
                <span className="px-2 py-0.5 text-xs bg-cyan-500 text-white rounded-full">{tokenInfo.symbol} Deposits</span>
              </div>
              <a
                href={`${chainConfig?.blockExplorer?.testnet || 'https://suiscan.xyz/testnet'}/object/${suiPoolStateId || communityPoolAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                View Pool
              </a>
            </div>

            {suiIsConnected ? (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Wallet className="w-4 h-4 text-green-500" />
                <span>Connected: {suiAddress?.slice(0, 8)}...{suiAddress?.slice(-6)}</span>
                <span className="text-gray-400">|</span>
                <span>{suiBalance} SUI (for gas)</span>
              </div>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Connect a SUI wallet (Sui Wallet, Suiet, or Ethos) to deposit and withdraw.
              </p>
            )}
          </div>

          {/* Wrong Network Warning */}
          {suiIsConnected && suiIsWrongNetwork && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Wrong Network: Your wallet is on {suiNetwork}
                </span>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-500 mb-2">
                SUI wallets require manual network switching. Please open your wallet extension 
                and switch to <strong>Testnet</strong> in Settings → Network.
              </p>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>Supported wallets: Sui Wallet, Suiet, Ethos</span>
                <span className="text-amber-500">•</span>
                <span>The app will detect when you switch</span>
              </div>
            </div>
          )}

          {/* SUI Deposit/Withdraw Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => { onShowDeposit(!showDeposit); }}
              disabled={!suiIsConnected || actionLoading || suiIsWrongNetwork}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Deposit {tokenInfo.symbol}
            </button>
            <button
              onClick={() => { onShowWithdraw(!showWithdraw); }}
              disabled={!suiIsConnected || !userPosition?.isMember || actionLoading || suiIsWrongNetwork}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Minus className="w-4 h-4" />
              Withdraw
            </button>
          </div>

          {/* SUI Deposit Form */}
          <AnimatePresence>
            {showDeposit && suiIsConnected && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={suiDepositAmount}
                    onChange={(e) => onSuiDepositAmountChange(e.target.value)}
                    placeholder="Amount in USD (min $10)"
                    disabled={actionLoading}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  />
                  <button
                    onClick={onSuiDeposit}
                    disabled={actionLoading || !suiDepositAmount}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {txStatus === 'depositing' ? 'Depositing...' : txStatus === 'complete' ? 'Complete!' : 'Deposit'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Min deposit: $10 {tokenInfo.symbol} • Pool internally converts to portfolio assets
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Deposits are denominated in {tokenInfo.symbol}. Your share value reflects the portfolio NAV.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* SUI Withdraw Form */}
          <AnimatePresence>
            {showWithdraw && suiIsConnected && userPosition?.isMember && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={suiWithdrawShares}
                    onChange={(e) => onSuiWithdrawSharesChange(e.target.value)}
                    placeholder={`Shares (max: ${(Number(userPosition?.shares) || 0).toFixed(4)})`}
                    disabled={actionLoading}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  />
                  <button
                    onClick={() => onSuiWithdrawSharesChange(String(Number(userPosition?.shares) || 0))}
                    disabled={actionLoading}
                    className="px-3 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50 rounded-lg text-sm"
                  >
                    Max
                  </button>
                  <button
                    onClick={onSuiWithdraw}
                    disabled={actionLoading || !suiWithdrawShares}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minus className="w-4 h-4" />}
                    {txStatus === 'withdrawing' ? 'Withdrawing...' : txStatus === 'complete' ? 'Complete!' : 'Withdraw'}
                  </button>
                </div>
                {poolData && suiWithdrawShares && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Estimated value: ~${(parseFloat(suiWithdrawShares) * (Number(poolData.sharePriceUSD || poolData.sharePrice) || 1)).toFixed(2)} USD
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // EVM chains
  return (
    <div className="p-4 border-b border-gray-100 dark:border-gray-700">
      {/* EVM connection prompt */}
      {!evmConnected ? (
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <Wallet className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Connect your wallet (MetaMask, OKX, etc.) to deposit and withdraw from the pool.
            </p>
          </div>
          
          {/* WDK Treasury Status - AI Agent Wallet */}
          <WdkWalletConnect className="w-full" />
          
          <div className="text-center text-xs text-gray-500 dark:text-gray-400">
            Use the Connect Wallet button in the header
          </div>
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-green-500" />
            <span>Connected: {effectiveAddress?.slice(0, 6)}...{effectiveAddress?.slice(-4)}</span>
          </div>
          {!isChainMismatch && userUsdtBalance >= 0 && (
            <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded">
              Balance: ${userUsdtBalance.toFixed(2)} {tokenInfo.symbol}
            </span>
          )}
        </div>
      )}

      {/* Chain mismatch warning - wallet on different chain than selected pool */}
      {evmConnected && isChainMismatch && (
        <div className="mb-3 flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
          <AlertTriangle className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-700 dark:text-blue-400">
            Your wallet is on a different network. Click Deposit/Withdraw to switch to <strong>{chainConfig?.name}</strong> automatically.
          </p>
        </div>
      )}

      {/* No USDT warning */}
      {evmConnected && !isChainMismatch && userUsdtBalance === 0 && (
        <div className="mb-3 flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            You have no {tokenInfo.symbol} on {chainConfig?.name}. Get some WDK USDT from <a href="https://wdk.tether.io" target="_blank" rel="noopener noreferrer" className="underline font-medium">wdk.tether.io</a> to deposit.
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => { onShowDeposit(!showDeposit); }}
          disabled={!evmConnected}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Deposit
        </button>
        <button
          onClick={() => { onShowWithdraw(!showWithdraw); }}
          disabled={!evmConnected || !userPosition?.isMember}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          <Minus className="w-4 h-4" />
          Withdraw
        </button>
      </div>

      {/* EVM Deposit Form */}
      <AnimatePresence>
        {showDeposit && evmConnected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4"
          >
            <div className="flex gap-2">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => onDepositAmountChange(e.target.value)}
                placeholder={`Amount in USD (min $${minDeposit}${isFirstDeposit ? ' first deposit' : ''})`}
                disabled={actionLoading}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              />
              <button
                onClick={onDeposit}
                disabled={actionLoading || !depositAmount || !address || isPending || isConfirming}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {(actionLoading || isPending || isConfirming) && <Loader2 className="w-4 h-4 animate-spin" />}
                {txStatus === 'resetting_approval' ? 'Resetting allowance...' :
                 txStatus === 'signing_permit' ? 'Sign permit (gasless)...' :
                 txStatus === 'approving' ? `Approving ${tokenInfo.symbol}...` :
                 txStatus === 'approved' ? 'Approved! Starting deposit...' :
                 txStatus === 'depositing' ? 'Depositing...' :
                 txStatus === 'complete' ? 'Complete!' :
                 `Deposit ${tokenInfo.symbol}`}
              </button>
            </div>
            {poolData && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Current share price: ${(Number(poolData.sharePrice) || 1).toFixed(4)} — You'll receive ~{depositAmount ? (parseFloat(depositAmount) / (Number(poolData.sharePrice) || 1)).toFixed(4) : '0'} shares
              </p>
            )}
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {/* Permit-enabled tokens need only 1 signature! */}
              Deposits to on-chain CommunityPool contract. WDK USDT supports gasless permit - just 1 signature!
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* EVM Withdraw Form */}
      <AnimatePresence>
        {showWithdraw && evmConnected && userPosition?.isMember && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4"
          >
            <div className="flex gap-2">
              <input
                type="number"
                value={withdrawShares}
                onChange={(e) => onWithdrawSharesChange(e.target.value)}
                placeholder={`Shares to burn (max ${(Number(userPosition.shares) || 0).toFixed(4)})`}
                disabled={actionLoading || txStatus === 'withdrawing'}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              />
              <button
                onClick={() => onWithdrawSharesChange(String(Number(userPosition.shares) || 0))}
                disabled={actionLoading || txStatus === 'withdrawing'}
                className="px-3 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50 rounded-lg text-sm"
              >
                Max
              </button>
              <button
                onClick={onWithdraw}
                disabled={actionLoading || !withdrawShares || !address || txStatus === 'withdrawing' || isPending || isConfirming}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {(actionLoading || isPending || isConfirming || txStatus === 'withdrawing') && <Loader2 className="w-4 h-4 animate-spin" />}
                {txStatus === 'withdrawing' ? 'Withdrawing...' : 
                 txStatus === 'complete' ? 'Complete!' : 
                 'Withdraw'}
              </button>
            </div>
            {poolData && withdrawShares && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                You'll receive: ~${(parseFloat(withdrawShares) * (Number(poolData.sharePrice) || 0)).toFixed(2)} USD
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
