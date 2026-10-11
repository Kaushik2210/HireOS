# HireOS Architecture

## Shape
A single Next.js (App Router, TypeScript strict) application: UI, server actions, and route handlers in one deployable, with Supabase as the data/auth/storage plane and Inngest for background work. A modular monolith with strict layering, chosen over microservices because there is one developer and one deploy target.

```
/app          routes, layouts, route handlers (thin: auth, validate, delegate)
/components   shared UI primitives (shadcn/ui based)
/features     feature-scoped UI + hooks (profile, jobs, resume, crm, interview, analytics, graph)
/services     business logic, framework-agnostic, unit-testable
/ai           LLMProvider, prompts, Zod schemas, validators, integrity verifier
/db           typed queries, migrations, seed
/lib /hooks /utils /types
/tests        unit, integration, rls, security, e2e
```

Dependency direction: `app -> features -> services -> (db, ai)`. `services` never import from `app` or `features`. `ai` never touches `db`; services pass it data and persist its validated output.

## Request flow
1. Route handler / server action resolves the session (Supabase Auth), rejects if absent.
2. Input validated with Zod.
3. Service called with `userId` and validated input; queries run through the user-scoped Supabase client so RLS applies as a second line of defense.
4. AI services return Zod-validated structured output; failures yield typed errors, not free text.
5. Response is a typed result; UI renders loading/error/empty/success states.

## Key decisions and trade-offs
| Decision | Choice | Why / trade-off |
|---|---|---|
| Framework | Next.js App Router | Server actions and route handlers keep one codebase; trade-off: RSC learning curve. |
| DB/Auth/Storage | Supabase | Postgres + RLS + Auth + private storage in one, pgvector built in. Trade-off: vendor coupling; mitigated by plain SQL migrations. |
| Background jobs | **Inngest** | Durable step functions fit multi-stage pipelines (Autopilot, ingestion), run on serverless Vercel with no worker to host, good local dev server, retries and concurrency controls built in. Trigger.dev is comparable but wants longer-running infrastructure for this use; Inngest is the lighter fit. |
| AI | `LLMProvider` interface, Anthropic default | Swappable and mockable in tests; deterministic core means model choice is low-risk. |
| Scoring | Deterministic TypeScript | Explainability and testability. LLM only extracts and explains. |
| Validation | Zod everywhere | One schema = runtime check + TS type; also guards model output. |
| Email | Resend, draft-only | Nothing is sent without explicit approval. |
| UI libs | Tailwind, shadcn/ui, Recharts, React Flow | Boring, well-supported. |
| Tests | Vitest, Playwright, PGlite for migrations and RLS | Cover logic, UI flows, and policy correctness without needing Docker. |

## Authentication
- Supabase Auth, email and password. Sign-up, sign-in, sign-out, forgot and reset password, and a PKCE callback route (`/auth/callback`) for confirmation and recovery links.
- All auth calls happen server-side in server actions (`features/auth/actions.ts`). No Supabase client or anon key ships to the browser.
- `proxy.ts` refreshes the session each request (`getClaims`, local JWT verification) and redirects by route class: unknown paths are protected by default; only login, signup, forgot-password and `/auth/*` are open.
- The proxy is the first gate only. The `(app)` layout and every action call `requireUser()`, which validates the token with the Auth server (`getUser`) rather than trusting cookies. RLS is the final gate.
- Demo mode: when Supabase is not configured the proxy passes through, `requireUser()` returns a clearly labeled demo user, and auth pages explain there is nothing to sign in to.
- Messages never reveal whether an account exists (sign-in, sign-up, reset). Redirect targets pass `safeRedirectPath`. Email links are built from the configured `APP_URL`, never from request headers.

## Candidate profile
- `ProfileStore` interface (`db/profile`) with two implementations. `SupabaseProfileStore` is built from the user-scoped client, so RLS applies, and also filters by `user_id`. `MemoryProfileStore` backs demo mode.
- Demo mode gives each visitor an isolated sandbox keyed by an anonymous cookie, seeded with a fictional persona, held in server memory only (bounded, evicts oldest) and wiped on restart. It carries no authority because demo mode has no real accounts.
- Server actions validate with the same Zod schemas as the forms (the client is never trusted), cap items per section, and return field-level errors. Store errors are mapped to safe messages; raw database text is never shown or logged.
- The profile UI is configuration-driven: one generic form and dialog render every section from field definitions in `features/profile/config.ts`.
- `services/profile/completeness.ts` scores completeness from verified items only. It is deterministic, shows the evidence for every criterion, and says it is not a hiring prediction.

