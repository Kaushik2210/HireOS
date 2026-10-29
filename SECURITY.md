# HireOS Security

Resumes are sensitive PII. Security is a feature, designed in from phase 1.

## Threat model (summary)
| Threat | Mitigation |
|---|---|
| Cross-user data access | RLS on every table, user-scoped client for user reads, server-side authz in every route/action, RLS test suite with two users |
| Malicious upload | Allowlist PDF/DOCX, size cap, magic-byte check, parse in isolated step with timeouts, private bucket, random storage names, never served inline or executed, signed URLs |
| Prompt injection via JD/resume | See AI_ARCHITECTURE.md: delimited data, strict system prompts, no tools, Zod-validated output, validate before store |
| Fabricated claims | Integrity verifier with `source_ref` per claim |
| Secret leakage | Secrets only server-side; `NEXT_PUBLIC_` limited to Supabase URL and anon key; service role only in ingestion/jobs; `.env*` ignored |
| Abuse / cost attacks | Per-user and per-IP rate limits on AI, upload, auth; token and size caps |
| Session issues | Supabase Auth cookies via SSR helpers, expiry handling and redirect, CSRF-safe server actions, secure/httpOnly cookies |
| XSS | React escaping, no `dangerouslySetInnerHTML` for external text, strict CSP, sanitized rendering of JD text |
| SSRF via job/URL input | Provider fetches only from allowlisted hosts; no user-supplied URL fetching server-side |
| Log leakage | No resume/JD/PII content in logs; redaction helper; audit logs store action + ids only |
| Unauthorized automation | No scraping against ToS, no LinkedIn automation, no CAPTCHA bypass, no silent submission |

## Controls
- **AuthN/Z**: every route and server action starts with session resolution; authorization checks ownership by `userId`; RLS as backstop.
- **Validation**: Zod on every input and every model output.
- **Headers**: CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame protections, HSTS in production.
- **Audit**: login events, uploads, exports, deletions, status overrides, key changes.
- **Dependencies**: lockfile, automated advisory checks in CI.

## Implemented in Phase 2 (authentication)
- Default-deny route protection in `proxy.ts`, re-verified server-side with `getUser`.
- Zod validation on client and server; password 10-72 chars with a letter and a number; Supabase leaked-password protection errors are surfaced.
- No account enumeration on sign-in, sign-up or reset; identical responses and messages.
- Open-redirect protection on every `next` value.
- Per-IP and per-email rate limits on sign-in, sign-up and reset (shared across instances since Phase 13).
- Audit events for sign-in, failure, sign-up, sign-out, reset request and password change, with no emails or credentials, in an append-only table.
- A backend outage is reported as unavailable, not as bad credentials.
- Added in Phase 13: CSP and security headers, sign out everywhere, account deletion. Two-step sign-in was added afterwards (see below).

## Implemented in Phase 3 (profile)
- RLS on all eight profile tables with two-user isolation tests; least-privilege column grants.
- Only `http(s)` links are accepted (client, server and database), so a stored `javascript:` URL can never become a link. External links open with `rel="noopener noreferrer"`.
- Server actions validate the section name and item id (UUID) before use, and ownership is enforced both in code and by RLS.
- Per-section item limits bound storage and later prompt size.
- Profile text is rendered by React (escaped); it is treated as untrusted when it later reaches an LLM.
- Demo sandboxes are isolated per visitor and cannot reach real accounts.

