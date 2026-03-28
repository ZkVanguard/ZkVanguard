'use client';

import { Filter } from 'lucide-react';
import type { AssetFilter } from './types';
import { InfoTooltip } from './InfoTooltip';

export function FiltersStep({ filters, setFilters, onNext, onBack }: {
  filters: AssetFilter;
  setFilters: React.Dispatch<React.SetStateAction<AssetFilter>>;
  onNext: () => void;
  onBack: () => void;
}) {
  const categories = ['DeFi', 'Layer1', 'Layer2', 'Gaming', 'NFT', 'Stablecoin', 'RWA'];

  return (
    <div className="space-y-5 sm:space-y-6">
      <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#1d1d1f] mb-4 flex items-center gap-2">
        <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-[#007AFF]" />
        Asset Selection Filters
      </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
            Minimum Market Cap ($)
            <InfoTooltip content={[
              "Only include tokens with at least this market capitalization",
              "",
              "💡 Why it matters: Higher market cap = more established projects with better liquidity",
              "",
              "Recommended:",
              "• Conservative: $10M+ (established projects only)",
              "• Balanced: $1M+ (mix of established and growing)",
              "• Aggressive: $100K+ (includes emerging projects)"
            ]} />
          </label>
          <input
            type="number"
            value={filters.minMarketCap}
            onChange={(e) => setFilters({ ...filters, minMarketCap: Number(e.target.value) })}
            className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
          />
        </div>

        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
            Maximum Volatility (%)
            <InfoTooltip content={[
              "Exclude tokens that fluctuate more than this percentage - Controls risk exposure",
              "",
              "💡 Lower values = more stable portfolio, higher values = more growth potential",
              "",
              "Recommended:",
              "• Conservative: 30-40% (stable assets only)",
              "• Balanced: 60-80% (moderate volatility)",
              "• Aggressive: 90-100% (high-growth tokens)"
            ]} />
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={filters.maxVolatility}
            onChange={(e) => setFilters({ ...filters, maxVolatility: Number(e.target.value) })}
            className="w-full accent-[#007AFF]"
          />
          <div className="text-center text-[13px] sm:text-[14px] text-[#007AFF] font-semibold mt-1">
            {filters.maxVolatility}%
          </div>
        </div>

        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-3 flex items-center gap-2">
            Allowed Asset Categories
            <InfoTooltip content={[
              "Select which types of crypto assets AI can include in your portfolio",
              "",
              "🏛️ DeFi: Decentralized finance protocols (VVS Finance, Tectonic, etc.)",
              "🔗 Layer1: Base blockchains (BTC, ETH, CRO, SOL)",
              "⚡ Layer2: Scaling solutions (Polygon, Arbitrum, Optimism)",
              "🎮 Gaming: Play-to-earn and gaming tokens",
              "🇺🇻 NFT: NFT marketplace and utility tokens",
              "💵 Stablecoin: USD-pegged tokens (USDC, USDT, DAI)",
              "🏢 RWA: Real-world asset tokens (tokenized bonds, real estate)",
              "",
              "💡 Tip: More categories = better diversification but higher risk variety"
            ]} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((cat) => (
              <label key={cat} className="flex items-center gap-2 cursor-pointer p-2.5 rounded-[10px] bg-[#f5f5f7] hover:bg-[#e8e8ed] transition-colors">
                <input
                  type="checkbox"
                  checked={filters.allowedCategories.includes(cat)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFilters({ ...filters, allowedCategories: [...filters.allowedCategories, cat] });
                    } else {
                      setFilters({ ...filters, allowedCategories: filters.allowedCategories.filter((c: string) => c !== cat) });
                    }
                  }}
                  className="w-4 h-4 rounded-[4px] border-black/20 text-[#007AFF] focus:ring-[#007AFF]/50 accent-[#007AFF]"
                />
                <span className="text-[13px] sm:text-[14px] text-[#1d1d1f]">{cat}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[12px] sm:text-[13px] font-medium text-[#1d1d1f] mb-2 flex items-center gap-2">
            Minimum Liquidity ($)
            <InfoTooltip content={[
              "Only include tokens with at least this much trading liquidity - Ensures you can enter/exit positions easily",
              "",
              "💡 Why it matters: Higher liquidity = lower slippage when trading, easier to execute large orders",
              "",
              "Recommended:",
              "• Conservative: $1M+ (deep liquidity)",
              "• Balanced: $500K+ (good liquidity)",
              "• Aggressive: $100K+ (accepts lower liquidity for opportunities)",
              "",
              "⚠️ Low liquidity can cause high slippage and difficulty exiting positions"
            ]} />
          </label>
          <input
            type="number"
            value={filters.minLiquidity}
            onChange={(e) => setFilters({ ...filters, minLiquidity: Number(e.target.value) })}
            className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-[#f5f5f7] border border-black/5 rounded-[10px] text-[14px] sm:text-[15px] text-[#1d1d1f] focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 focus:outline-none transition-all"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 px-6 py-3 sm:py-3.5 bg-[#f5f5f7] hover:bg-[#e8e8ed] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-[#1d1d1f] transition-all"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="flex-1 px-6 py-3 sm:py-3.5 bg-[#007AFF] hover:bg-[#0051D5] active:scale-[0.98] rounded-[12px] font-semibold text-[15px] text-white transition-all"
        >
          Next: ZK Protection
        </button>
      </div>
    </div>
  );
}
