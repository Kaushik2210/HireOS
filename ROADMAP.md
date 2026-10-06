# HireOS Roadmap

Priority key: **Must** (MVP), **Should**, **Could**. Status is updated at each phase gate. Anything not yet built appears in the UI labeled "Planned".

| # | Phase | Priority | Status |
|---|---|---|---|
| 1 | Project foundation (tooling, lint, test setup, CI, design tokens, layout shell) | Must | Done |
| 2 | Authentication (Supabase Auth, protected routes, session expiry) | Must | Done (live round-trip unverified, see known issues) |
| 3 | Candidate profile (profile, skills, projects, certs, experience, preferences) | Must | Planned |
| 4 | Resume upload and parser (secure upload, extraction, Resume Health) | Must | Planned |
| 5 | Job database and providers (JobProvider, demo provider, dedupe, demo dataset) | Must | Planned |
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
