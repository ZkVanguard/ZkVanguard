'use client';

import React, { memo, useState } from 'react';
import { Award, Shield, Wallet, ExternalLink, ChevronDown, ChevronUp, CheckCircle2, Database } from 'lucide-react';
import type { LeaderboardEntry } from './types';
import { formatPercent } from './utils';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  proxyWallet?: string;
  poolTVL?: number;
  chainId?: number;
  selectedChain?: string;
  chainConfig?: {
    chainType?: string;
    name?: string;
    contracts?: { testnet?: { communityPool?: string; usdt?: string } };
    blockExplorer?: { testnet?: string };
    assets?: string[];
  };
}

const RANK_STYLES = [
  'bg-yellow-500 text-white',
  'bg-gray-400 text-white',
  'bg-orange-600 text-white',
];

// Treasury addresses for EVM chains
const POOL_PROXY_WALLETS: Record<string, { address: string; name: string }> = {
  sepolia: {
    address: '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086',
    name: 'Pool Contract (WDK USDT)',
  },
  cronos: {
    address: '0x7F75Ca65D32752607fF481F453E4fbD45E61FdFd',
    name: 'Pool Contract',
  },
};

const EXPLORER_URLS: Record<number, string> = {
  11155111: 'https://sepolia.etherscan.io',
  338: 'https://explorer.cronos.org/testnet',
  296: 'https://hashscan.io/testnet',
};

// Deterministic treasury proxy address for EVM chains
const ZKVANGUARD_PDA_DOMAIN = 'ZKVANGUARD_PROXY_PDA_V1';

async function deriveTreasuryProxyClient(): Promise<string> {
  const derivationPath = `${ZKVANGUARD_PDA_DOMAIN}:treasury:pool-share:0`;
  const encoder = new TextEncoder();
  const data = encoder.encode(derivationPath);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return '0x' + hashHex.slice(-40);
}

export const Leaderboard = memo(function Leaderboard({ entries, proxyWallet, poolTVL, chainId = 11155111, selectedChain, chainConfig }: LeaderboardProps) {
  const [showProof, setShowProof] = useState(false);
  const [treasuryProxy, setTreasuryProxy] = useState<string>('');
  const isSui = selectedChain === 'sui' || chainConfig?.chainType === 'sui';
  
  // Derive treasury proxy address (EVM chains only)
  React.useEffect(() => {
    if (!isSui) {
      deriveTreasuryProxyClient().then(setTreasuryProxy);
    }
  }, [isSui]);

  // Get explorer URL based on chain
  const explorerUrl = isSui
    ? (chainConfig?.blockExplorer?.testnet || 'https://suiscan.xyz/testnet')
    : (EXPLORER_URLS[chainId] || EXPLORER_URLS[11155111]);

  // Treasury info varies by chain
  const treasury = isSui ? {
    address: chainConfig?.contracts?.testnet?.communityPool || '',
    name: 'Pool Contract (USDC)',
  } : treasuryProxy ? {
    address: treasuryProxy,
    name: POOL_PROXY_WALLETS[selectedChain || 'sepolia']?.name || 'Pool Treasury',
  } : proxyWallet ? {
    address: proxyWallet,
    name: 'Pool Treasury',
  } : POOL_PROXY_WALLETS[selectedChain || 'sepolia'] || POOL_PROXY_WALLETS.sepolia;

  // Build explorer link based on chain type
  const contractUrl = isSui
    ? `${explorerUrl}/object/${treasury.address}`
    : `${explorerUrl}/address/${treasury.address}`;

  return (
    <div className="p-4">
      {/* Pool Contract Info */}
      <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-2">
          {isSui ? <Database className="w-4 h-4 text-blue-500" /> : <Shield className="w-4 h-4 text-purple-500" />}
          <span className="font-semibold text-sm text-purple-600 dark:text-purple-400">
            {treasury.name}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">
            {treasury.address ? `${treasury.address.slice(0, 8)}...${treasury.address.slice(-6)}` : 'N/A'}
          </span>
          {poolTVL !== undefined && (
            <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
              ${poolTVL.toLocaleString()} TVL
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          {treasury.address && (
            <a
              href={contractUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              {isSui ? 'View on SuiScan' : 'View Contract'}
            </a>
          )}
          {isSui && chainConfig?.contracts?.testnet?.usdt && (
            <a
              href={`${explorerUrl}/object/${chainConfig.contracts.testnet.usdt}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              USDC Token
            </a>
          )}
          {!isSui && treasury.address && (
            <a
              href={`${explorerUrl}/address/${treasury.address}#tokentxns`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" />
              Token Transfers
            </a>
          )}
        </div>
      </div>

      {/* SUI Pool Info */}
      {isSui && (
        <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-blue-500" />
            <span className="font-semibold text-sm text-blue-600 dark:text-blue-400">
              Database-Backed USDC Pool
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Deposits are recorded in the pool database. AI manages a 4-asset allocation
            across {chainConfig?.assets?.join(', ') || 'BTC, ETH, SUI, CRO'}. 1 share = 1 USDC.
          </p>
        </div>
      )}

      {/* Shareholders Leaderboard */}
      {entries.length > 0 && (
        <>
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
            <Award className="w-4 h-4 text-yellow-500" />
            Top Shareholders
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            All deposits are routed through the single treasury proxy. Real addresses are never disclosed.
          </p>
          <div className="space-y-2">
            {entries
              .filter((user) => user?.walletAddress)
              .map((user, index) => {
                return (
                  <div
                    key={user.walletAddress}
                    className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                          RANK_STYLES[index] || 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1">
                          <Wallet className="w-3 h-3 text-blue-500" />
                          <span className="text-sm text-gray-600 dark:text-gray-300 font-mono">
                            {user.walletAddress.slice(0, 8)}...{user.walletAddress.slice(-6)}
                          </span>
                        </div>
                        <span className="text-[10px] text-purple-500 dark:text-purple-400">
                          via Treasury Proxy
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {user.shares.toFixed(2)} shares
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatPercent(user.percentage)}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
});
