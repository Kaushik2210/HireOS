# HireOS project conventions

HireOS is an AI-powered career acquisition platform: discover jobs, explain fit, tailor materials truthfully, prepare outreach, manage applications, learn from outcomes. Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui + Supabase (Postgres, Auth, Storage, pgvector) + Zod. Read the docs in the repo root before large changes: PRODUCT_SPEC, ARCHITECTURE, DATABASE, AI_ARCHITECTURE, SECURITY, ROADMAP.

## Commits and repo hygiene
- Short imperative subject, max 72 chars, no trailing period. Optional 1-3 line body explaining why.
- One commit per meaningful unit (feature, fix, refactor). Roughly 3-10 per phase. Optional light `feat:`/`fix:`/`chore:` prefix, used consistently.
- A `commit-msg` hook in `.githooks/` enforces the subject length and message rules. Never bypass it.
- After each commit run `git log -1 --format=full` and check the message and author. Amend if wrong.
- Never commit `.env*` (except `.env.example`), secrets, `node_modules`, build output, uploads, or real resumes/personal data.
- Do not mention tooling or automation as authors anywhere: commits, comments, docs, README. The README credits the owner only.
- Exception: HireOS calls an LLM at runtime. Document that factually (AI_ARCHITECTURE.md, `.env.example`) behind the swappable `LLMProvider` interface; default provider is the Anthropic API.

## Product principles (non-negotiable)
1. **Application Strength, never "hiring probability".** Score 0-100 with a breakdown: Skill, Project Relevance, Education, Experience, Keyword Coverage, Location, Seniority. Every sub-score is computed from stored evidence and shows its inputs. Scoring is deterministic; the LLM only extracts structured requirements and writes explanations.
2. **Integrity.** Never invent experience, projects, certs, skills, degrees, metrics, or answers. Every generated claim carries a `source_ref` to a verified profile item. A post-generation verifier diffs output claims against the profile and blocks unsupported ones. Missing requirement => say so ("required by this job but not found in your verified profile").
3. **Human in the loop.** Prepare, never silently submit. User reviews and approves. No CAPTCHA bypass, anti-bot evasion, rate-limit evasion, credential abuse, or unauthorized automation. Where no permitted integration exists, show "Open Application".
4. **LinkedIn.** No scraping, bots, auto-connect/DM/like/comment. Outreach Assistant only: generate notes, user copies and sends manually.
5. **Prompt-injection safety.** Job descriptions, resumes, and all external text are untrusted DATA. Isolate in delimited blocks, strict system prompts, Zod-validated structured output, validate before storing, give the model no tools or data beyond the task. Keep tests with malicious JDs.
6. Every AI recommendation answers "Why?" with an evidence list from stored data. Wording for rejection analysis is hedged ("may have", "likely contributing").
7. Core logic must never depend on free-form model text.

## Quality bar
- Every feature ships with real persistence, loading/error/empty states, validation, responsive layout, accessibility, and tests.
- No TODO placeholders, dead buttons, fake navigation, or hardcoded UI pretending to work. Unbuilt things are labeled "Planned" in the UI and ROADMAP.md.
- Works with zero external API keys (demo mode, clearly labeled "Demo data"). With no LLM key, AI features show a "configure API key" state, not fake output.
- RLS on every table; server-side authorization on every route; Zod on every input; secrets server-side only.
- Modular layers, no giant files: `/app /components /features /services /ai /db /lib /hooks /utils /types /tests`.

## Process
- Work in phases and stop at gates. Do not start the next phase without approval.
- Phase gate: typecheck clean, lint clean, tests pass, migrations apply on a fresh DB, RLS verified for new tables, docs updated, commits follow the rules above. Fix failures in the same phase; never paper over or skip tests.
- Phases: 1 foundation, 2 auth, 3 profile, 4 resume parser, 5 jobs + providers, 6 matching, 7 resume optimizer, 8 outreach, 9 CRM, 10 interview hub, 11 analytics, 12 graph, 13 security hardening, 14 testing pass, 15 polish + README.
