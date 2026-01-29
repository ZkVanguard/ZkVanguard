'use client';

import { useState } from 'react';

interface NetworkInfo {
  name: string;
  type: 'evm' | 'sui';
  status: 'live' | 'ready' | 'maintenance';
  network: 'mainnet' | 'testnet';
  color: string;
  packageId?: string;
  explorerUrl: string;
}

const NETWORKS: NetworkInfo[] = [
  {
    name: 'Cronos',
    type: 'evm',
    status: 'live',
    network: 'testnet',
    color: '#002D74',
    explorerUrl: 'https://explorer.cronos.org/testnet',
  },
  {
    name: 'SUI',
    type: 'sui',
    status: 'live',
    network: 'testnet',
    color: '#4DA2FF',
    packageId: '0xd76a2da684743b47e64382b61004314bca46fb2dc94a286c4f1882caa0dfc1d9',
    explorerUrl: 'https://suiscan.xyz/testnet/object/0xd76a2da684743b47e64382b61004314bca46fb2dc94a286c4f1882caa0dfc1d9',
  },
];

interface NetworkBadgeProps {
  compact?: boolean;
  showDropdown?: boolean;
}

export function NetworkBadge({ compact = false, showDropdown = false }: NetworkBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-[#F5F5F7] rounded-full">
        {NETWORKS.map((network) => (
          <div
            key={network.name}
            className="flex items-center gap-1"
            title={`${network.name} ${network.network}`}
          >
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: network.status === 'live' ? '#34C759' : '#FF9500' }}
            />
            <span className="text-xs font-medium text-[#1D1D1F]">{network.name}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => showDropdown && setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-[#E5E5EA] rounded-xl hover:bg-[#F5F5F7] transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {NETWORKS.map((network) => (
            <div
              key={network.name}
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: network.color }}
              title={network.name}
            />
          ))}
        </div>
        <span className="text-sm font-medium text-[#1D1D1F]">Multi-Chain</span>
        <span className="text-xs px-1.5 py-0.5 bg-[#34C759]/10 text-[#34C759] rounded-full font-medium">
          {NETWORKS.filter(n => n.status === 'live').length} Live
        </span>
      </button>

      {isOpen && showDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full mt-2 right-0 w-72 bg-white border border-[#E5E5EA] rounded-2xl shadow-xl overflow-hidden z-50">
            <div className="p-3 border-b border-[#E5E5EA]">
              <h4 className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">
                Network Status
              </h4>
            </div>
            <div className="p-2 space-y-1">
              {NETWORKS.map((network) => (
                <a
                  key={network.name}
                  href={network.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-[#F5F5F7] transition-colors"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: network.color }}
                  >
                    {network.name.slice(0, 3).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#1D1D1F]">{network.name}</span>
                      <span className="text-xs text-[#86868B] capitalize">{network.network}</span>
                    </div>
                    <div className="text-xs text-[#86868B]">
                      {network.type === 'evm' ? 'EVM • x402 Gasless' : 'Move • Sponsored Tx'}
                    </div>
                  </div>
                  <div
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      network.status === 'live'
                        ? 'bg-[#34C759]/10 text-[#34C759]'
                        : network.status === 'ready'
                        ? 'bg-[#FF9500]/10 text-[#FF9500]'
                        : 'bg-[#FF3B30]/10 text-[#FF3B30]'
                    }`}
                  >
                    {network.status.charAt(0).toUpperCase() + network.status.slice(1)}
                  </div>
                </a>
              ))}
            </div>
            <div className="p-3 border-t border-[#E5E5EA] bg-[#F5F5F7]">
              <div className="text-xs text-[#86868B] text-center">
                All contracts deployed and verified ✓
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default NetworkBadge;
