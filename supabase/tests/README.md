# Database test suites

SQL suites (`*.sql`) run against the local Supabase Postgres (container
`supabase_db_service-center`, started by `npm run db:start`). Each ends in
`rollback`; the runner also wraps each in an outer `begin`/`rollback` with
`ON_ERROR_STOP=1`, so a failing suite drops its connection and aborts the open
transaction. Nothing persists.

## Run everything

```bash
supabase/tests/run-all.sh                 # every *.sql suite, per-file PASS/FAIL, exit 1 on any FAIL
supabase/tests/run-all.sh f08 i18n        # only files whose name contains a pattern
supabase/tests/run-all.sh --concurrency   # additionally run the *.sh concurrency scripts
```

Set `SUPABASE_DB_CONTAINER` to use a differently named container.

The `*.sh` concurrency scripts open several sessions and **commit** data to the
seed organisation, so they are skipped unless `--concurrency` is given. Run those
only against a disposable database.

## Writing suites

- Create your own fixtures inside the transaction; do not depend on mutable seed
  rows (people, queue backlogs, the preferred languages other users picked).
- Remember the current rules: people are owner-only
  (`20261109000000_owner_people_permissions`: non-owners see only their own
  `people` row), assignment answers go through the response functions
  (`20261125000002`), member inserts are owner-only (`20261125000000`). Use the
  seed owner `11111111-1111-4111-8111-111111111111` where a roster/people
  capability is required.
- `-- BUG:` comments mark assertions deliberately left out because they expose a
  product defect (see `f10-plan-templates.sql`, `f11-order-editing.sql`).
