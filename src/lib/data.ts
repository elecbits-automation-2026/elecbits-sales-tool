// Data layer: relational Supabase (sales.* + core.*) in, the app's existing
// collection shapes out.
//
// Phase 0 contract: the UI keeps working on whole arrays (users, companies,
// deals, …) exactly as it did against the JSON blob; this module loads those
// arrays from the relational schema and syncs them back with wholesale
// upserts. Later phases replace wholesale syncs with per-row operations as
// each feature is reworked — the strangler pattern, applied to a data layer.
//
// The schema is the SHARED one the PMS built (core.people / core.orgs /
// core.trainings), plus this tool's own `sales` schema — see
// supabase/10-sales-port.sql. Rules that shape this file:
//   • core.people rows are shared with the PMS. The sales rank lives in
//     sales.people_detail; roster writes go through the SECURITY DEFINER
//     RPC sales.upsert_person, never straight at core.people.
//   • core.orgs is shared: the app fills gaps but never touches client_id
//     (official Eb- IDs) or another tool's columns.
//   • core.trainings is shared with the PMS: queries and prunes are scoped
//     to people on the SALES roster.
//
// Ids: every entity id is a uuid. Migrated rows carry deterministic
// md5-derived uuids (see supabase/11-migrate-blobs.sql); new rows get
// crypto.randomUUID() from the app. Append-only children (activities, deal
// moves) travel inside their parent objects with a hidden `_id` marking rows
// already persisted — sync inserts only entries without one.

import { supabase, type Client } from "./supabase";
import { tbl, RPC, type TableName } from "./tables";

/* ---------- small helpers ---------- */

const uuid = () => crypto.randomUUID();

async function rows(q: any, label: string): Promise<any[]> {
  const { data, error } = await q;
  if (error) throw new Error(label + ": " + error.message);
  return data || [];
}

function ok(error: any, label: string): boolean {
  if (error) { console.error(label, error.message || error); return false; }
  return true;
}

// The KPI blob is one standing set per person, applied month after month.
const TARGET_PERIOD = "default";

// Who is on the sales roster (core.people ids) — set by loadWorkspace, used
// to scope the shared core.trainings table to this tool's people.
let rosterIds: string[] = [];

// Tables whose load silently degraded to [] (missing migration, transient
// error). A sync against a degraded table must never prune: the app's array
// is empty because the LOAD failed, not because the rows are gone.
const degraded = new Set<string>();

/* ---------- load ---------- */

