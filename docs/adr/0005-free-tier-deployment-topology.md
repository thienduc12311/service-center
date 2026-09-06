# Deployment is split across Cloudflare Pages, Render and GHCR, shaped by free tiers

The SPA is a static bundle and goes to **Cloudflare Pages**; the API needs a
persistent process (ADR 0004) and goes to **Render**'s free tier; images are built
in GitHub Actions and published to **GHCR**, which Render then deploys. DNS already
sits at Cloudflare, and `graceaogchurch.com` already serves the church's own site
from Vercel, so the app takes `service.graceaogchurch.com` and the API takes
`api.graceaogchurch.com` proxied through Cloudflare. Proxying means the public API
hostname is ours rather than the host's, so moving off Render later is a DNS change
and a redeploy of the same image — which matters, because Railway and Koyeb both
withdrew comparable free tiers during 2026 and Render can do the same.

Render Free was chosen over Northflank Sandbox and Oracle Always Free on one
verified point: custom domains with managed TLS are documented on Render's free
tier, and Cloudflare's proxy still requires the origin to recognise
`api.graceaogchurch.com` by `Host` header, so custom-domain support is a hard
requirement. Its cost is that the service spins down after 15 minutes without
inbound traffic and takes about a minute to spin back up — a process kill, not a
pause. An external uptime monitor pings `/health` between 06:00 and 23:00 local,
which keeps it warm inside the 750 instance-hour monthly allowance with real
headroom; pinging around the clock would consume roughly 744 of those 750 hours and
leave none for restarts. Overnight requests, including calendar clients refreshing
a Schedule Feed, pay the cold start and retry.

Two consequences worth stating. Images are tagged with their commit SHA and
**rollback is code-only**: migrations are never reversed, so every migration must be
backward-compatible with the currently-deployed code (CLAUDE.md rule 16 applied to
releases). Down-migrations are deliberately not written — they are the least-tested
code in any repo and the schema simply staying ahead of the code is safe. And CI is
never given the production `SUPABASE_SERVICE_ROLE_KEY`: it bypasses RLS entirely,
and nothing in the pipeline needs it, since migrations are applied by hand and the
frontend build needs only the anon key.