## Resume pipeline
`POST /api/resumes` (a route handler, not a server action, so size limits and responses are explicit) runs `services/resume/upload.ts` in a fixed order. Nothing is stored unless every earlier step passes.
1. Same-origin check, session check, per-user and per-address rate limits, `Content-Length` and file-size limits.
2. `inspectUpload`: decides the file type from its bytes, never from the name or claimed MIME type, then checks for active content, encryption, macros and ZIP bombs.
3. SHA-256 de-duplication and the per-user resume limit.
4. Text extraction with hard budgets (pages, characters, time): `unpdf` for PDF, a bounded `fflate` + tokenizer reader for DOCX.
5. Deterministic parse: normalize, detect sections, extract contact, skills, education, experience, projects, certifications and achievements; every item is validated against the real profile schemas and anything invalid is dropped and counted.
6. Deterministic health scoring across six groups with the evidence behind every check.
7. `ResumeStore.create` uploads the file to private storage, then writes the row, and removes the file if the row fails.

Importing parsed items is a separate, explicit step: items enter the profile as `source = 'resume'`, `confirmed = false` and stay out of every verified view until the user confirms them.

## Job pipeline
- **Providers.** A `JobProvider` maps a source's records to a loose `RawJob`; everything after that is shared. Each provider states its `termsNote`: the basis on which fetching is permitted. Only two bundled demo providers exist. No third-party feed is enabled (see ROADMAP.md for why).
- **Normalisation** (`services/jobs/normalize.ts`) runs in a fixed order: strip markup from the description (including the double-escaped form some feeds send), analyse the cleaned text, let provider-supplied fields override analysis, canonicalise the apply link (http/https only, tracking parameters removed), strip control characters, validate with Zod. A record that fails validation is rejected, never repaired.
- **Analysis** (`services/jobs/analyze.ts`) is deterministic and offline: it splits a posting into responsibilities, requirements and nice-to-haves, extracts required and preferred skills with the same catalogue used for resumes, and reads years of experience, seniority, work mode, job type and salary. It only reports what the text says.
- **De-duplication** (`services/jobs/ingest.ts`) merges listings by fingerprint or identical canonical apply link. The first-seen record stays primary and only gains what it lacked; the other listing is remembered in `also_listed_on`.
- **Stores.** `JobStore` has an in-memory implementation for demo mode (each visitor gets a bounded private sandbox over a shared read-only catalogue) and a Supabase one built on `search_jobs()` and the user-scoped client.
- **Adding a job by hand** goes through exactly the same normalisation, then is stored as a private manual job. Nothing is fetched from any website.

## Matching pipeline
- **Candidate** (`services/matching/candidate.ts`): turns a profile snapshot into scoring inputs from verified items only (skills map with level and where each is used, projects, merged experience months, degrees, preferences, target roles) plus a hash of exactly those inputs.
- **Requirements** (`services/matching/requirements.ts`): reads the education and experience a job asks for from its stored fields and text.
- **Components and score** (`components.ts`, `score.ts`): seven pure functions and a combiner. No I/O, no clock beyond the `now` passed in, no randomness.
- **Ranking** (`rank.ts`): lists the jobs a user can see page by page from the job store (capped at 500), scores each, and sorts by strength with stable tie-breaks.
- **Stores.** `MatchStore` has an in-memory demo implementation and a Supabase one on the user-scoped client; both save a snapshot per user and job.
- **Pages.** `/jobs/[id]` shows Job Intelligence (live-scored, then snapshot saved if the profile hash or scorer version changed); `/matches` ranks everything with a band filter and paging; job cards and the dashboard's Top opportunities panel show strength. If scoring fails the rest of each page still renders.

## Tailoring pipeline
- **Build** (`services/tailoring/resume.ts`, `cover-letter.ts`): turn the verified snapshot and a job into a document of claims, plus the list of changes with reasons and the requirements the profile cannot support. Pure functions.
- **Verify** (`verify.ts`): the independent integrity check described in AI_ARCHITECTURE.md. Runs on save and on approval.
- **Prepare** (`prepare.ts`): builds a ready-to-store version (rendered text, verification, profile hash). Always runs on the server from stored data; the browser sends only which items to leave out, or the user's edited letter text.
- **Versions** (`db/documents`): `DocumentStore` with an in-memory demo implementation and a Supabase one. Versions are numbered per job and kind, immutable once saved, and approved only after a passing check.
- **Compare** (`diff.ts`): a line diff of two versions' plain text.
- **Pages.** `/jobs/[id]/tailor` (live preview from the current profile, the picker, reasons, missing requirements, save), `/jobs/[id]/cover-letter` (editable draft), `/jobs/[id]/documents/[versionId]` (review, approve, compare, copy, download, delete) and `/documents` (everything saved, grouped by job). Nothing is sent anywhere: the user applies on the employer's own page.

## Outreach pipeline
- **Build** (`services/outreach/build.ts`): a template per outreach type produces claims, a plain-text body and, for email, a subject. It refuses to build when the profile is empty, when an alumni note has no context, or when a follow-up or thank-you has not been confirmed.
- **Verify** (`services/outreach/verify.ts`): the letter verifier plus a subject check and the LinkedIn length limit.
- **Prepare** (`services/outreach/prepare.ts`): builds a new draft, or applies the user's edit and re-checks it. Always on the server.
- **Drafts** (`db/outreach`): `OutreachStore` with an in-memory demo implementation and a Supabase one. Draft, approved and sent are the only states, in that order.
- **Pages.** `/jobs/[id]/outreach` (write a draft; typed values go in the request body, never the URL), `/jobs/[id]/outreach/[draftId]` (edit, review, copy, record that you sent it, delete) and `/outreach` (all drafts by job). Every page states that HireOS sends and connects to nothing.

