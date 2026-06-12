# Pre-deploy audit — 2026-06-12

Final readiness pass on the v0.2.0 Move bundle + post-phase-15 off-chain
code before mainnet upgrade. Two ship-blocking bugs found and fixed in
this pass; everything else verified green.

## Verdict

**Deploy is GREEN on the code+artifacts side.** The remaining blockers
are operational (gas top-up, admin key sourcing) — same as documented
in `[[project-deploy-blockers-2026-06-04]]` memo, not yet cleared.

## Ship-blocking bugs found + fixed in this pass

### CRITICAL — Move.lock lost its `[env.mainnet]` block

**Status:** restored in this commit.

`sui client upgrade` reads `original-published-id` and `chain-id` from
`Move.lock` to identify which on-chain package to target. Without the
`[env.mainnet]` block the CLI cannot resolve the upgrade target and the
deploy fails (or worse, creates a fresh package — orphaning the
existing pool state).

Root cause: the working tree had lost the block at some point. I
restored it from commit `eea3f0f3` (the 2026-06-05 commit that
originally added it) and verified the values match the live package
(`0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88`,
chain-id `35834a8a`, published-version `2`).

**Recurring trap discovered during this audit:** `sui move build`
*regenerates* `Move.lock` and silently drops the `[env]` block every
time. Confirmed by running `sui move build` twice during this pass —
the block disappeared on each run. Operator MUST re-append the block
between `sui move build` and `sui client upgrade`. Captured for the
deploy runbook below.

### HIGH — Step 2 gas budget was 0.2 SUI vs ~0.5 SUI real cost

**Status:** fixed in this commit (`scripts/deploy-2026-06-04.md`).

The runbook's Step 2 `sui client upgrade` command set
`--gas-budget 200000000` (0.2 SUI). The previous successful upgrade of
this package consumed 454,724,100 MIST (~0.455 SUI) — dominated by
storage cost on the ~55 KB bytecode. 0.2 SUI fails with
`InsufficientGas` and was the same root cause that blocked the
2026-06-05 attempt (see commit `eea3f0f3`).

Raised to 700_000_000 (0.7 SUI). Leaves headroom for v0.2.0 bytecode
additions (TVL cap, ed25519 attestation, dynamic-field external_nav).

The `DEPLOY_SAFETY_NET.md` doc already shows `700000000` in its
recovery scenario; only the primary runbook was inconsistent.

## Documented but not a blocker

### LOW — `sui-hedge-reconcile` false-positive drift on transport hedges

**Status:** documented; no code change.

`app/api/cron/sui-hedge-reconcile/route.ts` compares on-chain
`active_hedges.length` with BlueFin `positions.length`. But the
sui-community-pool cron creates "transport hedges" in on-chain
`active_hedges` (`open_hedge` is the USDC pool→admin transfer rail)
that have no BlueFin counterpart. `COUNT_DRIFT = onChainCount > liveCount`
triggers every reconcile tick where the cron has open transport
entries — which is every cycle.

**Why it isn't a blocker:** the v0.2.0 phase 8 safety guard on
`admin_reset_hedge_state` requires pause OR strict mode (
`docs/RELEASE_NOTES_v0.2.0.md` line 239). The reconciler's reset
attempt will revert during normal operation; only Discord WARN noise
results. No state is corrupted.

**Cleaner fix (defer to next release):** filter `active_hedges` to only
entries with `collateral_usdc >= some_threshold AND pair_index in
{BTC, ETH, SUI}` before counting. The current behavior is loud but safe.

## Verified green

### Move contract bundle

- `sui move build` clean — only the standard "Dependencies on Sui…
  automatically added" NOTE
- `sui move test` — 28 / 28 PASS, no failures
- All 5 CRITICAL fixes claimed in `RELEASE_NOTES_v0.2.0.md` are
  actually present in source:
  - `community_pool_usdc::admin_attest_external_nav` at line 1231 +
    delta/absolute bounds at 1256, 1273
  - `community_pool_usdc::close_hedge` funds-verify at line 1113
    (`assert!(coin::value(&funds) >= expected_return)`)
  - `community_pool::close_pool_hedge` same funds-verify at line 1509
  - `zk_proxy_vault::execute_withdrawal` proxy_id check at lines
    499, 535, 562 (3 paths: execute, cancel, guardian_cancel)
  - `hedge_executor::update_price_feed` 50% delta bound at lines 542–552
- TVL ceiling (`admin_set_tvl_cap`) at line 1587, gate at line 510
- Cap-minting lockdown (`admin_lock_cap_minting`) at line 1620
- Disabled functions preserve original signatures (policy=0 compat):
  - `create_admin_cap` at 1537 — body is `abort E_NOT_AUTHORIZED`
  - `create_rebalancer_cap` at 1548 — same shape
- All 8 key public entry functions still present with original names:
  `deposit`, `withdraw`, `collect_fees`, `open_hedge`, `close_hedge`,
  `admin_reset_hedge_state`, `add_agent`, `emergency_withdraw`

### Upgrade compatibility (policy=0)

