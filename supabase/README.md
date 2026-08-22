# The database, and the order it goes in

One database — `eb-core-database-1` — shared with the ODM PMS and the other
Elecbits tools. This tool owns the `sales` schema and nothing else. `core` is
the company's; we fill gaps in it and never claim it.

```
        sales  ──── raises a request ────►  ulm  ──── sanctions ────►  pms
          │                                                             │
          └──────────────── both read ────► core ◄─────────────────────┘
                        people · orgs · numbering · contacts
```

**The one rule: every tool reads `core`; no tool reads another tool's schema.**
Sales reaches ULM through exactly two objects — the `core.intake` view (outward)
and `sales.settle_request()` (inward). There is no write path from here into
`core.projects`, and there must never be one: ULM decides what becomes a
project, not sales.

---

## Run order

Every file is idempotent — re-running one changes nothing. The `RUN-THIS-*`
files are concatenations of the numbered ones, in dependency order, meant to be
pasted into the SQL editor as a single transaction: if any statement fails the
whole thing rolls back and the database is untouched.

| Step | Run | What it does |
|---|---|---|
| 1 | **`RUN-THIS-phase0.sql`** | The whole cut-over, six parts (see below) |
| 2 | *Settings → API → Exposed schemas:* add `core` and `sales` | Or PostgREST answers 404 for everything |
| 3 | *Authentication → Providers → Email:* **Confirm email OFF** | The app's sign-in-or-create onboarding cannot work with it on |
| 4 | **`RUN-THIS-phase2.sql`** | tasks, LLDs, question sets, task gate, chats, account plan, company chat |
| 5 | **`17-task-states.sql`** | ⚠️ **not in any bundle — run it by hand** |
| 6 | **`RUN-THIS-phase3.sql`** | scrum call + transcripts, client comms |
| 7 | **`20-scrum-parity.sql`** | `steps` + `conditions` on `sales.tasks` — the scrum organiser writes both |

### Step 5 is a real trap

`17-task-states.sql` appears in **no** `RUN-THIS-*` file. `phase2` bundles
12–16, `phase3` bundles 18–19, and 17 falls down the gap between them. It
widens the `tasks_status_check` constraint to allow `doing`, and the app writes
that status in seven places — so on a database built only from the bundles,
every attempt to start a task fails a check constraint. Run it between steps 4
and 6.

### What `RUN-THIS-phase0.sql` contains

| Part | File | Origin | What |
|---|---|---|---|
| 1 | `sanction-gate.sql` | PMS repo | `core.tools`, sanction gate, `ulm` schema |
| 2 | `schemas/01-core.sql` | PMS repo | contacts, documents, events, numbering |
| 3 | `schemas/02-sales.sql` | PMS repo | leads, quotes, requests + `core.intake` |
| 4 | `schemas/03-ulm.sql` | PMS repo | ULM's side of the request contract |
| 5 | `10-sales-port.sql` | this repo | the Sales OS tables, auth, roster RPCs |
| 6 | `11-migrate-blobs.sql` | this repo | `sales:*` blobs → relational; prints a row-count report |

Parts 1–4 come from `elecbits-pms-odm2`. They are the shared spine; if that
repo changes them, the copies bundled here go stale. Prefer running them from
the PMS repo when both are to hand.

### The numbered files, individually

Run these only when you know why the bundle is not what you want.

| File | Requires | What |
|---|---|---|
| `10-sales-port.sql` | PMS parts 1–4 | the Sales OS tables, conformed to the shared architecture |
| `11-migrate-blobs.sql` | 10 | eleven `sales:*` JSON blobs → relational |
| `12-phase1.sql` | 10 | `sales.tasks`, `sales.llds`, `sales.question_sets` |
| `13-task-gate.sql` | 12 | AI-gated closure columns on `sales.tasks` |
| `14-chats.sql` | 10 | one assistant thread per person per day |
| `15-account-plan.sql` | 10 | `org_detail.plan` — the staged account plan |
| `16-company-chat.sql` | 14 | `chats.org_id` — per-company "Ask the AI" threads |
| `17-task-states.sql` | 13 | `open → doing → done` |
| `18-scrum-call.sql` | 17 | meet link, attendance, transcript on a scrum note |
| `19-client-comms.sql` | 18 | touch log direction/channel/contact + commitments |
| `20-scrum-parity.sql` | 12 | `steps` + `conditions` on `sales.tasks`, for PMS-shape scrum output |

Only `10 → 11` and `12 → 13 → 17 → 18 → 19 → 20` are real chains. `14 → 16` is a
second, shorter one. `15` is independent.

---

## Rolling back

`00-rollback.sql` reverses the additive steps — 12 through 20 — and nothing
else. Read its header before running it: it refuses to touch `10`/`11`, and
that refusal is deliberate.

**There is no way back from `RUN-THIS-phase0.sql` in this repo.** Parts 1–4
create shared `core` objects the PMS also depends on, and part 6 migrates the
blobs. Undoing that is a point-in-time restore, not a script. Take a backup
before step 1 — Supabase → Database → Backups — and know that the PMS is
looking at the same rows.

---

## Local development

`config.toml` makes this a real CLI project:

```bash
supabase link --project-ref <ref>    # once
supabase start                       # local Postgres + Studio on :54323
supabase db reset                    # rebuild local from the files above
```

`config.toml` lists `core` and `sales` under `[api].schemas` — the local
equivalent of step 2. Add a schema in one place and you must add it in the
other, or local and hosted stop agreeing about what exists.

---

## Where the app addresses these tables

Nowhere by name, since the refactor. `src/lib/tables.ts` holds the single map
of logical name → `[schema, table]`, and every query in `src/lib/data.ts` goes
through `tbl(supabase, "deals")`. Moving a table between schemas is an edit to
that one file; a typo in a table name is a TypeScript error rather than a 404
at runtime.
