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
    ├── constants.ts        # STAGES, DEPARTMENTS, TIERS, TYPES, DEFAULT_USERS, …
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

### Test logins (from `src/constants.ts` → DEFAULT_USERS)

| Role        | Email                     | Password        |
|-------------|---------------------------|-----------------|
| Main Admin  | sam.okafor@elecbits.in    | admin123        |
| Sales Mgr   | alex.rao@elecbits.in      | sales123        |
| Sales User  | jamie.lin@elecbits.in     | salesuser123    |

(One Manager + one User per department; see `DEFAULT_USERS` for the full list.)

## Backend (Supabase + Vercel)

This app now runs on a real backend. **See [`SETUP.md`](./SETUP.md) for the full
step-by-step setup + deploy guide.** In short:

- **Persistence** — Supabase. Each collection (`crm-clients`, `crm-projects`,
  `crm-users`, `crm-leads`, `crm-tasks`, `crm-work-updates`) is one JSON blob row
  in the `collections` table (`supabase/schema.sql`). `lib/storage.ts` reads/writes
  it via `@supabase/supabase-js`, keeping the same `loadList` / `saveList`
  interface, so `App.tsx` is untouched.
- **Auth** — Supabase Auth (`signInWithPassword`). Login accounts are seeded by
  `scripts/seed-auth.mjs` (`npm run seed`); the user's profile (tier/department)
  is resolved from the `crm-users` collection. Creating/deleting an employee in
  the app also creates/deletes their login via the `/api/admin` serverless
  function (service-role, Main-Admin-gated).
- **AI note helper** — `lib/ai.ts` calls the `/api/claude` serverless function,
  which holds `ANTHROPIC_API_KEY` server-side and forwards to the Anthropic API.

Environment variables are documented in `.env.example`.

### Known limitations (prototype-grade)

- Row Level Security allows any signed-in user to read/write all collections; the
  app enforces role/department visibility on the client. Harden with
  per-collection/per-row policies later.
- Whole-collection last-write-wins concurrency (fine for a small team).
- Seeded demo passwords are simple — change or remove those users before real use.
