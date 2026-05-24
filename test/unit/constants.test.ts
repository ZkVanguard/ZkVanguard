/**
 * Golden tests for portfolio-ID routing predicates (lib/constants.ts).
 * The reserved negative IDs (-1 EVM pool, -2 SUI pool) must never collide with
 * user portfolios (assigned 0,1,2,… by RWAManager) — these predicates centralize
 * that, so a regression here would misroute pool funds.
 */
import { describe, it, expect } from '@jest/globals';
import {
  COMMUNITY_POOL_PORTFOLIO_ID,
  SUI_COMMUNITY_POOL_PORTFOLIO_ID,
  isCommunityPoolPortfolio,
  isSuiCommunityPool,
} from '@/lib/constants';

describe('reserved portfolio IDs', () => {
  it('are the documented negative sentinels', () => {
    expect(COMMUNITY_POOL_PORTFOLIO_ID).toBe(-1);
    expect(SUI_COMMUNITY_POOL_PORTFOLIO_ID).toBe(-2);
  });
});

describe('isCommunityPoolPortfolio', () => {
  it('matches both pool sentinels', () => {
    expect(isCommunityPoolPortfolio(-1)).toBe(true);
    expect(isCommunityPoolPortfolio(-2)).toBe(true);
  });
  it('rejects user portfolios and nullish', () => {
    expect(isCommunityPoolPortfolio(0)).toBe(false);
    expect(isCommunityPoolPortfolio(5)).toBe(false);
    expect(isCommunityPoolPortfolio(null)).toBe(false);
    expect(isCommunityPoolPortfolio(undefined)).toBe(false);
  });
});

describe('isSuiCommunityPool', () => {
  it('matches the SUI sentinel and the string id', () => {
    expect(isSuiCommunityPool(-2)).toBe(true);
    expect(isSuiCommunityPool('sui-usdc-pool')).toBe(true);
  });
  it('rejects the EVM sentinel, other ids, and nullish', () => {
    expect(isSuiCommunityPool(-1)).toBe(false);
    expect(isSuiCommunityPool(0)).toBe(false);
    expect(isSuiCommunityPool('other')).toBe(false);
    expect(isSuiCommunityPool(null)).toBe(false);
  });
});
