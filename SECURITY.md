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
- Per-IP and per-email rate limits on sign-in, sign-up and reset (in memory, per instance; shared store planned for Phase 13).
- Audit events for sign-in, failure, sign-up, sign-out, reset request and password change, with no emails or credentials, in an append-only table.
- A backend outage is reported as unavailable, not as bad credentials.
- Not yet done: CSP and security headers, MFA, account deletion, session management UI (Phase 13).

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

## User data controls
View, edit, export (JSON), delete resume/profile/applications, wipe demo data, delete account (cascade + storage purge).

## Data handling
Resumes stored privately and retained until the user deletes them. Only the minimum data goes to the LLM per task, and the provider and what is sent are disclosed in-app. Users can run without any LLM key.

## Testing
RLS cross-user tests on every table, unauthorized/expired-session route tests, malicious upload corpus (wrong magic bytes, oversized, zip bomb, macro docs), injection tests, rate-limit tests. Run in CI.

## Reporting
Personal portfolio project; report issues via GitHub issues on the repository.
