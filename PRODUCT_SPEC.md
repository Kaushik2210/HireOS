# HireOS Product Spec

**One line:** an AI operating system for getting hired. Not a job tracker: a career command center covering discovery, fit analysis, truthful tailoring, outreach prep, application management, and learning from outcomes.

## Users and inputs
Job seekers (primary persona: students and early-career engineers). Inputs: resume (PDF/DOCX), education, skills, projects, certifications, experience, preferred roles/locations, salary expectations, work preferences, career goals.

## Principles
| Principle | Product behavior |
|---|---|
| Application Strength, not hiring probability | 0-100 score with an itemised, evidence-backed breakdown. No claim to predict outcomes. |
| Integrity | Nothing is invented. Each generated line has a `source_ref`; a verifier blocks unsupported claims and surfaces the gap instead. |
| Human in the loop | Everything is a draft until the user approves. Submission only via permitted methods, otherwise "Open Application". |
| LinkedIn | Message drafting only. User sends manually. |
| Untrusted text | JDs and resumes are data, never instructions. |
| Explainability | Every recommendation shows "Why?" with stored evidence. |

## Modules
1. **Career Profile**: normalized profile (education, grouped skills, projects, certs, experience, achievements, leadership, preferences, goals).
2. **Resume Intelligence**: upload, extraction, section detection, skill normalization; produces profile plus Resume Health (ATS compatibility, skill coverage, impact, readability, structure, keywords).
3. **Job Discovery**: `JobProvider` adapters (public APIs, permitted ATS feeds, demo provider), normalized job model, cross-source dedupe.
4. **Job Match**: Application Strength, breakdown, Why You Match, Missing/Weak areas, label (Strong / Good / Stretch / Low).
5. **Job Intelligence page**: company, role, strength, gaps, keywords, concerns, recommended action.
6. **Resume Tailoring**: pick relevant verified items, propose changes, before/after diff with per-change reasons, approval required, versions v1..vN with compare.
7. **Cover Letter**: job-specific, grounded in real projects, editable.
8. **Outreach**: recruiter / hiring manager / referral / alumni / LinkedIn note / follow-up / thank-you emails. Draft-only.
9. **Application CRM**: Kanban over DISCOVERED, SHORTLISTED, PREPARING, APPLIED, OA, INTERVIEW, FINAL ROUND, OFFER, REJECTED, WITHDRAWN, NO RESPONSE; enforced transitions; every change logged as an event.
10. **Follow-Up Engine**: flags stale applications (default 7 days), drafts follow-ups, never sends.
11. **Interview Hub**: records, prep checklist, generated questions, Mock Interview Mode with six scored dimensions.
12. **Rejection Analyzer**: hedged analysis of JD vs resume vs profile vs notes; updates the development plan.
13. **Career Gap Analyzer**: target role vs skills vs stored market requirements; gap bars; recommendations.
14. **Career Analytics**: funnel, rates, best resume/role/source/location, common gap, trends.
15. **Career Graph**: interactive graph of user, skills, projects, certs, jobs, companies, applications, outcomes.

### Flagship
- **Career Autopilot**: pick role, location, level; pipeline runs in the background (profile analysis, discovery, ranking, scoring, tailoring, cover letter, outreach prep, tracking setup, gaps) and **stops at an approval queue** before any external action.
- **"Why am I not getting interviews?"**: analyzes application history with evidence; degrades gracefully with little data ("Not enough applications yet, here is what we can say so far").

## Scoring (summary)
Weighted sum of seven sub-scores, each deterministic from stored data (details in AI_ARCHITECTURE.md). Weights are configurable and shown in the UI. Labels: Strong >= 80, Good 65-79, Stretch 45-64, Low < 45 (initial thresholds, tunable).

## UX
Dark-first command center (Linear + Vercel + Bloomberg Terminal): dense, restrained glass, sparing accents, accessible, responsive. Dashboard: greeting, career readiness %, pipeline summary, top opportunities, today's actions, insights. Command palette (Ctrl/Cmd+K) for core actions.

## Demo mode
Works with zero keys. 30+ jobs across 10+ companies, multiple candidate profiles, sample applications, analytics history, gaps. "Demo data" badge wherever shown; one-click wipe. No LLM key => explicit "configure API key" state, never fabricated AI output.

## Out of scope (by design)
Auto-submitting applications, LinkedIn automation, scraping against ToS, hiring-probability prediction, CAPTCHA/anti-bot bypass.

## Success criteria for the portfolio
Looks real immediately after setup; engineering story is defensible (explainable scoring, integrity verifier, injection defenses, RLS, provider abstraction); tests demonstrate it.
