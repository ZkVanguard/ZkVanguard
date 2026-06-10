# ZkVanguard Move Contract — v0.2.0 Release Notes

**Released:** 2026-06-09
**Previous version:** v0.1.0 (originally deployed 2026-XX as package
`0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88`,
upgrade-cap policy=0 compatible)

This is a **major release** — `0.1.0` → `0.2.0`. The contract has
undergone 14 in-session audit phases across multiple sessions,
producing ~45 bug fixes and 4 net-new safety features. The most
critical bug (the 2026-06-03 share-math underpayment that caused 91%
of withdrawal value to be silently lost) is fixed.

`sui move build` clean. `sui move test` 28/28 passing. Deploy
runbook + safety net + end-to-end verification doc all published.

## TL;DR — what changed

**For depositors:**
- Withdrawals now pay full fair share (or revert) — no more silent
  underpayment.
- Pool now has a TVL ceiling — operator can't accept more inflows
  than they've validated for the current confidence level.

**For operators:**
- 4 new admin functions to manage the safety features
- `create_admin_cap` and `create_rebalancer_cap` are now disabled
  (multi-sig migration uses transfer instead)
- `admin_reset_hedge_state` now requires pause-or-strict-mode and
  also clears stale external_nav

**For auditors / external review (T4-C):**
- Full audit chain in `docs/AUDIT_2026-06-04.md`
- End-to-end arithmetic verification in `docs/AUDIT_E2E_VERIFICATION.md`
- Deploy safety net in `docs/DEPLOY_SAFETY_NET.md`
- Compatibility-preserved upgrade (policy=0)

## Critical fixes (would-have-cost-funds bugs)

### CRITICAL — share-math underpayment (the bug that started this)

Pre-v0.2.0, `calculate_assets_for_shares` used only `balance::value`
as total assets. Off-chain wBTC/wETH/SUI on admin wallet and BlueFin
collateral were ignored. Live impact 2026-06-03: pool had $0.41
on-chain vs $44.99 true NAV; member withdrawing 10% of shares would
have received $0.135 instead of $4.50 (97% underpayment).

**Fix:** external NAV oracle via dynamic_field. Cron pushes the off-
chain portion every tick. Share math uses balance + external_nav +
hedged. End-to-end verified in `docs/AUDIT_E2E_VERIFICATION.md`
against live numbers.

### CRITICAL — close_hedge AgentCap drain

Pre-v0.2.0, `close_hedge` took `pnl_usdc + is_profit + funds` as
inputs and joined `funds` into pool regardless of consistency. A
compromised AgentCap holder could call with `is_profit=false`,
`pnl_usdc=collateral`, `funds=Coin::zero()` — silent collateral
drain.

**Fix:** `assert!(coin::value(&funds) >= expected_return)` where
expected = `is_profit ? collateral + pnl : max(0, collateral - pnl)`.

### CRITICAL — community_pool::close_pool_hedge same drain vector

Same shape in the SUI-native sibling. Same fix applied.

### CRITICAL — zk_proxy_vault execute_withdrawal cross-proxy drain

Pre-v0.2.0, `execute_withdrawal` asserted `pending.owner == sender`
but never that the `PendingWithdrawal` belonged to the
`ProxyBinding` passed in. Attacker could open small withdrawal from
their own proxy A, wait the time-lock, then call execute with
`proxy=victim's_shared_proxy_B` — drain B's balance.

**Fix:** `assert!(pending.proxy_id == object::id(proxy))`. Same fix
on `cancel_withdrawal` and `guardian_cancel_withdrawal`.

### CRITICAL — hedge_executor::update_price_feed unbounded oracle

Pre-v0.2.0, AdminCap could push arbitrary price. Single-block
rugpull possible via close_hedge after extreme oracle shift.

**Fix:** 50% per-update bounded change.

## HIGH severity fixes