## Implemented in Phase 4 (resume upload and parsing)
Uploads are untrusted input and are treated as hostile until proven otherwise.
- **Type by content.** The extension must agree with the magic bytes (`%PDF-` or ZIP). Executables, HTML and text renamed to `.pdf`/`.docx` are rejected. Legacy `.doc`/`.rtf`/`.odt` get guidance rather than a parse attempt.
- **Active content.** PDFs with `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia` or `/XFA` are rejected. The scan skips binary stream bodies (to avoid false positives) and pdf.js then checks structurally for JS actions and attachments, which also catches dictionaries hidden in compressed object streams. Encrypted PDFs are rejected. pdf.js runs with `isEvalSupported: false`.
- **DOCX.** Macro (`vbaProject.bin`), ActiveX and embedded-object parts are rejected. A central-directory check enforces entry-count, total-size, per-entry-size and compression-ratio limits before anything is inflated (decompression-bomb defense). Only `word/document.xml` and headers are ever inflated, with a size cap. Text is read by a tokenizer; no XML parser runs, so external entities are never resolved.
- **Budgets.** 4 MB upload, 10 pages, 100,000 characters, 15 s per file, 15 resumes per user.
- **Names and paths.** Display names are sanitised (directories, control characters and symbols stripped, length bounded) and are never used in a path. Storage paths are generated server-side as `{user_id}/{resume_id}.ext` and enforced by a CHECK constraint and by storage policy.
- **Storage.** Private bucket with size and MIME limits; per-user folder policies; no update policy. Originals are never served from the app's origin: downloads redirect to a 60-second signed URL, so an uploaded document can never execute in the app's context.
- **Endpoint hardening.** Same-origin check (Origin, falling back to Sec-Fetch-Site) because this is a cookie-authenticated route outside server actions; JSON 401 for signed-out API calls; `Cache-Control: no-store` and `nosniff`; per-user and per-address rate limits with `Retry-After`; generic error messages that never echo file contents or internals.
- **Privacy.** In demo mode the original file is discarded after parsing and only the analysis is kept in server memory. Resume text and parse results are never logged. Extracted text is stored only in the user's own row.
- **Integrity.** Parsed items are unconfirmed proposals; nothing from a resume is verified or usable in generated output until the user confirms it, and confirming requires an explicit second step for bulk confirmation.
- **Tested** with real PDF and DOCX files and hostile variants (scripts, encryption, macros, embeddings, ZIP bombs, disguised executables, traversal-style names, injection text) in unit and end-to-end tests.

Known limits: parsing runs in the request process (bounded, but a pathological file can still use CPU for up to the timeout; a worker or separate service is the next step); there is no antivirus scan; multipart bodies are buffered by the platform before the handler sees them, so Content-Length is checked first but a chunked body without one is bounded only by the platform limit; scanned or image-only PDFs are detected as unreadable, and there is no OCR.

## Implemented in Phase 5 (jobs)
- **Job text is untrusted data.** Markup is stripped before storage, script and style bodies are dropped, control characters (NUL, which Postgres cannot hold, and others) are removed from every field, and the result is only ever rendered as text by React, never as HTML. Tests run scripts, event-handler images, double-escaped markup and instruction-like text through the full path and in the browser, and assert nothing executes.
- **Links.** Apply links are canonicalised to plain http(s) with credentials, fragments and tracking parameters removed; `javascript:`, `data:` and other schemes never become an `href`, and the database re-checks the same rule. External links open with `rel="noopener noreferrer"`. Demo links use the reserved `.example` TLD and cannot reach a real site.
- **No fetching.** Nothing in the app fetches a URL on a user's behalf: jobs are added by pasting text. That removes server-side request forgery from this feature entirely.
- **Search input.** Filters come from the URL through a parser that never throws and ignores each invalid value on its own, strips control characters, and bounds length. Text is passed to SQL as a bound parameter and compared with `strpos`, so it cannot act as a pattern or as SQL. Page size is clamped in the database function.
- **Row Level Security.** Shared jobs are readable by any signed-in user and read-only for them; private jobs are visible and deletable only by their owner; companies and sources are read-only. A CHECK ties private jobs to the manual source, a trigger caps them at 100 per user, and column-level grants stop clients setting `is_demo`, `company_id` or the history fields. All covered by two-user tests, plus a negative control that broke the policies and was caught.
- **Honest sourcing.** No third-party job feed is enabled; see ROADMAP.md.

## Implemented in Phase 6 (matching)
- **Job text stays data.** The scorer reads parsed fields (skills, years, level, location) and never executes or follows text from a posting. Generated explanations are templates over those fields, so instruction-like text in a description cannot reach a result (tested: an injected posting scores identically to a clean one and appears nowhere in the output).
- **No unsupported claims.** Only confirmed profile items are scored or cited, and a test checks that every cited `source_ref` is a real verified item. Missing requirements are stated as missing, never papered over.
- **No outcome predictions.** Wording is checked by test: nothing says probability, chance, odds, guarantee or that anyone will be hired or interviewed.
- **Row Level Security** on `job_matches`: own rows only, inserts must reference a visible job, column grants stop re-parenting rows, and a negative control proved the isolation test fails when the policy is loosened.
- **Stored results are re-validated** with the same Zod schema on read; a row that no longer fits is treated as absent.
- **Bounded work.** Ranking is capped at 500 jobs per request and saved matches at 2000 per user.

