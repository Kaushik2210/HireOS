# HireOS Roadmap

Priority key: **Must** (MVP), **Should**, **Could**. Status is updated at each phase gate. Anything not yet built appears in the UI labeled "Planned".

| # | Phase | Priority | Status |
|---|---|---|---|
| 1 | Project foundation (tooling, lint, test setup, CI, design tokens, layout shell) | Must | Done |
| 2 | Authentication (Supabase Auth, protected routes, session expiry) | Must | Done (live round-trip unverified, see known issues) |
| 3 | Candidate profile (profile, skills, projects, certs, experience, preferences) | Must | Done (Supabase path unverified live) |
| 4 | Resume upload and parser (secure upload, extraction, Resume Health) | Must | Done (Supabase storage path unverified live; LLM-assisted parsing Planned) |
| 5 | Job database and providers (JobProvider, demo provider, dedupe, demo dataset) | Must | Done (no real provider by design; Supabase path unverified live) |
| 6 | Job matching (Application Strength, breakdown, Job Intelligence page) | Must | Planned |
| 7 | Resume optimizer (tailoring, diff, versions, integrity verifier, cover letter) | Must | Planned |
| 8 | Outreach assistant (drafts, LinkedIn copy-only assistant) | Should | Planned |
| 9 | Application CRM (Kanban, transitions, events, follow-ups) | Must | Planned |
| 10 | Interview hub (prep, questions, Mock Interview Mode) | Should | Planned |
| 11 | Career analytics (funnel, rates, "Why am I not getting interviews?", gap analyzer) | Should | Planned |
| 12 | Career graph | Could | Planned |
| 13 | Security hardening (rate limits, CSP, audit, data export/delete) | Must | Planned |
| 14 | Testing pass (edge cases, e2e, RLS suite completion) | Must | Planned |
| 15 | Production polish, README, screenshots | Must | Planned |

## MVP definition
Phases 1-7, 9, 13 (core path): sign in, build profile/upload resume, see ranked jobs with explainable strength, tailor a resume with verified claims, track applications. Phases 8, 10, 11 follow; 12 last.

## Cross-phase items
- Command palette grows with each phase (Should; shell in phase 1, actions added as features land).
- Career Autopilot (flagship): needs phases 5-9; built after 9 as an Inngest pipeline ending in an approval queue (Should).
- Real job providers beyond demo: added one at a time after reviewing each source's terms (Should).
- Email sending via Resend after explicit approval (Could; drafts and copy first).

## Future improvements
Browser extension for user-initiated page capture, calendar integration for interviews, multi-resume A/B outcome analysis, additional LLM providers behind `LLMProvider`.

## Known issues
- `npm audit` reports 8 advisories, all in the dev-only Vitest toolchain (none in production dependencies; CI gates on `npm audit --omit=dev`). Upgrading Vitest is blocked by peer-dependency conflicts; revisit when the ecosystem catches up.
- Authentication has not been exercised against a real Supabase project. Covered instead: action logic against a mocked client, the proxy, migrations and RLS on PGlite, and routing/validation/outage behavior end to end. Verify sign-up, email confirmation, reset and sign-out against a real project before relying on it. Supabase Auth settings to check: email confirmation on, leaked-password protection on, redirect URL allow-list includes `APP_URL`/auth/callback.
- No Docker on the primary dev machine, so migrations are verified on PGlite rather than the Supabase CLI stack. A CI job running `supabase start` and `supabase db reset` is planned.
- Rate limits are in memory per server instance (Phase 13 moves them to a shared store).
- Account deletion and OAuth providers are Planned.
- The Supabase profile store (`db/profile/supabase-store.ts`) is tested against a fake client for query shape and error mapping, and the schema and RLS are tested on PGlite, but the two have not been exercised together against a real Supabase project. Verify create, edit, delete and isolation with two real accounts.
- Demo sandboxes live in server memory: they reset on restart and are not shared across serverless instances.
- Profile items have no import path yet; resume parsing (Phase 4) will create unconfirmed items, and a confirm-all UI lands with it.
- Month inputs use the browser's native control, whose appearance varies by browser.
- The Supabase resume store and storage bucket are tested against a fake client (call shape, cleanup on failure) and, for the schema, constraints and storage policies, on PGlite. They have not run against a real Supabase project. Verify: upload, signed-URL download, delete (file and row), and cross-account isolation with two real accounts.
- The resume parser is heuristic. It handles the common layouts well (classic, pipe-separated, wrapped lines) but will misread unusual ones, such as multi-column designs, graphics-heavy templates and non-English resumes. It flags uncertainty and drops what it cannot read; all imported items need user review. An LLM-assisted fallback is Planned for after the `LLMProvider` interface exists.
- No OCR: image-only PDFs are reported as unreadable.
- Resume Health scoring weights and thresholds are initial values and have not been calibrated against real resumes. Keyword coverage is general breadth only; job-specific coverage arrives with matching (Phase 6).
- Resume files are parsed in the request process. Move to a background job or isolated worker with the Inngest work in a later phase if volume warrants.
- Download is unavailable in demo mode because originals are discarded.
- **No real job provider is enabled, on purpose.** Before adding one I read Greenhouse's Job Board API documentation: it describes giving a company access to "your company's" offices, departments and jobs, to build that company's own careers page. It does not grant reuse by a third-party aggregator, so enabling it for other companies' boards would rest on an assumption rather than a stated permission. Lever and Ashby have the same shape. A real source should be added only when its terms clearly allow it (a licensed or partner feed, an API that explicitly permits aggregation, or a company that points its own board at HireOS), one at a time, with the basis recorded in its `termsNote`. Until then, real discovery is the "add a job" paste flow.
- The job provider framework, normalisation and dedupe are exercised by two fictional demo sources. The adapter surface for a real source is small: map its records to `RawJob`.
- Job analysis is heuristic. It reads conventionally written postings well (headed sections, bullets) and degrades to fewer extracted fields on prose-only or unusual ones; it never invents values. It cannot tell from text alone that "Go" in a sentence is the language, so very short skill names are only recognised in list contexts.
- Search is whole-word-fragment matching over title, company, location, skills and description, not full-text search with ranking or stemming ("engineers" does not match "engineer"). Fine at catalogue sizes in the thousands; move to Postgres full-text or trigram indexes when it grows. Title sort uses the database's collation, which may order punctuation differently from the demo store on a real Supabase instance.
- Pay is shown per posting in its own currency. There is no currency conversion and no salary sort.
- The Supabase job store and `search_jobs()` through PostgREST have not been exercised against a real project (the SQL is tested on PGlite and the client calls against a fake). Verify search, add, delete and the hide-demo flag with two real accounts, and load `supabase/seed.sql` to see demo jobs.
- Ingestion has no scheduler yet: shared catalogue rows come only from `supabase/seed.sql` (demo) today. A refresh job (Inngest) arrives with the first real provider.
