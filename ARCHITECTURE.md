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

## Cross-cutting
- **Config**: typed env loader; the app boots with no keys (demo mode), features degrade to explicit "configure" states.
- **Errors**: typed `Result`/error classes; no raw error text to clients; no PII in logs.
- **Rate limiting**: per-user and per-IP on AI and upload endpoints.
- **Audit**: security-relevant actions write `audit_logs`.
- **Background jobs**: idempotent, resumable steps; Autopilot ends in an approval queue.
- **Providers**: `JobProvider` registry; each adapter documents its terms-of-use basis.

## Environments
Local: Supabase CLI (Docker) + Inngest dev server. CI: GitHub Actions (typecheck, lint, unit, migrate-on-fresh-DB, RLS tests, e2e). Prod: Vercel + Supabase cloud.