// Everything the app needs, in its existing shapes. One round of parallel
// selects; RLS decides what the signed-in person may see.
export async function loadWorkspace() {
  const [
    people, details, orgs, orgDetails, activities,
    deals, moves, targets, trainings, worklogs,
    knowledge, expenses, scrums, memory, gates,
    tasks, llds, questionSets, requests,
  ] = await Promise.all([
    rows(tbl(supabase, "people").select("*"), "people"),
    rows(tbl(supabase, "people_detail").select("*"), "people_detail"),
    rows(tbl(supabase, "orgs").select("*"), "orgs"),
    rows(tbl(supabase, "org_detail").select("*"), "org_detail"),
    rows(tbl(supabase, "org_activities").select("*").order("at"), "org_activities"),
    rows(tbl(supabase, "deals").select("*"), "deals"),
    rows(tbl(supabase, "deal_moves").select("*").order("at"), "deal_moves"),
    rows(tbl(supabase, "targets").select("*").eq("period", TARGET_PERIOD), "targets"),
    rows(tbl(supabase, "trainings").select("*"), "trainings"),
    rows(tbl(supabase, "work_updates").select("*"), "work_updates"),
    rows(tbl(supabase, "knowledge").select("*"), "knowledge"),
    rows(tbl(supabase, "travel_requests").select("*"), "travel_requests"),
    rows(tbl(supabase, "scrum_notes").select("*"), "scrum_notes"),
    rows(tbl(supabase, "memory").select("*"), "memory"),
    rows(tbl(supabase, "gate_config").select("*"), "gate_config"),
    // Phase 1 tables may not exist until 12-phase1.sql runs — degrade to empty,
    // but REMEMBER the failure so no sync ever prunes against a phantom [].
    tbl(supabase, "tasks").select("*").then((r: any) => { if (r.error) degraded.add("tasks"); return r.data || []; }),
    tbl(supabase, "llds").select("*").then((r: any) => { if (r.error) degraded.add("llds"); return r.data || []; }),
    tbl(supabase, "question_sets").select("*").then((r: any) => r.data || []),
    tbl(supabase, "requests").select("*").then((r: any) => r.data || []),
  ]);

  const peopleById = new Map(people.map((p: any) => [p.id, p]));

  // users — only people with a sales.people_detail row appear in the Sales UI.
  const users = details
    .map((d: any) => {
      const p: any = peopleById.get(d.person_id);
      if (!p) return null;
      return {
        id: p.id, name: p.name || "", email: (p.email || "").toLowerCase(),
        role: d.role, dept: d.dept || "Sales",
        active: d.active !== false,
        authId: p.auth_id || null, // null = rostered but never signed in
      };
    })
    .filter(Boolean);
  rosterIds = users.map((u: any) => u.id);
  const rosterSet = new Set(rosterIds);

  // companies — orgs that carry a sales.org_detail row are "sales companies";
  // orgs the PMS knows but sales has not touched stay out of the list.
  const actByOrg = new Map<string, any[]>();
  for (const a of activities) {
    const list = actByOrg.get(a.org_id) || [];
    list.push({ _id: a.id, at: a.at, by: a.author_id, text: a.body });
    actByOrg.set(a.org_id, list);
  }
  const orgById = new Map(orgs.map((o: any) => [o.id, o]));
  const companies = orgDetails
    .map((d: any) => {
      const o: any = orgById.get(d.org_id);
      if (!o) return null;
      return {
        id: o.id,
        cid: o.client_id || d.legacy_cid || "",
        official: !!o.client_id, // true once the Eb- ID is minted
        orgSize: o.org_size || "",
        name: o.name,
        contactPerson: d.contact_person || "", designation: d.designation || "",
        phone: d.contact_phone || "", email: d.contact_email || "",
        city: d.city || "", industry: o.industry || "",
        whatTheyDo: d.what_they_do || "", source: d.source || "",
        potential: Number(d.potential || 0), website: o.website || "",
        address: (o.address && o.address.text) || "",
        legacyCid: d.legacy_cid || "",
        plan: d.plan || {},
        accountOwner: o.owner_id, createdBy: o.owner_id,
        createdAt: d.created_at,
        custom: Array.isArray(d.custom) ? d.custom : [],
        activity: actByOrg.get(o.id) || [],
      };
    })
    .filter(Boolean);

  // deals — history rides along, ordered oldest-first like the blob did.
  const movesByDeal = new Map<string, any[]>();
  for (const m of moves) {
    const list = movesByDeal.get(m.deal_id) || [];
    list.push({
      _id: m.id, from: m.from_stage, to: m.to_stage, at: m.at, by: m.author_id,
      summary: m.summary || "", facts: m.facts || {}, risks: m.risks || [],
      next_action: m.next_action || "", transcript: m.transcript || [],
      gated: m.gated, forced: m.forced,
    });
    movesByDeal.set(m.deal_id, list);
  }
  const dealsOut = deals.map((d: any) => ({
    id: d.id, did: d.code, companyId: d.org_id, ownerId: d.owner_id,
    value: Number(d.value || 0), stage: d.stage,
    createdAt: d.created_at, updatedAt: d.updated_at,
    lost: d.lost, lostInfo: d.lost ? { summary: d.lost_note || "" } : undefined,
    history: movesByDeal.get(d.id) || [],
  }));

  // kpis — {userId: {metric: target}}.
  const kpis: Record<string, Record<string, number>> = {};
  for (const t of targets) {
    (kpis[t.person_id] = kpis[t.person_id] || {})[t.metric] = Number(t.target || 0);
  }

  // trainings — core.trainings is shared with the PMS; show only rows that
  // belong to people on the sales roster. `resource` carries the linked
  // knowledge entry's uuid (as text) when there is one.
  const knowledgeIds = new Set(knowledge.map((k: any) => k.id));
  const trainingsOut = trainings
    .filter((t: any) => rosterSet.has(t.user_id))
    .map((t: any) => ({
      id: t.id, title: t.title, assignedTo: t.user_id, assignedBy: t.assigned_by,
      due: t.due || "", status: t.status,
      knowledgeId: knowledgeIds.has(t.resource) ? t.resource : "",
    }));

  const worklogsOut = worklogs.map((w: any) => ({
    id: w.id, userId: w.person_id, date: w.on_date, progress: w.note || "",
    score: w.score, feedback: w.feedback || "",
  }));

  const knowledgeOut = knowledge.map((k: any) => ({
    id: k.id, title: k.title, content: k.content, access: k.access,
    createdBy: k.created_by, updatedAt: k.updated_at,
  }));

  const expensesOut = expenses.map((e: any) => ({
    id: e.id, userId: e.person_id, companyId: e.org_id || "",
    purpose: e.purpose, city: e.city || "", from: e.from_date || "",
    to: e.to_date || "", mode: e.mode || "", estimate: Number(e.estimate || 0),
    notes: e.notes || "", status: e.status, decidedBy: e.decided_by,
    decidedAt: e.decided_at, decisionNote: e.decision_note || "", createdAt: e.created_at,
  }));

  const scrumsOut = scrums.map((s: any) => ({
    id: s.id, userId: s.author_id, date: s.on_date, raw: s.raw,
    tasks: (s.organized && s.organized.tasks) || [],
    summary: (s.organized && s.organized.summary) || "",
    tasked: !!(s.organized && s.organized.tasked),
    blockers: (s.organized && s.organized.blockers) || [],
    decisions: (s.organized && s.organized.decisions) || [],
    ignored: (s.organized && s.organized.ignored) || "",
    noteNo: (s.organized && s.organized.noteNo) || null,
    time: (s.organized && s.organized.time) || "",
    origin: (s.organized && s.organized.origin) || "manual",
    meetingIds: (s.organized && s.organized.meetingIds) || [],
    engine: (s.organized && s.organized.engine) || "ai",
    link: s.meet_link || "", attendance: s.attendance || {},
    source: s.source || "typed", transcript: s.transcript || "",
    transcriptUrl: s.transcript_url || "",
    _transcriptSynced: !!s.transcript,
    createdAt: s.created_at,
  }));

  const memoryOut = memory.map((m: any) => ({
    id: m.id, title: m.title, text: m.content, updatedAt: m.updated_at, by: m.created_by,
  }));

  const gatesOut: Record<string, string[]> = {};
  for (const g of gates) gatesOut[g.stage] = g.requirements || [];

  const tasksOut = tasks.map((t: any) => ({
    id: t.id, companyId: t.org_id || "", dealId: t.deal_id || "",
    assignee: t.assignee_id, author: t.author_id,
    title: t.title, details: t.details || "", due: t.due || "",
    status: t.status, source: t.source, createdAt: t.created_at, doneAt: t.done_at,
    windowStart: t.window_start || "", windowEnd: t.window_end || "",
    scrumNoteId: t.scrum_note_id || "",
    work: t.work || {}, ai: t.ai || {}, escalated: !!t.escalated,
    branchedFrom: t.branched_from || "",
    // 20-scrum-parity.sql. Older rows predate the columns, hence the defaults.
    steps: t.steps || [], conditions: t.conditions || [],
  }));

  const lldsOut = llds.map((l: any) => ({
    id: l.id, companyId: l.org_id, dealId: l.deal_id || "", title: l.title,
    answers: l.answers || {}, status: l.status, createdBy: l.created_by,
    createdAt: l.created_at, updatedAt: l.updated_at,
  }));

  const qsetsOut: Record<string, { title: string; questions: string[] }> = {};
  for (const q of questionSets) qsetsOut[q.key] = { title: q.title, questions: q.questions || [] };

  const requestsOut = requests.map((r: any) => ({
    id: r.id, companyId: r.org_id || "", title: r.title, summary: r.summary || "",
    kind: r.proposed_kind || "", qty: r.qty, targetDate: r.target_date || "",
    value: Number(r.value_inr || 0), urgency: r.urgency, status: r.status,
    projectId: r.project_id || "", decidedAt: r.decided_at, decisionNote: r.decision_note || "",
    submittedBy: r.submitted_by, submittedAt: r.submitted_at,
  }));

  return {
    users, companies, deals: dealsOut, kpis, trainings: trainingsOut,
    worklogs: worklogsOut, knowledge: knowledgeOut, expenses: expensesOut,
    scrums: scrumsOut, memory: memoryOut, gates: gatesOut,
    tasks: tasksOut, llds: lldsOut, questionSets: qsetsOut, requests: requestsOut,
  };
}

