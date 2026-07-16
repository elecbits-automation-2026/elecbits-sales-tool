# Going live — Supabase + Vercel

This turns the local prototype into a hosted, shared, dynamic app:

- **Supabase** stores all data and handles logins (real auth).
- **Vercel** hosts the site and runs two small serverless functions
  (`/api/claude` for the AI note helper, `/api/admin` for creating logins).

Follow the steps in order. You only do steps 1–4 once.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> → sign in → **New project**.
2. Name it (e.g. `elecbits-sales`), pick a strong database password, choose a
   region near you, and create it. Wait ~2 minutes for it to finish.
3. **Turn OFF email confirmation** (so logins work without inbox verification):
   **Authentication → Sign In / Providers → Email** → turn **Confirm email**
   off → Save. (Also fine to leave "Allow new users to sign up" off — you create
   users through the app.)

## 2. Create the database table

1. In Supabase: **SQL Editor → New query**.
2. Open `supabase/schema.sql` from this project, copy the whole file, paste it
   in, and click **Run**. You should see "Success". This creates the
   `collections` table with Row Level Security enabled.

## 3. Collect your keys

In Supabase: **Project Settings → API**. You need three values:

| Value | Where it goes |
|---|---|
| **Project URL** (e.g. `https://abcd.supabase.co`) | `VITE_SUPABASE_URL` **and** `SUPABASE_URL` |
| **anon public** key | `VITE_SUPABASE_ANON_KEY` |
| **service_role** key (secret — click to reveal) | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ The **service_role** key bypasses all security. Never put it in a `VITE_`
> variable, never commit it, never paste it in the browser. It goes only in
> `.env.local` (git-ignored) and in Vercel's server-side env vars.

## 4. Create the login accounts (seed script)

The app fills in everyone's profile automatically on first login, but each
person needs a Supabase Auth account to sign in. Create the 15 demo accounts:

1. Copy `.env.example` to `.env.local` and fill in at least `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (from step 3).
2. Run:

   ```bash
   npm install
   npm run seed
   ```

   You should see `✓ create` lines for each user. Re-running is safe (it skips
   existing accounts).

The seeded logins are the ones listed in `README.md` (e.g.
`sam.okafor@elecbits.in` / `admin123`).

---

## 5. Run it locally (optional but recommended)

Fill in the rest of `.env.local`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ANTHROPIC_API_KEY=your-anthropic-key      # optional locally
```

Then:

```bash
npm run dev      # http://localhost:5173
```

Sign in with a seeded account. On the first sign-in the app seeds the sample
clients/projects/leads/tasks into Supabase. Data now persists and is shared
across everyone.

> Note: `npm run dev` serves the front-end only — the `/api/*` functions run on
> Vercel. Locally, the AI note helper and admin user-creation won't work unless
> you use `vercel dev` (below). Everything else (logins, data) works.
>
> To run the API functions locally too: `npm i -g vercel` then `vercel dev`.

---

## 6. Deploy to Vercel

1. Push this project to a GitHub repo (or use the Vercel CLI).
   - This folder isn't a git repo yet. To use GitHub:
     ```bash
     git init && git add -A && git commit -m "Elecbits Sales OS"
     ```
     then create a repo on GitHub and push.
   - `.gitignore` already excludes `.env*` and `node_modules`, so your secrets
     won't be committed.
2. Go to <https://vercel.com> → **Add New → Project** → import your repo.
3. Vercel auto-detects **Vite**. Leave the build settings as-is
   (build command `npm run build`, output `dist`). It also auto-detects the
   `/api` folder as serverless functions — nothing to configure.
4. **Environment Variables** — add all of these (Settings → Environment
   Variables), for the Production environment:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your project URL |
   | `VITE_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_URL` | your project URL (again, no `VITE_`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `ANTHROPIC_API_KEY` | your Anthropic key (for the note helper) |
   | `ANTHROPIC_MODEL` | *(optional)* `claude-opus-4-8`, or `claude-haiku-4-5` to save cost |

5. Click **Deploy**. When it finishes you get a live URL. Open it and sign in.

> If you add env vars after the first deploy, hit **Redeploy** for them to take
> effect.

---

## What's dynamic now

- **Logins** are real Supabase Auth accounts.
- **All data** (clients, RFQs, leads, projects, tasks, work updates, users) lives
  in Supabase and is shared across everyone in real time on reload.
- **Adding an employee** in the app's Employees page also creates their login
  automatically (via `/api/admin`); removing one deletes their login.
- **The AI note helper** runs through `/api/claude` with your key kept server-side.

## Known limitations (prototype-grade)

- Row Level Security currently allows any signed-in user to read/write all
  collections; the app enforces role/department visibility on the client. For
  stricter security, move to per-collection/per-row policies later.
- Concurrent edits use last-write-wins on a whole collection (fine for a small
  team). A future step is per-row tables if you need finer-grained concurrency.
- Passwords for seeded demo users are simple — change them (or delete the demo
  users) before real use.
