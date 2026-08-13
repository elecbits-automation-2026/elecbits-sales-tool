# Sales OS — setup & the Phase 0 cut-over

The app runs on the **shared core database** (`eb-core-database-1`), on two
Postgres schemas:

- **`core`** — the company spine shared with the ODM PMS: people, orgs,
  contacts, projects, documents, memory, numbering, and the `core.grants` lock.
- **`sales`** — this tool's own tables: deals, deal moves, activities, quotes,
  targets, knowledge, trainings, scrum notes, work updates, travel requests,
  gate config.

Login is **Supabase Auth**. There is no seed script and no password step for
admins: put a person's email on the roster (Admin → Add user), and their
**first sign-in creates the account** — whatever password they type then
becomes theirs. A DB trigger links the new account to their roster row; an
email nobody added signs in to a "no workspace access" screen.

---

## Phase 0 cut-over — run these once, in order

All in `eb-core-database-1` → **SQL Editor**, one file at a time, top to
bottom. Every file is idempotent (safe to re-run).

1. **`supabase/01-core-schema.sql`** — creates the `core` schema: the spine,
   the `core.me()` / `core.can()` lock, the numbering mint (client serial seeded
   at **781**, project serial at **1877** — above every serial in the tracking
   sheets; adjust with
   `update core.numbering set next_val = N where prefix = 'client_serial';`),
   and the auth-link trigger.
2. **`supabase/02-sales-schema.sql`** — creates the `sales` schema and the
   first-run bootstrap RPC.
3. **`supabase/03-migrate-blobs.sql`** — parses the nine `sales:*` JSON blobs
   out of `public.collections` into the new tables, and merges the PMS roster
   (`public.profiles`) into `core.people`. Ends with a row-count report.
   `public.collections` is left untouched — it is the rollback.

Then two dashboard settings:

4. **Settings → API → Exposed schemas**: add `core` and `sales`
   (keep `public`). Without this every query 404s.
5. **Authentication → Sign In / Providers → Email**: turn **off**
   “Confirm email”. First sign-in must produce a session immediately.

> ⚠️ Do **not** expose `hr` or `finance` schemas (when they exist) until this
> app's deploy is confirmed off the old anon-readable `collections` table.

## Deploy order matters

The app in this branch reads `core`+`sales` — if it deploys **before** steps
1–5, login breaks. Sequence:

1. Run steps 1–5 above.
2. Merge this branch to `main` (Vercel builds production).
3. Sign in with your usual email. Existing people from the old user list are
   already on the roster; each person's **first sign-in sets their password**.
4. Confirm companies/deals/history all show. The old blob stays in
   `public.collections` as rollback; drop it only when confident:
   `drop table public.collections;`

## Environment (unchanged)

| Variable | Where |
|---|---|
| `VITE_SUPABASE_URL` | Vercel — `https://zpesebacpomxllcjmekc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Vercel — anon public key |
| `ANTHROPIC_API_KEY` | Vercel — for `/api/claude` (Assistant, gates, scrum) |

No service-role key anywhere. The anon key + RLS (`core.can()`) is the entire
client surface; anon alone can reach nothing in `core`/`sales`.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173 — front-end only; /api/claude runs on Vercel
npm run build
```

`.env.local` needs just `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Access model

- Roles inside the app (`admin` / `dept_head` / `agent` / `finance`) live in
  `sales.people_detail` and drive the UI.
- Database access is `core.grants`: one row per person per tool
  (`none|read|write|admin`). The migration grants sales users `write` on
  `core`+`sales` (admins `admin`). Changing someone's access is one row —
  no policy edits, ever.
- First user on an **empty** database becomes admin automatically
  (`sales.bootstrap_first_admin()`); with migrated data that path never fires.