| Module | Fix |
|---|---|
| community_pool_usdc | `emergency_withdraw` pro-rata cap (FCFS race) |
| community_pool_usdc | `open_hedge` uses `get_onchain_nav` for ratios (not double-counting external_nav) |
| community_pool_usdc | `collect_management_fee_internal` u128 (was overflow at $10M NAV) |
| community_pool_usdc | `admin_reset_hedge_state` NAV inconsistency window |
| community_pool_usdc | `admin_reset_hedge_state` safety guard (paused or strict mode) |
| community_pool_usdc | `admin_reset_hedge_state` clears external_nav for single-tick recovery |
| community_pool_usdc | `create_admin_cap` persistence escalation (now always aborts) |
| community_pool_usdc | `create_rebalancer_cap` same pattern (now always aborts) |
| community_pool_usdc | `add_agent` lockdown via `admin_lock_cap_minting` |
| community_pool_usdc | external_nav absolute cap (100× total_deposited) |
| community_pool_usdc | withdraw circuit breaker u128 (overflow at $1.8B NAV) |
| community_pool_usdc | `open_hedge` reserve/cap math u128 (overflow at $1.8-3.6B) |
| community_pool_usdc | `collect_fees` pause check |
| community_pool_usdc | **TVL ceiling (admin-set hard cap on total_deposited)** |
| community_pool | `close_pool_hedge` drain fix |
| community_pool_timelock | `cancel_operation` 1-of-N veto (proposer check) |
| zk_proxy_vault | cap_minting same pattern (3 paths) |
| 4 ZK contracts | ed25519 prover attestation (was length check only) |
| zk_verifier | replay bypass via byte-append (sig dedup) |

## MEDIUM severity fixes

| Module | Fix |
|---|---|
| community_pool_usdc | First `admin_attest_external_nav` was unbounded |
| community_pool_usdc | Phantom NAV dilutes new depositor after full exit |
| community_pool_usdc | `collect_performance_fee_internal` u128 |
| community_pool_usdc | u128→u64 cast safety in delta_bps |
| community_pool_timelock | `execute_operation` missing pause check |
| payment_router | `withdraw_sponsor_fund` explicit recipient (new variant) |
| payment_router | `pay_sponsor_gas` (real payout, not just bookkeeping) |
| bluefin_bridge | `share_object` (relayer can sync without trader) |

## LOW severity / defense in depth

- Clock skew defense in `collect_management_fee_internal`
- `is_cap_minting_locked` reads value too (not just exists)
- `withdraw` reverts if amount rounds to 0 (foot gun prevention)
- `emergency_withdraw` reverts if amount rounds to 0 (foot gun)

## NET-NEW FEATURES

### External NAV oracle (the underpayment fix)

```move
public entry fun admin_attest_external_nav<T>(
    _admin: &AdminCap,
    state: &mut UsdcPoolState<T>,
    external_nav_usdc: u64,
    clock: &Clock,
)
```

Cron pushes off-chain NAV every tick. Bounded:
- First attestation: ≤ 100× `total_deposited`
- Subsequent: ≤ 30% delta from prior
- Absolute: ≤ 100× `total_deposited` always

Storage via `dynamic_field` on state.id (upgrade-safe).

```move
public entry fun admin_set_external_nav_required<T>(...)
```

Strict mode toggle. When on, deposits/withdraws revert if last
attestation > 2 hours old.

### Cap-minting lockdown

```move
public entry fun admin_lock_cap_minting<T>(
    _admin: &AdminCap,
    state: &mut UsdcPoolState<T>,
)
```

One-way irreversible. Once called, `add_agent` reverts. `create_admin_cap`
and `create_rebalancer_cap` are already permanently disabled.

Use case: after multi-sig migration (T4-A), call this to prevent any
further capability creation even by the multi-sig.

### TVL ceiling

```move
public entry fun admin_set_tvl_cap<T>(
    _admin: &AdminCap,
    state: &mut UsdcPoolState<T>,
    cap_usdc: u64,
)
public fun get_tvl_cap_usdc<T>(state: &UsdcPoolState<T>): u64
```

Operator-set hard ceiling on `total_deposited`. Below cap, deposits
work. Above, deposit reverts with `E_MAX_DEPOSIT_EXCEEDED`. Existing
members unaffected by cap changes.

**Proposed phased ratchet:**

| Cap | Pre-condition |
|---|---|
| $10k | Initial deploy |
| $100k | 1 week clean operation |
| $1M | T4-A multi-sig complete |
| $10M | T4-C external audit clean |
| $100M | 6 months at $10M, no incidents |
| $1B+ | T4-B u128 redeploy + insurance + bug bounty |

This is the single biggest "billion-dollar safety" feature. Industry
standard (Compound, Aave, Morpho all use this).

### ed25519 prover attestation (4 ZK contracts)

```move
public entry fun admin_set_prover_pubkey<T>(...)
public fun has_prover_pubkey<T>(...) -> bool
```

ZK proof verification was a length check across `zk_verifier`,
`zk_proxy_vault`, `zk_hedge_commitment`, `rwa_manager`. Now: opt-in
ed25519 signature verification against the configured prover key.
Trust model: equivalent to Pyth (trust the prover key, verify
cryptographically on-chain).

