---
name: qa-wave
description: Run the next QA wave from docs/plans/admin-mobile-test-plan.md by spawning small parallel testing subagents (Sonnet), one per QA package, then triage, write the wave summary under docs/qa/runs/, and optionally fix accepted defects. Use when the user says "continue QA", "next QA wave", "run QA-xx", or "retest QA".
---

# QA wave runner

You are the **coordinator**. You do not test cases yourself; small subagents do. You prepare the
environment, brief agents, check their P0/P1 claims against source, and write the summary.

Source of truth: `docs/plans/admin-mobile-test-plan.md` (packages in §9, scenarios in §5–8,
result format in §12). Past runs: `docs/qa/runs/<date>-wave<N>/` — always read the latest
`SUMMARY.md` first ("Not covered", "Deferred", "Fixed", "Still open").

## 1. Decide scope

1. Read the latest `docs/qa/runs/*/SUMMARY.md` (and `mobile.md` if present).
2. The next wave = the packages listed under "Not covered", in plan order (§9 "Suggested waves").
   If the user named packages (`QA-09`, "retest"), use those instead.
3. At most **6 testing agents** at once (plan §9). One package per agent. A big package can be
   split, but never give two agents the same case IDs.
4. Retest waves: one agent re-runs every FAIL from the previous wave's reports against the fix
   branch and reports PASS/FAIL per original defect ID.

## 2. Prepare (coordinator, before spawning)

- Branch: `git checkout -b feature/qa-wave<N>` from up-to-date `main` (CLAUDE.md rule 1).
  Results docs go on this branch; fixes go on `feature/qa-wave<N>-fixes`.
- Record frozen commit: `git rev-parse --short HEAD`, Node/npm versions.
- DB: local Supabase in Docker. Query with
  `docker exec supabase_db_service-center psql -U postgres -Atc "<sql>"` (no host psql).
  Check all migrations are applied:
  `select max(version), count(*) from supabase_migrations.schema_migrations` vs
  `ls supabase/migrations | wc -l`. If behind, ask the user before `supabase migration up`.
  **Never `supabase db reset` without the user's OK** — it wipes earlier waves' fixtures.
  (If `supabase status` fails after a CLI upgrade, it is usually a renamed config key — e.g.
  CLI 3 renamed `[inbucket]` → `[local_smtp]`; the containers may still be fine — check `docker ps`.)
- Servers via `preview_start` (never Bash): `api-simulated-delivery` (:4000, simulated email/push)
  and `web` (:5173); `admin` (:5174) / `mobile-metro` / `mobile-ios` only if a package needs them.
  Check `curl -s -o /dev/null -w '%{http_code}' localhost:4000/health`.
- Keys for agents: `SUPABASE_URL`, anon and service-role keys are in `backend/.env`. Tell agents
  to read them from there, never to print them.
- Namespace per agent: orgs `qa-<YYYYMMDD>-<pkg>-<a|b|c>`, users
  `<alias>.qa<YYYYMMDD>.<pkg>@example.test`. Passwords generated at runtime, kept only in the
  agent's scratchpad.

### Shared-resource rules (put the relevant ones in each brief)

- **Browser:** only ONE agent may drive the built-in browser (same origin = shared session
  storage). Pick the package whose cases are most UI-bound; every other agent tests via API + DB
  and marks web-only steps `NOT_RUN (browser owned by QA-xx)`.
- **iOS simulator:** one agent at most, and not in parallel with heavy Metro rebuilds.
- **Delivery worker** (`npm run worker -w @service-center/backend`, or
  `POST /api/v1/internal/deliveries/run` with `CRON_SECRET`) is global: it processes every org.
  Only the release/delivery package runs it on purpose; others must not, or must say they did.
  Overlapping runs are safe (SKIP LOCKED) but change other agents' job states.
- **Servers:** agents must not restart :4000/:5173 or Metro. If a server dies they stop and report;
  the coordinator restarts it (`preview_start`) and resumes them with `SendMessage`.
- **No implementation changes** by testing agents. No edits outside their report file.

## 3. Spawn agents

