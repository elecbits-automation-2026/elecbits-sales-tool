# Elecbits Sales OS — what has been built to date

*Reference document, updated 23 Aug 2026. Companion to `docs/LEARNING.md`
(what the tool still needs to be taught).*

Shareable version: https://claude.ai/code/artifact/a015b9e7-9983-472f-9a8f-beb22b36687a

- **Production:** https://elecbits-sales-tool.vercel.app (deploys from `main`)
- **Repository:** `elecbits-automation-2026/elecbits-sales-tool`
- **Database:** Supabase project **eb-core-database-1** — shared with the
  Elecbits ODM PMS (https://elecbits-pms-odm2.vercel.app), whose look, feel
  and working patterns this tool deliberately mirrors.

## 1. What this tool is

The Sales OS is the operating system for the Elecbits sales team: every
company, deal, task, scrum, client conversation and promise lives in one
place, and an AI layer (Claude, via a server-side proxy) organises, gates,
scores and drafts on top of that record. The design goal throughout: PMS-level
UI/UX, minimum friction for the person logging work, and no way to close work
without leaving a real trace.

## 2. The stack

| Layer | What it is |
|---|---|
| Views | Vite + React + TypeScript. `src/App.tsx` holds the views; `src/main.tsx` mounts with an error boundary and a config diagnostic (a bad env var renders a named diagnosis, never a white page). Tailwind, lucide icons, light default + dark toggle, PMS visual language: slate-on-white, blue accent, IBM Plex Mono readouts. |
| Services (`src/lib/`) | `supabase.ts` (client, env repair), `tables.ts` (logical name → schema.table — the only place a table name is written), `data.ts` (load + sync), `auth.ts`, `ai.ts` (askClaude, Drive tool loop, attachments, memory), `drive.ts`, `fireflies.ts`, `meet.ts`, `recordings.ts`, `adminUsers.ts`. |
| Domain data (`src/data/`) | `stages.ts` (pipeline, gates, KPI metrics, company fields, STAGE_GUIDE), `taxonomy.ts` (industry codes, org sizes, LLD questions, roles), `scrum.ts` (organiser date/time-window logic — unit-tested). |
| Database | Supabase (Postgres + Auth + RLS). Two schemas: **`core`** (shared with the PMS — people, orgs, trainings, numbering) and **`sales`** (this tool's own tables + the private `sales-recordings` storage bucket). Collections load at login and sync per feature. |
| AI proxy | `api/claude.js` (Vercel serverless). Model **claude-sonnet-5** by default (`ANTHROPIC_MODEL` overrides), output capped at 8,192 tokens, accepts text + pasted images (client-side downscaled) + PDF attachments. Empty answers come back with the stop reason so failures are diagnosable. |
| Google Drive | `api/drive.js` — zero-dependency service-account JWT. Actions: `status`, `root`, `list`, `deep`, `search`, `open` (find-or-create company folder), `verify` (loose-match a claimed file inside the company folder + sub-folders), `write` (file a document into the folder, creating sub-folders like `Client-Comms` on first use). |
| Fireflies | `api/fireflies.js` — GraphQL proxy: `status`, `list` (date-filtered with schema-drift fallbacks), `get` (transcript flattened to "Speaker: text"), `schema`. Needs `FIREFLIES_API_KEY` (paid plan). |
| Google Meet | Scheduling calls the **PMS's deployed `meet` edge function** on the same Supabase project (it already holds the Google service account + Calendar delegation), so Sales holds no Google credentials for Meet. `api/meet.js` is a complete working copy kept as the escape hatch (`VITE_MEET_URL=/api/meet`). |
| Login provisioning | `api/admin-users.js` — admins create, reset and **revoke** teammate logins from inside the app (needs `SUPABASE_SERVICE_ROLE_KEY`, server-only). Deactivating on the roster is a UI flag; revoking deletes the auth account and actually ends access. It refuses to revoke your own login or the last signed-in admin. |
| Tooling | `scripts/check-sales.mjs` (`npm run check`) tells *not deployed* from *not configured* from *working* for every backend; `npm run test:scrum` runs 19 tests over the scrum organiser; `docs/ARCHITECTURE.md` documents the layering; `supabase/README.md` documents SQL run order and rollback (`00-rollback.sql`). |

**Deploy discipline:** every slice is built (`npm run build`), committed to the
working branch, merged `--no-ff` to `main`, and pushed — Vercel deploys `main`.

## 3. Sign-in, roles, shared database

- **Auth:** Supabase email/password. First sign-in creates the account; a DB
  trigger adopts the person's roster row by email. First user on an empty
  roster becomes admin. Roster writes go through the SECURITY DEFINER RPC
  `sales.upsert_person`, so sales admins never need core-admin rights and
  stay `engineer`-ranked in the shared `core.people`.
- **Roles:** Admin · Dept Head · Sales Agent · Finance. Admin sees everything
  including the Assistant, System Memory and Admin views; dept heads see
  their team's scrums/tasks/performance; agents see their own.
- **Shared-DB rule (standing constraint):** the PMS's `core` and `pms`
  objects are never modified — everything this tool adds is additive
  (`sales.*` tables, extra columns on nothing shared, RLS policies named
  `<table>_read`/`<table>_write`).
- **Official client IDs:** minted from the shared `core.numbering` serial via
  `core.next_number('client_serial')` as `Eb-<industry>-<size>-<serial>`;
  once minted the ID is permanent and the legacy pseudo-ID is kept separately.

## 4. The modules (sidebar order)

### Workspace

**Pipeline** — ten stages: Lead → First Meeting → Physical Meeting → RFQ →
Project ID → PM Added → Quote / LLD → Negotiation → Closure → PO, plus Lost.
Moving a deal forward opens the **stage gate**: an AI interviewer that asks
the stage's required questions (per-stage question sets, editable in Admin;
sensible defaults shipped) and only allows the move when the answers are
complete and specific. Admin can force a move with a reason. Lost deals get a
post-mortem. Every move is stored with summary, facts, risks, next action and
transcript.

**Companies** — filterable list (search, industry, city, owner) with
completeness scoring against the required record fields and allocated-people
cards. Each company opens a six-tab workspace:

| Tab | What it holds |
|---|---|
| Overview | The record (contact, city, industry, size, what they do, source, potential ₹, custom fields), completeness meter, deals, activity notes, client-ID minting, Project-ID request to ULM. |
| Plan | The AI account plan (`PLAN_JSON`): situation, goal, plays, risks — stored on the record, refreshable, plays convert to tasks. |
| To-dos | This company's open tasks with the same row controls as My Tasks. |
| Client Comms | The touch log + commitments ledger (section 5). |
| Files & Drive | The company's Drive folder (`/Eb-07-Sales/<client-ID> — <name>/`): live listing, open-in-Drive, and **Drive intelligence** (`INTEL_JSON`) — the AI reads the folder listing and reports how the account is moving. |
| Ask the AI | A per-company chat saved date-wise to the record (`sales.chats` with `org_id`), with Drive lookups, image/PDF attachments, and task creation (`TASKS_JSON`). |

**My Tasks** — the task system (section 5).

**LLD Creation** — guided low-level-design documents per company/deal
(`sales.llds`), with a designer hand-off view (DesignerLld).

### Personal

**Daily Scrum** — the morning call as a first-class object (section 5).

**Performance** — four tabs, viewable per person (admins/heads can switch):
**KPI** (targets vs actuals with pace tracking: companies added, meetings,
RFQs, quotes, POs, revenue, data completeness; team health roll-up),
**Training** (assigned trainings linked to knowledge entries, overdue
tracking), **Work update sheet** (one open-ended daily doc; submitting scores
it with AI against the person's KPI targets — `SCORE_JSON`, blunt two-line
feedback, saved with the day), and **Ideas & contribution** (every idea the
AI credited from written-up client conversations, per person and across the
team).

### Resources

**Resources** — Team View (roster table with role/dept filters and per-person
load), Resource Planning (who is on what), Efficiency (output measures).
**Product / Service** — the knowledge base (access-tiered entries; the AI
product assistant reads it). **Expenses** — travel requests with
approve/reject flow.

### AI (admin)

**Assistant** — the agentic workspace chat, saved date-wise per person. It
reads a workspace snapshot (companies, deals, team), System Memory, and
Google Drive (tool loop with visible "🔎 checked Drive" notes), accepts
pasted screenshots and files, and **acts** via `ACTIONS_JSON`: create task,
create company, create deal, save a memory, file a scrum note.

**System Memory** — durable facts and rules (positioning, pricing rules,
do's/don'ts) injected into **every** AI call in the tool.

### Admin

Roster management (add people, roles, emails — powered by the RPC), stage-gate
question sets per pipeline stage, and the three special question sets
(`company_card`, `project_id`, `boxbuild_criteria`).

## 5. The three deep systems

### Tasks: open → doing → done, with an honesty gate

Tasks arrive from everywhere — manual, scrum, transcript, company chat,
assistant, account plan, commitments, branching — and always carry company,
assignee, due date and an optional time window (overdue shows a live
HH:MM:SS counter).

1. **Start** is instant: the row flips to *doing*, no modal, no AI wait.
2. The **Work window** (PMS two-column modal) shows the task's scope card —
   what it is, where its files live, the quality bar, the deadline — and 2–4
   AI **prep questions** specific to the task ("What is this meeting actually
   about? What will you show?"). Answers persist on blur. A task can be
   linked to a **pipeline stage** once; the stage guidance then shows what
   the stage demands (entry/exit questions from the real gates) and what it
   should produce, and a **task chat** sits alongside — it knows the task,
   the account, the deal and the stage, and can look in the company's Drive
   folder.
3. **Complete Now** opens the close flow: task-specific **close questions**
   (outcomes, names, dates, numbers), then the evidence step. A
   verb/noun classifier plus the AI brief decide what evidence the task owes:
   **file** (it produced a document — name + Drive path), **link** (a meeting
   happened — MoM in the folder or a Fireflies/Meet link), or **none**
   (arranging/chasing produces an outcome, not paperwork — never ask for a
   file). Named files are **verified in Drive** before judging.
4. The **AI verdict** (`VERDICT_JSON`) passes or fails the closure with a
   score and two blunt sentences. Unreachable AI falls back to an offline
   heuristic (marked "checked offline"). Failing offers "Fix my answers" or
   **branch**: split what remains into 2–4 AI-suggested sub-tasks
   (`BRANCH_JSON`) and close the parent as branched. Escalation to the dept
   head is one checkbox and is tracked.

Briefs are cached on the task, shape-validated (legacy briefs re-fetch rather
than crash), and never block the UI — a local question bank answers when the
network is down.

### Daily Scrum: the call itself

The scrum view carries the **call card** — Meet link (remembered from the
last note), attendance chips for the roster, guest names, absent list — plus
**Meet scheduling** (creates the calendar event through the PMS's edge
function, invites the attendees), a meetings panel for the day, and
**call-recording upload** into the private `sales-recordings` bucket with
signed playback links. Two modes for the note itself. **Write** mode: type/dictate the scrum; the AI organiser
(`SCRUM_JSON`) extracts assigned, time-boxed tasks, matching owners to the
roster and companies to the book ("the account owner" resolves to that
company's real owner). **Transcript** mode: paste or upload a `.txt/.vtt/
.srt/.json` transcript, or **Pull from Fireflies** for the day; the
transcript reader extracts only real commitments, each with a verbatim
`said` quote so a human can check it in two seconds, plus blockers,
decisions, and a note of what it deliberately ignored. Everything lands in a
**preview card** first — reassign owners, adjust time windows, then "Send to
My Tasks". Notes save with link, attendance, source and transcript attached.

### Client Comms: touches and promises

Per company, the permanent record of every client interaction. **Log a
touch** in 15 seconds: kind (Call / Email / WhatsApp / Meeting / Visit /
Other), direction (they came to us / we reached out), when, who, one line —
optionally notes, a link, and a "Saved in Drive as" file that can be checked
against the folder on the spot. "Log it and write it up with AI" runs the
`COMMS_JSON` write-up: title, summary, what the client said, **our
commitments** and **their commitments** (each with owner, counterparty, due
date, promised-vs-implied), ideas credited (these feed Performance → Ideas &
contribution), decisions, objections and their status, next step, temperature
(hot/warm/cold) and the one risk. The write-up is auto-filed into the
company's Drive folder under `Client-Comms/`.

**Commitments** are first-class (`sales.commitments`), not tasks: they keep a
side (us/them), a counterparty and an outcome (open → kept / missed /
renegotiated / dropped, with a closing note). Overdue promises show red; "we
promised" rows convert to tasks in one click (linked, so no duplicates); the
kept/missed tally stays on the record. The timeline shows every touch with
its temperature, expandable write-up, and a **Draft the follow-up** button
(`DRAFT_JSON`) that produces a copy-ready email and a sub-40-word WhatsApp
from the write-up alone — never inventing a commitment that wasn't made.

## 6. The AI layer as a whole

- One proxy, one model floor (Sonnet 5), System Memory on every call.
- Structured contracts between prompt and parser (marker + JSON):
  `SCRUM_JSON`, `BRIEF_JSON`, `VERDICT_JSON`, `BRANCH_JSON`, `TASKS_JSON`,
  `ACTIONS_JSON`, `PLAN_JSON`, `COMMS_JSON`, `DRAFT_JSON`, `INTEL_JSON`,
  `SCORE_JSON`, `DRIVE_JSON`, plus the stage-gate summary. The parser
  handles object and array payloads; protocol lines are stripped from what
  the user sees.
- Every chat accepts pasted screenshots (downscaled client-side to fit the
  serverless body limit) and PDFs ≤ 4 MB.
- Every AI feature has an offline/failure path: local brief bank, offline
  verdict heuristic, unscored-but-saved work updates, "logged, but the
  write-up failed — the touch is saved".

## 7. Data model (all additive to the shared DB)

**`core` (shared with PMS, read/joined, never restructured):** `people`,
`orgs` (+ `client_id`, `org_size` stamped by the mint), `trainings`,
`numbering` (+ `next_number` RPC), auth-adoption trigger.

**`sales` (this tool's own):** `people_detail` (roster + rank),
`org_detail` (record fields, custom fields, account **plan**), `org_activities`
(notes **and** client touches: direction, subject, contact, occurred-at,
link, drive file, AI write-up), `deals`, `deal_moves` (gated history),
`targets` (KPIs), `work_updates` (+ AI score/feedback), `knowledge`,
`travel_requests`, `scrum_notes` (+ meet link, attendance, source,
transcript, transcript URL), `memory`, `gate_config`, `question_sets`,
`tasks` (+ window, work jsonb, ai jsonb, escalated, branched-from,
scrum-note back-link, source check), `llds`, `chats` (person × date × org),
`commitments`, `requests` (Project-ID pipe to ULM), and the meetings quartet
`meetings` / `meeting_ideas` / `meeting_decisions` / `meeting_challenges`
(fed by Client Comms write-ups; read by Ideas & contribution).

Safety rules in the sync layer (added in the repair pass): task and scrum
saves are upsert-only — deleting is an explicit per-row act, so one
browser's stale copy can never wipe a teammate's rows; a load that silently
degrades to empty poisons pruning for that table; an empty collection never
becomes a full-table delete.

**Migrations:** `supabase/10…22-*.sql` with one-paste runbooks
`RUN-THIS-phase0/2/3.sql`, a rollback (`00-rollback.sql`) and a run-order
README. Recent additions: `20-scrum-parity.sql` (scrum brought to the ODM2
shape), `21-recordings-bucket.sql` (the private `sales-recordings` storage
bucket), `22-task-stage.sql` (`tasks.stage` for the stage-linked work
window). Phase 3 (18 + 19) and 20–22 must be run in the Supabase SQL editor
for those features to persist.

## 8. How it was built (timeline)

1. **Foundation** — test-bench Sales OS on Supabase + AI proxy; PMS
   look-and-feel conversion; real Supabase auth; menu regrouped; light/dark.
2. **Phase 0** — off the JSON-blob storage onto the shared relational
   `core`+`sales` schemas of eb-core-database-1, RPC-guarded roster,
   one-paste runbook.
3. **Phase 1–2 (PMS parity)** — Google Drive integration; official client-ID
   minting; task system; per-company workspace tabs (plan, brainstorm→comms,
   Drive intel, saved chat); PMS filter bars; KPI-scored work updates;
   Ideas & contribution; agentic Assistant + System Memory; scrum preview;
   Designer LLD; Project-ID→ULM pipe; Resources rebuild.
4. **Quality passes** — model floor raised to Sonnet 5; attachments made
   Claude-grade; Drive lookups fixed (deep listings, no false "empty");
   task lifecycle rebuilt around Start-first and task-specific questions;
   evidence model (file/link/none) with Drive verification; company
   matching everywhere.
5. **Scrum call + Fireflies + Client Comms** — the three features that
   don't exist in the PMS, designed fresh for sales.
6. **Repair pass** — full-codebase audit: data-loss guards in the sync
   layer, Ideas pipeline unfrozen, commitment→task de-duplication,
   legacy-brief crash guards, dead code removed.
7. **Structure + three backends** (latest) — App.tsx split into layers
   (views / `src/lib` services / `src/data` domain constants; `tables.ts`
   as the single source of table names); health check + scrum tests +
   rollback + architecture docs; Meet scheduling (via the PMS's edge
   function), login provisioning with real revoke, call-recording storage;
   scrum brought fully to the ODM2 shape; the work window gained the stage
   picker, stage guidance and task chat.

## 9. Current state & what's outstanding

**Live and working:** everything above, deployed on `main`. `npm run build`
passes; `npm run test:scrum` (19 tests) passes; `npm run check` reports each
backend as working / not configured / not deployed. `npm run typecheck`
reports ~297 pre-existing errors, all one class in `App.tsx` (untyped
destructured props); every file in `src/lib/` and `src/data/` is clean.

**Needs a one-time action (user side):**
- Run the pending SQL in the Supabase editor per `supabase/README.md`:
  `RUN-THIS-phase3.sql` (18+19) if not yet run, then `20-scrum-parity.sql`,
  `21-recordings-bucket.sql`, `22-task-stage.sql`.
- Google Drive service account needs **Editor** on the root folder for
  `write`/filing to work (Reader covers all read paths).
- `SUPABASE_SERVICE_ROLE_KEY` in Vercel (server-only, never `VITE_`) to
  enable login create/reset/revoke from Admin.
- Optional: `FIREFLIES_API_KEY` in Vercel (paid Fireflies plan) to enable
  "Pull from Fireflies"; make the daily scrum a recurring calendar event so
  Fireflies auto-joins. Meet scheduling needs nothing — it rides the PMS's
  deployed edge function.
- Vercel env: ensure no stale `ANTHROPIC_MODEL` override (Sonnet 5 is the
  default).

**Known open item:** whole-collection syncs mean two browsers editing the
same collection can still overwrite each other's *edits* (deletes are now
safe for tasks/scrums; six low-churn collections still prune). Per-row
writes or a Realtime subscription is the eventual fix — tracked in
`docs/ARCHITECTURE.md`.

**Where the tool's intelligence comes from:** the code is finished scaffolding;
sharpness depends on what the team feeds it — company records to 100%,
product-family entries, commercial rules in System Memory, real box-build
criteria, stage-gate questions in Elecbits language, artifacts filed in
Drive. The full supply checklist is `docs/LEARNING.md`.