/* ---------- phase 1 syncs ---------- */

export async function syncTasks(tasks: any[]): Promise<boolean> {
  const rowsIn = tasks.map((t) => ({
    id: t.id, org_id: t.companyId || null, deal_id: t.dealId || null,
    assignee_id: t.assignee, author_id: t.author || null,
    title: t.title, details: t.details || null, due: t.due || null,
    status: t.status, source: t.source || "manual",
    done_at: t.status === "done" ? (t.doneAt || new Date().toISOString()) : null,
    window_start: t.windowStart || null, window_end: t.windowEnd || null,
    scrum_note_id: t.scrumNoteId || null,
    work: t.work || {}, ai: t.ai || {}, escalated: !!t.escalated,
    branched_from: t.branchedFrom || null,
    steps: t.steps || [], conditions: t.conditions || [],
  }));
  // Upsert only. Tasks are created by everyone from everywhere (scrums,
  // assistant, comms, branches) — pruning against one browser's possibly
  // stale array would silently delete a teammate's fresh tasks. Deletion is
  // an explicit act: deleteTask().
  if (!rowsIn.length) return true;
  const { error } = await tbl(supabase, "tasks").upsert(rowsIn, { onConflict: "id" });
  return ok(error, "syncTasks");
}

export async function deleteTask(id: string): Promise<boolean> {
  const { error } = await tbl(supabase, "tasks").delete().eq("id", id);
  return ok(error, "deleteTask");
}

