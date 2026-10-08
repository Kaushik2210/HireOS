# HireOS Database Design

PostgreSQL via Supabase. Versioned SQL migrations in `supabase/migrations` (the Supabase CLI convention), applied in filename order on a fresh DB. Typed queries and the seed script live in `/db`.

## Conventions
- `id uuid primary key default gen_random_uuid()`; `created_at`, `updated_at` (trigger-maintained) on every table.
- Every user-owned table has `user_id uuid not null references auth.users(id) on delete cascade`.
- Soft delete (`deleted_at timestamptz`) on user-authored content that can be restored (applications, resumes, outreach). Hard delete on account deletion cascades everything. In practice resumes, outreach drafts and applications are hard-deleted today; soft delete is Planned.
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
| | `document_versions` | Tailored resume and cover letter versions v1..vN per job: content with claim `source_ref`s, change reasons, integrity result, plain-text body, parent, approval state. |
| Jobs | `companies` | Normalized company records (shared). |
| | `job_sources` | Provider/source registry with terms basis. |
| | `jobs` | Normalized jobs (shared catalog), dedupe key, embedding `vector`. |
| | `job_matches` | Per user x job: strength, sub-scores JSON with inputs, label, gaps, scorer version. |
| Pipeline | `applications` | One per user x job; status enum, resume version, dates, follow-up date, outcome. |
| | `application_events` | Append-only status/change log. |
| | `contacts` | Planned, not built: recruiter names live in notes and outreach drafts for now. |
| | `outreach_drafts` | Copy-only drafts and the user's own sent records (type, channel, subject, body, claim refs, review state). Hard-deleted, not soft-deleted. |
| | `followups` | Not needed: follow-ups are derived from application events and the follow-up date. |
| Interviews | `interviews` | Rounds for an application: dates, notes, prep checklist. |
| | `mock_sessions`, `mock_answers` | Practice sessions with the questions asked, the answers given and their scores. Replaces the planned `interview_questions`: questions are chosen when a session starts and saved with it. |
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
| `..08_jobs` | `job_sources` (reference rows), `companies`, `jobs`, the `search_jobs()` function, and the private-job limit trigger |
| `..09_job_matches` | `job_matches`: the last Application Strength saved per user and job, with RLS (own rows only) and a per-user cap |
| `..10_document_versions` | `document_versions`: numbered tailored resumes and cover letters per user and job, immutable once saved, approvable only after a passing integrity check |
| `..11_outreach_drafts` | `outreach_drafts`: copy-only email and LinkedIn drafts per user and job. Editable while a draft, frozen once approved, and the sent state is only the user's own record |
| `..12_applications` | `application_transitions` (allowed moves), `applications`, `application_events` (append-only), and the functions `change_application_status()` and `add_application_event()` |
| `..13_interviews` | `interviews` (rounds with a prep checklist), `mock_sessions` (practice sessions with the questions asked) and `mock_answers` (answers and their feedback, never edited) |

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

## Jobs (Phase 5)
- `jobs.owner_user_id` is null for the **shared catalogue** (written only by the service role) or a user's id for a job they pasted in themselves (private to them). A CHECK forces private jobs to be `source_key = 'manual'` and never demo data.
- RLS: everyone signed in can read shared jobs plus their own. Users may insert only their own manual jobs, and delete only their own. There is no update policy; shared rows are read-only for users. `companies` and `job_sources` are read-only for users.
- Duplicate protection by partial unique indexes on `fingerprint`: one shared posting per fingerprint, and one per owner for private jobs. The fingerprint (company + title + location after cleaning, see `lib/jobs/keys.ts`) is how the same posting from two sources becomes one row; the other listing is kept in `also_listed_on`.
- A trigger caps each user at 100 private jobs regardless of what the application does.
- Salary is stored as `salary_min`/`salary_max` plus a currency and period, with checks that the range is ordered and that a currency is present whenever pay is.
- `search_jobs()` runs with the caller's rights (`security invoker`), so RLS decides what appears. A query matches when every word appears (case-insensitively) in the title, company, location, skills or description. Filters, sorting (`newest`, `oldest`, `title`) and paging happen in one call, with a clamped page size. Search text is bound as a parameter and compared with `strpos`, never as a pattern, so `%`, `_` and quotes are plain characters. There is deliberately no salary sort: it would compare amounts across currencies.
- `supabase/seed.sql` is generated from the same demo dataset by `npm run seed:generate`, with deterministic ids so reseeding is a no-op. A test fails if the committed file differs from what the generator produces. Production never loads it, so production has no demo jobs.
- The in-memory demo store and `search_jobs()` are held to identical results by a parity suite that runs the same 26 queries against both (on PGlite for SQL).
- Embeddings (`pgvector`) are not added yet. Nothing consumes them until matching, and they will only ever augment retrieval, never the score.
- "Hide demo jobs" for real accounts is a per-user flag in `users.settings` (`hide_demo_jobs`). It filters the shared rows out of that user's search; it never deletes shared data.

