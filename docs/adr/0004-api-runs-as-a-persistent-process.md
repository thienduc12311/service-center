# The API runs as a persistent process, not on a serverless platform

`POST /api/v1/imports` charges the quota, inserts a `pending` row, calls
`void processImport(created.id)` and immediately answers `202`. The transcription
therefore runs *after* the response has been sent. On Vercel, Netlify or any
Lambda-backed platform the invocation is frozen or killed the moment the response
is flushed, so that call would die mid-flight and every chord sheet import would
sit at `pending` for ever. We deploy the API as a long-running container instead.
This is why a plain Express server in this repo is *not* on Vercel even though the
frontend is trivially static — a future reader would otherwise reasonably assume
the API belongs there too and "fix" it.

The alternative is a real job queue (pgmq, pg_cron, or a Supabase Edge Function)
plus a shared-store rate limiter, which would make the API genuinely
platform-agnostic. We deferred it: it is a feature-sized refactor, and nothing at
current scale needs it. Two things depend on staying single-process until then.
`express-rate-limit` in `app.ts` uses its default in-memory store, so the 300
requests/minute production limit is **per process** — raising the instance count
above one silently multiplies the limit and stops it protecting anything. And the
fire-and-forget call above has no retry beyond the user-triggered `POST
/imports/:id/retry`, so a container replaced mid-transcription loses that import
(the row keeps the outcome, and the retry charges quota again by design).
