/* ─── WHERE EVERY TABLE LIVES ──────────────────────────────────────────────
   One map, one place. Table names used to be string literals scattered
   through data.ts — 55 of them — with the schema decided in two different
   ways: `sales` implicitly, because it is the client's default, and `core`
   explicitly, by reaching for a second client handle. Which schema a given
   query hit was therefore a property of which variable the author happened to
   type, and moving a table between schemas meant finding every literal.

   Now a move is an edit to this file.

   Two schemas matter to this app:

     core   what the whole company shares — people, orgs, trainings. The PMS,
            ULM, HR and Finance tools read the same rows. Sales fills gaps in
            these but never owns them.
     sales  this tool's own working data — deals, tasks, scrums, knowledge,
            the lot.

   Both must be listed in Supabase → Settings → API → Exposed schemas, or
   PostgREST answers 404 for everything here.

   NOTE ON SHARED TABLES: `core.people` and `core.trainings` are shared with
   the PMS. Roster writes go through the SECURITY DEFINER RPC
   `sales.upsert_person`, never straight at core.people — see RPC below. */

import type { Client } from "./supabase";

/** logical name → [schema, table] */
const WHERE = {
  // ── core: what the whole company shares ─────────────────────────────
  people:    ["core", "people"],
  orgs:      ["core", "orgs"],
  trainings: ["core", "trainings"],

  // ── sales: this tool's own ──────────────────────────────────────────
  people_detail:      ["sales", "people_detail"],
  org_detail:         ["sales", "org_detail"],
  org_activities:     ["sales", "org_activities"],
  deals:              ["sales", "deals"],
  deal_moves:         ["sales", "deal_moves"],
  targets:            ["sales", "targets"],
  work_updates:       ["sales", "work_updates"],
  knowledge:          ["sales", "knowledge"],
  travel_requests:    ["sales", "travel_requests"],
  scrum_notes:        ["sales", "scrum_notes"],
  memory:             ["sales", "memory"],
  gate_config:        ["sales", "gate_config"],
  tasks:              ["sales", "tasks"],
  llds:               ["sales", "llds"],
  question_sets:      ["sales", "question_sets"],
  requests:           ["sales", "requests"],
  chats:              ["sales", "chats"],
  commitments:        ["sales", "commitments"],
  meetings:           ["sales", "meetings"],
  meeting_ideas:      ["sales", "meeting_ideas"],
  meeting_decisions:  ["sales", "meeting_decisions"],
  meeting_challenges: ["sales", "meeting_challenges"],
  deal_stages:        ["sales", "deal_stages"],
  temperature_moves:  ["sales", "temperature_moves"],
  scrum_sessions:     ["sales", "scrum_sessions"],
} as const;

export type TableName = keyof typeof WHERE;

/** The RPCs this tool calls. Both are SECURITY DEFINER and live in `sales`. */
export const RPC = {
  /** Roster write. The only sanctioned path into core.people. */
  upsertPerson: "upsert_person",
  /** Mint the next official Eb- client id from the shared core.numbering. */
  nextNumber: "next_number",
} as const;

/* The client's default schema, set in supabase.ts. A table in this schema is
   addressed with a plain .from(); anything else needs .schema() first. */
const DEFAULT_SCHEMA = "sales";

/* A query builder for a logical table. Everything that touches Postgres goes
   through here — `tbl(sb, "deals")` rather than `sb.from("deals")` — so the
   name and the schema are never written twice, and a typo is a TypeScript
   error rather than a 404 at runtime. */
export function tbl(sb: Client, name: TableName) {
  const at = WHERE[name];
  if (!at) throw new Error(`Unknown table "${name}" — add it to src/lib/tables.ts`);
  const [schema, table] = at;
  return schema === DEFAULT_SCHEMA ? sb.from(table) : sb.schema(schema).from(table);
}

/** For error messages and logs: "core.people", not "people". */
export function tableName(name: TableName): string {
  const at = WHERE[name];
  return at ? `${at[0]}.${at[1]}` : String(name);
}

/** True when this table is shared with other tools and must not be pruned
    wholesale. Callers scope their deletes instead — see syncTrainings. */
export function isShared(name: TableName): boolean {
  return WHERE[name]?.[0] === "core";
}

export const TABLES = WHERE;
