# ZkVanguard Documentation

Living reference for the platform. Many docs here are point-in-time reports kept for provenance rather than daily reference; the "Living reference docs" table below lists the ones under active maintenance.

## Start here

- **[Main README](../README.md)** — product overview, safety, roadmap, FAQ
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system design overview
- **[DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md)** — env conventions, invariants, admin endpoints, incident response

## Living reference docs

| Doc | Purpose |
|---|---|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | System design (partial-historical banner; current state summarised at top) |
| **[DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md)** | Incident response, env presets, BlueFin invariants, admin endpoints |
| **[MAINNET_READINESS.md](./MAINNET_READINESS.md)** | Current mainnet posture, cap-lift criteria |
| **[SUI_DEPLOYMENT.md](./SUI_DEPLOYMENT.md)** | SUI-specific deploy runbook |
| **[SECURITY.md](./SECURITY.md)** | Responsible disclosure, supported versions, defense posture |
| **[ROADMAP.md](./ROADMAP.md)** | Cap-ratchet milestones (Q3 2026 → Q1 2027) |
| **[CHANGELOG.md](./CHANGELOG.md)** | Versioned release history |
| **[SLO_AND_RUNBOOKS.md](./SLO_AND_RUNBOOKS.md)** | Service objectives, cron runbooks |
| **[SCALABILITY_ANALYSIS.md](./SCALABILITY_ANALYSIS.md)** | Hard walls at $50M / $500M / $1B TVL |
| **[BUG_BOUNTY.md](./BUG_BOUNTY.md)** | Bounty tiers and scope |
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | Contribution workflow |
| **[SETUP.md](./SETUP.md)** | Local setup |
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | Contract + service deployment |

## Deploy records (historical, point-in-time)

- **[DEPLOY_2026-06-12_v0.2.0.md](./DEPLOY_2026-06-12_v0.2.0.md)** — v0.2.0 mainnet deploy record
- **[PRE_DEPLOY_AUDIT_2026-06-12.md](./PRE_DEPLOY_AUDIT_2026-06-12.md)** — pre-deploy audit
- **[AUDIT_2026-06-04.md](./AUDIT_2026-06-04.md)** — Move contract audit (phases 1–14)
- **[AUDIT_2026-06-12_phase15_offchain.md](./AUDIT_2026-06-12_phase15_offchain.md)** — off-chain TS audit (phase 15)
- **[RELEASE_NOTES_v0.2.0.md](./RELEASE_NOTES_v0.2.0.md)** — v0.2.0 release notes

## Product docs

- **[PRICING_MODEL.md](./PRICING_MODEL.md)** — three revenue streams (cross-referenced to [`lib/config/pricing.ts`](../lib/config/pricing.ts))
- **[CUSTODY_ATTESTATION_SPEC.md](./CUSTODY_ATTESTATION_SPEC.md)** — RWA custody attestation primitive
- **[PRIVACY_HEDGE_ARCHITECTURE.md](./PRIVACY_HEDGE_ARCHITECTURE.md)** — private hedges via `zk_hedge_commitment.move`
- **[ZK_HEDGE_PRIVACY.md](./ZK_HEDGE_PRIVACY.md)** — ZK privacy layer
- **[FORMAL_STARK_VERIFICATION.md](./FORMAL_STARK_VERIFICATION.md)** — STARK protocol formal verification

## Grants + business

- **[VISION.md](./VISION.md)** — product vision
- **[PROJECT_DESCRIPTION.md](./PROJECT_DESCRIPTION.md)** — one-pager
- **[GO_TO_MARKET_PLAN.md](./GO_TO_MARKET_PLAN.md)** — GTM strategy
- **[GRANT_SUBMISSION_PLAYBOOK.md](./GRANT_SUBMISSION_PLAYBOOK.md)** — grant application framework
- **[INVESTOR_PITCH_DECK.md](./INVESTOR_PITCH_DECK.md)** — investor deck

*(Some strategic/pitch docs kept private — not in this repo. Grant reviewers can request access.)*

## Guides

- **[guides/DASHBOARD_USAGE_GUIDE.md](./guides/DASHBOARD_USAGE_GUIDE.md)** — dashboard walkthrough
- **[guides/TESTNET_DEMO_GUIDE.md](./guides/TESTNET_DEMO_GUIDE.md)** — testnet demo flow
- **[guides/X402_GASLESS_INTEGRATION.md](./guides/X402_GASLESS_INTEGRATION.md)** — gasless integration
- **[guides/DEMO_WALKTHROUGH_GUIDE.md](./guides/DEMO_WALKTHROUGH_GUIDE.md)** — end-to-end demo

## Test reports (historical)

- **[reports/COMPLETE_SYSTEM_TEST_REPORT.md](./reports/COMPLETE_SYSTEM_TEST_REPORT.md)**
- **[reports/AUDIT_READY_REPORT.md](./reports/AUDIT_READY_REPORT.md)**
- **[reports/ONCHAIN_TEST_REPORT.md](./reports/ONCHAIN_TEST_REPORT.md)**
- **[E2E_TEST_REPORT.md](./E2E_TEST_REPORT.md)**

## Weekly / monthly grant reports

Moved to [`docs/history/`](./history/) — SUI Foundation grant deliverables (12 weekly + 3 monthly submissions + `sui-directory-submission-final.md`) kept for provenance. Read for period-scoped shipped work.

---

Docs referenced in the previous index that don't exist (SCALABILITY.md, KNOWN_ISSUES.md, ORGANIZATION_SUMMARY.md, PROJECT_ANALYSIS.md, PITCH_DECK.md, FRONTEND_GASLESS_INTEGRATION.md, ZK_CRYPTOGRAPHIC_PROOF.md) were either never created or superseded. The living-reference set above is the source of truth.
