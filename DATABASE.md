# HireOS Database Design

PostgreSQL via Supabase. Versioned SQL migrations in `supabase/migrations` (the Supabase CLI convention), applied in filename order on a fresh DB. Typed queries and the seed script live in `/db`.

## Conventions
- `id uuid primary key default gen_random_uuid()`; `created_at`, `updated_at` (trigger-maintained) on every table.
- Every user-owned table has `user_id uuid not null references auth.users(id) on delete cascade`.
- Soft delete (`deleted_at timestamptz`) on user-authored content that can be restored (applications, resumes, outreach). Hard delete on account deletion cascades everything.
- `is_demo boolean not null default false` on seedable tables so demo data can be wiped without touching real data.
- Enums for closed sets (application status, work mode, job type); CHECK constraints for ranges (scores 0-100).
- Indexes on every FK and on common filters (`user_id, status`, `user_id, created_at`).

## Tables
| Group | Table | Purpose |
|---|---|---|
| Identity | `users` | App-level mirror of `auth.users` (settings, onboarding state). |
| | `profiles` | Normalized candidate profile, preferences, salary, work mode. |
| | `career_goals` | Target roles, locations, level, timeline. |
| Profile data | `skills` | Skill per user with type, level, evidence refs. Canonical skill catalog is a shared read-only table `skill_catalog`. |
| | `projects`, `certifications`, `experiences` | Verified profile items; the only legal sources for generated claims. |
| Resume | `resumes` | Uploaded file metadata (storage path, hash, parse status, health scores). |
| | `resume_versions` | Tailored versions v1..vN, content, `job_id`, parent, claim `source_ref`s, approval state. |
| Jobs | `companies` | Normalized company records (shared). |
| | `job_sources` | Provider/source registry with terms basis. |
| | `jobs` | Normalized jobs (shared catalog), dedupe key, embedding `vector`. |
| | `job_matches` | Per user x job: strength, sub-scores JSON with inputs, label, gaps, scorer version. |
| Pipeline | `applications` | One per user x job; status enum, resume version, dates, follow-up date, outcome. |
| | `application_events` | Append-only status/change log. |
| | `contacts` | People tied to companies/applications. |
| | `outreach` | Drafts and sent-by-user records (type, channel, body, claim refs). |
| | `followups` | Due dates and drafts for stale applications. |
| Interviews | `interviews` | Rounds, dates, notes, prep checklist. |
| | `interview_questions` | Generated/mock questions, answers, scores. |
| Intelligence | `skill_gaps` | Per user x target: required vs have, severity, evidence job ids. |
| | `career_recommendations` | Recommendations with evidence list and status. |
| System | `analytics_events` | Product and funnel events. |
| | `audit_logs` | Security-relevant actions (no PII payloads). |

## Shared vs private
- **Private** (user_id scoped): everything except the below.
- **Shared read-only**: `companies`, `jobs`, `job_sources`, `skill_catalog` readable by authenticated users; writes only via service role (ingestion). Demo jobs are shared with `is_demo = true`.

## Status transitions
`applications.status` changes only through a SQL function / service that validates against an allowed-transition table and writes an `application_events` row in the same transaction. Direct status updates are blocked by trigger.

## Row Level Security
- RLS enabled on every table, no exceptions; default deny.
- Private tables: `using (user_id = auth.uid())` and `with check (user_id = auth.uid())` for select/insert/update/delete.
- Child tables without direct `user_id` (if any) check ownership through the parent via `exists`.
- `audit_logs`: insert via service role only; users may read their own.
- Service role used only server-side, in ingestion and background jobs, and never for user-initiated reads.
- Tests: pgTAP/SQL tests create two users and assert cross-user select/update/delete return zero rows on every table; CI fails if any table lacks RLS (checked via `pg_class.relrowsecurity`).

## Vectors
`pgvector` embeddings on `jobs` and optionally profile items for semantic search; HNSW index. Embeddings only augment retrieval; they never feed the score.

