'use client';

/**
 * CommunityPool - Refactored
 * 
 * Main orchestration component. All UI sections are extracted into
 * memoized sub-components under ./community-pool/. State management
 * uses useReducer via the useCommunityPool hook for minimal re-renders.
 * 
 * ~280 lines vs previous ~1,632 lines
 */

import { useState, memo, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RiskMetricsPanel } from './RiskMetricsPanel';
import { AutoHedgePanel } from './AutoHedgePanel';
import {
  PoolHeader,
  PoolStats,
  AllocationChart,
  UserPositionCard,
  DepositWithdrawActions,
  StatusMessages,
  Leaderboard,
  AIInsightsModal,
  useCommunityPool,
} from './community-pool';

interface CommunityPoolProps {
  address?: string;
  compact?: boolean;
}

export const CommunityPool = memo(function CommunityPool({ address: propAddress, compact = false }: CommunityPoolProps) {
  const [showAI, setShowAI] = useState(false);

  const pool = useCommunityPool(propAddress);

  // ============================================================================
  // TRANSACTION CONFIRMATION EFFECTS (tightly coupled to wagmi lifecycle)
  // ============================================================================
  
  // Handle transaction confirmation based on current status
  useEffect(() => {
    if (!pool.isConfirmed) return;
    
    // Approval confirmed -> trigger deposit
    if (pool.txStatus === 'approving' && pool.depositAmount) {
      pool.setTxStatus('depositing');
      pool.resetWrite();
      return;
    }
    
    // Deposit confirmed - record in backend
    if (pool.txStatus === 'depositing') {
      const recordDeposit = async () => {
        try {
          const amount = parseFloat(pool.depositAmount);
          
          pool.setError('Please sign to confirm your deposit...');
          const authData = await pool.signForApi('deposit', amount.toString());
          if (!authData) {
            pool.setError('Signature required to confirm deposit');
            pool.setTxStatus('idle');
            pool.setActionLoading(false);
            return;
          }
          pool.setError(null);
          
          const res = await fetch(`/api/community-pool?action=deposit&chain=${pool.selectedChain}&network=${pool.network}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-wallet-address': pool.address!,
              'x-wallet-signature': authData.signature,
              'x-wallet-message': btoa(authData.message),
            },
            body: JSON.stringify({
              walletAddress: pool.address,
              amount,
            }),
          });
          
          const json = await res.json();
          
          if (json.success) {
            pool.setSuccess(`Deposited $${amount.toFixed(2)} successfully!`);
            pool.setDepositAmount('');
            pool.setShowDeposit(false);
            pool.setTxStatus('idle');
            pool.resetWrite();
            
            await fetch(`/api/community-pool?action=sync&user=${pool.address}`);
            pool.fetchPoolData();
            
            setTimeout(() => { pool.setSuccess(null); pool.setLastTxHash(null); }, 10000);
          } else {
            pool.setError(json.error);
            pool.setTxStatus('idle');
          }
        } catch (err: any) {
          pool.setError(err.message);
          pool.setTxStatus('idle');
        } finally {
          pool.setActionLoading(false);
        }
      };
      recordDeposit();
      return;
    }
    
    // Withdrawal confirmed - record in backend
    if (pool.txStatus === 'withdrawing') {
      const recordWithdrawal = async () => {
        try {
          const shares = parseFloat(pool.withdrawShares);
          
          pool.setError('Please sign to confirm your withdrawal...');
          const authData = await pool.signForApi('withdraw', shares.toString());
          if (!authData) {
            pool.setError('Signature required to confirm withdrawal');
            pool.setTxStatus('idle');
            pool.setActionLoading(false);
            return;
          }
          pool.setError(null);
          
          const res = await fetch(`/api/community-pool?action=withdraw&chain=${pool.selectedChain}&network=${pool.network}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-wallet-address': pool.address!,
              'x-wallet-signature': authData.signature,
              'x-wallet-message': btoa(authData.message),
            },
            body: JSON.stringify({
              walletAddress: pool.address,
              shares,
            }),
          });
          
          const json = await res.json();
          
          if (json.success) {
            pool.setSuccess(`Withdrew ${shares.toFixed(2)} shares successfully!`);
            pool.setWithdrawShares('');
            pool.setShowWithdraw(false);
            pool.setTxStatus('idle');
            pool.resetWrite();
            
            await fetch(`/api/community-pool?action=sync&user=${pool.address}`);
            pool.fetchPoolData();
            
            setTimeout(() => { pool.setSuccess(null); pool.setLastTxHash(null); }, 10000);
          } else {
            pool.setError(json.error);
            pool.setTxStatus('idle');
          }
        } catch (err: any) {
          pool.setError(err.message);
          pool.setTxStatus('idle');
        } finally {
          pool.setActionLoading(false);
        }
      };
      recordWithdrawal();
    }
  }, [pool.isConfirmed]);

  // Handle write errors
  useEffect(() => {
    if (pool.writeError) {
      const errorMsg = pool.writeError.message || '';
      
      if (errorMsg.includes('User rejected') || errorMsg.includes('user rejected')) {
        pool.setError('Transaction rejected by user');
      } else if (errorMsg.includes('Invalid value') || errorMsg.includes('fetch')) {
        pool.setError('Transaction failed - please check your input values and try again');
      } else if (errorMsg.includes('InsufficientShares')) {
        pool.setError('Insufficient shares to withdraw');
      } else if (errorMsg.includes('InsufficientLiquidity')) {
        pool.setError('Insufficient liquidity in pool - please try a smaller amount');
      } else {
        const shortMsg = (pool.writeError as any).shortMessage || errorMsg;
        pool.setError(shortMsg.slice(0, 200));
      }
      pool.setActionLoading(false);
      pool.setTxStatus('idle');
    }
  }, [pool.writeError]);

  // ============================================================================
  // AI MODAL HANDLER
  // ============================================================================
  
  const handleAIClick = useCallback(() => {
    setShowAI(true);
    pool.fetchAIRecommendation();
  }, [pool.fetchAIRecommendation]);

  const chainName = pool.chainConfig?.name || pool.selectedChain;

  // ============================================================================
  // LOADING STATE
  // ============================================================================
  
  if (pool.loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden"
      >
        <PoolHeader
          selectedChain={pool.selectedChain}
          onChainSelect={pool.handleChainSelect}
          isLoading
        />
        <div className="p-6 animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </motion.div>
    );
  }

  // ============================================================================
  // NO DATA STATE
  // ============================================================================
  
  if (!pool.poolData) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden"
      >
        <PoolHeader
          selectedChain={pool.selectedChain}
          onChainSelect={pool.handleChainSelect}
          onRefresh={() => pool.fetchPoolData(true)}
        />
        <div className="p-6">
          <p className="text-gray-500 dark:text-gray-400 text-center">
            {pool.error || `Unable to load ${chainName} pool data. Try refreshing or selecting a different chain.`}
          </p>
        </div>
      </motion.div>
    );
  }

  // ============================================================================
  // MAIN RENDER 
  // ============================================================================
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden"
    >
      <PoolHeader
        selectedChain={pool.selectedChain}
        onChainSelect={pool.handleChainSelect}
        onRefresh={() => pool.fetchPoolData(true)}
        onAIClick={handleAIClick}
        chainName={chainName}
        network={pool.network}
        poolDeployed={pool.poolDeployed}
      />

      <PoolStats poolData={pool.poolData} selectedChain={pool.selectedChain} />

      <AllocationChart
        allocations={pool.poolData.allocations}
        assets={pool.chainConfig?.assets}
      />

      {pool.address && pool.userPosition && (
        <UserPositionCard
          userPosition={pool.userPosition}
          selectedChain={pool.selectedChain}
          chainName={chainName}
        />
      )}

      <DepositWithdrawActions
        selectedChain={pool.selectedChain}
        poolData={pool.poolData}
        userPosition={pool.userPosition}
        chainConfig={pool.chainConfig}
        poolDeployed={pool.poolDeployed}
        communityPoolAddress={pool.COMMUNITY_POOL_ADDRESS}
        suiPoolStateId={pool.suiPoolStateId}
        showDeposit={pool.showDeposit}
        showWithdraw={pool.showWithdraw}
        depositAmount={pool.depositAmount}
        withdrawShares={pool.withdrawShares}
        actionLoading={pool.actionLoading}
        isPending={pool.isPending}
        isConfirming={pool.isConfirming}
        txStatus={pool.txStatus}
        address={pool.address}
        suiIsConnected={pool.suiIsConnected}
        suiAddress={pool.suiAddress}
        suiBalance={pool.suiBalance}
        suiDepositAmount={pool.suiDepositAmount}
        suiWithdrawShares={pool.suiWithdrawShares}
        onShowDeposit={pool.setShowDeposit}
        onShowWithdraw={pool.setShowWithdraw}
        onDepositAmountChange={pool.setDepositAmount}
        onWithdrawSharesChange={pool.setWithdrawShares}
        onSuiDepositAmountChange={pool.setSuiDepositAmount}
        onSuiWithdrawSharesChange={pool.setSuiWithdrawShares}
        onDeposit={pool.handleDeposit}
        onWithdraw={pool.handleWithdraw}
        onSuiDeposit={pool.handleSuiDeposit}
        onSuiWithdraw={pool.handleSuiWithdraw}
      />

      <StatusMessages
        successMessage={pool.successMessage}
        error={pool.error}
        lastTxHash={pool.lastTxHash}
      />

      {!compact && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <RiskMetricsPanel compact={false} />
        </div>
      )}

      {!compact && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <AutoHedgePanel />
        </div>
      )}

      {!compact && <Leaderboard entries={pool.leaderboard} />}

      <AIInsightsModal
        isOpen={showAI}
        onClose={() => setShowAI(false)}
        recommendation={pool.aiRecommendation}
      />
    </motion.div>
  );
});

export default CommunityPool;
