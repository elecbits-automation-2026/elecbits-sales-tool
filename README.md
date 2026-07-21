# Elecbits — Sales OS

Internal sales / RFQ pipeline tool (leads → approvals → RFQ → project allocation →
tasks / work updates). React + Vite + TypeScript. Custom CSS (no Tailwind).

This repo was restructured from a single-file prototype (`sales_code.tsx`) into a
proper project. The code is **byte-identical** to the prototype — only split into
modules along clean seams. No behaviour was changed.

## Project structure

```
elecbits-sales-tool/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.example
└── src/
    ├── main.tsx            # React entry point
    ├── App.tsx             # all UI components + the app shell
    ├── constants.ts        # STAGES, DEPARTMENTS, TIERS, TYPES, BOOTSTRAP_ADMIN, …
    ├── globals.d.ts        # window.storage type declaration
    ├── data/
    │   └── sampleData.ts   # SAMPLE_CLIENTS / LEADS / PROJECTS / TASKS / WORK_UPDATES
    ├── lib/
    │   ├── storage.ts      # loadList / saveList  ← swap for Supabase (db.ts) later
    │   ├── ai.ts           # callClaude           ← repoint at a serverless proxy later
    │   └── helpers.ts      # id generators, formatting, role/department helpers
    └── styles/
        └── appStyles.ts    # the full APP_STYLES CSS block
```

The two modules that the backend migration will replace — `lib/storage.ts`
(persistence) and `lib/ai.ts` (the Claude call) — are deliberately isolated so
the rest of the app doesn't change when they do.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

### Users (dynamic — no hardcoded accounts)

There are no hardcoded users. On first run the app seeds a **single bootstrap
Main Admin** from env vars (`VITE_BOOTSTRAP_ADMIN_EMAIL` / `..._NAME`); its
Supabase Auth login is created by `npm run seed` from `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD`. Log in as that admin, then create everyone else from
the **Employees** screen (each new employee gets a real Supabase Auth login via
`/api/admin`).

In dev builds only, the login screen still shows a quick-login panel for any
dynamically-created users (whose password is stored in the `crm-users` blob); it
is hidden in production.

## Backend (Supabase + Vercel)

This app now runs on a real backend. **See [`SETUP.md`](./SETUP.md) for the full
step-by-step setup + deploy guide.** In short:

- **Persistence** — Supabase. Each collection (`crm-clients`, `crm-projects`,
  `crm-users`, `crm-leads`, `crm-tasks`, `crm-work-updates`) is one JSON blob row
  in the `collections` table (`supabase/schema.sql`). `lib/storage.ts` reads/writes
  it via `@supabase/supabase-js`, keeping the same `loadList` / `saveList`
  interface, so `App.tsx` is untouched.
- **Auth** — Supabase Auth (`signInWithPassword`). Only the bootstrap admin is
  seeded (`scripts/seed-auth.mjs` → `npm run seed`); everyone else is created
  dynamically in-app. The user's profile (tier/department) is resolved from the
  `crm-users` collection. Creating/deleting an employee in the app also
  creates/deletes their login via the `/api/admin` serverless function
  (service-role, Main-Admin-gated).
- **AI note helper** — `lib/ai.ts` calls the `/api/claude` serverless function,
  which holds `ANTHROPIC_API_KEY` server-side and forwards to the Anthropic API.

Environment variables are documented in `.env.example`.

### Known limitations (prototype-grade)

- Row Level Security allows any signed-in user to read/write all collections; the
  app enforces role/department visibility on the client. Harden with
  per-collection/per-row policies later.
- Whole-collection last-write-wins concurrency (fine for a small team).
- Set a strong `BOOTSTRAP_ADMIN_PASSWORD` before seeding; change it after first
  login. Dynamically-created users' passwords are stored in the `crm-users` blob
  (prototype-grade) — a later hardening step should stop storing them client-side.