## Implemented in Phase 7 (resume optimizer)
- **No invented claims.** Documents are built only from confirmed profile items, each line carries the item and field it came from, and an independent verifier re-checks every line (exact wording, named skills, numbers, dates) before a version can be approved. Edited cover letters are checked against the whole verified profile. The tests tamper with documents and expect blocks, and a negative control proves they fail when the verifier is disabled.
- **The server builds the content.** Save actions accept only a job id, a list of item keys to leave out (strictly patterned) or the user's letter text (length-bounded). They never accept document content, so a forged request cannot plant a claim.
- **Job text is data.** The posting's title and company appear verbatim in a letter's opening line and nowhere else; instruction-like text in them is rendered as text and changes nothing (tested with injection strings, including in the resume path).
- **Approval is a review decision, not an action on the world.** It sends nothing. Approved versions are immutable in the database, and the database refuses to approve a version whose check failed.
- **Row Level Security** on `document_versions`: own rows only, inserts must reference a visible job and an owned parent, column grants limit updates to the review state, and a `security definer` helper that only answers "is this version mine?" avoids policy recursion. Two-user tests plus negative controls.
- **Export is user-driven.** Copy and download happen in the browser from the stored text; there is no email, upload or share path.

## Implemented in Phase 8 (outreach)
- **No automation, by construction.** There is no code path that connects to LinkedIn or a mail service, fetches a recipient's profile, sends a message, or schedules one. A draft is text for the person to copy. "I sent this myself" records their own action and triggers nothing.
- **Drafts say only what is true.** Generated lines come from verified items, the posting's title and company, and what the person typed. Applied and spoke-with statements need an explicit tick. Edits and every typed field are re-checked for skills and numbers the profile lacks, and a flagged draft cannot be approved.
- **Typed text is untrusted.** Names, roles and connection text have control characters stripped and lengths bounded, are rendered as text, and are tested with injection strings. The create and edit actions accept only the documented fields: extra content from the browser is ignored, so a forged request cannot plant wording or a status.
- **No personal data in URLs.** Recipient details travel in the request body only, and pages are addressed by ids.
- **Row Level Security** on `outreach_drafts`: own rows only, inserts must reference a visible job and cannot arrive already approved or sent, column grants stop re-parenting a draft, and database triggers freeze approved and sent drafts. Two-user tests plus negative controls.

## Implemented in Phase 9 (application CRM)
- **Nothing is submitted or sent.** A status records what the person says happened. There is no code path that applies to a job, contacts an employer, or reads a mailbox; "Open application" links to the employer's own page.
- **History cannot be rewritten.** Status moves are validated against an allowed-move table inside one database function, the event log is append-only for every role, and direct status updates are blocked by a trigger even for the service role. A refused move leaves no event behind.
- **Typed text is untrusted.** Notes are length-bounded with control characters removed, rendered as text, and never interpreted. Every action validates its input with Zod and checks ownership server-side; the browser cannot set a status, an event or a date outside the allowed rules.
- **Linked documents must be the person's own.** The action checks kind, owner and job, and the database policy independently requires ownership, so a forged id cannot attach someone else's resume.
- **Row Level Security** on both tables with explicit column grants, a cap per user, and two-user tests plus negative controls.
- **Demo data is labelled and removable.** Sample applications exist only in the demo sandbox, carry a badge, and clear without touching what the visitor added.

