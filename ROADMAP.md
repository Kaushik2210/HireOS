# HireOS Roadmap

Priority key: **Must** (MVP), **Should**, **Could**. Status is updated at each phase gate. Anything not yet built appears in the UI labeled "Planned".

| # | Phase | Priority | Status |
|---|---|---|---|
| 1 | Project foundation (tooling, lint, test setup, CI, design tokens, layout shell) | Must | Done |
| 2 | Authentication (Supabase Auth, protected routes, session expiry) | Must | Done (live round-trip unverified, see known issues) |
| 3 | Candidate profile (profile, skills, projects, certs, experience, preferences) | Must | Done (Supabase path unverified live) |
| 4 | Resume upload and parser (secure upload, extraction, Resume Health) | Must | Done (Supabase storage path unverified live; LLM-assisted parsing Planned) |
| 5 | Job database and providers (JobProvider, demo provider, dedupe, demo dataset) | Must | Done (no real provider by design; Supabase path unverified live) |
| 6 | Job matching (Application Strength, breakdown, Job Intelligence page) | Must | Done (Supabase path unverified live; weights uncalibrated; LLM explanations Planned) |
| 7 | Resume optimizer (tailoring, diff, versions, integrity verifier, cover letter) | Must | Done (selection and ordering only; AI rewriting Planned; Supabase path unverified live) |
| 8 | Outreach assistant (drafts, LinkedIn copy-only assistant) | Should | Done (templated drafts, copy only; AI wording Planned; Supabase path unverified live) |
| 9 | Application CRM (Kanban, transitions, events, follow-ups) | Must | Done (no drag and drop; Supabase path unverified live) |
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
- Resume Health scoring weights and thresholds are initial values and have not been calibrated against real resumes. Resume Health keyword coverage is general breadth only; job-specific keyword coverage is part of Application Strength.
- Resume files are parsed in the request process. Move to a background job or isolated worker with the Inngest work in a later phase if volume warrants.
- Download is unavailable in demo mode because originals are discarded.
- **No real job provider is enabled, on purpose.** Before adding one I read Greenhouse's Job Board API documentation: it describes giving a company access to "your company's" offices, departments and jobs, to build that company's own careers page. It does not grant reuse by a third-party aggregator, so enabling it for other companies' boards would rest on an assumption rather than a stated permission. Lever and Ashby have the same shape. A real source should be added only when its terms clearly allow it (a licensed or partner feed, an API that explicitly permits aggregation, or a company that points its own board at HireOS), one at a time, with the basis recorded in its `termsNote`. Until then, real discovery is the "add a job" paste flow.
- The job provider framework, normalisation and dedupe are exercised by two fictional demo sources. The adapter surface for a real source is small: map its records to `RawJob`.
- Job analysis is heuristic. It reads conventionally written postings well (headed sections, bullets) and degrades to fewer extracted fields on prose-only or unusual ones; it never invents values. It cannot tell from text alone that "Go" in a sentence is the language, so very short skill names are only recognised in list contexts.
- Search is whole-word-fragment matching over title, company, location, skills and description, not full-text search with ranking or stemming ("engineers" does not match "engineer"). Fine at catalogue sizes in the thousands; move to Postgres full-text or trigram indexes when it grows. Title sort uses the database's collation, which may order punctuation differently from the demo store on a real Supabase instance.
- Pay is shown per posting in its own currency. There is no currency conversion and no salary sort.
- The Supabase job store and `search_jobs()` through PostgREST have not been exercised against a real project (the SQL is tested on PGlite and the client calls against a fake). Verify search, add, delete and the hide-demo flag with two real accounts, and load `supabase/seed.sql` to see demo jobs.
- Ingestion has no scheduler yet: shared catalogue rows come only from `supabase/seed.sql` (demo) today. A refresh job (Inngest) arrives with the first real provider.
- Application Strength weights (30/15/15/10/10/10/10), the label thresholds (80/65/45) and the skills cap (below 40% of at least three required skills limits the total to 54) are reasoned starting values. They have not been calibrated against real outcomes and will change with evidence, which is why every result carries `scorer_version`.
- Skill matching is by canonical name and alias only. A related skill (for example Flask for Django) is never credited; it only appears as a suggestion on the gap. Level credit is a fixed table, not a measurement.
- Education requirements are read from the posting's text with patterns, so unusual phrasing may be missed (the education component is then left out rather than guessed). Experience is the sum of verified work and internship ranges with overlaps merged; leadership and volunteering do not count as years.
- Scoring is live: `/matches` and the dashboard score every visible job on each load (capped at 500). That is cheap at demo scale. A saved snapshot (`job_matches`) is written when a job page is opened and its profile hash or scorer version changed; nothing reads it for ranking yet.
- The Supabase match store and `job_matches` through PostgREST have not run against a real project (SQL tested on PGlite, client calls against a fake). Verify save and read with two real accounts.
- Explanations are built from templates over stored evidence. LLM-written explanations are Planned and will only reword evidence the scorer already produced.
- E2E timing: eight workers share one production server, and navigations sometimes took longer than Playwright's default 5 second assertion timeout (the add-a-job redirect and job detail loads were the usual victims, and failed the same way on the Phase 5 commit). A server-side timing check and a 48-navigation stress run found no slow or stuck request, so the cause is load on the test machine, not a hang in the app. The assertion timeout is now 10 seconds, link prefetching is off, and a redundant `revalidatePath` was removed from the add-job action; the suite has been green on repeated runs since. Resume upload tests, which parse a PDF inside the request, are the most load-sensitive: roughly one full run in three still sees one of them miss the 10 second wait while the other 173 pass, and a stress run repeating that spec five times at once failed more than half. The parser runs in the request process (see above), so a background worker is the real fix. If other tests start failing, check machine load first.
- Tailoring only chooses and orders verified items and copies their wording unchanged. It cannot make a weak bullet stronger, shorten a long one or adapt phrasing to a posting. LLM rewriting is Planned and will have to pass the same verifier (which blocks any reworded line today).
- Keyword matching for relevance uses the skill catalogue, so a skill that is not in the catalogue is never treated as relevant. A project with no catalogue skills is only chosen as a fallback.
- Resumes are plain text (copy and .txt download). There is no PDF or DOCX export and no template choice yet, and the profile has no email or phone field, so contact details come from the profile's location and links only.
- The cover letter is a short fixed-structure draft: a greeting, one project line, one role line, the matching skills and a closing, each quoted from the profile. It is deliberately plain; the user edits it. Edited text is checked for skills and numbers that are not in the verified profile, but the check cannot judge tone or implied claims ("led", "owned") in free wording.
- Version approval is the user's own review step and nothing more: it does not submit, send or share anything. Approved versions are immutable, including in the database.
- The Supabase document store and `document_versions` through PostgREST have not run against a real project (SQL tested on PGlite, client calls against a fake). Verify save, approve, compare and delete with two real accounts.
- Outreach drafts are built from fixed templates around verbatim profile text. They are plain and short on purpose; they cannot adapt tone, mention something specific about the recipient or company, or vary between drafts. LLM wording is Planned and must pass the same verifier.
- Nothing is sent or connected: the person copies a draft into their own email or LinkedIn. "I sent this myself" is only their own record, so it cannot be checked, and nothing watches for replies. Follow-up reminders arrive with the application tracker (Phase 9).
- HireOS cannot check what the person types about a recipient or how they know them. A recipient's name and role are accepted as typed; the "how you know them" text is checked like the rest of the message, so a skill or number in it that the profile lacks is flagged.
- The follow-up and thank-you drafts say the person applied or spoke only after they tick a box saying so. The app cannot confirm either, and applications are not tracked until Phase 9.
- A LinkedIn note is limited to 300 characters, which is LinkedIn's connection-note limit for most accounts as of writing; accounts with a different limit would need that constant changed (`LINKEDIN_NOTE_LIMIT`).
- Drafts are hard-deleted (no soft delete or trash), and a draft keeps the wording it was written with even if the profile changes afterwards (a notice says so).
- The Supabase outreach store and `outreach_drafts` through PostgREST have not run against a real project (SQL tested on PGlite, client calls against a fake). Verify write, edit, approve, mark sent and delete with two real accounts.
- Every status is the person's own record. HireOS reads no email, polls no employer site and sees no replies, so a status is only as accurate as what the person enters. "Applied" means they applied themselves on the employer's page.
- The board moves cards with a "Move to" menu that offers only the allowed next statuses, not by dragging. It works with a keyboard, a screen reader and a phone; drag and drop is Planned.
- The follow-up engine is derived, not stored: an awaited application (applied, assessment or interview) is due after seven quiet days, or on the date the person set. The seven days is a constant (`DEFAULT_FOLLOW_UP_DAYS`), not yet a setting, and there are no reminders, emails or notifications: it appears on the board, the application page and the dashboard. The planned `followups` table was not needed.
- The allowed moves (for example Rejected is final, Offer can only become Rejected or Withdrawn) are a first design. A real search may need others, such as reopening a rejection. The rule lives in one table that the app, the demo store and the database tests all check.
- An application keeps its title, company and history when its job is deleted, but then has no link back to the job and cannot start a follow-up draft.
- Contacts (`contacts` in the original data model) are not built: recruiter names live in notes and in outreach drafts. They would arrive with analytics if the data is worth structuring.
- Sample applications are generated for each demo visitor from fixed definitions dated relative to now. They exist only in demo mode, are clearly labelled, and can be cleared with one button.
- The Supabase application store, `change_application_status()` and the other functions through PostgREST have not run against a real project (SQL tested on PGlite, client calls against a fake). Verify tracking, moving, notes and delete with two real accounts.