## Storage
Private bucket `resumes`, path `{user_id}/{resume_id}`; storage policies mirror table RLS; access via short-lived signed URLs.

## Data controls
Export (JSON of all user rows), delete resume/profile/applications, delete account (cascade + storage purge). Demo wipe deletes `is_demo` rows for the user.

## Implemented so far
| Migration | Contents |
|---|---|
| `..01_helpers` | `set_updated_at()` trigger function |
| `..02_users` | `users` (settings, onboarding state; email stays in Supabase Auth), RLS (own row), column-level update grants, `handle_new_user` trigger on `auth.users` |
| `..03_audit_logs` | `audit_logs`, RLS (read own), service-role-only writes, append-only trigger (only the account-deletion detach is allowed) |
| `..04_profile_and_goals` | `profiles`, `career_goals` (one row per user; preferences, salary, goals) |
| `..05_profile_collections` | `education`, `experiences`, `projects`, `certifications`, `skills`, `achievements`; every row has `source` (`manual`/`resume`) and `confirmed` |
| `..06_resumes` | `resumes`: file metadata, SHA-256, extracted text, `parsed` and `health` JSON; immutable; `storage_path` constrained to `{user_id}/{id}.ext` |
| `..07_resume_storage` | Private `resumes` bucket (4 MB, PDF/DOCX only) and `storage.objects` policies: own folder only, exact `{uuid}/{uuid}.pdf|docx` names, no update |

Grants are explicit and least-privilege (`revoke all` from `anon`/`authenticated`, then grant what is needed), so correctness does not depend on Supabase default privileges.

## Verifying migrations and RLS
`tests/db` applies every migration to a brand-new in-process Postgres (PGlite, real Postgres compiled to WASM) behind a small `auth` shim (`tests/db/auth-shim.sql`: `auth.users`, `auth.uid()`, and the `anon`/`authenticated`/`service_role` roles). Tests act as each role and user, and a generic test fails if any table in `public` lacks RLS. This runs in `npm test` with no Docker.
Limits: it is not a Supabase stack. GoTrue, PostgREST, storage policies and extensions such as pgvector are not exercised. A real-stack check (`supabase db reset` plus the same assertions) is planned for CI once a Supabase project exists.

## Profile data model (Phase 3)
- Singleton tables (`profiles`, `career_goals`) are keyed by a unique `user_id`. Collection tables hold many rows per user.
- **Verified items.** `source` records who produced an item; `confirmed` records whether the user vouches for it. Only confirmed items count as verified, and only verified items may back a generated claim. Resume-parsed items (Phase 4) arrive as `source = 'resume'`, `confirmed = false`. Editing an item confirms it.
- Least-privilege grants: `id`, `is_demo` and timestamps are never client-writable; `user_id` is insert-only; `source` cannot be rewritten after insert.
- Constraints mirror the Zod schemas as defense in depth: text lengths, `http(s)` links only, date ordering, array caps, enum values, case-insensitive unique skill names per user.
- Dates are `date` columns holding the first of the month; the app exchanges `YYYY-MM`.
- The skills catalog (canonical names, categories, aliases) lives in code at `lib/skills/catalog.ts`, not in a table, so normalization is versioned with the code and works with no database. This replaces the `skill_catalog` table sketched earlier.
- Soft delete is not used for profile items: deleting means deleting, which is what the user data controls promise.

## Resumes (Phase 4)
- `resumes` rows are immutable (no update policy or grant): re-analysis creates a new row. Users can read and delete their own; deleting also removes the stored file.
- A CHECK constraint ties `storage_path` to `{user_id}/{id}.{ext}` matching the content type, so a row can never point at another user's object or a traversal path.
- `UNIQUE (user_id, sha256)` recognises a re-upload of the same file for one user without blocking two users who happen to upload identical files.
- `parsed` holds the parser output (already valid profile items, re-validated with Zod on read) and `health` the scored breakdown. `parser_version` allows re-parsing later.
- Storage policies are tested on the PGlite shim, which now includes a minimal `storage` schema (`buckets`, `objects` with RLS, `foldername()`).