export async function syncLlds(llds: any[]): Promise<boolean> {
  const rowsIn = llds.map((l) => ({
    id: l.id, org_id: l.companyId, deal_id: l.dealId || null, title: l.title,
    answers: l.answers || {}, status: l.status, created_by: l.createdBy || null,
  }));
  return upsertAndPrune("llds", rowsIn, llds.map((l) => l.id), "syncLlds");
}

export async function syncQuestionSet(key: string, title: string, questions: string[]): Promise<boolean> {
  const { error } = await tbl(supabase, "question_sets")
    .upsert({ key, title, questions }, { onConflict: "key" });
  return ok(error, "syncQuestionSet." + key);
}

// Mint the next official client serial from the shared core.numbering mint and
// stamp the composed Eb-<industry>-<size>-<serial> onto the org. One-way: an
// org that already has an official ID keeps it.
export async function mintClientId(orgId: string, industryCode: number, sizeCode: string): Promise<string | null> {
  const { data: existing } = await tbl(supabase, "orgs").select("client_id").eq("id", orgId).maybeSingle();
  if (existing?.client_id) return existing.client_id;
  const { data: serial, error } = await supabase.schema("core").rpc(RPC.nextNumber, { p_kind: "client_serial" });
  if (error) { console.error("mintClientId", error.message); return null; }
  const cid = "Eb-" + String(industryCode).padStart(2, "0") + "-" + sizeCode + "-" + serial;
  const { error: e2 } = await tbl(supabase, "orgs")
    .update({ client_id: cid, org_size: sizeCode }).eq("id", orgId);
  if (e2) { console.error("mintClientId.update", e2.message); return null; }
  return cid;
}

// Raise a Project-ID request into the shared pipe (sales.requests → core.intake
// → ULM decides). Returns the created row's id, or null.
export async function submitProjectRequest(req: any): Promise<string | null> {
  const { data, error } = await tbl(supabase, "requests").insert({
    org_id: req.companyId, title: req.title, summary: req.summary || null,
    proposed_kind: req.kind || null, qty: req.qty || null,
    target_date: req.targetDate || null, value_inr: Number(req.value || 0) || null,
    urgency: req.urgency || "normal", status: "submitted",
    submitted_by: req.by || null,
  }).select("id").single();
  if (error) { console.error("submitProjectRequest", error.message); return null; }
  return data?.id || null;
}

/* ---------- syncs (wholesale, Phase 0) ---------- */

// Roster writes go through the SECURITY DEFINER RPC — a sales admin may
// manage the sales roster without holding any core-admin role. If an email
// already belongs to a core person (a PMS engineer, say), the RPC adopts
// that row instead of duplicating it; the app picks up the real id on the
// next load.
export async function syncUsers(users: any[]): Promise<boolean> {
  let allOk = true;
  for (const u of users) {
    const { error } = await supabase.rpc(RPC.upsertPerson, {
      p_id: u.id || null,
      p_name: u.name || "",
      p_email: (u.email || "").toLowerCase() || null,
      p_role: u.role || "agent",
      p_dept: u.dept || "Sales",
      p_active: u.active !== false,
    });
    allOk = ok(error, "syncUsers." + (u.email || u.id)) && allOk;
  }
  return allOk;
}