## Application pipeline
- **Rules** (`lib/applications/types.ts`): the statuses and the single table of allowed moves, plus the Zod schemas for every input. The database holds the same table as data and a test keeps the two identical.
- **Follow-ups** (`services/applications/followups.ts`): pure functions that decide, from an application and its events, whether a follow-up is due, and summarise the pipeline. Nothing is stored or sent.
- **Store** (`db/applications`): `ApplicationStore` with an in-memory demo implementation (which also creates the sample applications) and a Supabase one that calls the database functions for moves and notes.
- **Pages.** `/applications` (the board, summary and sample-data controls), `/applications/[id]` (timeline, status change, notes, follow-up date, linked documents, delete), a "track this job" form on each job page, and Pipeline summary and Today's actions panels on the dashboard. A follow-up draft opens the outreach page on the follow-up kind, where the person still confirms they applied before anything is written.

## Interview hub
- **Questions and scoring** (`services/interview`): `buildQuestions` chooses practice questions from the bank and the verified profile, `scoreAnswer` scores one answer on six dimensions, `buildChecklist` writes a prep checklist for a round. All pure and deterministic.
- **Stores** (`db/interviews`, `db/practice`): each has an in-memory demo implementation and a Supabase one. Rounds belong to an application; a practice session saves its questions when it starts, takes answers in order, and finishes with the average.
- **Actions** (`features/interview/actions.ts`): the server chooses questions and scores answers. The browser sends only the words of an answer, which round or job it is for, and form fields; any score or question it sends is ignored.
- **Pages.** `/interviews` (rounds, practice shortcuts and history), `/interviews/[id]` (a round with its checklist), `/jobs/[id]/practice` (what is worth preparing, and start a session), `/practice/[id]` (one question at a time, then results). The application page lists its rounds and adds new ones.

## Analytics
- **Pure services** (`services/analytics`): `funnel` (what stages each application reached, reply rates as "n of m", median wait, applications per week), `insights` (the "why" analysis), `breakdowns` (replies by fit and by resume), `gaps` (measured skill gaps) and `readiness`. All take plain records and return plain results, so they are fully testable without a database.
- **Loader** (`features/analytics/load.ts`): reads the stores through the user's own clients, scores each tracked job against today's profile, and hands the services what they need. A failure on the dashboard's insights panels is contained: the rest of the dashboard still renders.
- **Pages.** `/analytics` (funnel, timing, weekly activity, the "why" panel, breakdowns, practice and outreach), `/gaps` (skills worth learning with the jobs that gain, skills to strengthen, strengths, experience), and the dashboard's Career readiness and Career insights panels.

## Career graph
- **Build** (`services/graph/build.ts`): turns the verified snapshot, the tracked and best-matching jobs and the applications into nodes and edges. Pure and deterministic, with caps on jobs, skills per job and total nodes.
- **Layout** (`services/graph/layout.ts`): a Fruchterman-Reingold force layout with no randomness. Nodes start on rings by type in input order, the person is pinned to the centre, and a final pass keeps every pair a minimum distance apart and inside the canvas.
- **View** (`features/graph/components/graph-view.tsx`): an SVG with filters by kind of item, zoom, selection with a details panel, and a plain table of the same information. Nodes are focusable buttons, shape as well as colour tells kinds apart, and labels are drawn beneath the markers and ignore the pointer so they never block a click.
- **Page.** `/graph` reuses the analytics loader for the profile, applications and ranked jobs.

## Cross-cutting
- **Config**: typed env loader; the app boots with no keys (demo mode), features degrade to explicit "configure" states.
- **Errors**: typed `Result`/error classes; no raw error text to clients; no PII in logs.
- **Rate limiting**: per-user and per-IP on auth, upload, export and deletion, and a per-person cap on every write action (`lib/security/limits.ts`, `action-limits.ts`). Counters live in Postgres through `rate_limit_hit()` when the service role is configured and in memory otherwise.
- **Security headers**: `proxy.ts` mints a nonce per request and sets the Content Security Policy; `next.config.ts` sets the fixed headers. Pages are rendered per request.
- **Account controls**: `services/account` builds the JSON export through the user's own stores, deletes uploaded files and then the auth user, and lists recent security events; `/settings` and `/api/account/export` expose them.
- **Audit**: security-relevant actions write `audit_logs`.
- **Background jobs**: idempotent, resumable steps; Autopilot ends in an approval queue.
- **Providers**: `JobProvider` registry; each adapter documents its terms-of-use basis.

## Environments
Local: Supabase CLI (Docker) + Inngest dev server. CI: GitHub Actions (typecheck, lint, unit, migrate-on-fresh-DB, RLS tests, e2e). Prod: Vercel + Supabase cloud.
