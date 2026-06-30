# Outstanding Submission Blockers

> Last updated: 2026-06-30. All P0 blockers RESOLVED.

---

## ✅ RESOLVED: Vercel deployment failures (commits d0275ac0 → a4368110)

### Resolution summary
8 consecutive Vercel deploys failed silently between 2026-06-29 08:07 UTC
and 2026-06-30 05:55 UTC. Root cause + fix shipped in commits 1b20b7c2 +
a4368110. Production now serving the latest commit successfully (`readyState: READY`).

### Diagnostic path (for future reference)

The Vercel CLI's `inspect --logs` only surfaces build logs — post-build
errors are hidden. The actual error required calling Vercel's REST API
directly:

```bash
TOKEN=$(python -c "import json; print(json.load(open('~/AppData/Roaming/com.vercel.cli/Data/auth.json'))['token'])")
TEAM="team_BqFhY4LUH8KX8mpEFp4PxPLZ"
DPL_ID=$(curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=prj_lKMKnAdIylQyui8u5BkvkylA0ERs&teamId=$TEAM&limit=1" \
  | python -c "import json, sys; print(json.load(sys.stdin)['deployments'][0]['uid'])")

curl -sH "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v13/deployments/$DPL_ID?teamId=$TEAM" \
  | python -c "import json, sys; d=json.load(sys.stdin); print('errorCode:', d.get('errorCode')); print('errorMessage:', d.get('errorMessage'))"
```

That surfaced:
```
errorCode: exceeded_serverless_functions_per_deployment
errorMessage: No more than 12 Serverless Functions can be added to a
              Deployment on the Hobby plan. Create a team (Pro plan) to
              deploy more.
```

### Root cause

Vercel Hobby plan caps deployments at 12 serverless functions. Next.js
normally consolidates many route handlers into shared function buckets,
keyed by runtime + `maxDuration` + region.

When I added `/api/custody/{build-message,hash-assets,list-attestations,verify}`
in commit d0275ac0, those 4 new routes pushed us 3 functions over the cap.

After commit 1b20b7c2 consolidated them into a single action-dispatched
`/api/custody/route.ts`, the deploy STILL failed — because I'd set
`maxDuration = 12`, which was unique across the entire codebase
(37 routes use 15, 32 use 10, 27 use 30, etc.). Vercel treats unique
runtime configs as separate buckets, so my single route was its own
function.

### Fix shipped (commit a4368110)

Changed `app/api/custody/route.ts` from `maxDuration = 12` to `maxDuration = 15`
to consolidate into the most-used bucket. Deploy succeeded immediately.

### Lessons / guard rails

1. **Hobby plan = 12-function cap.** Pro plan ($20/mo) lifts to 100.
2. **Always reuse common `maxDuration` values** (15 / 10 / 30 / 60). A
   unique value = unique function bucket = +1 toward the cap.
3. **Vercel CLI hides post-build errors.** Always hit the REST API
   `/v13/deployments/{id}` for the actual errorCode.

If we need to add more API routes in future and hit the cap again, options:
- Use existing maxDuration buckets (15/10/30/60) before introducing new ones
- Upgrade to Pro plan
- Consolidate related routes into action-dispatched single routes (as done
  for `/api/custody/*`)

---

## 🟡 OPEN ITEM #1: Custody attestor not yet deployed to mainnet

### Status
- ✅ Move contract written + 11/11 tests passing
- ✅ TS SDK + consolidated API route + frontend page + deploy runbook all shipped
- ❌ Not yet on mainnet

### What this means today
`/api/custody?action=list-attestations` returns `{ deployed: false, message: ...}`
gracefully — UI shows the "not deployed yet" state with pointer to the runbook.

### Action when ready
Run `scripts/deploy-custody-attestor.md`. Requires:
- 0.5+ SUI for gas in operator wallet
- Existing UpgradeCap (you have v3)
- ~30 min total

This is Tranche 2/3 work per the grant deck — not blocking grant submission.
Ship after grant approval so the framing earns itself with on-chain evidence.

---

## 🟢 EVERYTHING ELSE IS GREEN

See `docs/SUBMISSION_DAY_CHECKLIST.md` for the actual submission flow.

Last updated: 2026-06-30