## Implemented in Phase 10 (interview hub)
- **Practice is private.** Sessions, answers and feedback are visible only to their owner (RLS plus server-side ownership checks) and are never shared, exported or sent to any service. Nothing is scored by a model.
- **The server decides, the browser reports.** Questions are chosen and answers scored on the server from the stored question and the verified profile. A forged request cannot supply a score, a question, a status or an application it does not own: actions validate their input with Zod, check ownership, and ignore extra fields. A finished session cannot be changed and answers cannot be edited, enforced by database triggers for every role.
- **Honesty is built in.** The feedback checks whether an answer claims skills the verified profile does not hold, lists that first, and treats an honest "I haven't used it yet" as the right answer to a question about a skill the person lacks.
- **Typed text is untrusted.** Round names, interviewer, notes, checklist items and answers are bounded, stripped of control characters, rendered as text and tested with injection strings. The job's title and company appear only inside the question text that quotes them.
- **Bounded.** Per-user caps on rounds and sessions, a checklist limit, an answer length limit, and a fixed number of questions per session.

## Implemented in Phase 11 (analytics)
- **Read-only and private.** Analytics write nothing and add no tables. Every figure comes from the person's own rows through their own client (RLS applies) and is shown only to them.
- **No outcome predictions.** There is no hiring probability anywhere. Findings are hedged, list their evidence, and carry a caveat that they are patterns rather than causes; small samples are labelled. A test scans the output for outcome language.
- **Gap analysis cannot invent skills.** The simulated skill exists only inside the calculation, is never saved, and the page tells the person to build something real and add the skill once it is true. A test checks that the profile passed in is left untouched.
- **Bounded work.** The gap analysis scores at most 30 jobs and 12 candidate skills, the tracked-job read is capped, and the activity read is capped at 2,000 events.
- **Found and fixed during this phase:** the demo application store seeded its sample data lazily but let a second concurrent read return before the seeding finished, so a first visit could show applications without their history. Reads now share one seeding promise, with a regression test that fails without the fix.

## Implemented in Phase 12 (career graph)
- **Read-only and private.** The graph writes nothing and adds no tables. It is built from the person's own rows through their own client and shown only to them.
- **Verified items only.** Unconfirmed profile items never appear, and a skill a job asks for that the person lacks is drawn as a separate gap node joined to the job, never to the person. Tests cover both.
- **Untrusted text is plain text.** Job titles and company names appear as SVG text and in the details panel, never as markup; there is no `dangerouslySetInnerHTML` and the node ids are derived values, not user input. Links go only to the app's own pages.
- **Bounded.** At most 12 jobs, 6 required skills per job and 160 nodes are drawn; the layout is a fixed number of iterations.

