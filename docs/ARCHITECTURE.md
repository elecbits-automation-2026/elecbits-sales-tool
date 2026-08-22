# How this codebase is put together

The Sales OS is a Vite + React + TypeScript single-page app on Vercel, reading
and writing a Postgres database it shares with the ODM PMS and the other
Elecbits tools.

```
   browser                          vercel                    supabase
  ┌──────────────────────┐        ┌──────────────┐        ┌──────────────┐
  │ main.tsx             │        │ api/claude   │───────►│  Anthropic   │
  │  ErrorBoundary       │        │ api/drive    │───────►│  Google      │
  │  config diagnostic   │        │ api/fireflies│───────►│  Fireflies   │
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

`npm run typecheck` reports **288 errors, all in `App.tsx`**, and all of one
pre-existing class: components written as untyped destructured props, which
TypeScript then treats as required. `tsconfig.json` runs with `strict: false`
and `noImplicitAny: false` for the same reason. This is inherited, not new —
the count was 291 before the layer extraction. Every file in `src/lib/` and
`src/data/` is clean, and the honest way to bring `App.tsx` down is to type
those component props as views move out of it.

`npm run build` passes.

## What has not been done

Three items from the structural audit are deliberately still open, because each
changes behaviour rather than structure:

1. **Concurrent writes.** `upsertAndPrune` in `data.ts` still writes whole
   collections and prunes the rest, so two people editing the pipeline at once
   can overwrite each other. Per-row writes are the fix.
2. **Provisioning logins.** There is no service-role path, so a rostered person
   must sign themselves in the first time. The PMS has an `admin-users`
   function for this.
3. **Degraded mode.** With no Supabase config the app shows a diagnostic; the
   PMS falls back to seed data and localStorage so it runs with zero config.
