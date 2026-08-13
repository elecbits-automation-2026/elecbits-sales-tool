# Sales OS — setup & the Phase 0 cut-over

The app runs on the **shared core database** (`eb-core-database-1`) — the same
project the ODM PMS 2 lives in — on two Postgres schemas:

- **`core`** — the company spine the PMS already built: `people`, `orgs`,
  `projects`, `trainings`, `contacts`, `documents`, `events`, `numbering`.
- **`sales`** — this tool's own tables: deals, deal moves, org activities,
  targets, knowledge, work updates, travel requests, scrum notes, memory,
  gate config, meetings — plus the PMS-defined `leads`/`quotes`/`requests`
  contract tables.

Nothing in `core` or `pms` is altered beyond additive pieces (two numbering
series, an `auth_id` backfill, and the sign-up trigger regaining its
adopt-by-email behaviour — the PMS's own `fix-resource-creation.sql` pattern).

Login is **Supabase Auth**. Put a person's email on the roster (Admin → Add
user); their **first sign-in creates the account** — whatever password they
type then becomes theirs — and a DB trigger links the account to their roster
row by email. An email nobody added signs in to a "no workspace access"
screen.

---

## Phase 0 cut-over — run these once, in order

Everything goes into `eb-core-database-1` → **SQL Editor**. Every file is
idempotent (safe to re-run). The first four files are the PMS repo's, and are
prerequisites in case any have not run yet; if one has already run it does
nothing.

From the **elecbits-pms-odm2** repo:

1. `supabase/schemas/00-one-structure.sql` — moves the 19 tables into
   `core` / `pms` (already applied on the live DB).
2. `supabase/sanction-gate.sql` — `core.tools`, staffing, sanction columns.
3. `supabase/schemas/01-core.sql` — contacts, documents, events,
   `core.numbering` + `core.next_number()`.
4. `supabase/schemas/02-sales.sql` — leads/quotes/`sales.requests` +
   `core.intake` + `sales.settle_request()` (the RFQ → ULM contract).
5. `supabase/schemas/03-ulm.sql` — ULM's side of that contract.

From **this** repo:

6. **`supabase/10-sales-port.sql`** — the Sales OS's tables in `sales`,
   the auth adopt-by-email trigger, the roster RPCs
   (`sales.upsert_person` / `sales.remove_person`), and two serial series in
   `core.numbering` (client serial seeded at **781**, project serial at
   **1877** — above every serial in the tracking sheets; adjust with
   `update core.numbering set last_value = N-1 where kind = 'client_serial';`).
7. **`supabase/11-migrate-blobs.sql`** — parses the eleven `sales:*` JSON
   blobs out of `public.collections` into the relational tables. People merge
   into `core.people` by email, companies into `core.orgs` by name; old
   `EB-C-0001` pseudo-ids land in `sales.org_detail.legacy_cid`. Ends with a
   row-count report. `public.collections` is left untouched — it is the
   rollback.

Then two dashboard settings:

8. **Settings → API → Exposed schemas**: add `core` and `sales`
   (keep `public`). Without this every query 404s.
9. **Authentication → Sign In / Providers → Email**: turn **off**
   "Confirm email". First sign-in must produce a session immediately.

## Deploy order matters

The app in this branch reads `core`+`sales` — if it deploys **before** the
steps above, login breaks. Sequence:

1. Run steps 1–9 above.
2. Merge this branch to `main` (Vercel builds production).
3. Sign in with your usual email. Everyone from the old user list is already
   on the roster; each person's **first sign-in sets their password**.
4. Confirm companies / deals / history all show. The old blob stays in
   `public.collections` as rollback; drop it only when confident:
   `drop table public.collections;`

## Environment (unchanged)

| Variable | Where |
|---|---|
| `VITE_SUPABASE_URL` | Vercel — `https://zpesebacpomxllcjmekc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Vercel — anon public key |
| `ANTHROPIC_API_KEY` | Vercel — for `/api/claude` (Assistant, gates, scrum) |

No service-role key anywhere. The anon key + RLS is the entire client
surface; anon alone can reach nothing in `core`/`sales`.

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
- In `core`, sales people stay role `engineer` — a sales admin never gains
  the PMS/HR `is_admin()` powers. Roster writes therefore go through the
  SECURITY DEFINER RPC `sales.upsert_person`, which checks the **sales**
  role instead.
- First signed-in user on an **empty** sales roster becomes admin
  automatically; with migrated data that path never fires.