export async function syncCompanies(companies: any[]): Promise<boolean> {
  if (!companies.length) return true;
  // core.orgs is shared: write only the columns this tool owns a say in, and
  // never client_id (official Eb- IDs are minted, not typed).
  const orgs = companies.map((c) => ({
    id: c.id, name: c.name || "(unnamed)",
    industry: c.industry || null, website: c.website || null,
    owner_id: c.accountOwner || null,
    address: c.address ? { text: c.address } : {},
  }));
  const details = companies.map((c) => ({
    org_id: c.id, what_they_do: c.whatTheyDo || null,
    city: c.city || null, source: c.source || null,
    potential: Number(c.potential || 0),
    // once the official Eb- ID is minted, cid holds it — keep the legacy
    // pseudo-id separately and never let the official ID overwrite it
    legacy_cid: (c.official ? c.legacyCid : (c.legacyCid || c.cid)) || null,
    contact_person: c.contactPerson || null, designation: c.designation || null,
    contact_phone: c.phone || null, contact_email: c.email || null,
    custom: c.custom || [], plan: c.plan || {},
  }));
  const r1 = await tbl(supabase, "orgs").upsert(orgs, { onConflict: "id" });
  const r2 = await tbl(supabase, "org_detail").upsert(details, { onConflict: "org_id" });
  let allOk = ok(r1.error, "syncCompanies.orgs") && ok(r2.error, "syncCompanies.detail");

  // Append-only notes: persist only entries that have never been written.
  const fresh: any[] = [];
  for (const c of companies) {
    for (const a of c.activity || []) {
      if (!a._id) {
        a._id = uuid();
        fresh.push({ id: a._id, org_id: c.id, kind: "note", body: a.text || "", author_id: a.by || null, at: a.at });
      }
    }
  }
  if (fresh.length) {
    const r3 = await tbl(supabase, "org_activities").insert(fresh);
    allOk = ok(r3.error, "syncCompanies.activities") && allOk;
  }
  return allOk;
}

export async function syncDeals(deals: any[]): Promise<boolean> {
  if (!deals.length) return true;
  const dealRows = deals.map((d) => ({
    id: d.id, code: d.did, org_id: d.companyId, owner_id: d.ownerId || null,
    value: Number(d.value || 0), stage: d.stage, lost: !!d.lost,
    lost_note: (d.lostInfo && d.lostInfo.summary) || null,
    created_at: d.createdAt, updated_at: d.updatedAt,
  }));
  const r1 = await tbl(supabase, "deals").upsert(dealRows, { onConflict: "id" });
  let allOk = ok(r1.error, "syncDeals.deals");

  const fresh: any[] = [];
  for (const d of deals) {
    for (const h of d.history || []) {
      if (!h._id) {
        h._id = uuid();
        fresh.push({
          id: h._id, deal_id: d.id, from_stage: h.from || null, to_stage: h.to || null,
          summary: h.summary || null, facts: h.facts || {}, risks: h.risks || [],
          next_action: h.next_action || null, transcript: h.transcript || [],
          gated: !!h.gated, forced: !!h.forced, author_id: h.by || null, at: h.at,
        });
      }
    }
  }
  if (fresh.length) {
    const r2 = await tbl(supabase, "deal_moves").insert(fresh);
    allOk = ok(r2.error, "syncDeals.moves") && allOk;
  }
  return allOk;
}

export async function syncKpis(kpis: Record<string, Record<string, number>>): Promise<boolean> {
  const rowsIn: any[] = [];
  for (const [personId, metrics] of Object.entries(kpis || {})) {
    for (const [metric, target] of Object.entries(metrics || {})) {
      rowsIn.push({ person_id: personId, period: TARGET_PERIOD, metric, target: Number(target || 0) });
    }
  }
  if (!rowsIn.length) return true;
  const { error } = await tbl(supabase, "targets")
    .upsert(rowsIn, { onConflict: "person_id,period,metric" });
  return ok(error, "syncKpis");
}

// Small collections that support delete-in-UI: upsert what's present, remove
// what's gone. Two hard safety rules: never prune a table whose load degraded
// (the [] is a phantom), and never turn an empty array into a full-table
// wipe — a stray leftover row is recoverable, a deleted table is not.
async function upsertAndPrune(table: TableName, rowsIn: any[], keepIds: string[], label: string, client: Client = supabase): Promise<boolean> {
  let allOk = true;
  if (rowsIn.length) {
    const { error } = await tbl(client, table).upsert(rowsIn, { onConflict: "id" });
    allOk = ok(error, label + ".upsert");
  }
  if (!keepIds.length || degraded.has(table)) return allOk;
  const list = "(" + keepIds.map((i) => '"' + i + '"').join(",") + ")";
  const { error: e2 } = await tbl(client, table).delete().not("id", "in", list);
  return ok(e2, label + ".prune") && allOk;
}