One `Agent` call per package, **all in one message** so they run in parallel:
`subagent_type: "general-purpose"`, `model: "sonnet"` (small agent; use `haiku` only for pure
re-run/retest of scripted API cases). Each writes `docs/qa/runs/<date>-wave<N>/<area>.md`.

Brief template (fill every `<>`; the agent knows nothing else):

```text
You are a QA testing agent for the Service Center repo (/Users/nguyen/service-center).
Task: execute package <QA-xx — title> from docs/plans/admin-mobile-test-plan.md.
Owned case IDs: <list from §9 + scenario rows in §5–8>. Read those rows, §2 (execution rules),
§3 (permission oracle + fixtures), the dataset rows <Dxx> in §4, and §12 (result format).
Also read docs/qa/runs/<latest>/SUMMARY.md for prior defects/fixes in your area and
<relevant docs: docs/operations/*.md, docs/adr/*, specs>.

Environment (already running — do not restart): API http://localhost:4000 (simulated
email/push), web http://localhost:5173, local Supabase (URL + anon/service keys in
backend/.env; never print keys). DB: docker exec supabase_db_service-center psql -U postgres -Atc "...".
Frozen commit <sha> on <branch>.
Namespace: orgs qa-<date>-<pkg>-{a,b}, users <alias>.qa<date>.<pkg>@example.test. Create
fixtures yourself (service-role/admin API only for setup: users, memberships, grants; then
drive features through the real API/UI with each actor's own token). Passwords stay in your
scratchpad (<scratchpad path>), never in the report.
Shared-resource rules: <browser: yours | not yours — API/DB only>; <worker: you own it | do not run it>;
do not restart servers — if one dies, stop and report; do not change code, migrations, or config;
do not touch other qa-* orgs.

Method: expand each owned row by action × actor (allowed + denied role) × surface (API, DB/RLS
with the caller's JWT, Storage, web UI if yours) × failure mode. Permission evidence must use the
caller's token, never service role. For mutations assert response + persisted row + side effects.
Read source (backend/src/routes, services, supabase/migrations) to know the contract; when source
and plan disagree, record it.

Output: write docs/qa/runs/<date>-wave<N>/<area>.md with: header (package, commit, env, namespace,
fixture shape), a result table per case group (Case ID, actor, surface, expected, actual, status
PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE), a Defects section (ID W<N>-<AREA>-D<n>, priority
P0/P1/P2, minimal repro with HTTP request/SQL, expected vs actual, source file:line suspected),
Not run/blocked with reasons, and fixtures left in place. Report P0 (cross-tenant leak,
private/prepared exposure, unauthorized write, lost write, overfill) immediately in your final
message. Final message: counts per status, defect list with priority, blockers, file path. Keep
it under 300 words.
```

## 4. While agents run

- Don't poll. Wait for completion notifications.
- If one reports a dead server: restart it with `preview_start`, then `SendMessage` the agent to
  resume.
- Don't test their cases yourself in parallel.

## 5. Triage and summary

1. For every reported P0/P1, open the cited source and reproduce with one request (caller token)
   before accepting. Downgrade or reject with a reason if it doesn't hold.
2. Write `docs/qa/runs/<date>-wave<N>/SUMMARY.md` in the wave-2 shape: plan + commit + env line;
   package table (report link, expanded cases, PASS, FAIL, other); P0 status; "Fix now — P1"
   table (ID, summary, decision); "Fix now — P2" list; "Deferred"; "Not covered" (what the next
   wave picks up); "Fixtures left in place". Never blend into an "all passed".
3. Commit the reports on `feature/qa-wave<N>` (`docs(qa): wave <N> results`).
4. Ask the user before starting fixes. Fixes go on `feature/qa-wave<N>-fixes`, follow CLAUDE.md
   (migrations for schema, read the supabase skill first, tests for each fix), then append a
   "Fixed" table to the summary with ID / fix / where, re-verified against the live API.

## 6. Done criteria

- Every owned case has a status; blockers say what would unblock them.
- Summary lists what is still not covered so the next `/qa-wave` run picks it up.
- Fixture namespaces and any leftover pending state (applications, tokens, webhooks) are listed.
