# Elecbits — Sales OS

Internal sales tool: a full CRM + HubSpot-style pipeline with AI-guided stage
intake, KPIs, a performance "firing tool", a product/service knowledge assistant,
and expense approvals — on top of the original RFQ / approvals / project-allocation
flow. React + Vite + TypeScript. Custom CSS (no Tailwind).

## Sales OS modules (`src/features/`)

These are the eight capabilities layered on top of the original RFQ app. They
reuse the same backend (Supabase JSON collections), auth (roles/departments), and
AI proxy (`/api/claude`) — no new infrastructure.

1. **Companies** (`Companies.tsx`) — full company records with a generated
   `COM-####` ID, multiple contacts, "what they do", and unlimited custom
   detail fields. Records missing key info are flagged **incomplete** and nag
   their owner (goal: *no information is missed*).
2. **Pipeline** (`Pipeline.tsx`) — a HubSpot-style kanban across the client
   journey: Lead → First Meeting → Physical Meeting → RFQ → Project ID Creation →
   PM Added → Quote/LLD → Negotiation → Closure to PO → Won / Lost. Drag a card
   to move it.
3. **AI stage intake** (`StageTransitionChat.tsx`) — every stage move opens a
   guided AI chat that asks stage-specific questions, **probes on weak/negative
   answers** ("not interested" → "what did you pitch, what was the objection?"),
   supports **voice dictation**, and compiles a note. The deal only advances once
   the intake is complete.
4. **AI Intake Playbook** (in `KPIManager.tsx`) — Main Admin edits the per-stage
   questions and a global "playbook memory" that trains what the AI asks. Stored
   in the `crm-config` collection; per-company context is pulled from the company
   record automatically.
5. **KPIs** (`KPIManager.tsx`) — Main Admin sets targets for Department Heads;
   Department Heads set targets for their team. Targets are per calendar month.
6. **Performance** (`Performance.tsx`) — scorecards measured **live** from
   pipeline activity (not self-reported). Behind pace → the card and the
   workspace health banner go **red** (the *firing tool*).
7. **Product & Services** (`Knowledge.tsx`) — an AI chat grounded in an
   admin-maintained knowledge base (docs + Drive/file links), with reusable
   **answer templates**.
8. **Expenses** (`Expenses.tsx`) — travel / client expense requests approved by
   Main Admin or Finance (approve / reject / mark paid).

New Supabase collections (all JSON-blob rows in the existing `collections`
table — no schema migration needed): `crm-companies`, `crm-deals`, `crm-kpis`,
`crm-knowledge`, `crm-templates`, `crm-expenses`, `crm-config`.

---

## Original RFQ app

The base app is an internal sales / RFQ pipeline tool (leads → approvals → RFQ →
project allocation → tasks / work updates), restructured from a single-file
prototype into modules along clean seams.

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
