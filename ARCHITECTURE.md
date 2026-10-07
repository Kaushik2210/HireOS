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

## Cross-cutting
- **Config**: typed env loader; the app boots with no keys (demo mode), features degrade to explicit "configure" states.
- **Errors**: typed `Result`/error classes; no raw error text to clients; no PII in logs.
- **Rate limiting**: per-user and per-IP on AI and upload endpoints.
- **Audit**: security-relevant actions write `audit_logs`.
- **Background jobs**: idempotent, resumable steps; Autopilot ends in an approval queue.
- **Providers**: `JobProvider` registry; each adapter documents its terms-of-use basis.

## Environments
Local: Supabase CLI (Docker) + Inngest dev server. CI: GitHub Actions (typecheck, lint, unit, migrate-on-fresh-DB, RLS tests, e2e). Prod: Vercel + Supabase cloud.
