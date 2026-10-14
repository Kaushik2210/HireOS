# Connecting HireOS to a real Supabase project

HireOS runs with no setup in demo mode. Follow this to store your own data in Supabase
instead: accounts, profile, resumes, jobs, applications and everything else. It takes about
15 minutes, and the free plan is enough.

Never paste a key into a chat, an issue or a commit. Keys go only into `.env.local`, which git
ignores.

## 1. Create the project

1. Sign in at supabase.com and choose **New project**.
2. Pick a name, a strong database password (save it in a password manager) and the region
   nearest you.
3. Wait for the project to finish setting up.

## 2. Put the keys in `.env.local`

In the dashboard, open **Project Settings, API** (or **API Keys**). Copy these three values:

| `.env.local` variable | Where to find it | Safe to expose? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` public key | Yes (Row Level Security protects the data) |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret key | **No.** Server only. Never commit it. |

Then, in the project folder:

```bash
copy .env.example .env.local
```

Open `.env.local` and fill in the three values. Set `APP_URL=http://localhost:3000`.

## 3. Create the tables

Pick one of the two ways.

**A. SQL Editor (no installs).**

```bash
npm run supabase:bundle
```

This writes `supabase/.temp/setup.sql`. Open the file, copy all of it, and paste it into the
dashboard's **SQL Editor** (New query), then **Run**. Run it once, on a new project.

**B. Supabase CLI.**

```bash
npx supabase login
npx supabase init
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

The project ref is the part of your project URL before `.supabase.co`. `db push` applies the
15 migrations in `supabase/migrations` in order.

## 4. Check the sign-in settings

In **Authentication**:

- **Providers, Email**: enabled. Turn on **Confirm email** if you will share the app with
  anyone else.
- **URL Configuration**: set **Site URL** to `http://localhost:3000`, and add
  `http://localhost:3000/auth/callback` to **Redirect URLs**. When you deploy, add your real
  address too.
- **Passwords**: raise the minimum length to match HireOS (10 or more, the same as HireOS). If your plan offers
  **Leaked password protection**, turn it on.

## 5. Optional: sample jobs

The shared demo job board (41 fictional jobs) is `supabase/seed.sql`. Without it, a real account
starts with an empty job list and you add jobs yourself by pasting them in. To load the samples,
paste the contents of `supabase/seed.sql` into the SQL Editor and run it. Running it twice is
harmless.

## 6. Check it worked

```bash
npm run supabase:check
```

It prints PASS or FAIL for each of these, and never prints a key:

- the project answers and the anon key is accepted;
- every table exists and an anonymous visitor cannot read any of them;
- the private `resumes` storage bucket exists;
- (if the service key is set) whether sample jobs are loaded.

Fix any FAIL using the hint printed under it, then run it again.

## 7. Use the app

```bash
npm run dev
```

Open http://localhost:3000. With the keys set, HireOS no longer shows demo data: you will be
sent to sign up. Create an account yourself, confirm the email if confirmation is on, and sign
in.

Things worth trying once, to confirm each part works against the real service:

1. Create your profile and add a skill.
2. Upload a resume (this uses the `resumes` storage bucket).
3. Add a job by pasting it in, then open it to see Application Strength.
4. Track the job, move it to Applied, then tailor a resume for it.
5. Sign out, sign up a second account, and confirm it cannot see the first account's data.

## If something goes wrong

- **"relation does not exist"** or missing tables: step 3 did not finish. Run it again on an
  empty project.
- **Sign-up emails never arrive**: the free plan's built-in mail is limited to a few messages
  an hour. Wait, or turn off **Confirm email** while you test on your own machine.
- **Redirect or "invalid link" errors after confirming email**: the Site URL or Redirect URLs in
  step 4 do not match the address you are using.
- **A page shows "Could not load"**: open the browser's network tab and the terminal running
  `npm run dev`; the server logs a short error code (never row contents).

## What this does not cover

Hosting the app (for example on Vercel), a custom domain, backups and the paid plan's extras are
out of scope here. The AI, background-job and email variables in `.env.example` are optional and
not needed for any of the steps above.

## Alternative: run Supabase locally with Docker

No account or cloud project is needed. Install Docker Desktop and start it, then:

```bash
npx supabase start
```

`supabase/config.toml` is already set up. The first start downloads images and applies every
migration and the seed. Run `npx supabase status -o json` to see the local URL and keys, put
them in `.env.local` the same way as step 2, then run `npm run supabase:check`. Stop it with
`npx supabase stop`. The local keys are the standard demo keys and are not secrets.

If port 3000 is taken, Next.js uses 3001: set `APP_URL` to match and add that address's
`/auth/callback` to `additional_redirect_urls` in `supabase/config.toml`.
