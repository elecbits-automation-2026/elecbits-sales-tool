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

import { supabase, core } from "./supabase";

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

/* ---------- load ---------- */

// Everything the app needs, in its existing shapes. One round of parallel
// selects; RLS decides what the signed-in person may see.
export async function loadWorkspace() {
  const [
    people, details, orgs, orgDetails, activities,
    deals, moves, targets, trainings, worklogs,
    knowledge, expenses, scrums, memory, gates,
  ] = await Promise.all([
    rows(core.from("people").select("*"), "people"),
    rows(supabase.from("people_detail").select("*"), "people_detail"),
    rows(core.from("orgs").select("*"), "orgs"),
    rows(supabase.from("org_detail").select("*"), "org_detail"),
    rows(supabase.from("org_activities").select("*").order("at"), "org_activities"),
    rows(supabase.from("deals").select("*"), "deals"),
    rows(supabase.from("deal_moves").select("*").order("at"), "deal_moves"),
    rows(supabase.from("targets").select("*").eq("period", TARGET_PERIOD), "targets"),
    rows(core.from("trainings").select("*"), "trainings"),
    rows(supabase.from("work_updates").select("*"), "work_updates"),
    rows(supabase.from("knowledge").select("*"), "knowledge"),
    rows(supabase.from("travel_requests").select("*"), "travel_requests"),
    rows(supabase.from("scrum_notes").select("*"), "scrum_notes"),
    rows(supabase.from("memory").select("*"), "memory"),
    rows(supabase.from("gate_config").select("*"), "gate_config"),
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
        name: o.name,
        contactPerson: d.contact_person || "", designation: d.designation || "",
        phone: d.contact_phone || "", email: d.contact_email || "",
        city: d.city || "", industry: o.industry || "",
        whatTheyDo: d.what_they_do || "", source: d.source || "",
        potential: Number(d.potential || 0), website: o.website || "",
        address: (o.address && o.address.text) || "",
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
    createdAt: s.created_at,
  }));

  const memoryOut = memory.map((m: any) => ({
    id: m.id, title: m.title, text: m.content, updatedAt: m.updated_at, by: m.created_by,
  }));

  const gatesOut: Record<string, string[]> = {};
  for (const g of gates) gatesOut[g.stage] = g.requirements || [];

  return {
    users, companies, deals: dealsOut, kpis, trainings: trainingsOut,
    worklogs: worklogsOut, knowledge: knowledgeOut, expenses: expensesOut,
    scrums: scrumsOut, memory: memoryOut, gates: gatesOut,
  };
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
    const { error } = await supabase.rpc("upsert_person", {
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
    legacy_cid: c.cid || null,
    contact_person: c.contactPerson || null, designation: c.designation || null,
    contact_phone: c.phone || null, contact_email: c.email || null,
    custom: c.custom || [],
  }));
  const r1 = await core.from("orgs").upsert(orgs, { onConflict: "id" });
  const r2 = await supabase.from("org_detail").upsert(details, { onConflict: "org_id" });
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
    const r3 = await supabase.from("org_activities").insert(fresh);
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
  const r1 = await supabase.from("deals").upsert(dealRows, { onConflict: "id" });
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
    const r2 = await supabase.from("deal_moves").insert(fresh);
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
  const { error } = await supabase.from("targets")
    .upsert(rowsIn, { onConflict: "person_id,period,metric" });
  return ok(error, "syncKpis");
}

// Small collections that support delete-in-UI: upsert what's present, remove
// what's gone.
async function upsertAndPrune(table: string, rowsIn: any[], keepIds: string[], label: string, client: any = supabase): Promise<boolean> {
  let allOk = true;
  if (rowsIn.length) {
    const { error } = await client.from(table).upsert(rowsIn, { onConflict: "id" });
    allOk = ok(error, label + ".upsert");
  }
  const list = "(" + keepIds.map((i) => '"' + i + '"').join(",") + ")";
  const del = keepIds.length
    ? client.from(table).delete().not("id", "in", list)
    : client.from(table).delete().gte("created_at", "1970-01-01");
  const { error: e2 } = await del;
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
    const { error } = await core.from("trainings").upsert(rowsIn, { onConflict: "id" });
    allOk = ok(error, "syncTrainings.upsert");
  }
  if (rosterIds.length) {
    const keep = trainings.map((t) => t.id);
    let del = core.from("trainings").delete()
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
  }));
  const { error } = await supabase.from("work_updates")
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
  const { error } = await supabase.from("travel_requests").upsert(rowsIn, { onConflict: "id" });
  return ok(error, "syncExpenses");
}

export async function syncScrums(scrums: any[]): Promise<boolean> {
  const rowsIn = scrums.map((s) => ({
    id: s.id, on_date: s.date, raw: s.raw,
    organized: { tasks: s.tasks || [], summary: s.summary || "" },
    author_id: s.userId || null, created_at: s.createdAt,
  }));
  return upsertAndPrune("scrum_notes", rowsIn, scrums.map((s) => s.id), "syncScrums");
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
    const { error } = await supabase.from("gate_config").upsert(rowsIn, { onConflict: "stage" });
    allOk = ok(error, "syncGates.upsert");
  }
  const q = supabase.from("gate_config").delete();
  const { error: e2 } = stages.length
    ? await q.not("stage", "in", "(" + stages.map((s) => '"' + s + '"').join(",") + ")")
    : await q.neq("stage", "");
  return ok(e2, "syncGates.prune") && allOk;
}

/* ---------- auth ---------- */

// Onboarding pattern shared with the PMS: sign in; if the account does not
// exist yet, the first sign-in creates it, and the DB trigger adopts the
// person's roster row by email (an email nobody rostered authenticates into
// a fresh engineer row and sees NoProfile).
export async function signInOrUp(email: string, password: string) {
  const em = email.trim().toLowerCase();
  const s1 = await supabase.auth.signInWithPassword({ email: em, password });
  if (!s1.error) return { ok: true, error: "" };
  const msg = (s1.error.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) {
    const s2 = await supabase.auth.signUp({ email: em, password });
    if (!s2.error) {
      if (s2.data.session) return { ok: true, error: "" };
      return { ok: false, error: "Account created but email confirmation is on. In Supabase: Authentication → Providers → Email → turn off 'Confirm email', then sign in again." };
    }
    const m2 = (s2.error.message || "").toLowerCase();
    if (m2.includes("already registered"))
      return { ok: false, error: "Wrong password for this email." };
    return { ok: false, error: s2.error.message };
  }
  if (msg.includes("email not confirmed"))
    return { ok: false, error: "This account needs email confirmation turned off. In Supabase: Authentication → Providers → Email → 'Confirm email' → off." };
  return { ok: false, error: s1.error.message };
}

export async function signOut() {
  try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
}

export async function currentAuthEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.email?.toLowerCase() || null;
  } catch (e) { return null; }
}

// First signed-in user on an empty sales roster enrols themself as admin —
// the RPC allows exactly that one case without a sales admin behind it.
export async function bootstrapFirstAdmin(name?: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    if (!u?.email) return;
    await supabase.rpc("upsert_person", {
      p_id: null,
      p_name: name || u.email.split("@")[0],
      p_email: u.email.toLowerCase(),
      p_role: "admin",
      p_dept: "Management",
      p_active: true,
    });
  } catch (e) { /* ignore */ }
}
