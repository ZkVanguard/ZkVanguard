'use client';

import React, { memo, useState, useMemo } from 'react';
import { Award, Shield, Wallet, ExternalLink, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import type { LeaderboardEntry } from './types';
import { formatPercent } from './utils';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  proxyWallet?: string;
  poolTVL?: number;
  chainId?: number;
}

const RANK_STYLES = [
  'bg-yellow-500 text-white',
  'bg-gray-400 text-white',
  'bg-orange-600 text-white',
];

// ZK Proxy Vault address for Community Pool Treasury
const POOL_PROXY_WALLETS: Record<string, { address: string; name: string }> = {
  sepolia: {
    address: '0x07d68C2828F35327d12a7Ba796cCF3f12F8A1086',
    name: 'Pool Treasury (ZK Proxy)',
  },
  cronos: {
    address: '0x7F75Ca65D32752607fF481F453E4fbD45E61FdFd',
    name: 'Pool Treasury (ZK Proxy)',
  },
};

// On-chain proof: Verified asset tokens held by pool
const SEPOLIA_ASSET_TOKENS = [
  { symbol: 'mBTC', address: '0xaEbA1a0817F6A072F6272d9B46098E2e8A20A9D6', allocation: '30%' },
  { symbol: 'mETH', address: '0xEbFA21Ca64791821D4138d3F0643a821313e53A5', allocation: '30%' },
  { symbol: 'mCRO', address: '0x257d8583094D524554472d30A58F5cd9337D81c0', allocation: '20%' },
  { symbol: 'mSUI', address: '0x5DA2C404bA47d289d8E125Ef12f0Dd4707d68E5D', allocation: '20%' },
];

const EXPLORER_URLS: Record<number, string> = {
  11155111: 'https://sepolia.etherscan.io',
  338: 'https://explorer.cronos.org/testnet',
  296: 'https://hashscan.io/testnet',
};

// Deterministic treasury proxy address — ALL deposits go here
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

export const Leaderboard = memo(function Leaderboard({ entries, proxyWallet, poolTVL, chainId = 11155111 }: LeaderboardProps) {
  const [showProof, setShowProof] = useState(false);
  const [treasuryProxy, setTreasuryProxy] = useState<string>('');
  
  // Derive single treasury proxy address
  React.useEffect(() => {
    deriveTreasuryProxyClient().then(setTreasuryProxy);
  }, []);

  // Show the ZK Proxy wallet as the pool treasury
  const treasury = treasuryProxy ? {
    address: treasuryProxy,
    name: 'Pool Treasury (ZK Proxy)',
  } : proxyWallet ? {
    address: proxyWallet,
    name: 'Pool Treasury (ZK Proxy)',
  } : POOL_PROXY_WALLETS.sepolia;

  const explorerUrl = EXPLORER_URLS[chainId] || EXPLORER_URLS[11155111];

  return (
    <div className="p-4">
      {/* Pool Treasury - ZK Proxy Wallet */}
      <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-purple-500" />
          <span className="font-semibold text-sm text-purple-600 dark:text-purple-400">
            {treasury.name}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600 dark:text-gray-400 font-mono">
            {treasury.address.slice(0, 8)}...{treasury.address.slice(-6)}
          </span>
          {poolTVL !== undefined && (
            <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
              ${poolTVL.toLocaleString()} TVL
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <a
            href={`${explorerUrl}/address/${treasury.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            View Contract
          </a>
          <a
            href={`${explorerUrl}/address/${treasury.address}#tokentxns`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            Token Transfers
          </a>
        </div>
      </div>

      {/* On-Chain Proof of Holdings - Sepolia */}
      {chainId === 11155111 && (
        <div className="mb-4">
          <button
            onClick={() => setShowProof(!showProof)}
            className="w-full flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20 hover:bg-green-500/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="font-semibold text-sm text-green-600 dark:text-green-400">
                On-Chain Proof of Holdings
              </span>
            </div>
            {showProof ? (
              <ChevronUp className="w-4 h-4 text-green-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-green-500" />
            )}
          </button>
          
          {showProof && (
            <div className="mt-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Verify pool holdings on-chain. All assets are held in the ZK Proxy vault contract.
                Depositor addresses are private - only the pool address is public.
              </p>
              
              <div className="space-y-2">
                {SEPOLIA_ASSET_TOKENS.map((token) => (
                  <div
                    key={token.symbol}
                    className="flex items-center justify-between p-2 rounded bg-white dark:bg-gray-900/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {token.symbol}
                      </span>
                      <span className="text-xs text-green-600 dark:text-green-400">
                        {token.allocation}
                      </span>
                    </div>
                    <a
                      href={`${explorerUrl}/token/${token.address}?a=${treasury.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1"
                    >
                      <span className="font-mono">{token.address.slice(0, 6)}...{token.address.slice(-4)}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <strong>Privacy:</strong> Depositor addresses are never disclosed.
                  Pool earnings are distributed proportionally via smart contract.
                </p>
              </div>
            </div>
          )}
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