The package upgrade target is `UpgradeCap` policy=0 ("compatible") —
function bodies + new public functions allowed, no existing-public-
function signature changes. v0.2.0 satisfies this: every disabled
function preserves its signature and aborts internally instead of being
removed. Sui's bytecode-level compatibility check will be the
authoritative gate at upgrade time; this audit verified the source-level
preconditions.

### Phase 15 off-chain fixes (shipped earlier today, `6008114f`)

- `settleActiveHedges` residual-replenish guard prevents fake-loss
  writes
- `SuiHedgeReconciler` empty-RPC safety bail prevents mass-close
- `bluefin-db-reconcile` empty-venue safety bail prevents mass-close

`bun run typecheck` clean after all phase 15 + pre-deploy changes.

### Deploy artifacts (all present)

- `scripts/deploy-2026-06-04.md` — step-by-step runbook (now with
  correct 0.7 SUI gas budget)
- `docs/DEPLOY_RUNBOOK.md` — operator runbook (appendices Y, W, V
  referenced from CLAUDE.md)
- `docs/DEPLOY_SAFETY_NET.md` — failure modes per step + recovery
- `docs/AUDIT_E2E_VERIFICATION.md` — arithmetic walkthrough against
  live state
- `docs/RELEASE_NOTES_v0.2.0.md` — bug inventory + API changes
- `scripts/pause-sui-pool.ts` — DRY-RUN + `--commit` + `--unpause` modes,
  proper env preconditions
- `scripts/pool-strict-mode.ts` — DRY-RUN + `--commit` + `--off` modes
- `scripts/diagnose-pool-underpayment.ts` — read-only verification

### Local environment

- `sui --version` → 1.72.5 ✓ (mainnet is on protocol v124; 1.72.5
  supports it — 2026-06-04 audit had 1.69.2 which was a blocker)
- `Move.toml` version → 0.2.0 ✓
- `Move.toml` published-at → `0x9ccb…c88` ✓ (matches live package)
- Move.lock `[env.mainnet]` block → RESTORED ✓ (but will be wiped by
  next build — see CRITICAL above)

## Remaining operational blockers (not in code scope)

These were captured in `[[project-deploy-blockers-2026-06-04]]` and
are still open as of this audit:

1. **Deployer gas balance** — needs ≥0.7 SUI for the upgrade itself
   plus ~0.05 SUI for pause/prover-key/strict/unpause chain. Recommend
   topping up to ≥1 SUI before deploy.
2. **`SUI_POOL_ADMIN_KEY` not in local `.env.local`** — pause and
   strict-mode scripts both require it. Two options per
   `scripts/deploy-2026-06-04.md`: pull from Vercel temporarily, or
   pause via direct `sui client call` since the deployer wallet IS
   the admin.
3. **Sui CLI version** — local is 1.72.5 ✓ (no longer a blocker).

## Deploy-day pre-flight checklist (final)

Run in order, immediately before deploy. Tick each box.

- [ ] `sui --version` shows 1.72.x or later
- [ ] `sui client active-env` returns `mainnet`
- [ ] `sui client active-address` is the deployer wallet
      (`0x99a3a0fd45bb6b467547430b8efab77eb64218ab098428297a7a3be77329ac93`)
- [ ] `sui client gas` shows ≥ 1 SUI
- [ ] `cd contracts/sui && sui move build` exits 0
- [ ] **`tail -5 contracts/sui/Move.lock` shows the `[env.mainnet]`
      block — if missing, re-append from the audit doc below**
- [ ] `sui move test` shows 28/28 PASS
- [ ] `git status` working tree clean
- [ ] Pool currently paused on-chain
- [ ] `bun run typecheck` clean
- [ ] `SUI_POOL_ADMIN_KEY` in `.env.local` (or planned alternative path)
- [ ] BlueFin pre-step done: `curl /api/admin/bluefin-debug` shows
      0 positions, 0 free balance (or known polymarket-trader positions)
- [ ] 30–60 min uninterrupted time available

### Move.lock env block (for re-append after `sui move build`)

```toml
[env]

[env.mainnet]
chain-id = "35834a8a"
original-published-id = "0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88"
latest-published-id = "0x9ccbabbdca72c5c0b5d6e01765b578ae37dc33946dd80d6c9b984cd83e598c88"
published-version = "2"
```

After `sui client upgrade` succeeds and produces `$NEW_PACKAGE_ID`,
update the `latest-published-id` to the new package id and increment
`published-version`.

## Audit chain summary

```
6a58ff22  docs(deploy): BlueFin verification step before unpause
d9b21b58  audit(phase 14 + v0.2.0): release notes
21baa1f8  audit(phase 13): TVL cap
b458346c  audit(phase 12): overflow + pause + defense in depth
9b3d1a9b  audit(phase 11): test suite GREEN
… (phases 1–10 — see RELEASE_NOTES_v0.2.0.md) …
6008114f  audit(phase 15): off-chain TS — 3 HIGH fixes
(this)    pre-deploy audit — 2 ship blockers + LOW finding
```

The Move bundle has had 14 in-session audit phases + an off-chain TS
audit + this final pre-deploy pass. Builds and tests are GREEN. The
remaining gates are operational (gas top-up, admin key sourcing,
BlueFin pre-step verification) — those clear, deploy can proceed.
