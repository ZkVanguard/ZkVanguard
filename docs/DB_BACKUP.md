# Local DB backups

Manual `pg_dump` snapshots of the production Aiven DB, landed to your
laptop under `db-backups/`. Two-line reason for existing:

1. **Aiven is the source of truth.** Every write (deposits, hedges,
   NAV history, cron heartbeats) goes to Aiven and nothing else.
   Never fork the DB. Never point production at anything else.
2. **Local snapshots let you restore fast** if something goes sideways
   (a bad migration, a corrupt row, an audit question about
   yesterday's state). They are read-only copies of prod, taken by
   you, when you want one.

Backup files are gitignored (`.gitignore` → `db-backups/*.sql*`) so
you never accidentally commit rows.

---

## Prerequisites

Install PostgreSQL client tools **once** — you only need `pg_dump` +
`psql`, not a running Postgres server.

| OS | Install |
|---|---|
| Windows | `winget install PostgreSQL.PostgreSQL` (or postgresql.org installer) |
| macOS | `brew install libpq && brew link --force libpq` |
| Linux | `sudo apt install postgresql-client` |

Verify: `pg_dump --version && psql --version`.

Aiven URL notes:
- `DATABASE_URL` in `.env.local` is your Aiven connection string.
- It carries `sslmode=no-verify` — `pg_dump` and `psql` respect that
  (no extra flags needed).
- Aiven's plan has a **20-connection cap shared plane-wide**. `pg_dump`
  uses one connection for the duration of the dump; kick it off during
  quiet windows and don't run it back-to-back if crons are hot.

---

## Commands

```sh
bun run db:backup                              # DATABASE_URL → db-backups/{ts}.sql.gz
bun run db:backup --plain                      # skip gzip (bigger .sql)
bun run db:backup --schema-only                # DDL only, no rows

bun run db:list-backups                        # ls db-backups/ with size + age

# Restore into your LOCAL Postgres (never prod — see guards below):
LOCAL_DATABASE_URL=postgres://user:pass@localhost:5432/zkv_dev \
  bun run db:restore-local -- --latest --i-really-mean-it

# Or restore a specific snapshot by name:
bun run db:restore-local -- 20260729-134502.sql.gz --i-really-mean-it
```

Timestamps are UTC (`YYYYMMDD-HHMMSS`).

---

## Restore guards (why you can't foot-gun prod)

`db:restore-local` refuses to run unless **all three** hold:

1. `LOCAL_DATABASE_URL` is set (separate env var from `DATABASE_URL`).
2. `LOCAL_DATABASE_URL` host looks local — `localhost`, `127.0.0.1`,
   `host.docker.internal`, `postgres`, `db`. Anything else aborts.
3. `LOCAL_DATABASE_URL` ≠ `DATABASE_URL` (belt-and-braces).

Plus you have to pass `--i-really-mean-it` on the command line because
restore is a `DROP CASCADE` in disguise.

If any guard fails, the script exits with a clear error before touching
Postgres.

---

## Typical workflow

```sh
# 1. Take a snapshot before you touch anything.
bun run db:backup

# 2. Do the risky thing (migration, script, test data).
bun run scripts/some-migration.ts

# 3. If it went wrong, restore your local copy from the snapshot:
export LOCAL_DATABASE_URL=postgres://postgres@localhost:5432/zkv_dev
bun run db:restore-local -- --latest --i-really-mean-it

# 4. Aiven stays untouched throughout. That's the point.
```

---

## What's NOT here

- **No automated backups.** Aiven has its own snapshot policy (check
  the Aiven console); this repo's script is for ad-hoc dev safety.
- **No offsite copies.** Backups sit on your laptop. If that's not
  enough, wire up an S3/R2 upload — trivial addition, but not needed
  for the "I'm about to do something risky" workflow.
- **No writes to prod.** `db-backup.mjs` only reads. `db-restore-local.mjs`
  only writes to the guarded LOCAL_DATABASE_URL. There is no script
  in this repo that pushes a local backup back to Aiven — that's a
  manual `psql` + intentional operator action.