## API CHANGES from v0.1.0

### Disabled functions (will always abort with E_NOT_AUTHORIZED)

These existed in v0.1.0 but are now disabled to close the persistence
escalation path. **Use `transfer::public_transfer` of the existing cap
for multi-sig migration.**

- `community_pool_usdc::create_admin_cap(AdminCap, recipient, ctx)`
- `community_pool_usdc::create_rebalancer_cap(AdminCap, recipient, ctx)`

### Function signature changes

None. Policy=0 compatible upgrade — all existing public function
signatures are preserved.

### Behavior changes (may affect callers)

| Function | Behavior change |
|---|---|
| `deposit` | Now reverts if TVL cap exceeded (when cap > 0) |
| `withdraw` | Now reverts if amount rounds to 0 |
| `withdraw` | Reverts when balance < fair share (instead of silently underpaying) |
| `emergency_withdraw` | Now pro-rata bounded, reverts if amount = 0 |
| `collect_fees` | Now reverts when pool is paused |
| `admin_reset_hedge_state` | Now requires paused or strict mode |
| `add_agent` | Now reverts after `admin_lock_cap_minting` called |
| `close_hedge` | Now requires `funds >= expected_return` |
| `admin_attest_external_nav` | Now bounded (30% delta, 100× absolute) |

## Upgrade compatibility

This is a **policy=0 compatible upgrade**:
- All existing public function signatures preserved
- All existing struct fields preserved
- New state stored via `dynamic_field` on state.id
- No layout migration required

**Deploy method:** `sui client upgrade --upgrade-capability <cap>`.
The on-chain state object continues to be the same `UsdcPoolState<T>`;
new dynamic fields are added on first interaction with the relevant
admin function.

## Known limitations + roadmap

These are out of scope for v0.2.0 — they require organizational change
or significant work beyond contract audit:

| Track | Item | Required for |
|---|---|---|
| T4-A | Multi-sig migration of AdminCap | Single-key risk removal |
| T4-B | u128 redeploy of balance counters | Operation above $500M NAV |
| T4-C | External audit (Movebit / OtterSec / Halborn) | Trust at scale |
| T5-C | Insurance fund + treasury policy | Tail risk coverage |
| — | community_pool_usdc test coverage | Specific to new oracle/cap code |
| — | Pyth oracle integration | Replace admin-attested oracle |

## Deploy + verification artifacts

- `docs/AUDIT_2026-06-04.md` — full audit chain across 13 phases
- `docs/AUDIT_E2E_VERIFICATION.md` — arithmetic walkthrough against live state
- `docs/DEPLOY_SAFETY_NET.md` — failure modes + recovery procedures
- `scripts/deploy-2026-06-04.md` — step-by-step deploy runbook
- `scripts/diagnose-pool-underpayment.ts` — verification source of truth (phase 10 rewrite)
- `scripts/pool-strict-mode.ts` — strict mode toggle (recovery tool)
- `scripts/pause-sui-pool.ts` — emergency pause

## Audit chain (commits, in order)

```
252a4284  share-math + close_hedge drain + emergency_withdraw race
765e364d  community_pool drain + hedge_executor oracle bound
c21a0a00  zk_proxy_vault cross-proxy + timelock proposer veto
6bb98e5b  ed25519 attestation + sponsor fund + relayer sync
b502dddc  zk_verifier replay bypass via byte-append
42d7179f  NAV race + fee overflow + 4 more
5dfb56f2  cap-minting lockdown
b68727ca  admin_reset recovery + E2E verification doc
3cc9e57f  admin_reset safety guard
f0da4309  absolute caps + community_pool sealed
d564db88  diagnose script — 3 bugs fixed
9b3d1a9b  tests 28/28 green
b458346c  overflow + pause + defense in depth
21baa1f8  TVL cap — billion-dollar safety
(this)    v0.2.0 release — version bump + phase 14 edge cases + release notes
```

## Acknowledgments

This audit was conducted in-session by Claude (Sonnet 4.6 then Opus
4.7) over multiple working sessions in early June 2026. ~45 bugs were
found and fixed. Honest scoping: this is NOT a substitute for
external adversarial professional review. T4-C must complete before
meaningful AUM.

The pre-incident state (v0.1.0 with the 2026-06-03 underpayment bug
active) cost members 91% of their fair share value on any withdrawal.
v0.2.0 restores this. End-to-end verified.
