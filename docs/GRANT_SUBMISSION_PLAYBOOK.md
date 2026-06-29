# Sui Foundation Grant Submission Playbook (live state as of 2026-06-29)

> ⚠ **CRITICAL FINDING:** The "$50K Developer Grant in 3 tranches" assumed by
> `GRANT_PITCH_DECK_v2.md` is built on a defunct program. The old Typeform URL
> `suifoundation.typeform.com/devgrants` is dead — it now redirects to
> Typeform's generic landing. The Sui Foundation restructured its funding
> stack in early 2026. This doc maps the current paths and recommends which
> to submit to and in what order.

## Current funding paths (verified live URLs)

| Program | URL | Form | Funding | Eligibility fit |
|---|---|---|---|---|
| **DeFi Moonshots** | [sui.io/moonshots](https://www.sui.io/moonshots) | [tally.so/r/MeRKJX](https://tally.so/r/MeRKJX) | Up to **$500K liquidity incentives** + audit credits + DeFi-engineering collab + launch amplification | ⭐ **Primary target** — direct match for ZkVanguard's product (live DeFi vault on Sui) |
| **RFP Cohort 2** | [sui.io/request-for-proposals](https://sui.io/request-for-proposals) | Per-RFP application | Varies | Submit only if matching open RFP. Manual browser check required — page is JS-rendered. |
| **Hydropower Accelerator** | [hydropower.sui.io](https://hydropower.sui.io) → Notion | Notion form (currently inaccessible to scrapers) | Cohort program, no upfront equity | Possible parallel to Alliance DAO application |
| **Academic Research Awards** | [Notion link](https://suifoundation.notion.site/Sui-Ecosystem-Academic-Research-Awards-18537af41c6e80688ca0ff37cf2e617b) | Form on Notion | $25K | Not a fit (this isn't research) |
| **Strategic Investment** | Not public | Direct contact via Sui Foundation team | Variable | Best for proven projects with TVL/usage |

## DeFi Moonshots application — fields required

The Tally form ([tally.so/r/MeRKJX](https://tally.so/r/MeRKJX)) collects:

**Basics:**
- Project name
- Applicant name
- Email
- Telegram handle
- GitHub profile
- X / Twitter handle

**Project:**
- Geographic region
- DeFi category
- Project stage
- Current deployment status (Sui + other chains)
- Product criteria alignment statement

**Team:**
- Team structure, size, roles, backgrounds
- Notable experience building on Sui / other chains

**Technical:**
- Architecture
- Business model + fee structure

**Funding:**
- Funding received to date
- Notable investors

**Submission:**
- **Project deck file upload** (10 MB limit) ← use `GRANT_PITCH_DECK_v2.html` printed to PDF
- Referral source

**Notable omissions:** the form does NOT ask for a funding ask amount, milestone tranche structure, TVL targets, or whitepaper. That changes the deck strategy — focus on product depth + business model + team execution. The "$50K in 3 tranches" framing in the current pitch decks is not the right shape for this form.

## How the existing decks map to DeFi Moonshots

| Existing deck content | Fits DeFi Moonshots? | Notes |
|---|---|---|
| Slide 1 (cover) | ✅ | Use as-is |
| Slide 2 (problem) | ✅ | Use as-is |
| Slide 3 (what we built — 3 products + privacy primitive) | ✅ | Strongest content for evaluation criteria ("product originality, technical depth") |
| Slide 4 (why SUI is lead chain) | ✅ | Use as-is |
| Slide 5 (live on mainnet proof) | ✅ | Refreshed 2026-06-29 |
| Slide 6 (the moat — PQ ZK-STARK) | ✅ | This is the strongest single asset for "novel financial primitive" evaluation |
| Slide 7 (7-agent autonomous engine) | ✅ | Use as-is |
| Slide 8 (6 months solo to mainnet) | ✅ | Demonstrates "ability to ship and iterate quickly, track record of building products that reached real usage" — though "real usage" is the weak point at $57 NAV |
| **Slide 9 (THE ASK — $50K in 3 tranches)** | ❌ | **DEFI MOONSHOTS DOESN'T USE THIS STRUCTURE.** Replace with: liquidity-incentive use case, audit-credit need, DeFi-engineering collab asks |
| Slide 10 (verify) | ✅ | Use as-is |

## Honest gap: traction

DeFi Moonshots eligibility says applicants need "demonstrated ability to ship... with a track record of building products that reached real usage." $57 NAV / 3 members is below the typical bar. The deck currently leans on this with the framing "intentional cap pre-audit." Reviewers may not buy it.

Two ways to strengthen before submission:

1. **Apply now with full honesty** — Moonshots committee may value the technical depth + multi-product surface over raw TVL, especially since the platform is operationally proven (1,453 unattended NAV snapshots, 86% capital-flow return on $30 deposits)
2. **Raise the TVL cap first** — bump `community_pool_usdc` TVL cap from $10K to $50K, run a small Founding-50 push to land $10-20K TVL before submitting. Adds ~2-4 weeks but materially strengthens the application

## Recommended submission sequence

**Week 1 (now):**
1. ✅ Refresh deck numbers (DONE today)
2. ✅ Smoke-test all URLs (DONE today)
3. **Print `GRANT_PITCH_DECK_v2.html` → PDF** (open `C:\tmp\pdf-tool\out\GRANT_PITCH_DECK_v2.html` → Cmd/Ctrl-P → Save as PDF)
4. **Revise Slide 9 of v2 PDF** to drop "$50K / 3 tranches" framing and replace with:
   - "Open to: $X liquidity incentives, audit credit, DeFi-engineering collaboration on multi-pool architecture"
   - Make the ask less prescriptive — DeFi Moonshots reviewers structure the offer themselves
5. **Submit to DeFi Moonshots** at https://tally.so/r/MeRKJX
6. **Apply to Alliance DAO ALL18** at alliance.xyz/apply (separate, parallel) — uses the existing alliance pitch deck

**Week 2:**
7. Manually check [sui.io/request-for-proposals](https://sui.io/request-for-proposals) for any matching open RFP (page is JS-rendered, requires browser)
8. If matching RFP exists → submit per its specific instructions
9. Email Sui Foundation team (find contact via @SuiNetwork on X or LinkedIn) for direct intro — strategic investment path

**Parallel (2-4 week prep for stronger application):**
10. Raise TVL cap + Founding-50 push to add $10-20K TVL
11. Ship Phase 2 dashboard (investor risk view) — strengthens "category-defining" claim
12. Shortlist + email 3 audit firms for quotes (Tranche 1 deliverable becomes credible)

## Direct application URLs (bookmark these)

- DeFi Moonshots: https://tally.so/r/MeRKJX
- RFP Hub: https://sui.io/request-for-proposals
- Hydropower: https://hydropower.sui.io
- Programs overview: https://www.sui.io/programs-funding
- Alliance DAO (parallel): https://alliance.xyz/apply

## What NOT to do

- ❌ Don't try `suifoundation.typeform.com/devgrants` — the URL is dead
- ❌ Don't submit the v2 deck unchanged — Slide 9's tranche structure doesn't fit Moonshots
- ❌ Don't claim to be the next BlackRock-for-Web3 in the application — frame it as the **trajectory**, not the present
- ❌ Don't ask for $50K cash — the Moonshots program is liquidity incentives + non-cash support
