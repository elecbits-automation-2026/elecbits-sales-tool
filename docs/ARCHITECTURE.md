# How this codebase is put together

The Sales OS is a Vite + React + TypeScript single-page app on Vercel, reading
and writing a Postgres database it shares with the ODM PMS and the other
Elecbits tools.

```
   browser                          vercel                    supabase
  ┌──────────────────────┐        ┌──────────────┐        ┌──────────────┐
  │ main.tsx             │        │ api/claude   │───────►│  Anthropic   │
  │  ErrorBoundary       │        │ api/drive    │───────►│  Google Drive│
  │  config diagnostic   │        │ api/fireflies│───────►│  Fireflies   │
  │        │             │        │ api/meet     │───────►│  Google Cal. │
  │        │             │        │ api/admin-…  │───────►│  Supabase adm│
  │        │             │        └──────▲───────┘        └──────────────┘
  │        ▼             │               │
  │ App.tsx  (views)     │───────────────┘  lib/ai · lib/drive · lib/fireflies
  │        │             │
  │        ▼             │        ┌──────────────────────────────────────┐
  │ lib/data.ts          │───────►│ postgres                             │
  │   via lib/tables.ts  │        │   sales.*  this tool's own           │
  │ lib/auth.ts          │───────►│   core.*   shared with PMS/ULM/HR/Fin │
  │ lib/supabase.ts      │        └──────────────────────────────────────┘
  └──────────────────────┘
```

## The layers, and what belongs in each

| Layer | Files | Rule |
|---|---|---|
| Entry | `src/main.tsx` | Mount, catch, diagnose. No app logic. |
| Views | `src/App.tsx` | React only. If it does not render, it does not belong here. |
| Domain data | `src/data/*.ts` | Constants describing the business. No React, no I/O. |
| Services | `src/lib/*.ts` | Everything that talks to the outside world. No JSX. |
| Functions | `api/*.js` | Anything holding a secret. Never `VITE_`-prefixed. |

### Adding a backend endpoint

One file in `api/` is one endpoint — `api/meet.js` serves `/api/meet`. Vercel
picks up `api/*.js` automatically; there is no `vercel.json` and no deploy
step. Three conventions every function here follows:

- **`GET ?action=status` answers without credentials**, reporting `{connected,
  reason}`. That is what lets the UI show a "not connected" card instead of
  failing silently, and what lets `scripts/check-sales.mjs` tell *not
  deployed* from *not configured* from *working*.
- **Secrets are read from `process.env` and never `VITE_`-prefixed.** A
  `VITE_` variable is compiled into the browser bundle.
- **Resolve, don't throw.** The client module in `src/lib/` expects a JSON
  shape back either way.

The one direction that matters: **views import from lib, never the reverse.**
A file in `src/lib/` that imports from `App.tsx` is the beginning of the
5,000-line component all over again.

### `src/lib`

| File | Holds |
|---|---|
| `supabase.ts` | The client. Repairs common env-var mistakes; never throws at module scope. |
| `tables.ts` | Logical name → `[schema, table]`. The only place a table name is written. |
| `data.ts` | Loads the workspace and syncs it back. Every query goes through `tbl()`. |
| `auth.ts` | Sign in, sign out, who am I, first-admin bootstrap. |
| `ai.ts` | `askClaude`, the Drive tool loop, attachments, system memory. |
| `drive.ts` | `/api/drive` — status, list, deep, search, open, verify, write. |
| `fireflies.ts` | `/api/fireflies` — status, list, transcript. |
| `meet.ts` | `/api/meet` — schedule, list upcoming, cancel. Carries the caller's JWT so the event is theirs. |
| `recordings.ts` | The private `sales-recordings` bucket — upload, list, signed playback links. |

### `src/data`

`stages.ts` is the pipeline: stages, gate questions, KPI metrics, company
fields. `taxonomy.ts` is the shared vocabulary: industry codes, org sizes, LLD
questions, roster roles.

The PMS goes a step further — its equivalent is *generated* from the process
documents by `scripts/build-process-map.mjs`, so the documents are the source
of truth. That is the shape to grow into when these stop being edited by hand.

## Two things that are load-bearing

**`tables.ts` is the only place a table name appears.** Before it, `data.ts`
held 55 string literals and the schema was decided by which variable the author
reached for — `core.from(...)` or `supabase.from(...)`. Which schema a query hit
was a property of typing, not of design. Now moving a table between schemas is
one edit, and a misspelled table is a compile error rather than a 404.

**`main.tsx` must never let a failure render nothing.** `supabase.ts`
deliberately does not throw when its config is bad: a module-scope throw happens
before React mounts, and the user gets a white page. Instead it records why, and
`main.tsx` renders a diagnostic naming the variable. Keep that contract — it is
the difference between a five-minute fix and an afternoon in devtools.

## Where the shared database is documented

`supabase/README.md` — run order, what each file does, the `17-task-states.sql`
trap, and how to roll back. Read it before touching SQL.

## Known state

`npm run typecheck` reports **297 errors, every one of them in `App.tsx`**, and
260 of those are a single pre-existing class: components written as untyped
destructured props, which TypeScript then treats as required. `tsconfig.json`
runs with `strict: false` and `noImplicitAny: false` for the same reason.

This is inherited, not new. It was **291 on the untouched codebase**, dropped to
288 after the layer extraction, and rises only as new UI is added in the same
style. The number worth watching is the other 37, which has not moved through
any of this work. Every file in `src/lib/` and `src/data/` is clean.

The honest way to bring `App.tsx` down is to type those component props as
views move out of it.

`npm run build` passes. `npm run test:scrum` — 19 tests over the scrum
organiser's date and time-window logic — passes.

## What has not been done

Three items from the structural audit are deliberately still open, because each
changes behaviour rather than structure:

1. **Concurrent writes.** Two separate problems, both from `loadWorkspace()`
   running once at login and every save pushing a whole collection back:
   - *Rows deleted.* `upsertAndPrune` (`data.ts`) ends with an unscoped
     `.delete().not("id","in",…)`. Six collections use it — `llds`, `kpis`,
     `trainings`, `knowledge`, `memory`, `gates` — so a save from a stale
     array deletes a teammate's new row.
   - *Edits reverted.* The other eight sync functions, `syncDeals` included,
     only upsert — nothing is deleted, but a stale array still writes old
     field values over someone else's edit.

   Per-row writes fix the first; a poll or a Realtime subscription fixes the
   second.
2. **Degraded mode.** With no Supabase config the app shows a diagnostic; the
   PMS falls back to seed data and localStorage so it runs with zero config.

Login provisioning (`api/admin-users.js`), Meet scheduling (`api/meet.js`) and
call-audio upload (`21-recordings-bucket.sql`) are built. Each is inert until
its configuration exists, and each reports why through `npm run check` — see
`.env.example` for the values and the two Google console steps Meet needs.
