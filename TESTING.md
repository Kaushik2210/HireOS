# Testing HireOS

Five layers, from fast and broad to slow and real. `npm run check` runs the static checks
and the first two layers.

| Layer | Command | What it proves | Needs |
|---|---|---|---|
| Static | `npm run typecheck`, `npm run lint`, `npm run format:check` | Types, rules, style | nothing |
| Unit and component | `npm test` | Logic, actions, routes, stores against fakes, hostile-input handling | nothing |
| Database | `npm test` (`tests/db`) | Every migration on a fresh database, Row Level Security, triggers, grants | nothing (PGlite, in memory) |
| End to end | `npm run test:e2e` | Real pages in a real browser against a production build, accessibility, the Content Security Policy | Playwright browsers |
| Live | `npm run test:live` | The Supabase store classes against a real local Supabase, as two real accounts, including storage | Docker, `npx supabase start`, `.env.local` |

## What lives where

- `tests/unit`: one file per feature area. Server actions are called directly with the session
  mocked, so ownership, validation, rate limits and error messages are checked without a browser.
- `tests/unit/security-static.test.ts`: reads the source and fails if a rule the security model
  rests on is broken (no raw HTML injection, secrets only on the server, every action resolves
  the user, limits its rate and validates its input, every changing route checks the origin).
- `tests/unit/robustness.test.ts`: feeds nine text-handling functions hostile input (unclosed
  tags, long unbroken words, thousands of blank lines, half entities) and checks that they never
  throw, that their cost grows in proportion to the input, and that a few properties hold for
  any text. This is where two quadratic-time bugs were found, in the markup stripper and in the
  email and salary patterns.
- `tests/db`: the schema on PGlite. `rls-structure.test.ts` checks rules that must hold for
  every table and function, so a new one cannot skip them; the per-table files check behaviour
  with two users. Negative controls (loosen a policy, watch the test fail) are recorded in the
  per-phase notes in SECURITY.md.
- `tests/e2e`: Playwright against `next start`. Three projects: desktop and mobile in demo mode,
  and a server with auth enabled but no reachable backend (routing, validation, outage states).
  `a11y.spec.ts` runs axe (WCAG 2.0/2.1 A and AA) on every main page on both screen sizes.
  `settings.spec.ts` loads every main page under the production policy and fails on any blocked
  script or style.
- `tests/live`: opt-in. It refuses to run unless the Supabase address is local, so it can never
  create test accounts on a hosted project. It creates its own accounts and removes them.

## Running the live suite

```bash
npx supabase start
npm run test:live
```

Keys are read from `.env.local` (see SUPABASE_SETUP.md). Stop the stack with
`npx supabase stop`.

## What is not covered

- **Real email.** Confirmation and reset links are not sent in any test; the local stack's mail
  catcher is not wired in.
- **Screen readers and keyboard-only use.** Axe finds roughly a third of accessibility problems.
  Focus order and the wording read aloud still need a person.
- **The remaining Supabase stores** (documents, outreach, interviews, practice, matches) are
  covered against fakes and PGlite, but not yet by the live suite.
- **Load.** Nothing measures behaviour with many users at once.
- **Visual regressions.** There are no screenshot comparisons.
