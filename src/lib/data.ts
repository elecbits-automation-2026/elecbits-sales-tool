// Data layer: relational Supabase (sales.* + core.*) in, the app's existing
// collection shapes out.
//
// Phase 0 contract: the UI keeps working on whole arrays (users, companies,
// deals, …) exactly as it did against the JSON blob; this module loads those
// arrays from the relational schema and syncs them back with wholesale
// upserts. Later phases replace wholesale syncs with per-row operations as
// each feature is reworked — the strangler pattern, applied to a data layer.
//
// Ids: every entity id is a uuid. Migrated rows carry md5(old_text_id)::uuid
// (see supabase/03-migrate-blobs.sql); new rows get crypto.randomUUID() from
// the app. Append-only children (activities, deal moves) travel inside their
// parent objects with a hidden `_id` marking rows already persisted — sync
// inserts only entries without one.

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

const monthKey = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};

/* ---------- load ---------- */

// Everything the app needs, in its existing shapes. One round of parallel
// selects; RLS scopes every query to the signed-in person's grants.
export async function loadWorkspace() {
  const [
    people, details, orgs, orgDetails, activities,
    deals, moves, targets, trainings, worklogs,
    knowledge, expenses, scrums, memory, gates,
  ] = await Promise.all([
    rows(core.from("people").select("*"), "people"),
    rows(supabase.from("people_detail").select("*"), "people_detail"),
    rows(core.from("orgs").select("*").is("archived_at", null), "orgs"),
    rows(supabase.from("org_detail").select("*"), "org_detail"),
    rows(supabase.from("activities").select("*").order("at"), "activities"),
    rows(supabase.from("deals").select("*"), "deals"),
    rows(supabase.from("deal_moves").select("*").order("at"), "deal_moves"),
    rows(supabase.from("targets").select("*").eq("period", monthKey()), "targets"),
    rows(supabase.from("trainings").select("*"), "trainings"),
    rows(supabase.from("work_updates").select("*"), "work_updates"),
    rows(supabase.from("knowledge").select("*"), "knowledge"),
    rows(supabase.from("travel_requests").select("*"), "travel_requests"),
    rows(supabase.from("scrum_notes").select("*"), "scrum_notes"),
    rows(core.from("memory").select("*").eq("scope", "sales").is("archived_at", null), "memory"),
    rows(supabase.from("gate_config").select("*"), "gate_config"),
  ]);

  const peopleById = new Map(people.map((p: any) => [p.id, p]));

  // users — only people with a sales.people_detail row appear in the Sales UI.
  const users = details
    .map((d: any) => {
      const p: any = peopleById.get(d.person_id);
      if (!p) return null;
      return {
        id: p.id, name: p.full_name, email: p.work_email || "",
        role: d.role, dept: d.dept || "Sales",
        active: p.status === "active",
      };
    })
    .filter(Boolean);

  // companies — orgs that carry a sales.org_detail row are "sales companies".
  const actByOrg = new Map<string, any[]>();
  for (const a of activities) {
    const list = actByOrg.get(a.org_id) || [];
    list.push({ _id: a.id, at: a.at, by: a.by, text: a.body });
    actByOrg.set(a.org_id, list);
  }
  const orgById = new Map(orgs.map((o: any) => [o.id, o]));
  const companies = orgDetails
    .map((d: any) => {
      const o: any = orgById.get(d.org_id);
      if (!o) return null;
      return {
        id: o.id, cid: o.code || "", name: o.name,
        contactPerson: d.contact_person || "", designation: d.designation || "",
        phone: d.contact_phone || "", email: d.contact_email || "",
        city: d.city || "", industry: d.industry || "",
        whatTheyDo: d.what_they_do || "", source: d.source || "",
        potential: Number(d.potential || 0), website: o.website || "",
        address: d.address || "",
        accountOwner: d.account_owner, createdBy: d.account_owner,
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
      _id: m.id, from: m.from_stage, to: m.to_stage, at: m.at, by: m.by,
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

  // kpis — {userId: {metric: target}} for the current month.
  const kpis: Record<string, Record<string, number>> = {};
  for (const t of targets) {
    (kpis[t.person_id] = kpis[t.person_id] || {})[t.metric] = Number(t.target || 0);
  }

  const trainingsOut = trainings.map((t: any) => ({
    id: t.id, title: t.title, assignedTo: t.person_id, assignedBy: t.assigned_by,
    due: t.due || "", status: t.status, knowledgeId: t.knowledge_id || "",
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
    id: s.id, userId: s.by, date: s.on_date, raw: s.raw,
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

export async function syncUsers(users: any[]): Promise<boolean> {
  if (!users.length) return true;
  const people = users.map((u) => ({
    id: u.id, full_name: u.name, work_email: (u.email || "").toLowerCase() || null,
    kind: "employee", status: u.active === false ? "exited" : "active",
  }));
  const details = users.map((u) => ({
    person_id: u.id, role: u.role, dept: u.dept || "Sales",
  }));
  const grants = users.flatMap((u) => ["core", "sales"].map((tool) => ({
    person_id: u.id, tool, level: u.role === "admin" ? "admin" : "write",
  })));
  const r1 = await core.from("people").upsert(people, { onConflict: "id" });
  const r2 = await supabase.from("people_detail").upsert(details, { onConflict: "person_id" });
  const r3 = await core.from("grants").upsert(grants, { onConflict: "person_id,tool" });
  return ok(r1.error, "syncUsers.people") && ok(r2.error, "syncUsers.detail") && ok(r3.error, "syncUsers.grants");
}

export async function syncCompanies(companies: any[]): Promise<boolean> {
  if (!companies.length) return true;
  const orgs = companies.map((c) => ({
    id: c.id, code: c.cid || null, name: c.name || "(unnamed)",
    website: c.website || null, status: "active",
  }));
  const roles = companies.map((c) => ({ org_id: c.id, role: "prospect" }));
  const details = companies.map((c) => ({
    org_id: c.id, what_they_do: c.whatTheyDo || null, industry: c.industry || null,
    city: c.city || null, address: c.address || null, source: c.source || null,
    potential: Number(c.potential || 0), account_owner: c.accountOwner || null,
    contact_person: c.contactPerson || null, designation: c.designation || null,
    contact_phone: c.phone || null, contact_email: c.email || null,
    custom: c.custom || [],
  }));
  const r1 = await core.from("orgs").upsert(orgs, { onConflict: "id" });
  const r2 = await core.from("org_roles").upsert(roles, { onConflict: "org_id,role", ignoreDuplicates: true });
  const r3 = await supabase.from("org_detail").upsert(details, { onConflict: "org_id" });
  let allOk = ok(r1.error, "syncCompanies.orgs") && ok(r2.error, "syncCompanies.roles") && ok(r3.error, "syncCompanies.detail");

  // Append-only notes: persist only entries that have never been written.
  const fresh: any[] = [];
  for (const c of companies) {
    for (const a of c.activity || []) {
      if (!a._id) {
        a._id = uuid();
        fresh.push({ id: a._id, org_id: c.id, kind: "note", body: a.text || "", by: a.by || null, at: a.at });
      }
    }
  }
  if (fresh.length) {
    const r4 = await supabase.from("activities").insert(fresh);
    allOk = ok(r4.error, "syncCompanies.activities") && allOk;
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
          gated: !!h.gated, forced: !!h.forced, by: h.by || null, at: h.at,
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
  const period = monthKey();
  const rows: any[] = [];
  for (const [personId, metrics] of Object.entries(kpis || {})) {
    for (const [metric, target] of Object.entries(metrics || {})) {
      rows.push({
        id: undefined, person_id: personId, period, metric, target: Number(target || 0),
      });
    }
  }
  if (!rows.length) return true;
  rows.forEach((r) => delete r.id);
  const { error } = await supabase.from("targets")
    .upsert(rows, { onConflict: "person_id,period,metric" });
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
  const list = keepIds.length ? "(" + keepIds.map((i) => '"' + i + '"').join(",") + ")" : "()";
  const del = keepIds.length
    ? client.from(table).delete().not("id", "in", list)
    : client.from(table).delete().gte("created_at", "1970-01-01");
  const { error: e2 } = await del;
  return ok(e2, label + ".prune") && allOk;
}

export async function syncTrainings(trainings: any[]): Promise<boolean> {
  const rowsIn = trainings.map((t) => ({
    id: t.id, person_id: t.assignedTo, title: t.title,
    knowledge_id: t.knowledgeId || null, due: t.due || null,
    status: t.status, assigned_by: t.assignedBy || null,
  }));
  return upsertAndPrune("trainings", rowsIn, trainings.map((t) => t.id), "syncTrainings");
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
    by: s.userId || null, created_at: s.createdAt,
  }));
  return upsertAndPrune("scrum_notes", rowsIn, scrums.map((s) => s.id), "syncScrums");
}

export async function syncMemory(memory: any[]): Promise<boolean> {
  const rowsIn = memory.map((m) => ({
    id: m.id, scope: "sales", title: m.title, content: m.text,
    created_by: m.by || null,
  }));
  let allOk = true;
  if (rowsIn.length) {
    const { error } = await core.from("memory").upsert(rowsIn, { onConflict: "id" });
    allOk = ok(error, "syncMemory.upsert");
  }
  // prune only within the sales scope — never touch pms/company memory
  const keep = memory.map((m) => m.id);
  const q = core.from("memory").delete().eq("scope", "sales");
  const { error: e2 } = keep.length
    ? await q.not("id", "in", "(" + keep.map((i) => '"' + i + '"').join(",") + ")")
    : await q;
  return ok(e2, "syncMemory.prune") && allOk;
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

// PMS onboarding pattern: sign in; if the account does not exist yet, the
// first sign-in creates it (the roster row must already exist — an email
// nobody added authenticates into an empty workspace and sees NoProfile).
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

// First user on an empty database becomes admin (SECURITY DEFINER RPC; a no-op
// once anyone exists).
export async function bootstrapFirstAdmin(name?: string): Promise<void> {
  try { await supabase.rpc("bootstrap_first_admin", { _name: name || null }); } catch (e) { /* ignore */ }
}