## Job matches (Phase 6)
- `job_matches` holds one row per user and job (`unique (user_id, job_id)`): `scorer_version`, `strength` (0-100), `label` (`strong`/`good`/`stretch`/`low`), the full breakdown as JSON (`components` is checked to be an array of exactly seven, `why`, `gaps`, `keywords`, `concerns`, `cap`, `action`), the `profile_hash` it was computed from, and `computed_at`.
- The score is a pure function of a job and the verified profile, so this table is a snapshot, not a source of truth. `profile_hash` (SHA-256 of the scoring inputs) and `scorer_version` tell the app when a snapshot is stale.
- RLS: a user reads, refreshes and deletes only their own rows. Inserts must name themselves and a job they can see (the policy checks visibility through `jobs` RLS, so another user's private job cannot be referenced). Column grants stop a client moving a row to another user or job. Deleting a job or an account cascades. A trigger caps each user at 2000 rows.
- Tested with two users, constraint cases, cascade, and a negative control (loosening the select policy fails the isolation test).

## Document versions (Phase 7)
- One row per saved version, numbered per `(user_id, job_id, kind)` with a unique constraint (`kind` is `resume` or `cover_letter`). `parent_id` links a version to the one it was made from and is set null if that parent is deleted.
- `content` is the whole document with every claim and the item and field it came from; `changes` and `missing` record why items were chosen or left out and which requirements the profile could not support; `verification` is the integrity result at save time (a CHECK requires `ok` to be a boolean); `body` is the plain text used for display, comparison and export (at most 20,000 characters); `profile_hash` and `tailor_version` say what it was built from.
- **Immutable.** Users get insert on a fixed column list and update on only `status` and `approved_at`. A trigger refuses any update to an approved row. Two CHECKs make approval consistent: approved if and only if `approved_at` is set, and never approved when `verification.ok` is not true. Users also cannot insert a row that is already approved.
- RLS: own rows only. Inserts must name the caller, a job the caller can see (through `jobs` RLS) and, if given, a parent the caller owns. Because a policy that reads its own table would recurse, the parent check uses a small `security definer` function (`owns_document_version`) that answers only "is this version mine?" for the calling user.
- Deleting a job or an account cascades. A trigger caps each user at 200 versions.
- Tested with two users, every constraint, the immutability and approval rules, cascades and parent handling, plus negative controls (removing the approval CHECK or the parent check fails a test). The tests also caught a real gap: a `verification` object without `ok` slipped past the first version of the CHECK.

## Outreach drafts (Phase 8)
- One row per draft: `type` (recruiter, hiring manager, referral, alumni, LinkedIn note, follow-up, thank-you), `channel` (`email` or `linkedin`), the optional recipient name and role and the user's own "how you know them" text, `subject` (email only), `body`, the full `content` with each line's source, the `verification` result and the `profile_hash` it was written from.
- **Channel rules in the database.** A LinkedIn note is exactly the `linkedin_note` type, has no subject and fits 300 characters; an email always has a subject. These are CHECK constraints, so no client can store anything else.
- **Review states.** `draft` to `approved` to `sent`, never backwards, with CHECKs tying `approved_at` and `sent_at` to the state and requiring a passing integrity check for anything past `draft`. A trigger lets a draft be edited, freezes `body`, `subject` and `content` once approved (only the move to `sent` is allowed), and refuses any change to a sent draft. A draft cannot be marked sent without approval because both dates are required to be consistent with the state.
- RLS: own rows only. Inserts must name the caller and a job the caller can see, and users cannot insert an already approved or sent row. Column grants allow updating only the words, the check and the review state, never the owner, job, type, channel or recipient. Deleting a job or account cascades, and a trigger caps each user at 300 drafts.
- Tested with two users, every constraint, the state machine, the freeze and sent rules, cascades, and negative controls (removing the passing-check CHECK, or removing the sent-immutability rule, each fails a test).

## Applications (Phase 9)
- `applications`: one per user and job (a partial unique index), with the job's title and company copied so the record survives the job being deleted (`job_id` becomes null). `status` is one of eleven values; `applied_on` is required whenever the status means the person has applied; `follow_up_on`, `notes` (2,000 characters) and links to the person's own resume and cover letter versions are the only fields a user edits directly.
- `application_transitions` holds the allowed moves as data. A test compares it, row for row, with the table the app uses, and walks every pair of statuses through the database function.
- **Moves go through one function.** `change_application_status(id, status, note, date)` locks the row, checks the move against the table, updates the status (setting `applied_on` the first time the person reaches Applied) and writes the event in the same transaction. A trigger refuses every other change to `status` or `applied_on`, for every role including the service role, and users have no update grant on those columns at all.
- `application_events` is append-only: a trigger refuses any update, users have no insert, update or delete grant, and rows leave only when their application is deleted. Events are written by the status function, by `add_application_event()` (which accepts only a note or "I followed up") and by a trigger that logs creation, follow-up date changes and document links. Constraints tie `from_status` and `to_status` to the kind of event.
- RLS: own rows only, in both tables. A new application can only start as discovered, shortlisted, preparing or applied, for a job the user can see. Linking a document requires it to be the user's own, through the same ownership helper used by outreach and documents. Each user is capped at 500 applications.
- The demo store is held to the database by a scripted parity test: the same random sequence of creates, moves, notes and date changes runs against both, and every status, date and event must match.
- Tested with two users, every constraint, the full status matrix, the event log, cascades and the cap, plus negative controls (disabling the status guard, the document-ownership check or a transition row each fails a test).

## Interviews and practice (Phase 10)
- `interviews`: a round for one of the person's applications (`application_id`, cascade on delete). `kind`, `format` and `status` are constrained lists; the date and time are the person's own wall-clock values (a `date` and a `time` with no zone); the prep checklist is a JSON array of at most 30 items. A CHECK refuses a time without a date. Users can edit everything except the owner and the application. A trigger caps each user at 200 rounds.
- `mock_sessions`: a practice session. `questions` holds exactly `question_count` (3 to 10) questions as they were asked, so later changes to the bank cannot alter history; the job's title and company are copied and `job_id` is set null if the job is deleted. A trigger enforces the lifecycle: a session cannot finish until every question has an answer, its `overall` must equal the average of the answers' scores, and a finished session never changes. Users cannot edit the questions, focus or owner. Capped at 200 per user.
- `mock_answers`: one row per answered question, with the question, the answer (at most 3,000 characters), the feedback JSON and its overall score. A trigger accepts answers only in order (position 0, 1, 2, ...), only for an unfinished session of the same user, and never more than the question count. There is no update or delete grant, and a trigger refuses updates for every role; rows go only with their session.
- RLS: own rows only on all three tables. An interview can only attach to an application the user can see (applications are private), a session only to a job the user can see, and an answer only to an open session of the user.
- Tested with two users, every constraint, the answer ordering and finish rules, the cascades and caps, plus negative controls (removing the average check, the ordering check or the application-ownership check each fails a test).

## Analytics (Phase 11)
No new tables. Analytics are computed on read from `applications` and `application_events` (status history and follow-up records), `document_versions` (whether a resume version was linked), `outreach_drafts` (sent count), `mock_sessions` (practice scores), `resumes` (latest health score) and the profile and jobs tables, all through the user's own client, so Row Level Security limits every figure to the person's own data. Nothing is cached or written.