export async function syncTrainings(trainings: any[]): Promise<boolean> {
  // core.trainings is shared with the PMS — every write and every delete here
  // is scoped to people on the sales roster.
  const rowsIn = trainings.map((t) => ({
    id: t.id, user_id: t.assignedTo, title: t.title,
    resource: t.knowledgeId || null, due: t.due || null,
    status: t.status, assigned_by: t.assignedBy || null,
  }));
  let allOk = true;
  if (rowsIn.length) {
    const { error } = await tbl(supabase, "trainings").upsert(rowsIn, { onConflict: "id" });
    allOk = ok(error, "syncTrainings.upsert");
  }
  if (rosterIds.length) {
    const keep = trainings.map((t) => t.id);
    let del = tbl(supabase, "trainings").delete()
      .in("user_id", rosterIds);
    if (keep.length) del = del.not("id", "in", "(" + keep.map((i) => '"' + i + '"').join(",") + ")");
    const { error: e2 } = await del;
    allOk = ok(e2, "syncTrainings.prune") && allOk;
  }
  return allOk;
}

export async function syncWorklogs(worklogs: any[]): Promise<boolean> {
  if (!worklogs.length) return true;
  const rowsIn = worklogs.map((w) => ({
    id: w.id, person_id: w.userId, on_date: w.date, note: w.progress || "",
    score: w.score ?? null, feedback: w.feedback || null,
  }));
  const { error } = await tbl(supabase, "work_updates")
    .upsert(rowsIn, { onConflict: "person_id,on_date" });
  return ok(error, "syncWorklogs");
}

export async function syncKnowledge(knowledge: any[]): Promise<boolean> {
  const rowsIn = knowledge.map((k) => ({
    id: k.id, title: k.title, content: k.content, access: k.access,
    created_by: k.createdBy || null,
  }));
  return upsertAndPrune("knowledge", rowsIn, knowledge.map((k) => k.id), "syncKnowledge");
}

export async function syncExpenses(expenses: any[]): Promise<boolean> {
  if (!expenses.length) return true;
  const rowsIn = expenses.map((e) => ({
    id: e.id, person_id: e.userId, org_id: e.companyId || null,
    purpose: e.purpose, city: e.city || null,
    from_date: e.from || null, to_date: e.to || null, mode: e.mode || null,
    estimate: Number(e.estimate || 0), notes: e.notes || null, status: e.status,
    decided_by: e.decidedBy || null,
    decided_at: e.status === "pending" ? null : (e.decidedAt || new Date().toISOString()),
    decision_note: e.decisionNote || null, created_at: e.createdAt,
  }));
  const { error } = await tbl(supabase, "travel_requests").upsert(rowsIn, { onConflict: "id" });
  return ok(error, "syncExpenses");
}

export async function syncScrums(scrums: any[]): Promise<boolean> {
  const rowsIn = scrums.map((s) => {
    const row: any = {
      id: s.id, on_date: s.date, raw: s.raw,
      organized: { tasks: s.tasks || [], summary: s.summary || "", tasked: !!s.tasked,
                   blockers: s.blockers || [], decisions: s.decisions || [], ignored: s.ignored || "",
                   // "Note 1, Note 2…" within the day, the clock time it was
                   // written, and which recorded calls fed it.
                   noteNo: s.noteNo || null, time: s.time || null,
                   origin: s.origin || "manual", meetingIds: s.meetingIds || [],
                   engine: s.engine || "ai" },
      meet_link: s.link || null, attendance: s.attendance || {},
      source: s.source || "typed", transcript_url: s.transcriptUrl || null,
      author_id: s.userId || null, created_at: s.createdAt,
    };
    // A transcript is written once. Re-sending 40k characters on every scrum
    // save would make an ordinary edit cost megabytes.
    if (!s._transcriptSynced) row.transcript = s.transcript || null;
    return row;
  });
  // Upsert only — same reasoning as syncTasks: notes are written by the whole
  // team, so pruning against one stale array deletes someone else's note.
  if (!rowsIn.length) return true;
  const { error } = await tbl(supabase, "scrum_notes").upsert(rowsIn, { onConflict: "id" });
  return ok(error, "syncScrums");
}

export async function deleteScrum(id: string): Promise<boolean> {
  const { error } = await tbl(supabase, "scrum_notes").delete().eq("id", id);
  return ok(error, "deleteScrum");
}

export async function syncMemory(memory: any[]): Promise<boolean> {
  const rowsIn = memory.map((m) => ({
    id: m.id, title: m.title, content: m.text, created_by: m.by || null,
  }));
  return upsertAndPrune("memory", rowsIn, memory.map((m) => m.id), "syncMemory");
}

export async function syncGates(gates: Record<string, string[]>): Promise<boolean> {
  const stages = Object.keys(gates || {});
  let allOk = true;
  if (stages.length) {
    const rowsIn = stages.map((stage) => ({ stage, requirements: gates[stage] || [] }));
    const { error } = await tbl(supabase, "gate_config").upsert(rowsIn, { onConflict: "stage" });
    allOk = ok(error, "syncGates.upsert");
  }
  const q = tbl(supabase, "gate_config").delete();
  const { error: e2 } = stages.length
    ? await q.not("stage", "in", "(" + stages.map((s) => '"' + s + '"').join(",") + ")")
    : await q.neq("stage", "");
  return ok(e2, "syncGates.prune") && allOk;
}

