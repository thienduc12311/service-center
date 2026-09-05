---
name: service-center-engineering
description: Apply the Service Center repository's architecture, TypeScript, Supabase, security, testing, and Git conventions when changing this project.
---

# Service Center Engineering

Before changing this repository, read [CLAUDE.md](CLAUDE.md) in full. It is the canonical, shared engineering guide for both Codex and Claude and its rules apply to every feature, fix, refactor, backend change, and database change.

When database schema, SQL, migrations, indexes, functions, triggers, or RLS policies are involved, also read and follow `.agents/skills/supabase-postgres-best-practices/SKILL.md` and the relevant files in its `references/` directory. The Supabase skill takes precedence over generic database advice.

Keep cross-package contracts in `packages/shared`, preserve RLS as the primary tenant boundary, use explicit named TypeScript types without `any`, validate untrusted input with the existing Zod conventions, and run the relevant workspace build, typecheck, and tests before handing work off.
