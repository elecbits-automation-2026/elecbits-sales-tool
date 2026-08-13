<!-- GitHub renders READMEs on light and dark backgrounds; the logo's icon half
     is pure black, so a dark-theme reader gets the white-icon variant. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/elecbits-logo-dark.png" />
  <img src="src/assets/elecbits-logo.png" alt="Elecbits" width="360" />
</picture>

# Elecbits — Sales OS

Internal sales tool for Elecbits (electronics ODM/EMS). A clean, light-first
CRM + pipeline that enforces two rules: **no information is missed** and
**knowledge is power**. React + Vite + TypeScript + Tailwind, backed by Supabase,
with a serverless AI proxy.

The whole UI lives in **`src/App.tsx`** (single-file app). It persists to Supabase
and calls Claude through the `/api/claude` serverless proxy (key stays
server-side).

## What it does

- **Pipeline** — a HubSpot-style board across the full journey: Lead → First
  Meeting → Physical Meeting → RFQ → Project ID → PM Added → Quote/LLD →
  Negotiation → Closure → PO. Drag a card and an **AI gate interviews the agent**
  before the move is allowed — it probes vague answers ("client not interested"
  → "what did you pitch, what was the exact objection?"), supports **voice
  dictation**, and files a structured note (summary / facts / risks / next action).
  Marking a deal **Lost** triggers a post-mortem.
- **Companies** — full records (`EB-C-0001`), required fields + custom fields,
  with a **data-completeness %**. Incomplete records are flagged.
- **Performance** — KPI targets (Admin → Dept Head → Agent), a **Training**
  tracker, and a daily **Work-update** sheet. Each person gets a composite
  **Health score** (KPI pace + training + discipline). Behind pace → red.
- **Fix This Now** — a red banner of exactly what each user must do (fill data,
  work stalled deals, log yesterday, clear overdue training, catch up on KPI).
  This is the "firing tool".
- **Product / Service** — an AI assistant grounded in an admin-maintained
  knowledge base (with access tiers), plus **template generation** (intro email,
  WhatsApp follow-up, one-pager, quote cover note).
- **Expenses** — travel / client expense requests approved by Admin or Finance.
- **Admin** — users & roles, the **editable AI stage-gate questions** per stage,
  and workspace backup / reset.

Roles: **Admin**, **Dept Head**, **Sales Agent**, **Finance**.

## Architecture

- **`src/App.tsx`** — the entire UI + logic (Tailwind classes).
- **Persistence** — Supabase, relational, on the shared **eb-core-database-1**:
  the `core` schema the ODM PMS built (people, orgs, trainings, numbering)
  plus this tool's `sales` schema (deals, deal moves, org activities, targets,
  knowledge, work updates, travel requests, scrum notes, memory, gate config).
  `src/lib/data.ts` loads the workspace and syncs edits;
  `supabase/10–11` create and migrate the sales side.
- **Session/auth** — Supabase Auth on the shared core database. An admin puts a
  person's email on the roster (**Admin → Add user**); their first sign-in
  creates the account and a DB trigger links it to their `core.people` row by
  email (see `SETUP.md`).
- **AI** — `askClaude(system, messages)` posts to `/api/claude`
  (`api/claude.js`), which holds `ANTHROPIC_API_KEY` and forwards to the
  Anthropic Messages API. The model is chosen server-side (`ANTHROPIC_MODEL`,
  default `claude-opus-4-8`).

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173  (front-end only; /api/* runs on Vercel)
npm run build    # production build → dist/
```

Create `.env.local` from `.env.example` with your Supabase URL + anon key. The AI
features need the app deployed to Vercel (or `vercel dev`) so `/api/claude` runs
with `ANTHROPIC_API_KEY` set.

See **[`SETUP.md`](./SETUP.md)** for the Phase 0 cut-over runbook (the three
SQL files, exposed schemas, and the deploy order).

### Reference

`git log` includes an earlier modular implementation of the same eight
capabilities (kept in history). The single-file test-bench app in `src/App.tsx`
is the current, canonical UI.
