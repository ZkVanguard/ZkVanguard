# External Audit Firm Shortlist — Tranche 1 Procurement

> **Purpose:** Once Tranche 1 (~$18K) lands from the grant, immediately wire the external audit deposit to one of these firms. This shortlist lets us close the engagement in days, not weeks.

## Audit scope

Four Move contracts on Sui mainnet at package `0x107292a69eea2f6eaf4a4e4727ee25d747b04c1985441b138933f0ef33f7b726`:

| Contract | LOC | Why it needs audit |
|---|---|---|
| `community_pool_usdc.move` | ~620 | Holds USDC, mints shares, NAV oracle in strict mode |
| `zk_hedge_commitment.move` | 502 | Stealth addresses, nullifiers, commitment storage — drain prevention is critical |
| `zk_proxy_vault.move` | 727 | PDA-style proxy addresses, time-locked withdrawals, confidential portfolios |
| `zk_verifier.move` | 484 | On-chain ZK-STARK verification, ed25519 prover attestation |

**Total auditable surface:** ~2,333 LOC of Move + the integration glue with `payment_router.move` and `community_pool_timelock.move`.

**Out of scope** (will not be audited under Tranche 1):
- `rwa_manager.move` — generic portfolio primitive, not actively used in any product flow
- EVM mirrors on Cronos / Hedera / Oasis / Sepolia (testnet only)
- Python ZK-STARK prover (separate cryptographic review path)

## Top 5 Sui Move audit firms (per blog.sui.io + ecosystem visibility)

### 1. OtterSec — ⭐ recommended primary

- **Website:** https://osec.io
- **Why:** In-depth manual review, works closely with team through audit, strong Move/Sui track record (Aptos + Sui core teams, Mysten partner)
- **Typical scope match:** Multi-contract Move suites in the 1,500-3,000 LOC range
- **Pricing estimate:** $30K-$60K for ~2.3K LOC, 2-4 week turnaround
- **Contact:** team@osec.io
- **Notable Sui clients:** Cetus, Aftermath, NAVI (per public reports)

### 2. MoveBit — ⭐ recommended alternate (cost-competitive)

- **Website:** https://movebit.xyz
- **Why:** Pioneer in Move-specific tooling, integrates formal verification into Sui audits, publishes Move CTFs and dev tooling
- **Pricing estimate:** $20K-$40K for ~2.3K LOC (often more competitive than US firms)
- **Contact:** Via website contact form + Telegram
- **Notable Sui clients:** Listed on Sui Foundation security page

### 3. Zellic

- **Website:** https://zellic.io
- **Why:** Move expertise + active Sui engagements, formal cryptographic review available
- **Pricing estimate:** $35K-$70K for ~2.3K LOC
- **Contact:** hello@zellic.io
- **Notable:** Strong reputation for finding deeper vulns; longer engagement timelines

### 4. Halborn

- **Website:** https://halborn.com
- **Why:** Tier-1 cybersecurity advisory, broader scope incl. infrastructure + frontend
- **Pricing estimate:** $40K-$80K — higher due to full-stack scope
- **Contact:** info@halborn.com
- **Notable:** Audited Solana, BNB Chain projects; Sui Move is a newer practice

### 5. Asymptotic

- **Website:** https://asymptotic.tech
- **Why:** Newer Move-focused firm, often more available for fast turnaround
- **Pricing estimate:** $25K-$45K
- **Contact:** Via website
- **Notable:** Less brand recognition vs OtterSec, but often equally rigorous and faster

## Recommended outreach sequence

**Day 0 (grant approved, T1 wired):**
- Email **OtterSec, MoveBit, Zellic** simultaneously with identical scope + audit-bundle attached (the 4 Move files + brief security architecture doc)
- Ask each for: (a) fixed-price quote, (b) earliest start date, (c) typical turnaround, (d) past Sui clients we can reference
- Include the existing 15 internal audit phase reports (`docs/AUDIT_*.md`) so they see the surface is well-defined

**Day 3-5:**
- Compare quotes
- Pick the firm whose timeline + price best fits the Tranche 2 milestone deadline ($10K TVL + audit complete + AdminCap migration)
- Sign engagement letter, wire deposit

**Day 5+:**
- Daily standup with auditors
- Post audit-fix commits incrementally as findings come in (don't batch — incremental fixes are easier for the auditor to re-verify)

## Pre-engagement bundle to send

Each audit firm should receive at engagement time:

1. **Scope document** — list of 4 contracts + LOC + brief business logic summary
2. **Existing internal audit reports** — `docs/AUDIT_*.md` (the 15 internal phases)
3. **Deployment runbook** — `docs/DEPLOY_2026-06-12_v0.2.0.md`
4. **Test suite** — `test/integration/zk-stark.test.ts` + relevant `test/*.cjs` hardhat tests
5. **Operational documentation** — `CLAUDE.md` (the canonical architecture doc)
6. **Threat model** — short doc enumerating: drain vectors, replay attacks, oracle manipulation, capability theft, MEV exposure. To be drafted in `docs/THREAT_MODEL.md` before engagement.

## Budget allocation (within Tranche 1 = $18K)

| Item | Estimate |
|---|---|
| Audit deposit | $10K-12K |
| Audit-fix engineering time (3 weeks @ contractor) | $3K-5K |
| Operational runway (~6 weeks solo) | $3K |
| **T1 envelope** | **$18K** |

The full audit cost ($20K-60K depending on firm) gets split across Tranches 1 and 2. Tranche 1 covers the **deposit** + audit-fix cycle; Tranche 2 covers the **final payment** triggered by the milestone "audit complete + AdminCap to MSafe."

## Red flags to avoid

- Firms that don't list Sui Move clients publicly
- Quotes over $80K for this scope — too expensive vs market
- Firms that won't share past audit reports for reference
- Turnaround under 5 days — too short for a meaningful review of 2.3K LOC of crypto-critical code
- Anyone promising "100% bug-free" or any guarantee — auditors find issues, they don't certify perfection

## Status

| Firm | Outreach status | Quote received | Action |
|---|---|---|---|
| OtterSec | ⏳ Pending grant approval | — | Email Day 0 |
| MoveBit | ⏳ Pending grant approval | — | Email Day 0 |
| Zellic | ⏳ Pending grant approval | — | Email Day 0 |
| Halborn | Optional / fallback | — | Skip unless top 3 unavailable |
| Asymptotic | Optional / fallback | — | Skip unless top 3 unavailable |

Last updated: 2026-06-29
