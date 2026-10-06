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

## User data controls
View, edit, export (JSON), delete resume/profile/applications, wipe demo data, delete account (cascade + storage purge).

## Data handling
Resumes stored privately and retained until the user deletes them. Only the minimum data goes to the LLM per task, and the provider and what is sent are disclosed in-app. Users can run without any LLM key.

## Testing
RLS cross-user tests on every table, unauthorized/expired-session route tests, malicious upload corpus (wrong magic bytes, oversized, zip bomb, macro docs), injection tests, rate-limit tests. Run in CI.

## Reporting
Personal portfolio project; report issues via GitHub issues on the repository.
