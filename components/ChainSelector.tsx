'use client';

import { useState } from 'react';
import { SUPPORTED_CHAINS, ChainType } from '../lib/chains';

interface ChainSelectorProps {
  onChainChange?: (chainType: ChainType, chainName: string) => void;
  className?: string;
}

export function ChainSelector({ onChainChange, className = '' }: ChainSelectorProps) {
  const [selectedChain, setSelectedChain] = useState<ChainType>('evm');
  const [isOpen, setIsOpen] = useState(false);

  const currentChain = SUPPORTED_CHAINS.find(c => c.type === selectedChain);

  const handleChainSelect = (chainType: ChainType, chainName: string) => {
    setSelectedChain(chainType);
    setIsOpen(false);
    onChainChange?.(chainType, chainName);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Current Chain Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl hover:bg-[#E5E5EA] transition-all duration-200"
      >
        <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#007AFF] to-[#5856D6] flex items-center justify-center text-white text-xs font-bold">
          {currentChain?.name.charAt(0)}
        </div>
        <span className="text-[#1D1D1F] font-medium text-sm">{currentChain?.name}</span>
        <svg
          className={`w-4 h-4 text-[#86868B] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-64 bg-white border border-[#E5E5EA] rounded-2xl shadow-xl overflow-hidden z-50">
          <div className="p-3 border-b border-[#E5E5EA]">
            <h4 className="text-[#86868B] text-xs font-medium uppercase tracking-wider">Select Network</h4>
          </div>
          
          <div className="p-2">
            {SUPPORTED_CHAINS.map((chain) => (
              <button
                key={chain.type}
                onClick={() => handleChainSelect(chain.type, chain.name)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${
                  selectedChain === chain.type
                    ? 'bg-[#007AFF]/10 border border-[#007AFF]/50'
                    : 'hover:bg-[#F5F5F7]'
                }`}
              >
                {/* Chain Icon */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  chain.type === 'evm' 
                    ? 'bg-gradient-to-r from-[#007AFF] to-[#5856D6]' 
                    : 'bg-gradient-to-r from-[#32ADE6] to-[#007AFF]'
                }`}>
                  {chain.type === 'evm' ? (
                    <span className="text-white font-bold text-sm">CRO</span>
                  ) : (
                    <svg viewBox="0 0 32 32" className="w-6 h-6 text-white" fill="currentColor">
                      <path d="M16 2L4 9.5v13L16 30l12-7.5v-13L16 2zm0 3.5l8 5v10l-8 5-8-5v-10l8-5z"/>
                    </svg>
                  )}
                </div>

                {/* Chain Info */}
                <div className="flex-1 text-left">
                  <div className="text-[#1D1D1F] font-semibold">{chain.name}</div>
                  <div className="text-[#86868B] text-xs">
                    {chain.type === 'evm' ? 'EVM Compatible • x402 Gasless' : 'Move-based • Sponsored Tx'}
                  </div>
                </div>

                {/* Status Badge */}
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                  chain.type === 'evm'
                    ? 'bg-[#34C759]/10 text-[#34C759]'
                    : 'bg-[#32ADE6]/10 text-[#32ADE6]'
                }`}>
                  {chain.type === 'evm' ? 'Live' : 'Ready'}
                </div>

                {/* Check Icon */}
                {selectedChain === chain.type && (
                  <svg className="w-5 h-5 text-[#007AFF]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Multi-Chain Info */}
          <div className="p-3 border-t border-[#E5E5EA] bg-[#F5F5F7]">
            <div className="flex items-center gap-2 text-[#86868B] text-xs">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Multi-chain portfolio aggregation enabled</span>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

export default ChainSelector;