## Implemented in Phase 13 (security hardening)
- **Content Security Policy with a per-request nonce** (`proxy.ts`, `lib/security/headers.ts`). Scripts run only if they carry the nonce, with `'strict-dynamic'`; no `unsafe-inline` or `unsafe-eval` in production. `object-src`, `frame-src` and `frame-ancestors` are `'none'`, `base-uri` and `form-action` are `'self'`, and `connect-src` is `'self'` because every Supabase call is made on the server. The one relaxation is `style-src-attr 'unsafe-inline'` for inline style attributes (progress-bar widths), which cannot run script. Every page is rendered per request so the nonce can be applied. A browser test loads every main page and the command palette against a production build and asserts that nothing is blocked; it caught the validation library probing `eval`, which is now switched off in the browser (`instrumentation-client.ts`).
- **Fixed headers** (`next.config.ts`): `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (camera, microphone, geolocation, payment and others off), cross-origin opener and resource policies, and HSTS in production.
- **Shared rate limits.** `rate_limit_hit()` keeps one counter per key in Postgres, callable only by the service role, so every instance agrees and a restart no longer resets the counts. Keys are hashed before they leave the process, so no email address or IP address is stored. If the database cannot be reached the limiter falls back to per-instance counters instead of refusing everyone. Applies to sign-in, sign-up, reset, uploads, export and deletion.
- **Per-person limits on every write action.** 180 changes a minute and 60 builds an hour (document versions, drafts, practice, imports). Generous for a human, there to stop a script. The refusal message does not reveal the numbers.
- **Privacy & Data page.** Download everything as one JSON file (built through the person's own stores, so Row Level Security limits it to their rows; POST only, same-origin checked, no-store, five an hour); sign out of every device; see recent security events; delete the account. Deletion needs a typed confirmation, only ever acts on the signed-in person, removes uploaded files first and leaves the account untouched if that fails, then deletes the auth record, which cascades to every table. Audit rows stay with the user detached. Verified against a real local Supabase.
- **Audit.** New events for export, deletion and sign-out everywhere. Still only an action, a time and an id; never an email, password or content.
- **Source-level guards** (`tests/unit/security-static.test.ts`): no `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML` or `document.write`; only error-level logging; the process environment read in one module; only the two Supabase values are browser-visible; the service-role key is used in one file and its client imported from three; client components import no server code; every server action resolves the user, is rate limited and validates its input; every changing route checks the origin and answers only signed-in callers. Negative controls proved each fails when the rule is broken.
- **Auth callback** redirects to the configured `APP_URL` rather than the request's own origin.
- **Dependencies.** `npm audit --omit=dev` reports no vulnerabilities.

Known limits: the client address comes from `X-Forwarded-For`, which is only trustworthy behind a proxy that sets it (hosted platforms do), so per-address limits can be dodged by someone reaching the server directly; per-email limits still apply. Two-step sign-in, a recent-sign-in check before deletion, email notices for security events and a scanner for uploaded files are not built. Counters are fixed windows, so a burst at a window edge can briefly double the allowance. The Supabase Auth settings that matter (confirm email, leaked-password protection, redirect allow-list) are dashboard settings the app can only document, not enforce.

## Two-step sign-in
- **What it is.** An optional authenticator-app (TOTP) code after the password, built on Supabase MFA. Set up from Privacy & Data: scan a picture or type the key, then enter the first code to confirm. Turning it off needs a current code.
- **Where it is enforced.** Everywhere the app resolves a person (`getSessionState` in `lib/auth/session.ts`): pages, server actions and API routes alike. An account with a confirmed factor whose session is still at the first assurance level is "second step": every page sends it to the code screen, actions and routes treat it as signed out, and only the code page and sign-out work. The page it was heading for (a password-reset link, say) is carried through the code screen; the proxy sets that path itself, so a request cannot choose it.
- **Guessing.** Eight code attempts per account per fifteen minutes, shared across instances. Wrong codes are audited, without the code.
- **Enforced by the database as well as the app.** Migration 16 adds `public.second_step_satisfied()` (true when the token carries the second assurance level, or when the account has no confirmed authenticator) and a RESTRICTIVE `two_step_gate` policy on every table that holds a person's data, plus one on the private resume files in storage. Restrictive policies are ANDed with the existing ownership rules, so nothing that decides who owns what was touched. Someone who has only the password and asks Supabase directly with a first-level token gets empty results and refused writes. The two functions that run with their owner's rights (`change_application_status`, `add_application_event`) skip row level security, so they check the second step themselves. A test fails if a table with a `user_id` or `owner_user_id` column is added without the policy. Negative controls: making the check always true fails five tests; leaving one table out fails the coverage test.
- **Verified against the real service.** The live suite (`tests/live/mfa.live.test.ts`, run in CI on a local Supabase stack) enrols an authenticator, checks that the sign-in response and a fresh read both carry the factor, that a password alone gives only the first level, that a wrong code does not raise the session and a right one does, that only a raised session can remove the factor, and that the database returns nothing and refuses writes and file listings to a first-level token until the code is entered.
- **Limits.**
  - **There are no recovery codes.** If someone loses both the device and the setup key, HireOS cannot restore access; the factor has to be removed by whoever runs the Supabase project. The setup screen says so.
  - Authenticator (TOTP) only: no SMS, passkeys or hardware keys.
  - A hosted project needs TOTP turned on in its Auth settings; the local config in the repository already has it.

## User data controls
View, edit, export (JSON), delete resume/profile/applications, wipe demo data, delete account (cascade + storage purge). All built; see Privacy & Data above.

## Data handling
Resumes stored privately and retained until the user deletes them. Only the minimum data goes to the LLM per task, and the provider and what is sent are disclosed in-app. Users can run without any LLM key.

## Testing
RLS cross-user tests on every table, unauthorized/expired-session route tests, malicious upload corpus (wrong magic bytes, oversized, zip bomb, macro docs), injection tests, rate-limit tests. Run in CI.

## Reporting
Personal portfolio project; report issues via GitHub issues on the repository.