// Brainstorming sessions — sales.meetings + ideas/decisions/challenges
// (the Phase 0 quartet). Loaded on demand per company; wholesale-synced.
export async function loadSessions(orgId: string): Promise<any[]> {
  const [m, i, d, c] = await Promise.all([
    tbl(supabase, "meetings").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    tbl(supabase, "meeting_ideas").select("*"),
    tbl(supabase, "meeting_decisions").select("*"),
    tbl(supabase, "meeting_challenges").select("*"),
  ]);
  return (m.data || []).map((s: any) => ({
    id: s.id, companyId: s.org_id, dealId: s.deal_id || "", date: s.on_date,
    title: s.title || "", attendees: s.attendees || [], raw: s.raw || "",
    createdBy: s.author_id, createdAt: s.created_at,
    ideas: (i.data || []).filter((x: any) => x.meeting_id === s.id).sort((a: any, b: any) => a.seq - b.seq)
      .map((x: any) => ({ _id: x.id, by: x.by_name || "", authorId: x.author_id, idea: x.idea, impact: x.impact || "", value: x.value, why: x.why || "" })),
    decisions: (d.data || []).filter((x: any) => x.meeting_id === s.id).sort((a: any, b: any) => a.seq - b.seq)
      .map((x: any) => ({ _id: x.id, what: x.what, ownerName: x.owner_name || "" })),
    challenges: (c.data || []).filter((x: any) => x.meeting_id === s.id).sort((a: any, b: any) => a.seq - b.seq)
      .map((x: any) => ({ _id: x.id, challenge: x.challenge, action: x.action || "", status: x.status })),
  }));
}
export async function saveSession(s: any): Promise<boolean> {
  const r1 = await tbl(supabase, "meetings").upsert({
    id: s.id, org_id: s.companyId, deal_id: s.dealId || null, on_date: s.date,
    title: s.title || null, attendees: s.attendees || [], raw: s.raw || null, author_id: s.createdBy || null,
  }, { onConflict: "id" });
  let allOk = ok(r1.error, "saveSession.meeting");
  const kid = (x: any) => x._id || crypto.randomUUID();
  const ideas = (s.ideas || []).map((x: any, seq: number) => ({ id: (x._id = kid(x)), meeting_id: s.id, seq, author_id: x.authorId || null, by_name: x.by || null, idea: x.idea, impact: x.impact || null, value: x.value || null, why: x.why || null }));
  const decisions = (s.decisions || []).map((x: any, seq: number) => ({ id: (x._id = kid(x)), meeting_id: s.id, seq, what: x.what, owner_name: x.ownerName || null }));
  const challenges = (s.challenges || []).map((x: any, seq: number) => ({ id: (x._id = kid(x)), meeting_id: s.id, seq, challenge: x.challenge, action: x.action || null, status: x.status || "open" }));
  const children: [TableName, any[]][] = [["meeting_ideas", ideas], ["meeting_decisions", decisions], ["meeting_challenges", challenges]];
  for (const [table, rowsIn] of children) {
    if (rowsIn.length) {
      const { error } = await tbl(supabase, table).upsert(rowsIn, { onConflict: "id" });
      allOk = ok(error, "saveSession." + table) && allOk;
    }
  }
  return allOk;
}

// Every credited idea across all brainstorming sessions — for the
// Performance "Ideas & contribution" tab.
export async function loadAllIdeas(): Promise<any[]> {
  const [i, m] = await Promise.all([
    tbl(supabase, "meeting_ideas").select("*"),
    tbl(supabase, "meetings").select("id, org_id, on_date, title"),
  ]);
  const mm = new Map((m.data || []).map((x: any) => [x.id, x]));
  return (i.data || []).map((x: any) => {
    const s: any = mm.get(x.meeting_id) || {};
    return { id: x.id, by: x.by_name || "", authorId: x.author_id, idea: x.idea,
             impact: x.impact || "", value: x.value, why: x.why || "",
             companyId: s.org_id || "", date: s.on_date || "", session: s.title || "" };
  });
}

