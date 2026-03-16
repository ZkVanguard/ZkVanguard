'use client';

import React, { memo } from 'react';
import { Plus, Minus, Wallet, ExternalLink, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PoolSummary, UserPosition, ChainKey, TxStatus } from './types';

interface DepositWithdrawActionsProps {
  selectedChain: ChainKey;
  poolData: PoolSummary;
  userPosition: UserPosition | null;
  chainConfig: any;
  poolDeployed: boolean;
  communityPoolAddress: string;
  suiPoolStateId: string | null;
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
  // SUI state
  suiIsConnected: boolean;
  suiAddress: string | null;
  suiBalance: string;
  suiDepositAmount: string;
  suiWithdrawShares: string;
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
  showDeposit,
  showWithdraw,
  depositAmount,
  withdrawShares,
  actionLoading,
  isPending,
  isConfirming,
  txStatus,
  address,
  suiIsConnected,
  suiAddress,
  suiBalance,
  suiDepositAmount,
  suiWithdrawShares,
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

  if (isSui) {
    return (
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="space-y-4">
          {/* SUI Pool Header */}
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">💧</span>
                <h4 className="font-semibold text-gray-900 dark:text-white">SUI Pool</h4>
                <span className="px-2 py-0.5 text-xs bg-cyan-500 text-white rounded-full">Live on Testnet</span>
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
                <span>{suiBalance} SUI</span>
              </div>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Connect a SUI wallet (Sui Wallet, Suiet, or Ethos) to deposit and withdraw.
              </p>
            )}
          </div>

          {/* SUI Deposit/Withdraw Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => { onShowDeposit(!showDeposit); }}
              disabled={!suiIsConnected || actionLoading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Deposit SUI
            </button>
            <button
              onClick={() => { onShowWithdraw(!showWithdraw); }}
              disabled={!suiIsConnected || !userPosition?.isMember || actionLoading}
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
                    placeholder="Amount in SUI (min 0.1)"
                    disabled={actionLoading}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  />
                  <button
                    onClick={onSuiDeposit}
                    disabled={actionLoading || !suiDepositAmount}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Deposit
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* SUI Withdraw Form */}
          <AnimatePresence>
            {showWithdraw && suiIsConnected && (
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
                    placeholder={`Shares (max: ${userPosition?.shares?.toFixed(4) || 0})`}
                    disabled={actionLoading}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                  />
                  <button
                    onClick={onSuiWithdraw}
                    disabled={actionLoading || !suiWithdrawShares}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minus className="w-4 h-4" />}
                    Withdraw
                  </button>
                </div>
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
      <div className="flex gap-3">
        <button
          onClick={() => { onShowDeposit(!showDeposit); }}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Deposit
        </button>
        <button
          onClick={() => { onShowWithdraw(!showWithdraw); }}
          disabled={!userPosition?.isMember}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          <Minus className="w-4 h-4" />
          Withdraw
        </button>
      </div>

      {/* EVM Deposit Form */}
      <AnimatePresence>
        {showDeposit && (
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
                placeholder="Amount in USD (min $10)"
                disabled={actionLoading}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              />
              <button
                onClick={onDeposit}
                disabled={actionLoading || !depositAmount || !address || isPending || isConfirming}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {(actionLoading || isPending || isConfirming) && <Loader2 className="w-4 h-4 animate-spin" />}
                {txStatus === 'approving' ? 'Approve USDC...' :
                 txStatus === 'depositing' ? 'Deposit to Pool...' :
                 'Deposit USDC'}
              </button>
            </div>
            {poolData && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Current share price: ${poolData.sharePrice.toFixed(4)} — You'll receive ~{depositAmount ? (parseFloat(depositAmount) / poolData.sharePrice).toFixed(4) : '0'} shares
              </p>
            )}
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Deposits to on-chain CommunityPool contract. Requires 2 signatures: approve + deposit.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* EVM Withdraw Form */}
      <AnimatePresence>
        {showWithdraw && userPosition?.isMember && (
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
                placeholder={`Shares to burn (max ${userPosition.shares.toFixed(4)})`}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <button
                onClick={() => onWithdrawSharesChange(userPosition.shares.toString())}
                className="px-3 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-lg text-sm"
              >
                Max
              </button>
              <button
                onClick={onWithdraw}
                disabled={actionLoading || !withdrawShares || txStatus === 'withdrawing'}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
              >
                {txStatus === 'withdrawing' ? 'Withdrawing...' : actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
            {poolData && withdrawShares && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                You'll receive: ~${(parseFloat(withdrawShares) * poolData.sharePrice).toFixed(2)} USD
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
