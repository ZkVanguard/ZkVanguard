/**
 * Shared constants for the Chronos Vanguard platform.
 * 
 * IMPORTANT: Community Pool uses a dedicated portfolio ID (-1) to avoid
 * collision with user portfolios from RWAManager.sol, which starts
 * assigning portfolio IDs at 0 via `portfolioCount++`.
 * 
 * User portfolios: 0, 1, 2, 3, ... (from RWAManager contract)
 * Community Pool:  -1             (reserved, never assigned by contract)
 */

/**
 * Reserved portfolio ID for the Community Pool.
 * RWAManager.sol assigns user portfolios starting at 0 (uint256),
 * so -1 is guaranteed to never collide with a user portfolio.
 */
export const COMMUNITY_POOL_PORTFOLIO_ID = -1;

/**
 * Check if a portfolio ID represents the Community Pool.
 * Use this helper instead of direct comparison to keep the logic centralized.
 */
export function isCommunityPoolPortfolio(portfolioId: number | null | undefined): boolean {
  return portfolioId === COMMUNITY_POOL_PORTFOLIO_ID || portfolioId === SUI_COMMUNITY_POOL_PORTFOLIO_ID;
}

/**
 * Community Pool contract address on Cronos Testnet (legacy/deprecated).
 * For chain-specific addresses, use getCommunityPoolAddress(chain, network)
 * from lib/contracts/community-pool-config.ts instead.
 */
export const COMMUNITY_POOL_ADDRESS = '0xC25A8D76DDf946C376c9004F5192C7b2c27D5d30';

/**
 * SUI USDC Community Pool Constants
 * Uses -2 to distinguish from EVM Community Pool (-1)
 */
export const SUI_COMMUNITY_POOL_PORTFOLIO_ID = -2;
export const SUI_COMMUNITY_POOL_STATE = '0xb9b9c58c8c023723f631455c95c21ad3d3b00ba0fef91e42a90c9f648fa68f56';

export function isSuiCommunityPool(poolId: string | number | null | undefined): boolean {
  return poolId === SUI_COMMUNITY_POOL_PORTFOLIO_ID || poolId === 'sui-usdc-pool';
}
