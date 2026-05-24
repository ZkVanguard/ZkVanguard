/**
 * Golden tests for the community-pool state reducers
 * (components/dashboard/community-pool/reducers.ts). Locks the pure state
 * transitions extracted from the useCommunityPool hook.
 */
import { describe, it, expect } from '@jest/globals';
import {
  poolReducer,
  txReducer,
  initialPoolState,
  initialTxState,
} from '@/components/dashboard/community-pool/reducers';

describe('poolReducer', () => {
  it('sets individual fields immutably', () => {
    const next = poolReducer(initialPoolState, { type: 'SET_LOADING', payload: false });
    expect(next.loading).toBe(false);
    expect(next).not.toBe(initialPoolState);       // new object
    expect(initialPoolState.loading).toBe(true);   // input untouched
  });

  it('sets pool data, error, success, chain, pool-state-id', () => {
    const pool = { totalValueUSD: 48.69, totalShares: 30, sharePrice: 1.6, memberCount: 3, allocations: { BTC: 0, ETH: 0, SUI: 0, CRO: 0 }, aiLastUpdate: null, aiReasoning: null };
    expect(poolReducer(initialPoolState, { type: 'SET_POOL_DATA', payload: pool as any }).poolData).toBe(pool);
    expect(poolReducer(initialPoolState, { type: 'SET_ERROR', payload: 'boom' }).error).toBe('boom');
    expect(poolReducer(initialPoolState, { type: 'SET_SUCCESS', payload: 'ok' }).successMessage).toBe('ok');
    expect(poolReducer(initialPoolState, { type: 'SET_CHAIN', payload: 'sui' }).selectedChain).toBe('sui');
    expect(poolReducer(initialPoolState, { type: 'SET_SUI_POOL_STATE_ID', payload: '0xabc' }).suiPoolStateId).toBe('0xabc');
  });

  it('RESET_FOR_CHAIN_CHANGE clears state but keeps chain + sets loading', () => {
    const dirty = { ...initialPoolState, selectedChain: 'sui' as const, error: 'x', poolData: {} as any, loading: false };
    const next = poolReducer(dirty, { type: 'RESET_FOR_CHAIN_CHANGE' });
    expect(next.selectedChain).toBe('sui');
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
    expect(next.poolData).toBeNull();
  });

  it('returns the same state for unknown actions', () => {
    expect(poolReducer(initialPoolState, { type: 'NOPE' } as any)).toBe(initialPoolState);
  });
});

describe('txReducer', () => {
  it('deposit/withdraw modals are mutually exclusive', () => {
    const showDep = txReducer({ ...initialTxState, showWithdraw: true }, { type: 'SET_SHOW_DEPOSIT', payload: true });
    expect(showDep.showDeposit).toBe(true);
    expect(showDep.showWithdraw).toBe(false); // opening deposit closes withdraw

    const showWd = txReducer({ ...initialTxState, showDeposit: true }, { type: 'SET_SHOW_WITHDRAW', payload: true });
    expect(showWd.showWithdraw).toBe(true);
    expect(showWd.showDeposit).toBe(false);

    // closing one leaves the other untouched
    const closeDep = txReducer({ ...initialTxState, showWithdraw: true }, { type: 'SET_SHOW_DEPOSIT', payload: false });
    expect(closeDep.showWithdraw).toBe(true);
  });

  it('sets amounts, status, tx hash', () => {
    expect(txReducer(initialTxState, { type: 'SET_DEPOSIT_AMOUNT', payload: '25' }).depositAmount).toBe('25');
    expect(txReducer(initialTxState, { type: 'SET_SUI_WITHDRAW_SHARES', payload: '5' }).suiWithdrawShares).toBe('5');
    expect(txReducer(initialTxState, { type: 'SET_TX_STATUS', payload: 'depositing' }).txStatus).toBe('depositing');
    expect(txReducer(initialTxState, { type: 'SET_LAST_TX_HASH', payload: '0xhash' }).lastTxHash).toBe('0xhash');
  });

  it('RESET_TX_STATE returns the initial tx state', () => {
    const dirty = { ...initialTxState, depositAmount: '99', txStatus: 'depositing' as const, showDeposit: true };
    expect(txReducer(dirty, { type: 'RESET_TX_STATE' })).toEqual(initialTxState);
  });

  it('returns the same state for unknown actions', () => {
    expect(txReducer(initialTxState, { type: 'NOPE' } as any)).toBe(initialTxState);
  });
});