// Client touches — every call, mail, WhatsApp, meeting or visit with a
// client, and the promises made in them. org_activities is the touch log;
// kind='note' rows stay the internal activity feed and are filtered out here.
export async function loadTouches(orgId: string): Promise<any[]> {
  const { data } = await tbl(supabase, "org_activities").select("*")
    .eq("org_id", orgId).neq("kind", "note").order("occurred_at", { ascending: false });
  return (data || []).map((a: any) => ({
    id: a.id, companyId: a.org_id, kind: a.kind, direction: a.direction,
    subject: a.subject || "", body: a.body || "", contactName: a.contact_name || "",
    at: a.occurred_at || a.at, loggedAt: a.at, author: a.author_id,
    dealId: a.deal_id || "", meetingId: a.meeting_id || "",
    link: a.link || "", driveFile: a.drive_file || "", source: a.source || "manual",
    ai: a.ai || {},
  }));
}
export async function saveTouch(t: any): Promise<string | null> {
  const row = {
    id: t.id, org_id: t.companyId, kind: t.kind, direction: t.direction || "out",
    subject: t.subject || null, body: t.body || "", contact_name: t.contactName || null,
    occurred_at: t.at, author_id: t.author || null, deal_id: t.dealId || null,
    meeting_id: t.meetingId || null, link: t.link || null, drive_file: t.driveFile || null,
    source: t.source || "manual", ai: t.ai || {},
  };
  const { data, error } = await tbl(supabase, "org_activities").upsert(row, { onConflict: "id" }).select("id").single();
  if (!ok(error, "saveTouch")) return null;
  return (data && data.id) || t.id;
}

export async function loadCommitments(orgId?: string): Promise<any[]> {
  let q = tbl(supabase, "commitments").select("*").order("due", { ascending: true });
  if (orgId) q = q.eq("org_id", orgId);
  const { data } = await q;
  return (data || []).map((c: any) => ({
    id: c.id, companyId: c.org_id, activityId: c.activity_id || "", taskId: c.task_id || "",
    side: c.side, what: c.what, toWhom: c.to_whom || "", ownerId: c.owner_id,
    due: c.due || "", certainty: c.certainty, status: c.status,
    closedAt: c.closed_at, closedNote: c.closed_note || "", evidence: c.evidence || "",
    createdAt: c.created_at,
  }));
}
export async function saveCommitments(list: any[]): Promise<boolean> {
  if (!list.length) return true;
  const rowsIn = list.map((c) => ({
    id: c.id, org_id: c.companyId, activity_id: c.activityId || null, task_id: c.taskId || null,
    side: c.side || "us", what: c.what, to_whom: c.toWhom || null, owner_id: c.ownerId || null,
    due: c.due || null, certainty: c.certainty || "promised", status: c.status || "open",
    closed_at: c.status && c.status !== "open" ? (c.closedAt || new Date().toISOString()) : null,
    closed_note: c.closedNote || null, evidence: c.evidence || null, created_by: c.createdBy || null,
  }));
  const { error } = await tbl(supabase, "commitments").upsert(rowsIn, { onConflict: "id" });
  return ok(error, "saveCommitments");
}

// Chat threads — one per person per day; org_id scopes a thread to a company
// ("Ask the AI" on the record) while null is the personal Assistant.
// select→insert/update instead of upsert: the uniqueness lives in two partial
// indexes (with/without org), which ON CONFLICT can't target generically.
function chatScope(q: any, personId: string, date: string, orgId?: string | null) {
  q = q.eq("person_id", personId).eq("on_date", date);
  return orgId ? q.eq("org_id", orgId) : q.is("org_id", null);
}
export async function loadChat(personId: string, date: string, orgId?: string | null): Promise<any[]> {
  const { data } = await chatScope(tbl(supabase, "chats").select("messages"), personId, date, orgId).maybeSingle();
  return (data && data.messages) || [];
}
export async function loadChatDates(personId: string, orgId?: string | null): Promise<string[]> {
  let q = tbl(supabase, "chats").select("on_date").eq("person_id", personId);
  q = orgId ? q.eq("org_id", orgId) : q.is("org_id", null);
  const { data } = await q.order("on_date", { ascending: false }).limit(60);
  return (data || []).map((r: any) => r.on_date);
}
export async function saveChat(personId: string, date: string, messages: any[], orgId?: string | null): Promise<boolean> {
  const { data } = await chatScope(tbl(supabase, "chats").select("id"), personId, date, orgId).maybeSingle();
  if (data?.id) {
    const { error } = await tbl(supabase, "chats").update({ messages }).eq("id", data.id);
    return ok(error, "saveChat.update");
  }
  const { error } = await tbl(supabase, "chats")
    .insert({ person_id: personId, on_date: date, messages, org_id: orgId || null });
  return ok(error, "saveChat.insert");
}

/* ---------- auth ---------- */
