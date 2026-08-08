import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Building2, Columns, TrendingUp, BookOpen, Receipt, Settings, Plus, X, Search,
  Mic, MicOff, Send, Check, CheckCircle2, XCircle, AlertTriangle, AlertCircle,
  Clock, Flame, LogOut, Pencil, Trash2, Sparkles, Loader2, Copy, ChevronRight,
  ArrowRight, Users, GraduationCap, ClipboardList, Phone, FileText, Zap,
  Bot, Database, CalendarCheck2, Lightbulb
} from "lucide-react";
import { supabase } from "./lib/supabase";

/* ============================================================
   ELECBITS SALES OS
   Elecbits ODM PMS look-and-feel: clean slate-on-white canvas,
   blue accent, IBM Plex Mono readouts, light nav rail.
   LED status language kept — red = alarm = fix now.
   ============================================================ */

/* Brand mark — the blue lightning bolt from the Elecbits ODM PMS design. */
function Logo({ size = 28 }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-blue-600 text-white flex-none"
      style={{ width: size, height: size }}
    >
      <Zap size={Math.round(size * 0.58)} fill="currentColor" strokeWidth={0} />
    </span>
  );
}

/* ---------- constants ---------- */

const STAGES = [
  { key: "lead", name: "Lead" },
  { key: "first_meeting", name: "First Meeting" },
  { key: "physical_meeting", name: "Physical Meeting" },
  { key: "rfq", name: "RFQ" },
  { key: "project_id", name: "Project ID" },
  { key: "pm_added", name: "PM Added" },
  { key: "quote_lld", name: "Quote / LLD" },
  { key: "negotiation", name: "Negotiation" },
  { key: "closure", name: "Closure" },
  { key: "po", name: "PO" },
];
const stageIdx = (k) => STAGES.findIndex((s) => s.key === k);
const stageName = (k) => (STAGES.find((s) => s.key === k) || {}).name || k;

const DEFAULT_GATES = {
  lead: ["Where did this lead come from", "Which Elecbits product line fits", "Who is the contact and their role"],
  first_meeting: ["Who attended the meeting (both sides)", "What exact need did the client state", "What did you pitch and how did they react", "Agreed next step with a date"],
  physical_meeting: ["Where did you meet and who was present", "Requirements captured (specs, volumes, timelines)", "What was demonstrated or shown", "Client's budget or volume signals", "Agreed next step with a date"],
  rfq: ["Exact product / spec being quoted", "Quantity and delivery timeline", "Target price or budget from client", "Who is the decision maker", "Competitors in the picture"],
  project_id: ["Internal project ID created", "Scope summary in one or two lines", "Engineering owner assigned", "Feasibility or risk notes"],
  pm_added: ["Project manager name", "Kickoff date", "Key deliverables agreed", "Client-side point of contact"],
  quote_lld: ["Quote amount and validity", "Margin percentage", "LLD status (shared / pending)", "Who received the quote"],
  negotiation: ["Exact objections raised and by whom", "Price gap between us and client", "Competitor pressure details", "Concessions asked, concessions offered", "Expected decision date"],
  closure: ["Final agreed price", "Payment terms", "Delivery schedule", "Any pending approvals on client side"],
  po: ["PO number", "PO value", "Advance received (yes/no, amount)", "Delivery start date", "PO document received"],
};

const KPI_METRICS = [
  { key: "companies", label: "Companies added", pace: true },
  { key: "meetings", label: "Meetings held", pace: true },
  { key: "rfqs", label: "RFQs raised", pace: true },
  { key: "quotes", label: "Quotes sent", pace: true },
  { key: "pos", label: "POs closed", pace: true },
  { key: "revenue", label: "Revenue", pace: true, money: true },
  { key: "completeness", label: "Data completeness", pace: false, pct: true },
];

const COMPANY_FIELDS = [
  { k: "name", label: "Company name", req: true },
  { k: "contactPerson", label: "Contact person", req: true },
  { k: "designation", label: "Designation", req: false },
  { k: "phone", label: "Contact phone", req: true },
  { k: "email", label: "Email", req: true },
  { k: "city", label: "City", req: true },
  { k: "industry", label: "Industry", req: true },
  { k: "whatTheyDo", label: "What they do", req: true, long: true },
  { k: "source", label: "Lead source", req: true },
  { k: "potential", label: "Annual potential (₹)", req: true, num: true },
  { k: "website", label: "Website", req: false },
  { k: "address", label: "Address", req: false, long: true },
];
const REQ_FIELDS = COMPANY_FIELDS.filter((f) => f.req);

const ROLES = [
  { key: "admin", label: "Admin" },
  { key: "dept_head", label: "Dept Head" },
  { key: "agent", label: "Sales Agent" },
  { key: "finance", label: "Finance" },
];
const roleLabel = (r) => (ROLES.find((x) => x.key === r) || {}).label || r;

const STALE_AMBER = 4;
const STALE_RED = 8;

/* ---------- storage ---------- */

// Persistence — Supabase for all shared data. Each `sales:*` key is one JSON row
// in the `collections` table (value may be an array or an object — kpis/gates
// are maps). Reads/writes require an authenticated Supabase session: the user
// signs in with a real email + password (see auth helpers below), which
// satisfies the "authenticated" RLS policy on the table.
const store = {
  async get(key, shared = true) {
    if (!shared) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    }
    try {
      const { data, error } = await supabase.from("collections").select("data").eq("key", key).maybeSingle();
      if (error) { console.error("store.get", key, error.message); return null; }
      return data ? data.data : null;
    } catch (e) { console.error("store.get threw", key, e); return null; }
  },
  async set(key, val, shared = true) {
    if (!shared) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
    }
    try {
      const { error } = await supabase
        .from("collections")
        .upsert({ key, data: val, updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) { console.error("store.set", key, error.message); return false; }
      return true;
    } catch (e) { console.error("store.set threw", key, e); return false; }
  },
};

/* ---------- auth ---------- */

// Real Supabase email/password auth. Each employee has a Supabase Auth account
// (created by scripts/seed-auth.mjs for the demo team, or by an admin via
// /api/admin) whose email matches their profile's `email` in `sales:users`.
// The Supabase client persists the session (see lib/supabase.ts), so a logged-in
// user stays signed in across reloads until they sign out.
async function signInWithPassword(email, password) {
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(email || "").trim().toLowerCase(),
      password,
    });
    return { ok: !error, error: error ? error.message : "" };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "Sign in failed." };
  }
}

async function signOut() {
  try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
}

// Calls the server-side admin function (/api/admin) to create/update/delete the
// Supabase Auth login for a user. Requires the caller's access token; the server
// verifies the caller is an admin before doing anything. Throws with a readable
// message on failure (including when the function isn't configured/deployed).
async function callAdminApi(action, payload) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session ? data.session.access_token : "";
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action, ...payload }),
  });
  let json = {} as any;
  try { json = await res.json(); } catch (e) { /* non-JSON */ }
  if (!res.ok) throw new Error((json && json.error) || "Login request failed (" + res.status + ").");
  return json;
}

// The currently authenticated email (lowercased), or null. Used to resolve the
// app profile and to gate the whole UI behind a real session.
async function currentAuthEmail() {
  try {
    const { data } = await supabase.auth.getSession();
    return data && data.session && data.session.user
      ? String(data.session.user.email || "").toLowerCase()
      : null;
  } catch (e) {
    return null;
  }
}

/* ---------- Claude ---------- */

// Routes through our own serverless proxy (/api/claude), which holds the
// ANTHROPIC_API_KEY server-side and picks the model. The browser never sees the
// key. The proxy accepts { system, messages, maxTokens }.
async function askClaude(system, messages) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, maxTokens: 1000 }),
  });
  if (!res.ok) throw new Error("AI request failed (" + res.status + ")");
  const data = await res.json();
  return (data && data.text) || "";
}

function extractMarkedJSON(text, marker) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const rest = text.slice(i + marker.length);
  const s = rest.indexOf("{");
  const e = rest.lastIndexOf("}");
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(rest.slice(s, e + 1)); } catch (err) { return null; }
}

/* ---------- speech ---------- */

function useSpeech(onText) {
  const [on, setOn] = useState(false);
  const recRef = useRef(null);
  const cbRef = useRef(onText);
  cbRef.current = onText;
  const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const stop = () => { try { if (recRef.current) recRef.current.stop(); } catch (e) {} recRef.current = null; setOn(false); };
  const start = () => {
    if (!SR) return;
    try {
      const r = new SR();
      r.continuous = true; r.interimResults = false; r.lang = "en-IN";
      r.onresult = (e) => {
        let t = "";
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
        if (t.trim()) cbRef.current(t.trim());
      };
      r.onend = () => setOn(false);
      r.onerror = () => setOn(false);
      recRef.current = r; r.start(); setOn(true);
    } catch (e) { setOn(false); }
  };
  useEffect(() => () => stop(), []);
  return { supported: !!SR, on, toggle: () => (on ? stop() : start()) };
}

/* ---------- utils ---------- */

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const pad4 = (n) => String(n).padStart(4, "0");
function localISO(d = new Date()) {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 10);
}
const todayStr = () => localISO();
const monthKey = () => localISO().slice(0, 7);
const nowTS = () => new Date().toISOString();
const tsDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const dateDaysAgo = (n) => localISO(new Date(Date.now() - n * 86400000));
const fmtINR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const fmtINRc = (n) => {
  const v = Number(n || 0);
  if (v >= 10000000) return "₹" + (v / 10000000).toFixed(1).replace(/\.0$/, "") + "Cr";
  if (v >= 100000) return "₹" + (v / 100000).toFixed(1).replace(/\.0$/, "") + "L";
  if (v >= 1000) return "₹" + (v / 1000).toFixed(0) + "k";
  return "₹" + v;
};
function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); } catch (e) { return iso; }
}
function daysBetween(aISO, bISO) {
  try { return Math.max(0, Math.floor((new Date(bISO) - new Date(aISO)) / 86400000)); } catch (e) { return 0; }
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function nextSeq(items, field, prefix) {
  let mx = 0;
  items.forEach((it) => {
    const m = String(it[field] || "").match(/(\d+)$/);
    if (m) mx = Math.max(mx, parseInt(m[1], 10));
  });
  return prefix + pad4(mx + 1);
}

function completeness(c) {
  const filled = REQ_FIELDS.filter((f) => String(c[f.k] || "").trim() !== "").length;
  return Math.round((filled / REQ_FIELDS.length) * 100);
}
function missingFields(c) {
  return REQ_FIELDS.filter((f) => String(c[f.k] || "").trim() === "").map((f) => f.label);
}

function dealStaleDays(deal) {
  const last = deal.history && deal.history.length ? deal.history[deal.history.length - 1].at : deal.createdAt;
  return daysBetween(last, nowTS());
}

function healthColor(h) { return h == null ? "slate" : h >= 85 ? "green" : h >= 60 ? "amber" : "red"; }
function ledClass(color) {
  return {
    green: "bg-green-500",
    amber: "bg-amber-500",
    red: "bg-red-600",
    slate: "bg-slate-400",
    blue: "bg-blue-500",
  }[color] || "bg-slate-400";
}

/* actuals for one user id (own activity only) */
function actualsForId(userId, companies, deals, mk) {
  const inM = (iso) => iso && iso.slice(0, 7) === mk;
  const myCompanies = companies.filter((c) => c.accountOwner === userId);
  const a = { companies: 0, meetings: 0, rfqs: 0, quotes: 0, pos: 0, revenue: 0, completeness: 0 };
  a.companies = companies.filter((c) => c.createdBy === userId && inM(c.createdAt)).length;
  deals.forEach((d) => {
    (d.history || []).forEach((h) => {
      if (h.by !== userId || !inM(h.at)) return;
      if (h.to === "first_meeting" || h.to === "physical_meeting") a.meetings++;
      if (h.to === "rfq") a.rfqs++;
      if (h.to === "quote_lld") a.quotes++;
      if (h.to === "po") { a.pos++; a.revenue += Number(d.value || 0); }
    });
  });
  a.completeness = myCompanies.length
    ? Math.round(myCompanies.reduce((s, c) => s + completeness(c), 0) / myCompanies.length)
    : 0;
  return a;
}

function teamOf(user, users) {
  if (!user) return [];
  if (user.role === "admin") return users.filter((u) => u.role === "agent" || u.role === "dept_head");
  if (user.role === "dept_head") return users.filter((u) => u.role === "agent" && u.dept === user.dept && u.active !== false);
  return [];
}

/* aggregated actuals: dept head = sum of own + team agents */
function actualsForUser(user, users, companies, deals, mk) {
  if (!user) return null;
  if (user.role === "dept_head") {
    const ids = [user.id, ...teamOf(user, users).map((u) => u.id)];
    const list = ids.map((id) => actualsForId(id, companies, deals, mk));
    const sum = { companies: 0, meetings: 0, rfqs: 0, quotes: 0, pos: 0, revenue: 0, completeness: 0 };
    list.forEach((a) => KPI_METRICS.forEach((m) => { sum[m.key] += a[m.key]; }));
    const owned = companies.filter((c) => ids.includes(c.accountOwner));
    sum.completeness = owned.length ? Math.round(owned.reduce((s, c) => s + completeness(c), 0) / owned.length) : 0;
    return sum;
  }
  return actualsForId(user.id, companies, deals, mk);
}

function kpiPace(user, users, companies, deals, kpis) {
  const t = kpis[user.id];
  if (!t) return null;
  const mk = monthKey();
  const a = actualsForUser(user, users, companies, deals, mk);
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const frac = Math.max(0.05, now.getDate() / dim);
  const ratios = [];
  KPI_METRICS.forEach((m) => {
    const target = Number(t[m.key] || 0);
    if (target <= 0) return;
    const expected = m.pace ? target * frac : target;
    ratios.push(clamp01(a[m.key] / Math.max(0.0001, expected)));
  });
  if (!ratios.length) return null;
  return ratios.reduce((s, x) => s + x, 0) / ratios.length;
}

function trainingScore(userId, trainings) {
  const mine = trainings.filter((t) => t.assignedTo === userId);
  if (!mine.length) return { score: 1, overdue: [] };
  const done = mine.filter((t) => t.status === "done").length;
  const overdue = mine.filter((t) => t.status !== "done" && t.due && t.due < todayStr());
  return { score: done / mine.length, overdue };
}

function disciplineScore(userId, worklogs) {
  const expected = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    if (d.getDay() !== 0) expected.push(localISO(d)); // skip Sundays
  }
  const take = expected.slice(0, 6);
  if (!take.length) return { score: 1, missed: [] };
  const logged = take.filter((day) => worklogs.some((w) => w.userId === userId && w.date === day));
  const missed = take.filter((day) => !worklogs.some((w) => w.userId === userId && w.date === day));
  return { score: logged.length / take.length, missed };
}

function healthOf(user, data) {
  if (!user || user.role === "admin" || user.role === "finance") return null;
  const { users, companies, deals, kpis, trainings, worklogs } = data;
  const k = kpiPace(user, users, companies, deals, kpis);
  const t = trainingScore(user.id, trainings).score;
  const d = disciplineScore(user.id, worklogs).score;
  const kk = k == null ? 0.7 : k; // no targets set yet: neutral-ish
  return Math.round((kk * 0.5 + t * 0.25 + d * 0.25) * 100);
}

function fixNowItems(user, data) {
  if (!user) return [];
  const { users, companies, deals, kpis, trainings, worklogs } = data;
  const items = [];
  const scopeIds = user.role === "dept_head" ? [user.id, ...teamOf(user, users).map((u) => u.id)] : [user.id];
  companies.filter((c) => scopeIds.includes(c.accountOwner) && completeness(c) < 70).forEach((c) => {
    items.push({ type: "company", tab: "companies", id: c.id, label: c.name + " — data " + completeness(c) + "% complete. Fill: " + missingFields(c).slice(0, 3).join(", ") + (missingFields(c).length > 3 ? "…" : "") });
  });
  deals.filter((d) => !d.lost && d.stage !== "po" && scopeIds.includes(d.ownerId) && dealStaleDays(d) >= STALE_RED).forEach((d) => {
    const c = companies.find((x) => x.id === d.companyId);
    items.push({ type: "deal", tab: "pipeline", id: d.id, label: (c ? c.name : d.did) + " — " + dealStaleDays(d) + " days stuck in " + stageName(d.stage) });
  });
  const y = new Date(Date.now() - 86400000);
  if (y.getDay() !== 0 && user.role === "agent") {
    const yd = localISO(y);
    if (!worklogs.some((w) => w.userId === user.id && w.date === yd)) items.push({ type: "log", tab: "performance", label: "Yesterday's work update is missing. Log it." });
  }
  trainingScore(user.id, trainings).overdue.forEach((t) => items.push({ type: "training", tab: "performance", label: "Training overdue: " + t.title + " (due " + fmtDate(t.due) + ")" }));
  if (user.role !== "admin" && user.role !== "finance") {
    const t = kpis[user.id];
    if (t) {
      const mk = monthKey();
      const a = actualsForUser(user, users, companies, deals, mk);
      const now = new Date();
      const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const frac = Math.max(0.05, now.getDate() / dim);
      KPI_METRICS.forEach((m) => {
        const target = Number(t[m.key] || 0);
        if (target <= 0) return;
        const expected = m.pace ? target * frac : target;
        if (a[m.key] / Math.max(0.0001, expected) < 0.6) {
          items.push({ type: "kpi", tab: "performance", label: m.label + " at " + (m.money ? fmtINRc(a[m.key]) : a[m.key] + (m.pct ? "%" : "")) + " vs pace target " + (m.money ? fmtINRc(Math.round(expected)) : Math.round(expected) + (m.pct ? "%" : "")) });
        }
      });
    }
  }
  if (user.role === "dept_head") {
    teamOf(user, users).forEach((ag) => {
      const h = healthOf(ag, data);
      if (h != null && h < 60) items.push({ type: "agent", tab: "performance", label: ag.name + " is RED at " + h + "% health — review today." });
    });
  }
  return items;
}

/* ---------- seed data ---------- */

function seedData() {
  const users = [
    { id: "u_admin", name: "Admin", email: "admin@elecbits.in", role: "admin", dept: "Management", active: true },
    { id: "u_saurav", name: "Saurav", email: "saurav@elecbits.in", role: "dept_head", dept: "Sales", active: true },
    { id: "u_ankit", name: "Ankit", email: "ankit@elecbits.in", role: "agent", dept: "Sales", active: true },
    { id: "u_akash", name: "Akash", email: "akash@elecbits.in", role: "agent", dept: "Sales", active: true },
    { id: "u_fin", name: "Finance", email: "finance@elecbits.in", role: "finance", dept: "Finance", active: true },
  ];
  const companies = [
    {
      id: "c1", cid: "EB-C-0001", name: "Nevon Solutions", contactPerson: "Rahul Mehta", designation: "Founder",
      phone: "+91 98200 11223", email: "rahul@nevon.example", city: "Mumbai", industry: "Consumer IoT",
      whatTheyDo: "IoT product company; wants an ODM partner for a connected device line.",
      source: "Inbound - website", potential: 4500000, website: "", address: "",
      accountOwner: "u_ankit", createdBy: "u_ankit", createdAt: tsDaysAgo(24),
      custom: [{ k: "Deal shape", v: "20-unit design phase, 200-unit production potential" }],
      activity: [{ at: tsDaysAgo(24), by: "u_ankit", text: "Company created." }],
    },
    {
      id: "c2", cid: "EB-C-0002", name: "Greenline Paper Mills", contactPerson: "S. Iyer", designation: "",
      phone: "", email: "", city: "Coimbatore", industry: "Paper machinery",
      whatTheyDo: "", source: "Cold outreach", potential: 0, website: "", address: "",
      accountOwner: "u_akash", createdBy: "u_akash", createdAt: tsDaysAgo(12),
      custom: [], activity: [{ at: tsDaysAgo(12), by: "u_akash", text: "Company created." }],
    },
    {
      id: "c3", cid: "EB-C-0003", name: "Sunrise Retail Tech", contactPerson: "Priya Nair", designation: "COO",
      phone: "+91 99887 66554", email: "priya@sunrise.example", city: "Bengaluru", industry: "Retail",
      whatTheyDo: "Retail chain exploring ESL price tags for 40 stores.",
      source: "Referral", potential: 2000000, website: "", address: "",
      accountOwner: "u_akash", createdBy: "u_akash", createdAt: tsDaysAgo(6),
      custom: [], activity: [{ at: tsDaysAgo(6), by: "u_akash", text: "Company created." }],
    },
  ];
  const deals = [
    {
      id: "d1", did: "EB-D-0001", companyId: "c1", ownerId: "u_ankit", value: 1800000,
      stage: "rfq", createdAt: tsDaysAgo(24), updatedAt: tsDaysAgo(9), lost: false,
      history: [
        { from: null, to: "lead", at: tsDaysAgo(24), by: "u_ankit", summary: "Deal created from inbound enquiry." },
        { from: "lead", to: "first_meeting", at: tsDaysAgo(18), by: "u_ankit", summary: "Intro call done. Client needs design + manufacturing for a 20-unit pilot." },
        { from: "first_meeting", to: "rfq", at: tsDaysAgo(9), by: "u_ankit", summary: "RFQ received for pilot batch; spec shared; target timeline 8 weeks." },
      ],
    },
    {
      id: "d2", did: "EB-D-0002", companyId: "c3", ownerId: "u_akash", value: 900000,
      stage: "lead", createdAt: tsDaysAgo(6), updatedAt: tsDaysAgo(6), lost: false,
      history: [{ from: null, to: "lead", at: tsDaysAgo(6), by: "u_akash", summary: "Deal created after referral intro." }],
    },
  ];
  const kpis = {
    u_saurav: { companies: 20, meetings: 24, rfqs: 10, quotes: 8, pos: 3, revenue: 6000000, completeness: 90 },
    u_ankit: { companies: 8, meetings: 10, rfqs: 4, quotes: 3, pos: 1, revenue: 2500000, completeness: 90 },
    u_akash: { companies: 8, meetings: 10, rfqs: 4, quotes: 3, pos: 1, revenue: 2500000, completeness: 90 },
  };
  const trainings = [
    { id: "t1", title: "ESL product line deep-dive", assignedTo: "u_akash", assignedBy: "u_saurav", due: dateDaysAgo(-2), status: "assigned", knowledgeId: "k2" },
    { id: "t2", title: "Commercial guardrails: MOQ, payment terms", assignedTo: "u_akash", assignedBy: "u_saurav", due: dateDaysAgo(3), status: "assigned", knowledgeId: "k3" },
    { id: "t3", title: "Elecbits capabilities pitch", assignedTo: "u_ankit", assignedBy: "u_saurav", due: dateDaysAgo(1), status: "done", knowledgeId: "k1" },
  ];
  const worklogs = [
    { id: "w1", userId: "u_ankit", date: dateDaysAgo(1), companiesWorked: "Nevon Solutions", calls: 6, meetings: 1, progress: "Pushed Nevon RFQ; spec clarifications sent to engineering.", blockers: "Awaiting BOM cost from sourcing.", next: "Follow up on target price." },
    { id: "w2", userId: "u_ankit", date: dateDaysAgo(2), companiesWorked: "Nevon, 2 new leads", calls: 8, meetings: 0, progress: "Cold calls to paper industry list.", blockers: "", next: "Book meetings." },
  ];
  const knowledge = [
    {
      id: "k1", title: "Elecbits capabilities overview", access: "all", createdBy: "u_admin", updatedAt: tsDaysAgo(10),
      content: "Elecbits is an electronics ODM/EMS company. We take products from idea to production: hardware design, firmware, prototyping, certification support, and manufacturing. In-house SMT line coming up at GHP Hi-Tech Defence & Aerospace Park, Bengaluru. We serve consumer electronics, IoT, EV/automotive and industrial clients. Typical engagement: design phase (fixed fee) followed by NRE + per-unit manufacturing pricing.",
    },
    {
      id: "k2", title: "Product lines", access: "all", createdBy: "u_admin", updatedAt: tsDaysAgo(10),
      content: "Current product families: Soundbox variants (payment audio devices), Enote e-paper notepads, ESL electronic shelf labels with gateway + software, IFPD interactive flat panel displays, IoT gateways, motor drivers, smart energy meters, and development boards. ESL pitch: per-tag hardware + gateway + cloud dashboard; ideal for retail chains 10+ stores. Soundbox pitch: OEM-ready, customisable firmware and branding.",
    },
    {
      id: "k3", title: "Commercial guardrails", access: "all", createdBy: "u_admin", updatedAt: tsDaysAgo(10),
      content: "Standard terms unless approved otherwise: 50% advance with PO, 50% before dispatch. Design phase always billed separately from production. MOQ guidance: consumer devices 500 units, industrial 100 units, pilots allowed at premium per-unit pricing. Quotes valid 30 days. Never commit delivery dates without engineering sign-off. Discounts beyond 8% need dept head approval; beyond 15% need admin approval.",
    },
  ];
  const expenses = [
    { id: "e1", userId: "u_akash", companyId: "c3", purpose: "Store visit + ESL demo at Sunrise Retail HQ", city: "Bengaluru", from: dateDaysAgo(-3), to: dateDaysAgo(-2), mode: "Flight", estimate: 14500, notes: "Carrying 5 demo tags + gateway.", status: "pending", createdAt: tsDaysAgo(1), decidedBy: null, decisionNote: "" },
  ];
  const memory = [
    { id: "m1", title: "Company positioning", text: "Elecbits is an electronics ODM/EMS partner: design → firmware → prototyping → certification → manufacturing. Pitch the full journey, not just PCBs.", updatedAt: tsDaysAgo(5), by: "u_admin" },
    { id: "m2", title: "Commercial default", text: "Standard terms: 50% advance with PO, 50% before dispatch. Design phase billed separately from production. Quotes valid 30 days.", updatedAt: tsDaysAgo(5), by: "u_admin" },
  ];
  return { users, companies, deals, kpis, trainings, worklogs, knowledge, expenses, gates: {}, scrums: [], memory };
}

/* ---------- tiny UI atoms ---------- */

function cls(...a) { return a.filter(Boolean).join(" "); }

function Dot({ color, pulse }) {
  return <span className={cls("inline-block w-2 h-2 rounded-full flex-none", ledClass(color), pulse && "animate-pulse")} />;
}

function Btn({ children, onClick, kind = "ghost", size = "md", disabled, className, title }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "text-xs px-2 py-1", md: "text-sm px-3 py-1.5", lg: "text-sm px-4 py-2" };
  const kinds = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    dark: "bg-slate-900 text-white hover:bg-slate-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100",
    subtle: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    success: "bg-green-600 text-white hover:bg-green-700",
  };
  return <button title={title} disabled={disabled} onClick={onClick} className={cls(base, sizes[size], kinds[kind], className)}>{children}</button>;
}

function Chip({ children, color = "slate", className }) {
  const map = {
    slate: "bg-slate-100 text-slate-600",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    green: "bg-green-50 text-green-700",
    blue: "bg-blue-50 text-blue-700",
  };
  return <span className={cls("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap", map[color], className)}>{children}</span>;
}

function Bar({ pct, color = "blue", className }) {
  const c = { blue: "bg-blue-500", green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-600", slate: "bg-slate-400" }[color];
  return (
    <div className={cls("h-1.5 w-full rounded-full bg-slate-200 overflow-hidden", className)}>
      <div className={cls("h-full rounded-full transition-all", c)} style={{ width: Math.max(2, Math.min(100, pct)) + "%" }} />
    </div>
  );
}

function Modal({ title, onClose, children, wide, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={cls("bg-white rounded-xl border border-slate-200 shadow-xl w-full my-8", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, children, hint, req }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}{req && <span className="text-red-600"> *</span>}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500";
function Input(props) { return <input {...props} className={cls(inputCls, props.className)} />; }
function TA(props) { return <textarea {...props} className={cls(inputCls, "min-h-16", props.className)} />; }
function Sel(props) { return <select {...props} className={cls(inputCls, props.className)} />; }

function Avatar({ name, size = "md" }) {
  const initials = (name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const s = size === "sm" ? "w-6 h-6 text-xs" : "w-8 h-8 text-xs";
  return <span className={cls("inline-flex items-center justify-center rounded-full bg-slate-900 text-slate-100 font-mono flex-none", s)}>{initials}</span>;
}

function Empty({ icon: Icon, title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 border border-dashed border-slate-300 rounded-lg bg-white">
      <Icon size={28} className="text-slate-300 mb-3" />
      <p className="font-medium text-slate-700">{title}</p>
      {sub && <p className="text-sm text-slate-500 mt-1 max-w-sm">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">{children}</h2>
      {right}
    </div>
  );
}

/* ============================================================
   ROOT APP
   ============================================================ */

export default function App() {
  const [loading, setLoading] = useState(true);
  const [saveErr, setSaveErr] = useState(false);
  const [tab, setTab] = useState("pipeline");

  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [deals, setDeals] = useState([]);
  const [kpis, setKpis] = useState({});
  const [trainings, setTrainings] = useState([]);
  const [worklogs, setWorklogs] = useState([]);
  const [knowledge, setKnowledge] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [gates, setGates] = useState({});
  const [scrums, setScrums] = useState([]);
  const [memory, setMemory] = useState([]);

  // Auth state: authReady flips true once we know whether a session exists;
  // authEmail is the signed-in user's email (lowercased) or null.
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState(null);

  const [focusCompanyId, setFocusCompanyId] = useState(null);

  // Track the current Supabase session and react to sign-in / sign-out.
  useEffect(() => {
    let alive = true;
    currentAuthEmail().then((email) => {
      if (!alive) return;
      setAuthEmail(email);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setAuthEmail(session && session.user ? String(session.user.email || "").toLowerCase() : null);
      setAuthReady(true);
    });
    return () => { alive = false; sub && sub.subscription && sub.subscription.unsubscribe(); };
  }, []);

  // Load (and, on an empty workspace, seed) the shared data once authenticated.
  useEffect(() => {
    if (!authReady) return;
    if (!authEmail) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        let u = await store.get("sales:users");
        if (!u || u.length === 0) {
          const seed = seedData();
          await Promise.all([
            store.set("sales:users", seed.users),
            store.set("sales:companies", seed.companies),
            store.set("sales:deals", seed.deals),
            store.set("sales:kpis", seed.kpis),
            store.set("sales:trainings", seed.trainings),
            store.set("sales:worklogs", seed.worklogs),
            store.set("sales:knowledge", seed.knowledge),
            store.set("sales:expenses", seed.expenses),
            store.set("sales:gates", seed.gates),
            store.set("sales:scrums", seed.scrums),
            store.set("sales:memory", seed.memory),
          ]);
          if (!alive) return;
          setUsers(seed.users); setCompanies(seed.companies); setDeals(seed.deals); setKpis(seed.kpis);
          setTrainings(seed.trainings); setWorklogs(seed.worklogs); setKnowledge(seed.knowledge); setExpenses(seed.expenses); setGates(seed.gates);
          setScrums(seed.scrums); setMemory(seed.memory);
        } else {
          const [c, d, k, t, w, kn, e, g, sc, mem] = await Promise.all([
            store.get("sales:companies"), store.get("sales:deals"), store.get("sales:kpis"),
            store.get("sales:trainings"), store.get("sales:worklogs"), store.get("sales:knowledge"),
            store.get("sales:expenses"), store.get("sales:gates"),
            store.get("sales:scrums"), store.get("sales:memory"),
          ]);
          if (!alive) return;
          setUsers(u || []);
          setCompanies(c || []); setDeals(d || []); setKpis(k || {});
          setTrainings(t || []); setWorklogs(w || []); setKnowledge(kn || []);
          setExpenses(e || []); setGates(g || {});
          setScrums(sc || []); setMemory(mem || []);
        }
      } catch (e) { console.error(e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [authReady, authEmail]);

  const persist = (key, val) => { store.set(key, val).then((ok) => { if (!ok) setSaveErr(true); }); };
  const saveUsers = (v) => { setUsers(v); persist("sales:users", v); };
  const saveCompanies = (v) => { setCompanies(v); persist("sales:companies", v); };
  const saveDeals = (v) => { setDeals(v); persist("sales:deals", v); };
  const saveKpis = (v) => { setKpis(v); persist("sales:kpis", v); };
  const saveTrainings = (v) => { setTrainings(v); persist("sales:trainings", v); };
  const saveWorklogs = (v) => { setWorklogs(v); persist("sales:worklogs", v); };
  const saveKnowledge = (v) => { setKnowledge(v); persist("sales:knowledge", v); };
  const saveExpenses = (v) => { setExpenses(v); persist("sales:expenses", v); };
  const saveGates = (v) => { setGates(v); persist("sales:gates", v); };
  const saveScrums = (v) => { setScrums(v); persist("sales:scrums", v); };
  const saveMemory = (v) => { setMemory(v); persist("sales:memory", v); };

  const me = authEmail ? (users.find((u) => String(u.email || "").toLowerCase() === authEmail) || null) : null;
  const data = { users, companies, deals, kpis, trainings, worklogs, knowledge, expenses, gates, scrums, memory };
  const myHealth = useMemo(() => healthOf(me, data), [me, users, companies, deals, kpis, trainings, worklogs]);
  const fixNow = useMemo(() => (me ? fixNowItems(me, data) : []), [me, users, companies, deals, kpis, trainings, worklogs]);

  const logout = () => { signOut(); };

  const resetDemo = async () => {
    const seed = seedData();
    saveUsers(seed.users); saveCompanies(seed.companies); saveDeals(seed.deals); saveKpis(seed.kpis);
    saveTrainings(seed.trainings); saveWorklogs(seed.worklogs); saveKnowledge(seed.knowledge); saveExpenses(seed.expenses); saveGates(seed.gates);
    saveScrums(seed.scrums); saveMemory(seed.memory);
  };

  // Not signed in yet → the login screen. (authReady guards a flash of login
  // before we know whether a persisted session exists.)
  if (!authReady) return <Splash />;
  if (!authEmail) return <Login />;
  if (loading) return <Splash />;

  // Signed in, but this email has no active profile in the workspace.
  if (!me || me.active === false) return <NoProfile email={authEmail} onLogout={logout} />;

  const goFix = (item) => { setTab(item.tab); if (item.type === "company") setFocusCompanyId(item.id); };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      <Sidebar me={me} tab={tab} setTab={setTab} onLogout={logout} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar me={me} health={myHealth} onAlarmClick={() => setTab("performance")} />
        {fixNow.length > 0 && (
          <div className="bg-red-50 border-b border-red-200 px-4 md:px-6 py-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-600 mt-0.5 flex-none" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Fix this now — {fixNow.length} item{fixNow.length > 1 ? "s" : ""}</p>
                <ul className="mt-1 space-y-0.5">
                  {fixNow.slice(0, 3).map((it, i) => (
                    <li key={i}>
                      <button onClick={() => goFix(it)} className="text-sm text-red-800 hover:underline text-left">{it.label}</button>
                    </li>
                  ))}
                </ul>
                {fixNow.length > 3 && (
                  <button onClick={() => setTab("performance")} className="text-xs text-red-700 font-medium hover:underline mt-1">+{fixNow.length - 3} more in Performance</button>
                )}
              </div>
            </div>
          </div>
        )}
        <main key={tab} className="flex-1 min-w-0 p-4 md:p-6 overflow-x-hidden fade">
          {tab === "companies" && <CompaniesView me={me} data={data} saveCompanies={saveCompanies} saveDeals={saveDeals} focusCompanyId={focusCompanyId} setFocusCompanyId={setFocusCompanyId} setTab={setTab} />}
          {tab === "pipeline" && <PipelineView me={me} data={data} saveDeals={saveDeals} saveCompanies={saveCompanies} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "performance" && <PerformanceView me={me} data={data} saveKpis={saveKpis} saveTrainings={saveTrainings} saveWorklogs={saveWorklogs} fixNow={fixNow} goFix={goFix} />}
          {tab === "knowledge" && <KnowledgeView me={me} data={data} saveKnowledge={saveKnowledge} />}
          {tab === "expenses" && <ExpensesView me={me} data={data} saveExpenses={saveExpenses} />}
          {tab === "scrum" && <DailyScrumView me={me} data={data} saveScrums={saveScrums} />}
          {tab === "assistant" && me.role === "admin" && <AssistantView me={me} data={data} />}
          {tab === "memory" && me.role === "admin" && <SystemMemoryView me={me} data={data} saveMemory={saveMemory} />}
          {tab === "admin" && me.role === "admin" && <AdminView me={me} data={data} saveUsers={saveUsers} saveGates={saveGates} resetDemo={resetDemo} />}
        </main>
        {saveErr && (
          <div className="fixed bottom-3 left-3 z-50 bg-red-600 text-white text-xs px-3 py-2 rounded-md shadow-lg flex items-center gap-2">
            <AlertCircle size={14} /> A save failed — check connection, then retry your last change.
            <button onClick={() => setSaveErr(false)} className="ml-1 opacity-80 hover:opacity-100"><X size={12} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- login ---------- */

/* Full-screen loading state, shown while auth/data resolve. */
function Splash() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate-500 font-mono text-sm"><Loader2 className="animate-spin text-blue-600" size={18} /> loading sales os…</div>
    </div>
  );
}

/* Authenticated, but no matching (active) profile in the workspace. */
function NoProfile({ email, onLogout }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md fade text-center">
        <div className="flex items-center gap-2.5 justify-center mb-4"><Logo size={34} /><span className="text-slate-900 font-bold tracking-tight text-2xl">Elecbits</span></div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <AlertTriangle size={26} className="text-amber-500 mx-auto mb-3" />
          <p className="font-semibold text-slate-900">No workspace access</p>
          <p className="text-sm text-slate-500 mt-1.5">
            You're signed in as <span className="font-mono text-slate-700">{email}</span>, but this account isn't set up as an active user in the Sales OS. Ask an admin to add you.
          </p>
          <div className="mt-5"><Btn kind="ghost" onClick={onLogout}><LogOut size={14} /> Sign out</Btn></div>
        </div>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true); setErr("");
    const { ok, error } = await signInWithPassword(email, password);
    // On success, onAuthStateChange drives the app into the workspace; on
    // failure we surface the reason and let them retry.
    if (!ok) { setErr(error || "Sign in failed. Check your email and password."); setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm fade">
        <div className="flex items-center gap-2.5 justify-center mb-1.5">
          <Logo size={34} />
          <span className="text-slate-900 font-bold tracking-tight text-2xl">Elecbits</span>
        </div>
        <p className="text-center font-mono text-xs text-slate-500 mb-8">sales os · lead → po, nothing missed</p>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">Sign in</p>
            <p className="text-xs text-slate-500 mt-0.5">Use your Elecbits work email and password.</p>
          </div>
          <Field label="Email">
            <Input type="email" autoFocus autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@elecbits.in" />
          </Field>
          <Field label="Password">
            <div className="relative">
              <Input type={show ? "text" : "password"} autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pr-16" />
              <button type="button" onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 hover:text-slate-600 px-1">
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
          {err && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={13} className="flex-none" /> {err}</p>}
          <button type="submit" disabled={busy || !email.trim() || !password}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 text-white font-semibold text-sm px-4 py-2.5 transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-center text-xs text-slate-400 mt-8 leading-relaxed">
          Shared workspace — everyone signs in with their own account.<br />Voice input works best in Chrome or Edge.
        </p>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */

// Grouped navigation, mirroring the PMS design's labelled sections. Groups and
// items are filtered by role so each person only sees what applies to them.
function navGroups(me) {
  const isAdmin = me.role === "admin";
  const groups = [
    { label: "Workspace", items: [
      { key: "pipeline", label: "Pipeline", icon: Columns },
      { key: "companies", label: "Companies", icon: Building2 },
    ] },
    { label: "Personal", items: [
      { key: "scrum", label: "Daily Scrum", icon: CalendarCheck2 },
      { key: "performance", label: "Performance", icon: TrendingUp },
    ] },
    { label: "Resources", items: [
      { key: "knowledge", label: "Product / Service", icon: BookOpen },
      { key: "expenses", label: "Expenses", icon: Receipt },
    ] },
  ];
  if (isAdmin) {
    groups.push({ label: "AI", items: [
      { key: "assistant", label: "Assistant", icon: Bot },
      { key: "memory", label: "System Memory", icon: Database },
    ] });
    groups.push({ label: "Admin", items: [
      { key: "admin", label: "Admin", icon: Settings },
    ] });
  }
  return groups;
}

function Sidebar({ me, tab, setTab, onLogout }) {
  const groups = navGroups(me);
  const flat = groups.flatMap((g) => g.items); // mobile rail is a single scroll row
  return (
    <>
      {/* desktop rail */}
      <aside className="hidden md:flex w-56 flex-none bg-white border-r border-slate-200 text-slate-500 flex-col">
        <div className="px-4 py-5">
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <div className="min-w-0">
              <span className="block text-slate-900 font-bold tracking-tight leading-none">Elecbits</span>
              <span className="block font-mono text-[10px] text-slate-400 mt-1">sales os v1</span>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-2 pb-3 space-y-4 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{g.label}</p>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <button key={it.key} onClick={() => setTab(it.key)}
                    className={cls("w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium border border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      tab === it.key ? "bg-blue-50 text-blue-700 border-blue-100" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}>
                    <it.icon size={16} /> {it.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="flex items-center gap-2.5">
            <Avatar name={me.name} size="sm" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-slate-800 truncate">{me.name}</span>
              <span className="block text-xs text-slate-400">{roleLabel(me.role)}</span>
            </span>
            <button onClick={onLogout} title="Log out" className="text-slate-400 hover:text-red-600 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      {/* mobile rail */}
      <div className="md:hidden bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1 overflow-x-auto">
        <span className="flex items-center gap-1.5 pr-2 mr-1 border-r border-slate-200 flex-none">
          <Logo size={22} />
        </span>
        {flat.map((it) => (
          <button key={it.key} onClick={() => setTab(it.key)}
            className={cls("flex-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium",
              tab === it.key ? "bg-blue-50 text-blue-700" : "text-slate-500")}>
            <it.icon size={14} /> {it.label}
          </button>
        ))}
        <button onClick={onLogout} className="flex-none ml-auto text-slate-400 hover:text-red-600 px-2"><LogOut size={14} /></button>
      </div>
    </>
  );
}

function Topbar({ me, health, onAlarmClick }) {
  const hc = healthColor(health);
  const alarm = health != null && health < 60;
  return (
    <header className={cls("h-12 flex-none flex items-center justify-between px-4 md:px-6 border-b transition-colors",
      alarm ? "bg-red-700 border-red-800" : "bg-white border-slate-200")}>
      <div className={cls("text-sm font-medium", alarm ? "text-red-100" : "text-slate-500")}>
        {alarm ? "Performance alarm active" : "Workspace: Sales"}
      </div>
      {health == null ? (
        <span className="flex items-center gap-2 text-xs font-mono text-slate-400"><Dot color="slate" /> OVERSIGHT MODE</span>
      ) : (
        <button onClick={onAlarmClick}
          className={cls("flex items-center gap-2 rounded-md px-2.5 py-1.5 focus:outline-none focus-visible:ring-2",
            alarm ? "bg-red-800 hover:bg-red-900 focus-visible:ring-white" : "bg-slate-100 hover:bg-slate-200 focus-visible:ring-blue-500")}>
          {alarm && <Flame size={14} className="text-amber-300" />}
          <Dot color={hc} pulse={alarm} />
          <span className={cls("font-mono text-sm tabular-nums", alarm ? "text-white" : "text-slate-800")}>{health}%</span>
          <span className={cls("text-xs font-semibold tracking-wide", alarm ? "text-red-100" : hc === "amber" ? "text-amber-600" : "text-green-600")}>
            {alarm ? "BEHIND — FIX NOW" : hc === "amber" ? "AT RISK" : "ON TRACK"}
          </span>
        </button>
      )}
    </header>
  );
}

/* ============================================================
   COMPANIES
   ============================================================ */

function CompaniesView({ me, data, saveCompanies, saveDeals, focusCompanyId, setFocusCompanyId, setTab }) {
  const { users, companies, deals } = data;
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // company object or "new"
  const openId = focusCompanyId;
  const open = companies.find((c) => c.id === openId) || null;

  const visible = companies.filter((c) => {
    const s = (c.name + " " + c.cid + " " + (c.city || "") + " " + (c.contactPerson || "")).toLowerCase();
    return s.includes(q.toLowerCase());
  }).sort((a, b) => completeness(a) - completeness(b));

  const upsert = (c) => {
    const exists = companies.some((x) => x.id === c.id);
    const next = exists ? companies.map((x) => (x.id === c.id ? c : x)) : [c, ...companies];
    saveCompanies(next);
    setEditing(null);
    setFocusCompanyId(c.id);
  };

  if (open) {
    return <CompanyDetail me={me} company={open} data={data} saveCompanies={saveCompanies} saveDeals={saveDeals}
      onBack={() => setFocusCompanyId(null)} onEdit={() => setEditing(open)} editing={editing} setEditing={setEditing} upsert={upsert} setTab={setTab} />;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-auto">Companies <span className="font-mono text-sm text-slate-400">({companies.length})</span></h1>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search name, ID, city…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 w-56" />
        </div>
        <Btn kind="primary" onClick={() => setEditing("new")}><Plus size={15} /> Add company</Btn>
      </div>

      {visible.length === 0 ? (
        <Empty icon={Building2} title="No companies yet" sub="Every client starts here. Add the company with full details — the pipeline pulls from this record." action={<Btn kind="primary" onClick={() => setEditing("new")}><Plus size={15} /> Add company</Btn>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => {
            const comp = completeness(c);
            const cc = comp >= 90 ? "green" : comp >= 70 ? "amber" : "red";
            const owner = users.find((u) => u.id === c.accountOwner);
            const activeDeals = deals.filter((d) => d.companyId === c.id && !d.lost).length;
            return (
              <button key={c.id} onClick={() => setFocusCompanyId(c.id)}
                className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{c.name}</p>
                    <p className="font-mono text-xs text-slate-400">{c.cid}</p>
                  </div>
                  <Dot color={cc} />
                </div>
                <p className="text-xs text-slate-500 mt-2 truncate">{[c.city, c.industry].filter(Boolean).join(" · ") || "—"}</p>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500">Data</span>
                    <span className={cls("font-mono tabular-nums", cc === "red" ? "text-red-600 font-semibold" : "text-slate-600")}>{comp}%</span>
                  </div>
                  <Bar pct={comp} color={cc} />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">{owner && <Avatar name={owner.name} size="sm" />} {owner ? owner.name : "Unassigned"}</span>
                  <span className="font-mono text-xs text-slate-400">{activeDeals} deal{activeDeals === 1 ? "" : "s"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editing && <CompanyModal me={me} data={data} company={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={upsert} />}
    </div>
  );
}

function CompanyModal({ me, data, company, onClose, onSave }) {
  const { users, companies } = data;
  const [f, setF] = useState(() => company ? { ...company, custom: [...(company.custom || [])] } : {
    id: uid(), cid: nextSeq(companies, "cid", "EB-C-"), accountOwner: me.id, createdBy: me.id, createdAt: nowTS(),
    custom: [], activity: [{ at: nowTS(), by: me.id, text: "Company created." }],
  });
  const [err, setErr] = useState("");
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setCustom = (i, k, v) => setF((p) => { const c = [...p.custom]; c[i] = { ...c[i], [k]: v }; return { ...p, custom: c }; });
  const canPickOwner = me.role === "admin" || me.role === "dept_head";
  const save = () => {
    if (!String(f.name || "").trim()) { setErr("Company name is required."); return; }
    if (!String(f.contactPerson || "").trim()) { setErr("Contact person is required."); return; }
    onSave({ ...f, custom: f.custom.filter((c) => String(c.k || "").trim() || String(c.v || "").trim()) });
  };
  return (
    <Modal wide title={company ? "Edit " + company.name : "Add company"} onClose={onClose}
      footer={<>
        <span className="mr-auto text-xs text-red-600">{err}</span>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={save}><Check size={15} /> Save company</Btn>
      </>}>
      <p className="text-xs text-slate-500 mb-3">Fields marked <span className="text-red-600">*</span> count towards data completeness. Missing data turns this account red.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {COMPANY_FIELDS.map((fd) => (
          <div key={fd.k} className={fd.long ? "sm:col-span-2" : ""}>
            <Field label={fd.label} req={fd.req}>
              {fd.long
                ? <TA value={f[fd.k] || ""} onChange={(e) => set(fd.k, e.target.value)} />
                : <Input type={fd.num ? "number" : "text"} value={f[fd.k] || ""} onChange={(e) => set(fd.k, fd.num ? e.target.value.replace(/[^\d]/g, "") : e.target.value)} />}
            </Field>
          </div>
        ))}
        <Field label="Account owner">
          <Sel value={f.accountOwner} onChange={(e) => set("accountOwner", e.target.value)} disabled={!canPickOwner}>
            {users.filter((u) => u.role === "agent" || u.role === "dept_head").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Sel>
        </Field>
      </div>
      <div className="mt-4">
        <SectionTitle right={<Btn size="sm" onClick={() => setF((p) => ({ ...p, custom: [...p.custom, { k: "", v: "" }] }))}><Plus size={13} /> Add field</Btn>}>
          Custom fields — every minute detail
        </SectionTitle>
        {f.custom.length === 0 && <p className="text-xs text-slate-400">Anything that doesn't fit above: GST no., plant locations, buying cycle, birthdays — add it here so it is never lost.</p>}
        <div className="space-y-2">
          {f.custom.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="Field name" value={c.k} onChange={(e) => setCustom(i, "k", e.target.value)} className="w-44" />
              <Input placeholder="Value" value={c.v} onChange={(e) => setCustom(i, "v", e.target.value)} />
              <Btn size="sm" onClick={() => setF((p) => ({ ...p, custom: p.custom.filter((_, j) => j !== i) }))}><Trash2 size={13} /></Btn>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CompanyDetail({ me, company: c, data, saveCompanies, saveDeals, onBack, onEdit, editing, setEditing, upsert, setTab }) {
  const { users, deals, companies } = data;
  const comp = completeness(c);
  const cc = comp >= 90 ? "green" : comp >= 70 ? "amber" : "red";
  const owner = users.find((u) => u.id === c.accountOwner);
  const myDeals = deals.filter((d) => d.companyId === c.id);
  const [note, setNote] = useState("");
  const [newDeal, setNewDeal] = useState(false);

  const addNote = () => {
    if (!note.trim()) return;
    const next = companies.map((x) => x.id === c.id ? { ...x, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text: note.trim() }] } : x);
    saveCompanies(next); setNote("");
  };
  const createDeal = (value, ownerId) => {
    const d = {
      id: uid(), did: nextSeq(deals, "did", "EB-D-"), companyId: c.id, ownerId, value: Number(value || 0),
      stage: "lead", createdAt: nowTS(), updatedAt: nowTS(), lost: false,
      history: [{ from: null, to: "lead", at: nowTS(), by: me.id, summary: "Deal created." }],
    };
    saveDeals([d, ...deals]); setNewDeal(false); setTab("pipeline");
  };

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-800 mb-3 inline-flex items-center gap-1">← All companies</button>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 mr-auto">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{c.name}</h1>
              <Dot color={cc} />
            </div>
            <p className="font-mono text-xs text-slate-400 mt-0.5">{c.cid} · created {fmtDate(c.createdAt)}</p>
          </div>
          <div className="text-right">
            <p className={cls("font-mono text-2xl tabular-nums", cc === "red" ? "text-red-600" : cc === "amber" ? "text-amber-600" : "text-green-600")}>{comp}%</p>
            <p className="text-xs text-slate-400">data complete</p>
          </div>
          <Btn onClick={onEdit}><Pencil size={14} /> Edit</Btn>
        </div>
        {comp < 100 && (
          <div className={cls("mt-4 rounded-md border px-3 py-2 text-sm flex items-start gap-2", cc === "red" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800")}>
            <AlertTriangle size={15} className="mt-0.5 flex-none" />
            <span><span className="font-semibold">Missing:</span> {missingFields(c).join(", ")}. No excuses — fill these before the next stage move.</span>
          </div>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 mt-5">
          {COMPANY_FIELDS.map((fd) => (
            <div key={fd.k} className={fd.long ? "sm:col-span-2 lg:col-span-3" : ""}>
              <p className="text-xs text-slate-400">{fd.label}</p>
              <p className={cls("text-sm mt-0.5", String(c[fd.k] || "").trim() ? "text-slate-800" : "text-red-500 italic")}>
                {fd.num && c[fd.k] ? fmtINR(c[fd.k]) : (String(c[fd.k] || "").trim() || "missing")}
              </p>
            </div>
          ))}
          <div>
            <p className="text-xs text-slate-400">Account owner</p>
            <p className="text-sm mt-0.5 flex items-center gap-1.5">{owner && <Avatar name={owner.name} size="sm" />}{owner ? owner.name : "—"}</p>
          </div>
        </div>
        {(c.custom || []).length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Custom fields</p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {c.custom.map((cf, i) => (
                <div key={i} className="flex gap-2 text-sm"><span className="text-slate-400 flex-none">{cf.k}:</span><span className="text-slate-800">{cf.v}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <SectionTitle right={<Btn size="sm" kind="primary" onClick={() => setNewDeal(true)}><Plus size={13} /> New deal</Btn>}>Deals</SectionTitle>
          {myDeals.length === 0 ? <p className="text-sm text-slate-400">No deals yet. Start one to put this company on the board.</p> : (
            <div className="space-y-2">
              {myDeals.map((d) => {
                const o = users.find((u) => u.id === d.ownerId);
                return (
                  <button key={d.id} onClick={() => setTab("pipeline")} className="w-full text-left border border-slate-200 rounded-md px-3 py-2 hover:border-blue-500 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-400">{d.did}</span>
                      {d.lost ? <Chip color="red">Lost</Chip> : <Chip color="blue">{stageName(d.stage)}</Chip>}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-sm tabular-nums">{fmtINRc(d.value)}</span>
                      <span className="text-xs text-slate-500">{o ? o.name : ""}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <SectionTitle>Activity & history</SectionTitle>
          <div className="flex gap-2 mb-3">
            <Input placeholder="Add a note — call outcome, gossip, anything useful" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
            <Btn onClick={addNote}><Plus size={14} /></Btn>
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {[...(c.activity || [])].reverse().map((a, i) => {
              const by = users.find((u) => u.id === a.by);
              return (
                <div key={i} className="text-sm border-l-2 border-slate-200 pl-3">
                  <p className="text-slate-800 whitespace-pre-wrap">{a.text}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{by ? by.name : "?"} · {fmtDate(a.at)}</p>
                </div>
              );
            })}
            {(c.activity || []).length === 0 && <p className="text-sm text-slate-400">Nothing logged yet.</p>}
          </div>
        </div>
      </div>

      {editing && <CompanyModal me={me} data={data} company={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={upsert} />}
      {newDeal && <NewDealModal me={me} data={data} fixedCompany={c} onClose={() => setNewDeal(false)} onCreate={createDeal} />}
    </div>
  );
}

function NewDealModal({ me, data, fixedCompany, onClose, onCreate }) {
  const { users, companies } = data;
  const [companyId, setCompanyId] = useState(fixedCompany ? fixedCompany.id : (companies[0] ? companies[0].id : ""));
  const [value, setValue] = useState("");
  const [ownerId, setOwnerId] = useState(me.role === "agent" ? me.id : (users.find((u) => u.role === "agent") || me).id);
  const canPickOwner = me.role !== "agent";
  return (
    <Modal title="New deal" onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!companyId} onClick={() => onCreate(value, ownerId, companyId)}><Check size={15} /> Create deal</Btn>
      </>}>
      <div className="space-y-3">
        <Field label="Company" req>
          {fixedCompany ? <Input value={fixedCompany.name} disabled />
            : <Sel value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.cid})</option>)}
              </Sel>}
        </Field>
        <Field label="Estimated value (₹)"><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 1500000" /></Field>
        <Field label="Deal owner">
          <Sel value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={!canPickOwner}>
            {users.filter((u) => u.role === "agent" || u.role === "dept_head").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Sel>
        </Field>
        <p className="text-xs text-slate-500">New deals always start at <span className="font-medium">Lead</span>. Every stage move after this goes through the AI gate — no silent drags.</p>
      </div>
    </Modal>
  );
}

/* ============================================================
   PIPELINE + AI STAGE GATE
   ============================================================ */

function PipelineView({ me, data, saveDeals, saveCompanies, openCompany }) {
  const { users, companies, deals, gates } = data;
  const [scope, setScope] = useState(me.role === "agent" ? "mine" : "team");
  const [showLost, setShowLost] = useState(false);
  const [gate, setGate] = useState(null); // {deal, from, to, mode}
  const [newDeal, setNewDeal] = useState(false);
  const dragId = useRef(null);

  const scopeIds = scope === "mine" ? [me.id]
    : me.role === "dept_head" ? [me.id, ...teamOf(me, users).map((u) => u.id)]
    : users.map((u) => u.id);
  const visible = deals.filter((d) => scopeIds.includes(d.ownerId) && (showLost ? d.lost : !d.lost));

  const onDrop = (toKey) => {
    const d = deals.find((x) => x.id === dragId.current);
    dragId.current = null;
    if (!d || d.lost) return;
    if (d.stage === toKey) return;
    const fromI = stageIdx(d.stage), toI = stageIdx(toKey);
    setGate({ deal: d, from: d.stage, to: toKey, mode: toI < fromI ? "back" : "advance" });
  };

  const applyMove = (deal, to, entryExtra) => {
    const entry = { from: deal.stage, to, at: nowTS(), by: me.id, ...entryExtra };
    const nextDeals = deals.map((x) => x.id === deal.id
      ? { ...x, stage: to === "lost" ? x.stage : to, lost: to === "lost" ? true : x.lost, lostInfo: to === "lost" ? entryExtra : x.lostInfo, updatedAt: nowTS(), history: [...(x.history || []), entry] }
      : x);
    saveDeals(nextDeals);
    const c = companies.find((x) => x.id === deal.companyId);
    if (c) {
      const text = to === "lost"
        ? "Deal " + deal.did + " marked LOST. " + (entryExtra.summary || "")
        : "Deal " + deal.did + " moved " + stageName(deal.stage) + " → " + stageName(to) + ". " + (entryExtra.summary || "");
      saveCompanies(companies.map((x) => x.id === c.id ? { ...x, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text }] } : x));
    }
    setGate(null);
  };

  const createDeal = (value, ownerId, companyId) => {
    const d = {
      id: uid(), did: nextSeq(deals, "did", "EB-D-"), companyId, ownerId, value: Number(value || 0),
      stage: "lead", createdAt: nowTS(), updatedAt: nowTS(), lost: false,
      history: [{ from: null, to: "lead", at: nowTS(), by: me.id, summary: "Deal created." }],
    };
    saveDeals([d, ...deals]); setNewDeal(false);
  };

  const totalOpen = visible.filter((d) => !d.lost).reduce((s, d) => s + Number(d.value || 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-1">Pipeline</h1>
        <span className="font-mono text-xs text-slate-400 mr-auto">{visible.length} deals · {fmtINRc(totalOpen)}</span>
        {me.role !== "agent" && (
          <div className="flex rounded-md border border-slate-300 overflow-hidden">
            {[["mine", "Mine"], ["team", me.role === "admin" ? "Everyone" : "My team"]].map(([k, l]) => (
              <button key={k} onClick={() => setScope(k)} className={cls("px-2.5 py-1 text-xs font-medium", scope === k ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100")}>{l}</button>
            ))}
          </div>
        )}
        <button onClick={() => setShowLost(!showLost)} className={cls("px-2.5 py-1 text-xs rounded-md border", showLost ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100")}>
          {showLost ? "Showing lost" : "Show lost"}
        </button>
        <Btn kind="primary" onClick={() => setNewDeal(true)}><Plus size={15} /> New deal</Btn>
      </div>

      <p className="text-xs text-slate-500 mb-3 flex items-center gap-1.5"><Sparkles size={13} className="text-blue-600" /> Drag a card to the next stage — the AI gate will interview you before it moves. No data, no move.</p>

      <div className="flex gap-3 overflow-x-auto pb-4 items-start">
        {STAGES.map((s) => {
          const col = visible.filter((d) => d.stage === s.key);
          const colVal = col.reduce((sum, d) => sum + Number(d.value || 0), 0);
          return (
            <div key={s.key} className="w-64 flex-none bg-slate-50 border border-slate-200 rounded-xl"
              onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(s.key)}>
              <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">{s.name}</span>
                <span className="font-mono text-xs text-slate-400 tabular-nums">{col.length}{colVal > 0 ? " · " + fmtINRc(colVal) : ""}</span>
              </div>
              <div className="p-2 space-y-2 min-h-16">
                {col.map((d) => {
                  const c = companies.find((x) => x.id === d.companyId);
                  const o = users.find((u) => u.id === d.ownerId);
                  const stale = dealStaleDays(d);
                  const sc = d.lost ? "red" : stale >= STALE_RED ? "red" : stale >= STALE_AMBER ? "amber" : "green";
                  const compPct = c ? completeness(c) : 0;
                  return (
                    <div key={d.id} draggable={!d.lost} onDragStart={() => (dragId.current = d.id)}
                      className={cls("bg-white border rounded-md p-2.5 cursor-grab active:cursor-grabbing border-l-4",
                        sc === "red" ? "border-slate-200 border-l-red-600" : sc === "amber" ? "border-slate-200 border-l-amber-500" : "border-slate-200 border-l-green-500")}>
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => c && openCompany(c.id)} className="font-medium text-sm text-slate-900 hover:text-blue-700 text-left truncate">{c ? c.name : "?"}</button>
                        <span className="font-mono text-xs text-slate-400 flex-none">{d.did}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="font-mono text-sm tabular-nums text-slate-800">{fmtINRc(d.value)}</span>
                        <span className={cls("flex items-center gap-1 font-mono text-xs tabular-nums", sc === "red" ? "text-red-600 font-semibold" : sc === "amber" ? "text-amber-600" : "text-slate-400")}>
                          <Clock size={11} /> {stale}d
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="flex items-center gap-1 text-xs text-slate-500">{o && <Avatar name={o.name} size="sm" />}</span>
                        <div className="flex items-center gap-2">
                          {c && compPct < 70 && <span title="Company data incomplete"><AlertTriangle size={13} className="text-red-500" /></span>}
                          {!d.lost && d.stage !== "po" && (
                            <button onClick={() => setGate({ deal: d, from: d.stage, to: "lost", mode: "lost" })}
                              className="text-xs text-slate-400 hover:text-red-600" title="Mark lost">lost?</button>
                          )}
                        </div>
                      </div>
                      {d.lost && <p className="mt-1.5 text-xs text-red-600 line-clamp-2">{(d.lostInfo && d.lostInfo.summary) || "Lost."}</p>}
                    </div>
                  );
                })}
                {col.length === 0 && <p className="text-xs text-slate-300 text-center py-3">—</p>}
              </div>
            </div>
          );
        })}
      </div>

      {gate && gate.mode === "back" && (
        <BackMoveModal gate={gate} onClose={() => setGate(null)} onConfirm={(reason) => applyMove(gate.deal, gate.to, { summary: "Moved back: " + reason })} />
      )}
      {gate && (gate.mode === "advance" || gate.mode === "lost") && (
        <StageGateModal me={me} data={data} gate={gate} onClose={() => setGate(null)} onComplete={(payload) => applyMove(gate.deal, gate.mode === "lost" ? "lost" : gate.to, payload)} />
      )}
      {newDeal && <NewDealModal me={me} data={data} onClose={() => setNewDeal(false)} onCreate={createDeal} />}
    </div>
  );
}

function BackMoveModal({ gate, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={"Move back to " + stageName(gate.to)} onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="danger" disabled={reason.trim().length < 10} onClick={() => onConfirm(reason.trim())}>Confirm downgrade</Btn>
      </>}>
      <p className="text-sm text-slate-600 mb-2">Moving a deal backwards is a downgrade. Say exactly why (min 10 characters) — this goes on permanent record.</p>
      <TA value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client paused budget till next quarter; RFQ withdrawn." />
    </Modal>
  );
}

function StageGateModal({ me, data, gate, onClose, onComplete }) {
  const { users, companies, gates } = data;
  const { deal, from, to, mode } = gate;
  const company = companies.find((c) => c.id === deal.companyId) || {};
  const isLost = mode === "lost";
  const marker = isLost ? "LOST_COMPLETE" : "STAGE_COMPLETE";
  const reqs = isLost
    ? ["What exactly did you pitch", "The story / angle you used", "The exact objection and who said it", "Competitor or alternative they chose", "What would revive this deal"]
    : (gates[to] && gates[to].length ? gates[to] : DEFAULT_GATES[to] || []);

  const [msgs, setMsgs] = useState([]); // {role:'user'|'assistant', content}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null); // parsed JSON
  const [forceReason, setForceReason] = useState("");
  const [showForce, setShowForce] = useState(false);
  const bodyRef = useRef(null);
  const speech = useSpeech((t) => setInput((p) => (p ? p + " " : "") + t));

  const system = useMemo(() => {
    const histTail = (deal.history || []).slice(-5).map((h) => fmtDate(h.at) + " " + (h.from ? stageName(h.from) + "→" : "") + stageName(h.to) + ": " + (h.summary || "")).join("\n");
    const compJSON = JSON.stringify({
      name: company.name, contact: company.contactPerson, designation: company.designation, phone: company.phone,
      city: company.city, industry: company.industry, whatTheyDo: company.whatTheyDo, source: company.source,
      potential: company.potential, custom: company.custom, dataCompleteness: completeness(company) + "%", missing: missingFields(company),
    });
    return [
      "You are the sales-ops gatekeeper at Elecbits, an Indian electronics ODM/EMS company (design + manufacturing).",
      isLost
        ? "A sales agent wants to mark a deal LOST. Your job: extract the full post-mortem so the team learns something. Do not let them off easy."
        : "A sales agent wants to move a deal from \"" + stageName(from) + "\" to \"" + stageName(to) + "\". Your job: extract complete, specific information before the move is allowed.",
      "COMPANY RECORD: " + compJSON,
      "DEAL: " + deal.did + ", value " + fmtINR(deal.value) + ", currently in " + stageName(deal.stage) + " for " + dealStaleDays(deal) + " days.",
      "RECENT HISTORY:\n" + (histTail || "(none)"),
      "REQUIRED BEFORE " + (isLost ? "MARKING LOST" : "\"" + stageName(to) + "\"") + ":\n- " + reqs.join("\n- "),
      "RULES:",
      "- Ask ONE short, pointed question at a time. You already know the company record — never ask for what is already there; reference it to sound informed.",
      "- Tone: a sharp, fair sales head who hates vague answers. Professional, a little tough, never rude.",
      "- If an answer is vague (\"client not interested\", \"meeting was ok\", \"will see\"), probe immediately: what exactly was pitched, what story was used, what was the precise objection, who said it.",
      "- Never accept one-word or evasive answers for a required item. Push back once, then accept their best honest answer and move on.",
      "- If one answer covers several required items, accept them all and continue.",
      "- Keep every reply under 60 words.",
      "- When ALL required items are covered with specifics, reply with ONLY this on one line and nothing else: " + marker + " {\"summary\":\"2-3 sentence factual summary\",\"facts\":{\"key\":\"value pairs of what you learned\"},\"risks\":[\"risk strings\"],\"next_action\":\"single concrete next step with timeframe\"}",
      "- The JSON must be valid. Do not use markdown.",
    ].join("\n");
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true);
      try {
        const first = await askClaude(system, [{ role: "user", content: "Begin the gate check now. Ask your first question." }]);
        if (alive) setMsgs([{ role: "assistant", content: first }]);
      } catch (e) { if (alive) setErr("Could not reach the AI gate. Check connection and retry."); }
      if (alive) setBusy(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy, done]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || done) return;
    setInput(""); setErr("");
    const nextMsgs = [...msgs, { role: "user", content: text }];
    setMsgs(nextMsgs); setBusy(true);
    try {
      const reply = await askClaude(system, [{ role: "user", content: "Begin the gate check now. Ask your first question." }, ...nextMsgs.map((m) => ({ role: m.role, content: m.content }))]);
      const parsed = extractMarkedJSON(reply, marker);
      if (parsed) { setDone(parsed); setMsgs([...nextMsgs, { role: "assistant", content: "Gate cleared. Review the summary below and confirm." }]); }
      else setMsgs([...nextMsgs, { role: "assistant", content: reply }]);
    } catch (e) { setErr("AI call failed. Your last answer is kept — press send again to retry."); setInput(text); setMsgs(msgs); }
    setBusy(false);
  };

  const confirm = () => {
    onComplete({
      summary: done.summary || "", facts: done.facts || {}, risks: done.risks || [], next_action: done.next_action || "",
      transcript: msgs.map((m) => (m.role === "user" ? "Agent: " : "Gate: ") + m.content),
      gated: true,
    });
  };
  const force = () => {
    onComplete({ summary: "FORCED by " + me.name + ": " + forceReason.trim(), facts: {}, risks: ["Gate bypassed by admin"], next_action: "", forced: true });
  };

  return (
    <Modal wide onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={16} className="text-blue-600" />
          {isLost ? "Lost post-mortem — " + (company.name || deal.did) : (company.name || deal.did) + ": " + stageName(from) + " → " + stageName(to)}
        </span>
      }>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {reqs.map((r, i) => <Chip key={i} color="slate">{r}</Chip>)}
      </div>
      <div ref={bodyRef} className="h-80 overflow-y-auto border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cls("max-w-md rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
              m.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-800")}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-400 font-mono"><Loader2 size={13} className="animate-spin" /> gate is thinking…</div>}
        {err && <div className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</div>}
        {done && (
          <div className="bg-white border-2 border-green-500 rounded-lg p-3">
            <p className="flex items-center gap-1.5 text-green-700 font-semibold text-sm"><CheckCircle2 size={15} /> Gate cleared</p>
            <p className="text-sm text-slate-800 mt-1.5">{done.summary}</p>
            {done.facts && Object.keys(done.facts).length > 0 && (
              <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1">
                {Object.entries(done.facts).map(([k, v]) => (
                  <p key={k} className="text-xs"><span className="text-slate-400">{k}:</span> <span className="text-slate-700">{String(v)}</span></p>
                ))}
              </div>
            )}
            {done.risks && done.risks.length > 0 && (
              <p className="text-xs text-amber-700 mt-2 flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 flex-none" /> {done.risks.join(" · ")}</p>
            )}
            {done.next_action && <p className="text-xs text-slate-600 mt-1.5"><span className="font-semibold">Next:</span> {done.next_action}</p>}
          </div>
        )}
      </div>

      {!done ? (
        <div className="mt-3">
          <div className="flex gap-2 items-end">
            <TA value={input} onChange={(e) => setInput(e.target.value)} placeholder={speech.on ? "Listening… speak your answer" : "Type your answer, or use the mic"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} className="flex-1 min-h-12" />
            {speech.supported && (
              <Btn kind={speech.on ? "danger" : "ghost"} onClick={speech.toggle} title={speech.on ? "Stop recording" : "Record answer"}>
                {speech.on ? <MicOff size={15} /> : <Mic size={15} />}
              </Btn>
            )}
            <Btn kind="primary" disabled={busy || !input.trim()} onClick={send}><Send size={15} /></Btn>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-slate-400">Enter to send · Shift+Enter for a new line{speech.supported ? " · mic transcribes as you speak" : ""}</p>
            {me.role === "admin" && !showForce && <button onClick={() => setShowForce(true)} className="text-xs text-slate-400 hover:text-red-600">Force move (admin)</button>}
          </div>
          {showForce && (
            <div className="mt-2 flex gap-2">
              <Input placeholder="Reason for bypassing the gate (goes on record)" value={forceReason} onChange={(e) => setForceReason(e.target.value)} />
              <Btn kind="danger" size="sm" disabled={forceReason.trim().length < 10} onClick={force}>Force</Btn>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="success" onClick={confirm}><Check size={15} /> {isLost ? "Confirm lost" : "Confirm move to " + stageName(to)}</Btn>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   PERFORMANCE — KPI · TRAINING · WORK UPDATE SHEET
   ============================================================ */

function canSetTargets(me, u) {
  if (me.role === "admin") return u.role === "dept_head" || u.role === "agent";
  if (me.role === "dept_head") return u.role === "agent" && u.dept === me.dept;
  return false;
}

function PerformanceView({ me, data, saveKpis, saveTrainings, saveWorklogs, fixNow, goFix }) {
  const { users } = data;
  const [viewId, setViewId] = useState(me.id);
  const [ptab, setPtab] = useState("kpi");
  const team = teamOf(me, users);
  const viewUser = users.find((u) => u.id === viewId) || me;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-auto">Performance</h1>
        {team.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[me, ...team].map((u) => (
              <button key={u.id} onClick={() => setViewId(u.id)}
                className={cls("px-2.5 py-1 rounded-lg text-xs font-medium border", viewId === u.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100")}>
                {u.id === me.id ? "Me" : u.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {team.length > 0 && <TeamTable me={me} data={data} team={team} onPick={setViewId} />}

      <div className="flex gap-1 border-b border-slate-200 mb-4 mt-2">
        {[["kpi", "KPI", TrendingUp], ["training", "Training", GraduationCap], ["worklog", "Work update sheet", ClipboardList]].map(([k, l, I]) => (
          <button key={k} onClick={() => setPtab(k)}
            className={cls("flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px", ptab === k ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-slate-500 hover:text-slate-800")}>
            <I size={14} /> {l}
          </button>
        ))}
      </div>

      {ptab === "kpi" && <KpiTab me={me} viewUser={viewUser} data={data} saveKpis={saveKpis} goFix={goFix} />}
      {ptab === "training" && <TrainingTab me={me} viewUser={viewUser} data={data} saveTrainings={saveTrainings} />}
      {ptab === "worklog" && <WorklogTab me={me} viewUser={viewUser} data={data} saveWorklogs={saveWorklogs} />}
    </div>
  );
}

function TeamTable({ me, data, team, onPick }) {
  const { users, companies, deals, kpis, trainings, worklogs } = data;
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
      <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
        <Users size={14} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Team status — red rows need action today</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="px-4 py-2 font-medium">Person</th>
              <th className="px-4 py-2 font-medium">Health</th>
              <th className="px-4 py-2 font-medium">KPI pace</th>
              <th className="px-4 py-2 font-medium">Missed logs (7d)</th>
              <th className="px-4 py-2 font-medium">Overdue training</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {team.map((u) => {
              const h = healthOf(u, data);
              const hc = healthColor(h);
              const pace = kpiPace(u, users, companies, deals, kpis);
              const missed = disciplineScore(u.id, worklogs).missed.length;
              const od = trainingScore(u.id, trainings).overdue.length;
              return (
                <tr key={u.id} className={cls("border-b border-slate-50", hc === "red" && "bg-red-50")}>
                  <td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar name={u.name} size="sm" /> {u.name}<span className="text-xs text-slate-400">· {roleLabel(u.role)}</span></span></td>
                  <td className="px-4 py-2"><span className="flex items-center gap-1.5 font-mono tabular-nums"><Dot color={hc} pulse={hc === "red"} />{h == null ? "—" : h + "%"}</span></td>
                  <td className="px-4 py-2 font-mono tabular-nums">{pace == null ? "no targets" : Math.round(pace * 100) + "%"}</td>
                  <td className={cls("px-4 py-2 font-mono tabular-nums", missed > 0 ? "text-red-600 font-semibold" : "text-slate-500")}>{missed}</td>
                  <td className={cls("px-4 py-2 font-mono tabular-nums", od > 0 ? "text-red-600 font-semibold" : "text-slate-500")}>{od}</td>
                  <td className="px-4 py-2 text-right"><Btn size="sm" onClick={() => onPick(u.id)}>Open <ArrowRight size={12} /></Btn></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiTab({ me, viewUser, data, saveKpis, goFix }) {
  const { users, companies, deals, kpis } = data;
  const [editTargets, setEditTargets] = useState(false);
  if (viewUser.role === "admin" || viewUser.role === "finance") {
    return <Empty icon={TrendingUp} title="No KPI targets for this role" sub="Pick a team member above to review their numbers." />;
  }
  const t = kpis[viewUser.id];
  const mk = monthKey();
  const a = actualsForUser(viewUser, users, companies, deals, mk);
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const frac = Math.max(0.05, now.getDate() / dim);
  const pace = kpiPace(viewUser, users, companies, deals, kpis);
  const alarm = pace != null && pace < 0.6;
  const items = fixNowItems(viewUser, data);
  const setterAllowed = canSetTargets(me, viewUser);
  const monthLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div>
      {alarm && (
        <div className="rounded-lg bg-red-700 text-white p-4 mb-4">
          <p className="flex items-center gap-2 font-semibold"><Flame size={18} className="text-amber-300" /> {viewUser.id === me.id ? "YOU ARE BEHIND TARGET" : viewUser.name.toUpperCase() + " IS BEHIND TARGET"} — pace {Math.round(pace * 100)}%</p>
          <p className="text-sm text-red-100 mt-1">This board stays red until the items below are cleared. {viewUser.role === "dept_head" ? "Team numbers roll up to you." : "Every day behind pace makes the month harder."}</p>
          <ul className="mt-3 space-y-1">
            {items.slice(0, 8).map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <XCircle size={14} className="mt-0.5 flex-none text-red-200" />
                <button onClick={() => goFix(it)} className="text-left hover:underline">{it.label}</button>
              </li>
            ))}
            {items.length === 0 && <li className="text-sm text-red-100">KPI pace is the gap — add companies, book meetings, push deals forward.</li>}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">{monthLabel} · day {now.getDate()} of {dim} · pace expectation <span className="font-mono tabular-nums">{Math.round(frac * 100)}%</span> of monthly target{viewUser.role === "dept_head" ? " · team roll-up" : ""}</p>
        {setterAllowed && <Btn size="sm" onClick={() => setEditTargets(true)}><Pencil size={13} /> Set targets</Btn>}
      </div>

      {!t ? (
        <Empty icon={TrendingUp} title="No targets set yet"
          sub={viewUser.id === me.id ? "Ask your " + (viewUser.role === "dept_head" ? "admin" : "department head") + " to set your monthly targets." : "Set monthly targets to activate pace tracking and the alarm system."}
          action={setterAllowed ? <Btn kind="primary" onClick={() => setEditTargets(true)}><Plus size={14} /> Set targets</Btn> : null} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {KPI_METRICS.map((m) => {
            const target = Number(t[m.key] || 0);
            if (target <= 0) return null;
            const actual = a[m.key];
            const expected = m.pace ? target * frac : target;
            const ratio = clamp01(actual / Math.max(0.0001, expected));
            const color = ratio >= 0.85 ? "green" : ratio >= 0.6 ? "amber" : "red";
            const fmt = (v) => m.money ? fmtINRc(v) : Math.round(v) + (m.pct ? "%" : "");
            return (
              <div key={m.key} className={cls("bg-white border rounded-lg p-4", color === "red" ? "border-red-300 ring-1 ring-red-200" : "border-slate-200")}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-500">{m.label}</p>
                  <Dot color={color} pulse={color === "red"} />
                </div>
                <p className="mt-2 font-mono tabular-nums text-2xl text-slate-900">{fmt(actual)}<span className="text-sm text-slate-400"> / {fmt(target)}</span></p>
                <Bar pct={target > 0 ? (actual / target) * 100 : 0} color={color} className="mt-2" />
                <p className="text-xs text-slate-400 mt-1.5">{m.pace ? "Pace by today: " + fmt(expected) : "Fixed standard, no pace"} · <span className={cls("font-mono tabular-nums", color === "red" ? "text-red-600 font-semibold" : color === "amber" ? "text-amber-600" : "text-green-600")}>{Math.round(ratio * 100)}%</span></p>
              </div>
            );
          })}
        </div>
      )}

      {editTargets && <KpiModal viewUser={viewUser} kpis={kpis} onClose={() => setEditTargets(false)} onSave={(vals) => { saveKpis({ ...kpis, [viewUser.id]: vals }); setEditTargets(false); }} />}
    </div>
  );
}

function KpiModal({ viewUser, kpis, onClose, onSave }) {
  const [v, setV] = useState(() => ({ ...(kpis[viewUser.id] || {}) }));
  return (
    <Modal title={"Monthly targets — " + viewUser.name} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={() => onSave(v)}><Check size={15} /> Save targets</Btn></>}>
      <p className="text-xs text-slate-500 mb-3">Set 0 to skip a metric. Pace is measured daily against these — falling behind turns the dashboard red immediately, not at month end.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {KPI_METRICS.map((m) => (
          <Field key={m.key} label={m.label + (m.money ? " (₹)" : m.pct ? " (%)" : "")}>
            <Input type="number" value={v[m.key] == null ? "" : v[m.key]} onChange={(e) => setV((p) => ({ ...p, [m.key]: e.target.value === "" ? 0 : Number(e.target.value) }))} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function TrainingTab({ me, viewUser, data, saveTrainings }) {
  const { users, trainings, knowledge } = data;
  const [assign, setAssign] = useState(false);
  const mine = trainings.filter((t) => t.assignedTo === viewUser.id);
  const canAssign = me.role === "admin" || me.role === "dept_head";
  const canUpdate = (t) => me.id === viewUser.id || me.role === "admin" || t.assignedBy === me.id;
  const setStatus = (t, status) => saveTrainings(trainings.map((x) => x.id === t.id ? { ...x, status } : x));
  const remove = (t) => saveTrainings(trainings.filter((x) => x.id !== t.id));

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-sm text-slate-500">Assigned learning for <span className="font-medium text-slate-800">{viewUser.id === me.id ? "you" : viewUser.name}</span>. Overdue items pull the health score down like a missed KPI.</p>
        {canAssign && <Btn size="sm" kind="primary" onClick={() => setAssign(true)}><Plus size={13} /> Assign training</Btn>}
      </div>
      {mine.length === 0 ? (
        <Empty icon={GraduationCap} title="No training assigned" sub="Knowledge is power — random pitching is not a strategy. Assign product and commercial modules from the knowledge base." action={canAssign ? <Btn kind="primary" onClick={() => setAssign(true)}><Plus size={14} /> Assign training</Btn> : null} />
      ) : (
        <div className="space-y-2">
          {mine.map((t) => {
            const overdue = t.status !== "done" && t.due && t.due < todayStr();
            const k = knowledge.find((x) => x.id === t.knowledgeId);
            const by = users.find((u) => u.id === t.assignedBy);
            return (
              <div key={t.id} className={cls("bg-white border rounded-lg p-3 flex flex-wrap items-center gap-3", overdue ? "border-red-300 ring-1 ring-red-200" : "border-slate-200")}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Due {fmtDate(t.due)} · by {by ? by.name : "?"}{k ? " · material: " + k.title : ""}</p>
                </div>
                {overdue && <Chip color="red"><AlertTriangle size={11} /> Overdue</Chip>}
                {t.status === "done" ? <Chip color="green"><Check size={11} /> Done</Chip>
                  : canUpdate(t) ? (
                    <Sel value={t.status} onChange={(e) => setStatus(t, e.target.value)} className="w-36">
                      <option value="assigned">Assigned</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </Sel>
                  ) : <Chip color={t.status === "in_progress" ? "blue" : "slate"}>{t.status === "in_progress" ? "In progress" : "Assigned"}</Chip>}
                {(me.role === "admin" || t.assignedBy === me.id) && <Btn size="sm" onClick={() => remove(t)} title="Remove"><Trash2 size={13} /></Btn>}
              </div>
            );
          })}
        </div>
      )}
      {assign && <AssignTrainingModal me={me} data={data} defaultTo={viewUser.role === "agent" ? viewUser.id : ""} onClose={() => setAssign(false)}
        onSave={(t) => { saveTrainings([{ ...t, id: uid(), assignedBy: me.id, status: "assigned" }, ...trainings]); setAssign(false); }} />}
    </div>
  );
}

function AssignTrainingModal({ me, data, defaultTo, onClose, onSave }) {
  const { users, knowledge } = data;
  const pool = me.role === "admin" ? users.filter((u) => u.role === "agent" || u.role === "dept_head") : teamOf(me, users);
  const [f, setF] = useState({ title: "", assignedTo: defaultTo || (pool[0] ? pool[0].id : ""), due: todayStr(), knowledgeId: "" });
  return (
    <Modal title="Assign training" onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.title.trim() || !f.assignedTo} onClick={() => onSave(f)}><Check size={15} /> Assign</Btn></>}>
      <div className="space-y-3">
        <Field label="Title" req><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. ESL product line deep-dive" /></Field>
        <Field label="Assign to" req>
          <Sel value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}>
            {pool.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Sel>
        </Field>
        <Field label="Due date"><Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="Link knowledge material (optional)">
          <Sel value={f.knowledgeId} onChange={(e) => setF({ ...f, knowledgeId: e.target.value })}>
            <option value="">— none —</option>
            {knowledge.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
          </Sel>
        </Field>
      </div>
    </Modal>
  );
}

function last7Days() {
  return [...Array(7)].map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return { date: localISO(d), dow: d.getDay(), label: d.toLocaleDateString("en-IN", { weekday: "short" }), dnum: d.getDate() };
  });
}

function WorklogTab({ me, viewUser, data, saveWorklogs }) {
  const { users, worklogs } = data;
  const days = last7Days();
  const today = todayStr();
  const existing = worklogs.find((w) => w.userId === me.id && w.date === today);
  // The work update is now a single open-ended doc, stored in `progress`
  // (older logs with structured fields still read fine).
  const [doc, setDoc] = useState(() => (existing ? existing.progress || "" : ""));
  const [saved, setSaved] = useState(false);
  const [viewLog, setViewLog] = useState(null);
  const isSelf = viewUser.id === me.id && (me.role === "agent" || me.role === "dept_head");
  const team = teamOf(me, users);

  const submit = () => {
    if (!String(doc || "").trim()) return;
    const entry = { id: existing ? existing.id : uid(), userId: me.id, date: today, progress: doc.trim() };
    const next = worklogs.some((w) => w.id === entry.id) ? worklogs.map((w) => (w.id === entry.id ? entry : w)) : [entry, ...worklogs];
    saveWorklogs(next); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const DOC_PROMPTS = "Open-ended — write the day like a doc.\n\n· What moved forward today…\n· What I learned…\n· Which decisions went wrong, and why…\n· Blockers and what's next…\n\nThis is the mistake & learning vault — the more honest it is, the more it teaches.";

  const cellFor = (userId, d) => {
    const log = worklogs.find((w) => w.userId === userId && w.date === d.date);
    if (d.dow === 0) return { state: "off" };
    if (log) return { state: "ok", log };
    if (d.date === today) return { state: "due" };
    return { state: "miss" };
  };

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{viewUser.id === me.id ? "Your" : viewUser.name + "'s"} last 7 days — a red X is a missed day, on record</p>
        <div className="flex gap-2 flex-wrap">
          {days.map((d) => {
            const c = cellFor(viewUser.id, d);
            return (
              <button key={d.date} onClick={() => c.log && setViewLog(c.log)} disabled={!c.log}
                className={cls("w-16 rounded-md border px-2 py-1.5 text-center", c.log && "hover:border-blue-500",
                  c.state === "ok" ? "bg-green-50 border-green-200" : c.state === "miss" ? "bg-red-50 border-red-300" : c.state === "due" ? "bg-amber-50 border-amber-300" : "bg-slate-50 border-slate-200")}>
                <span className="block text-xs text-slate-500">{d.label}</span>
                <span className="mt-0.5 flex justify-center">
                  {c.state === "ok" && <Check size={14} className="text-green-600" />}
                  {c.state === "miss" && <X size={14} className="text-red-600" />}
                  {c.state === "due" && <Clock size={14} className="text-amber-600" />}
                  {c.state === "off" && <span className="text-xs text-slate-300">off</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isSelf && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-800 flex items-center gap-2"><FileText size={15} className="text-slate-400" /> Work update — {fmtDate(today)}</p>
            {existing ? <Chip color="green"><Check size={11} /> Logged, editable</Chip> : <Chip color="amber"><Clock size={11} /> Not logged yet</Chip>}
          </div>
          <TA value={doc} onChange={(e) => setDoc(e.target.value)} placeholder={DOC_PROMPTS} className="min-h-64 leading-relaxed" />
          <div className="flex items-center justify-between gap-2 mt-3">
            <p className="text-xs text-slate-400">The mistake &amp; learning vault — honest notes today save the deal tomorrow.</p>
            <span className="flex items-center gap-2">
              {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={13} /> Logged</span>}
              <Btn kind="primary" disabled={!String(doc || "").trim()} onClick={submit}><Check size={15} /> {existing ? "Update log" : "Log update"}</Btn>
            </span>
          </div>
        </div>
      )}

      {team.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-200"><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Team sheet — click a green day to read the log</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Agent</th>
                {days.map((d) => <th key={d.date} className="px-2 py-2 font-mono font-medium text-center">{d.label} {d.dnum}</th>)}
              </tr></thead>
              <tbody>
                {team.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50">
                    <td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar name={u.name} size="sm" />{u.name}</span></td>
                    {days.map((d) => {
                      const c = cellFor(u.id, d);
                      return (
                        <td key={d.date} className="px-2 py-2 text-center">
                          <button onClick={() => c.log && setViewLog(c.log)} disabled={!c.log}
                            className={cls("inline-flex items-center justify-center w-7 h-7 rounded", c.log && "hover:ring-2 hover:ring-blue-400",
                              c.state === "ok" ? "bg-green-100" : c.state === "miss" ? "bg-red-100" : c.state === "due" ? "bg-amber-100" : "bg-slate-100")}>
                            {c.state === "ok" && <Check size={13} className="text-green-700" />}
                            {c.state === "miss" && <X size={13} className="text-red-600" />}
                            {c.state === "due" && <Clock size={13} className="text-amber-600" />}
                            {c.state === "off" && <span className="text-slate-300 text-xs">·</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewLog && (
        <Modal wide title={"Work update — " + ((users.find((u) => u.id === viewLog.userId) || {}).name || "") + " · " + fmtDate(viewLog.date)} onClose={() => setViewLog(null)}>
          <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{viewLog.progress || "—"}</p>
          {/* Legacy structured fields, shown only if an older log has them. */}
          {(viewLog.companiesWorked || viewLog.calls || viewLog.meetings || viewLog.blockers || viewLog.next) && (
            <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 text-sm">
              {viewLog.companiesWorked && <p><span className="text-slate-400">Companies:</span> {viewLog.companiesWorked}</p>}
              {(viewLog.calls || viewLog.meetings) ? <p><span className="text-slate-400">Calls:</span> <span className="font-mono">{viewLog.calls || 0}</span> · <span className="text-slate-400">Meetings:</span> <span className="font-mono">{viewLog.meetings || 0}</span></p> : null}
              {viewLog.blockers && <p><span className="text-slate-400">Blockers:</span> {viewLog.blockers}</p>}
              {viewLog.next && <p><span className="text-slate-400">Next:</span> {viewLog.next}</p>}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   PRODUCT / SERVICE — KNOWLEDGE CHAT + TEMPLATES
   ============================================================ */

const TEMPLATE_TYPES = ["Intro email", "WhatsApp follow-up", "Capability one-pager", "Quote cover note"];

function KnowledgeView({ me, data, saveKnowledge }) {
  const { companies, knowledge } = data;
  const canManage = me.role === "admin" || me.role === "dept_head";
  const canSee = (k) => k.access === "all" || (k.access === "leadership" && (me.role === "admin" || me.role === "dept_head")) || (k.access === "admin" && me.role === "admin");
  const accessible = knowledge.filter(canSee);

  const [editing, setEditing] = useState(null); // entry | "new"
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [tpl, setTpl] = useState(null); // {type, text}
  const [tplBusy, setTplBusy] = useState("");
  const bodyRef = useRef(null);
  const speech = useSpeech((t) => setInput((p) => (p ? p + " " : "") + t));

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy]);

  const buildSystem = () => {
    const kb = accessible.map((k) => "### " + k.title + "\n" + String(k.content || "").slice(0, 4000)).join("\n\n").slice(0, 15000);
    const comp = companies.find((c) => c.id === companyId);
    return [
      "You are the Elecbits product & commercial knowledge assistant for the sales team.",
      "Answer ONLY using the knowledge entries below. If the answer is not covered, say exactly: \"Not in the knowledge base yet — ask admin to add it.\" Never invent specs, prices, or terms.",
      "Be tight and practical. Short paragraphs or bullet lists. This is for an agent mid-conversation with a client.",
      comp ? "The agent is preparing for this client — tailor framing to them, but facts still come only from the knowledge base: " + JSON.stringify({ name: comp.name, industry: comp.industry, city: comp.city, whatTheyDo: comp.whatTheyDo, potential: comp.potential }) : "",
      "KNOWLEDGE ENTRIES:\n" + (kb || "(empty)"),
    ].filter(Boolean).join("\n\n");
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setErr("");
    const next = [...msgs, { role: "user", content: text }];
    setMsgs(next); setBusy(true);
    try {
      const reply = await askClaude(buildSystem(), next.map((m) => ({ role: m.role, content: m.content })));
      setMsgs([...next, { role: "assistant", content: reply }]);
    } catch (e) { setErr("AI call failed — try again."); setInput(text); setMsgs(msgs); }
    setBusy(false);
  };

  const templatise = async (type) => {
    const lastA = [...msgs].reverse().find((m) => m.role === "assistant");
    const lastQ = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastA) return;
    setTplBusy(type);
    try {
      const comp = companies.find((c) => c.id === companyId);
      const sys = "You write client-ready sales collateral for Elecbits, an Indian electronics ODM/EMS company. Output plain text only — ready to paste and send. No markdown symbols, no commentary, no labels except 'Subject:' when writing an email. Confident, concise Indian business English.";
      const usr = "Turn this Q&A into a " + type + (comp ? " addressed to " + comp.name + " (" + (comp.industry || "client") + ", contact: " + (comp.contactPerson || "the client") + ")" : "") + ".\n\nQuestion: " + (lastQ ? lastQ.content : "") + "\n\nAnswer to base it on:\n" + lastA.content;
      const out = await askClaude(sys, [{ role: "user", content: usr }]);
      setTpl({ type, text: out });
    } catch (e) { setErr("Template generation failed — try again."); }
    setTplBusy("");
  };

  const upsertEntry = (k) => {
    const exists = knowledge.some((x) => x.id === k.id);
    saveKnowledge(exists ? knowledge.map((x) => (x.id === k.id ? k : x)) : [k, ...knowledge]);
    setEditing(null);
  };

  return (
    <div className="max-w-6xl mx-auto grid lg:grid-cols-5 gap-4 items-start">
      <div className="lg:col-span-2">
        <SectionTitle right={canManage ? <Btn size="sm" kind="primary" onClick={() => setEditing("new")}><Plus size={13} /> Add entry</Btn> : null}>
          Knowledge base
        </SectionTitle>
        {accessible.length === 0 ? (
          <Empty icon={BookOpen} title="Knowledge base is empty" sub="Admin trains this: capabilities, product lines, pricing rules. The chat answers only from what is here." action={canManage ? <Btn kind="primary" onClick={() => setEditing("new")}><Plus size={14} /> Add entry</Btn> : null} />
        ) : (
          <div className="space-y-2">
            {accessible.map((k) => (
              <div key={k.id} className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm text-slate-900">{k.title}</p>
                  <div className="flex items-center gap-1.5 flex-none">
                    <Chip color={k.access === "all" ? "green" : k.access === "leadership" ? "blue" : "slate"}>{k.access === "all" ? "Everyone" : k.access === "leadership" ? "Leadership" : "Admin only"}</Chip>
                    {canManage && <>
                      <button onClick={() => setEditing(k)} className="text-slate-400 hover:text-slate-700"><Pencil size={13} /></button>
                      <button onClick={() => saveKnowledge(knowledge.filter((x) => x.id !== k.id))} className="text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
                    </>}
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-3">{k.content}</p>
                <p className="font-mono text-xs text-slate-300 mt-1.5">updated {fmtDate(k.updatedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="lg:col-span-3">
        <SectionTitle right={
          <Sel value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="w-52">
            <option value="">Context: none</option>
            {companies.map((c) => <option key={c.id} value={c.id}>For: {c.name}</option>)}
          </Sel>
        }>Ask the company brain</SectionTitle>
        <div className="bg-white border border-slate-200 rounded-xl flex flex-col">
          <div ref={bodyRef} className="h-96 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
              <div className="text-sm text-slate-400 p-4">
                <p className="font-medium text-slate-500 mb-2">Ask anything the company should know:</p>
                <ul className="space-y-1 list-disc pl-4">
                  <li>"What's our MOQ for consumer devices?"</li>
                  <li>"How do I pitch ESL to a 40-store retail chain?"</li>
                  <li>"What payment terms can I offer without approval?"</li>
                </ul>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cls("max-w-lg rounded-lg px-3 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-50 border border-slate-200 text-slate-800")}>{m.content}</div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-xs text-slate-400 font-mono"><Loader2 size={13} className="animate-spin" /> searching the knowledge base…</div>}
            {err && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</p>}
            {msgs.some((m) => m.role === "assistant") && !busy && (
              <div className="flex flex-wrap gap-1.5 pt-1 items-center">
                <span className="text-xs text-slate-400 flex items-center gap-1"><Sparkles size={12} className="text-blue-600" /> Templatise last answer:</span>
                {TEMPLATE_TYPES.map((t) => (
                  <Btn key={t} size="sm" kind="subtle" disabled={!!tplBusy} onClick={() => templatise(t)}>
                    {tplBusy === t ? <Loader2 size={12} className="animate-spin" /> : null} {t}
                  </Btn>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-slate-200 p-3 flex gap-2 items-end">
            <TA value={input} onChange={(e) => setInput(e.target.value)} placeholder={speech.on ? "Listening…" : "Ask about products, pricing rules, capabilities…"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} className="flex-1 min-h-10" />
            {speech.supported && <Btn kind={speech.on ? "danger" : "ghost"} onClick={speech.toggle}>{speech.on ? <MicOff size={15} /> : <Mic size={15} />}</Btn>}
            <Btn kind="primary" disabled={busy || !input.trim()} onClick={send}><Send size={15} /></Btn>
          </div>
        </div>
      </div>

      {editing && <KnowledgeModal entry={editing === "new" ? null : editing} me={me} onClose={() => setEditing(null)} onSave={upsertEntry} />}
      {tpl && <TemplateModal tpl={tpl} onClose={() => setTpl(null)} />}
    </div>
  );
}

function KnowledgeModal({ entry, me, onClose, onSave }) {
  const [f, setF] = useState(() => entry || { id: uid(), title: "", content: "", access: "all", createdBy: me.id });
  return (
    <Modal wide title={entry ? "Edit entry" : "Add knowledge entry"} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.title.trim() || !f.content.trim()} onClick={() => onSave({ ...f, updatedAt: nowTS() })}><Check size={15} /> Save entry</Btn></>}>
      <div className="space-y-3">
        <Field label="Title" req><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. ESL pricing structure" /></Field>
        <Field label="Content" req hint="Paste specs, pitch angles, pricing rules, FAQs. The chat can only answer from what you put here.">
          <TA value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} className="min-h-48" />
        </Field>
        <Field label="Who can access this">
          <Sel value={f.access} onChange={(e) => setF({ ...f, access: e.target.value })}>
            <option value="all">Everyone</option>
            <option value="leadership">Leadership (dept heads + admin)</option>
            <option value="admin">Admin only</option>
          </Sel>
        </Field>
      </div>
    </Modal>
  );
}

function TemplateModal({ tpl, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(tpl.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  };
  return (
    <Modal wide title={tpl.type + " — ready to send"} onClose={onClose}
      footer={<><Btn onClick={onClose}>Close</Btn><Btn kind="primary" onClick={copy}><Copy size={14} /> {copied ? "Copied" : "Copy text"}</Btn></>}>
      <TA readOnly value={tpl.text} className="min-h-64 font-mono text-xs" />
    </Modal>
  );
}

/* ============================================================
   EXPENSES
   ============================================================ */

function ExpensesView({ me, data, saveExpenses }) {
  const { users, companies, expenses } = data;
  const [creating, setCreating] = useState(false);
  const [notes, setNotes] = useState({});
  const isApprover = me.role === "admin" || me.role === "finance";
  const mine = expenses.filter((e) => e.userId === me.id);
  const pendingQueue = expenses.filter((e) => e.status === "pending" && e.userId !== me.id);
  const decided = expenses.filter((e) => e.status !== "pending");

  const decide = (e, status) => {
    saveExpenses(expenses.map((x) => x.id === e.id ? { ...x, status, decidedBy: me.id, decidedAt: nowTS(), decisionNote: (notes[e.id] || "").trim() } : x));
  };

  const StatusChip = ({ s }) => s === "approved" ? <Chip color="green"><CheckCircle2 size={11} /> Approved</Chip>
    : s === "rejected" ? <Chip color="red"><XCircle size={11} /> Rejected</Chip>
    : <Chip color="amber"><Clock size={11} /> Pending</Chip>;

  const ExpCard = ({ e, actions }) => {
    const u = users.find((x) => x.id === e.userId);
    const c = companies.find((x) => x.id === e.companyId);
    const d = users.find((x) => x.id === e.decidedBy);
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm text-slate-900">{e.purpose}</p>
            <p className="text-xs text-slate-500 mt-0.5">{u ? u.name : "?"}{c ? " · " + c.name : ""} · {e.city} · {fmtDate(e.from)} → {fmtDate(e.to)} · {e.mode}</p>
            {e.notes && <p className="text-xs text-slate-400 mt-1">{e.notes}</p>}
            {e.status !== "pending" && <p className="text-xs text-slate-500 mt-1.5">{e.status === "approved" ? "Approved" : "Rejected"} by {d ? d.name : "?"}{e.decisionNote ? " — " + e.decisionNote : ""}</p>}
          </div>
          <div className="text-right flex-none">
            <p className="font-mono tabular-nums text-lg text-slate-900">{fmtINR(e.estimate)}</p>
            <div className="mt-1"><StatusChip s={e.status} /></div>
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
            <Input placeholder="Note (optional): budget line, conditions…" value={notes[e.id] || ""} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} className="flex-1 min-w-40" />
            <Btn kind="success" size="sm" onClick={() => decide(e, "approved")}><Check size={13} /> Approve</Btn>
            <Btn kind="danger" size="sm" onClick={() => decide(e, "rejected")}><X size={13} /> Reject</Btn>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-auto">Expenses</h1>
        <Btn kind="primary" onClick={() => setCreating(true)}><Plus size={15} /> New travel request</Btn>
      </div>

      {isApprover && (
        <div className="mb-6">
          <SectionTitle>Approval queue</SectionTitle>
          {pendingQueue.length === 0 ? <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-4">Queue is clear.</p>
            : <div className="space-y-2">{pendingQueue.map((e) => <ExpCard key={e.id} e={e} actions />)}</div>}
        </div>
      )}

      <SectionTitle>My requests</SectionTitle>
      {mine.length === 0 ? (
        <Empty icon={Receipt} title="No requests yet" sub="Travelling to meet a client? Raise it here — admin or finance approves before you book." action={<Btn kind="primary" onClick={() => setCreating(true)}><Plus size={14} /> New travel request</Btn>} />
      ) : <div className="space-y-2">{mine.map((e) => <ExpCard key={e.id} e={e} />)}</div>}

      {isApprover && decided.length > 0 && (
        <div className="mt-6">
          <SectionTitle>Decision history</SectionTitle>
          <div className="space-y-2">{decided.slice(0, 20).map((e) => <ExpCard key={e.id} e={e} />)}</div>
        </div>
      )}

      {creating && <ExpenseModal me={me} data={data} onClose={() => setCreating(false)}
        onSave={(f) => { saveExpenses([{ ...f, id: uid(), userId: me.id, status: "pending", createdAt: nowTS(), decidedBy: null, decisionNote: "" }, ...expenses]); setCreating(false); }} />}
    </div>
  );
}

function ExpenseModal({ me, data, onClose, onSave }) {
  const { companies } = data;
  const [f, setF] = useState({ purpose: "", companyId: "", city: "", from: todayStr(), to: todayStr(), mode: "Cab", estimate: "", notes: "" });
  const ok = f.purpose.trim() && f.city.trim() && Number(f.estimate) > 0;
  return (
    <Modal title="New travel request" onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!ok} onClick={() => onSave({ ...f, estimate: Number(f.estimate) })}><Check size={15} /> Submit for approval</Btn></>}>
      <div className="space-y-3">
        <Field label="Purpose" req><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. ESL demo at client HQ" /></Field>
        <Field label="Linked company">
          <Sel value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">— none —</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Sel>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" req><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Mode">
            <Sel value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
              {["Cab", "Train", "Flight", "Bus", "Own vehicle", "Other"].map((m) => <option key={m}>{m}</option>)}
            </Sel>
          </Field>
          <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <Field label="Estimated cost (₹)" req><Input type="number" value={f.estimate} onChange={(e) => setF({ ...f, estimate: e.target.value })} /></Field>
        <Field label="Notes"><TA value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What you're carrying, who you're meeting…" /></Field>
      </div>
    </Modal>
  );
}

/* ============================================================
   DAILY SCRUM — write it as it comes → AI-organised tasks
   ============================================================ */

function DailyScrumView({ me, data, saveScrums }) {
  const { users, scrums } = data;
  const [date, setDate] = useState(todayStr());
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const speech = useSpeech((t) => setRaw((p) => (p ? p + " " : "") + t));

  const scopeIds = me.role === "admin" ? users.map((u) => u.id)
    : me.role === "dept_head" ? [me.id, ...teamOf(me, users).map((u) => u.id)]
    : [me.id];
  const dayNotes = scrums
    .filter((s) => s.date === date && scopeIds.includes(s.userId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const organise = async () => {
    const text = raw.trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    const system = [
      "You organise a typed/spoken daily scrum for the Elecbits sales + ODM team into clear, assigned, time-boxed tasks.",
      "Read the note and extract each task with its owner, time window (if given) and any if/else condition.",
      "Keep task text short and action-first. Preserve project IDs verbatim.",
      "When done, reply with ONLY this on one line and nothing else: SCRUM_JSON {\"tasks\":[{\"owner\":\"name or empty\",\"task\":\"...\",\"window\":\"e.g. 12pm–1pm or empty\",\"condition\":\"if/else note or empty\"}],\"summary\":\"one-line summary\"}",
      "The JSON must be valid. No markdown.",
    ].join("\n");
    try {
      const reply = await askClaude(system, [{ role: "user", content: text }]);
      const parsed = extractMarkedJSON(reply, "SCRUM_JSON") || {};
      const note = {
        id: uid(), userId: me.id, date, raw: text,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        summary: parsed.summary || "", createdAt: nowTS(),
      };
      saveScrums([note, ...scrums]);
      setRaw("");
    } catch (e) { setErr("Could not organise this — saved nothing. Check connection and try again."); }
    setBusy(false);
  };

  const saveRawOnly = () => {
    const text = raw.trim();
    if (!text) return;
    saveScrums([{ id: uid(), userId: me.id, date, raw: text, tasks: [], summary: "", createdAt: nowTS() }, ...scrums]);
    setRaw("");
  };
  const remove = (id) => saveScrums(scrums.filter((s) => s.id !== id));

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h1 className="text-lg font-semibold mr-auto">Daily Scrum</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " w-auto"} />
      </div>
      <p className="text-sm text-slate-500 mb-4">Write it as it comes — the AI turns it into assigned, time-boxed, if/else-aware tasks.</p>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <CalendarCheck2 size={16} className="text-blue-600" />
          <p className="text-sm font-semibold text-slate-800">Daily scrum — write it as it comes</p>
        </div>
        <TA value={raw} onChange={(e) => setRaw(e.target.value)} className="min-h-32"
          placeholder={speech.on ? "Listening… speak the scrum" : "e.g. — project ID esp-32-123: check the gerber file, Rahul 12pm to 1pm. If the gerber is fine, great; if not, verify the schematic and submit a report in an hour. Gargi checks the BoM 12 to 1pm. Ask Akshay to have the client communicated by 2pm."} />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Btn kind="primary" disabled={busy || !raw.trim()} onClick={organise}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Organise with AI
          </Btn>
          {speech.supported && <Btn kind={speech.on ? "danger" : "ghost"} onClick={speech.toggle}>{speech.on ? <MicOff size={14} /> : <Mic size={14} />}</Btn>}
          <Btn kind="ghost" disabled={busy || !raw.trim()} onClick={saveRawOnly}>Save raw note</Btn>
          <span className="text-xs text-slate-400 ml-auto">Mention project ID, people, time windows and any if/else.</span>
        </div>
        {err && <p className="text-xs text-red-600 mt-2 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</p>}
      </div>

      <div className="flex items-center gap-2 mt-6 mb-3">
        <ClipboardList size={15} className="text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-700">Notes — {fmtDate(date)}</h2>
        <Chip color="slate">{dayNotes.length}</Chip>
      </div>
      {dayNotes.length === 0 ? (
        <Empty icon={CalendarCheck2} title="No scrum notes for this day" sub="Type the day's plan above and let the AI break it into assigned, time-boxed tasks." />
      ) : (
        <div className="space-y-3">
          {dayNotes.map((s) => {
            const by = users.find((u) => u.id === s.userId);
            return (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-blue-500">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-sm text-slate-900">{by ? by.name : "?"}</span>
                  <span className="font-mono text-xs text-slate-400">{new Date(s.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                  {s.tasks && s.tasks.length > 0 ? <Chip color="blue">{s.tasks.length} task{s.tasks.length === 1 ? "" : "s"}</Chip> : <Chip color="slate">raw note</Chip>}
                  {(me.role === "admin" || s.userId === me.id) && (
                    <button onClick={() => remove(s.id)} className="ml-auto text-slate-400 hover:text-red-600" title="Delete"><Trash2 size={13} /></button>
                  )}
                </div>
                {s.tasks && s.tasks.length > 0 ? (
                  <div className="space-y-2">
                    {s.summary && <p className="text-xs text-slate-500 italic">{s.summary}</p>}
                    {s.tasks.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <Check size={14} className="text-green-600 mt-0.5 flex-none" />
                        <div className="min-w-0">
                          <span className="text-slate-800">{t.task}</span>
                          <span className="ml-2 inline-flex flex-wrap gap-1.5 align-middle">
                            {t.owner && <Chip color="blue">{t.owner}</Chip>}
                            {t.window && <Chip color="slate"><Clock size={10} /> {t.window}</Chip>}
                            {t.condition && <Chip color="amber">{t.condition}</Chip>}
                          </span>
                        </div>
                      </div>
                    ))}
                    <details className="mt-1">
                      <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">Original note</summary>
                      <p className="text-xs text-slate-500 whitespace-pre-wrap mt-1">{s.raw}</p>
                    </details>
                  </div>
                ) : (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{s.raw}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ASSISTANT (admin) — chat over the workspace + system memory
   ============================================================ */

function AssistantView({ me, data }) {
  const { users, companies, deals, kpis, memory } = data;
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bodyRef = useRef(null);
  const speech = useSpeech((t) => setInput((p) => (p ? p + " " : "") + t));

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy]);

  const buildSystem = () => {
    const compSnap = companies.slice(0, 60).map((c) => ({
      name: c.name, city: c.city, industry: c.industry, potential: c.potential,
      owner: (users.find((u) => u.id === c.accountOwner) || {}).name, complete: completeness(c) + "%",
    }));
    const dealSnap = deals.slice(0, 80).map((d) => ({
      company: (companies.find((c) => c.id === d.companyId) || {}).name,
      stage: d.lost ? "lost" : stageName(d.stage), value: d.value,
      owner: (users.find((u) => u.id === d.ownerId) || {}).name, staleDays: dealStaleDays(d),
    }));
    const mem = (memory || []).map((m) => "• " + m.title + ": " + m.text).join("\n");
    return [
      "You are the Elecbits Sales OS assistant for the admin/leadership team.",
      "Answer using the workspace snapshot and system memory below. Be concise and practical — short paragraphs or bullet lists. If something isn't in the data, say so plainly rather than inventing it.",
      "SYSTEM MEMORY (durable facts & rules):\n" + (mem || "(none)"),
      "COMPANIES: " + JSON.stringify(compSnap),
      "DEALS: " + JSON.stringify(dealSnap),
      "TEAM: " + JSON.stringify(users.map((u) => ({ name: u.name, role: roleLabel(u.role), dept: u.dept }))),
    ].join("\n\n");
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setErr("");
    const next = [...msgs, { role: "user", content: text }];
    setMsgs(next); setBusy(true);
    try {
      const reply = await askClaude(buildSystem(), next.map((m) => ({ role: m.role, content: m.content })));
      setMsgs([...next, { role: "assistant", content: reply }]);
    } catch (e) { setErr("AI call failed — try again."); setInput(text); setMsgs(msgs); }
    setBusy(false);
  };

  const suggestions = [
    "Which deals are stuck the longest?",
    "Summarise the pipeline by stage and value.",
    "Which companies have the weakest data?",
    "Who on the team is behind and why?",
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-lg font-semibold mr-auto flex items-center gap-2"><Bot size={18} className="text-blue-600" /> Assistant</h1>
        <Chip color="green"><Database size={11} /> Reads the workspace</Chip>
      </div>
      <p className="text-sm text-slate-500 mb-4">Ask about the pipeline, companies, team and KPIs — it answers from live workspace data and your system memory.</p>

      <div className="bg-white border border-slate-200 rounded-xl flex flex-col">
        <div ref={bodyRef} className="h-[28rem] overflow-y-auto p-4 space-y-3">
          {msgs.length === 0 && (
            <div className="text-sm text-slate-400">
              <p className="font-medium text-slate-500 mb-2">Try:</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => setInput(s)} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs hover:bg-blue-50 hover:text-blue-700 transition-colors">{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cls("max-w-lg rounded-lg px-3 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-50 border border-slate-200 text-slate-800")}>{m.content}</div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-slate-400 font-mono"><Loader2 size={13} className="animate-spin" /> thinking…</div>}
          {err && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</p>}
        </div>
        <div className="border-t border-slate-200 p-3 flex gap-2 items-end">
          <TA value={input} onChange={(e) => setInput(e.target.value)} placeholder={speech.on ? "Listening…" : "Ask the assistant…"}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} className="flex-1 min-h-10" />
          {speech.supported && <Btn kind={speech.on ? "danger" : "ghost"} onClick={speech.toggle}>{speech.on ? <MicOff size={15} /> : <Mic size={15} />}</Btn>}
          <Btn kind="primary" disabled={busy || !input.trim()} onClick={send}><Send size={15} /></Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SYSTEM MEMORY (admin) — durable facts the Assistant remembers
   ============================================================ */

function SystemMemoryView({ me, data, saveMemory }) {
  const { users, memory } = data;
  const [editing, setEditing] = useState(null); // entry | "new"

  const upsert = (m) => {
    const exists = memory.some((x) => x.id === m.id);
    saveMemory(exists ? memory.map((x) => (x.id === m.id ? m : x)) : [{ ...m }, ...memory]);
    setEditing(null);
  };
  const remove = (id) => saveMemory(memory.filter((x) => x.id !== id));

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-lg font-semibold mr-auto flex items-center gap-2"><Database size={18} className="text-blue-600" /> System Memory</h1>
        <Btn kind="primary" size="sm" onClick={() => setEditing("new")}><Plus size={14} /> Add memory</Btn>
      </div>
      <p className="text-sm text-slate-500 mb-4">Durable facts, positioning and rules the Assistant always keeps in mind. Keep each entry short and true.</p>

      {(!memory || memory.length === 0) ? (
        <Empty icon={Database} title="No system memory yet" sub="Add the things the Assistant should never forget — positioning, pricing rules, do's and don'ts." action={<Btn kind="primary" onClick={() => setEditing("new")}><Plus size={14} /> Add memory</Btn>} />
      ) : (
        <div className="space-y-2">
          {memory.map((m) => {
            const by = users.find((u) => u.id === m.by);
            return (
              <div key={m.id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm text-slate-900">{m.title}</p>
                  <div className="flex items-center gap-1.5 flex-none">
                    <button onClick={() => setEditing(m)} className="text-slate-400 hover:text-slate-700"><Pencil size={13} /></button>
                    <button onClick={() => remove(m.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{m.text}</p>
                <p className="font-mono text-xs text-slate-300 mt-1.5">updated {fmtDate(m.updatedAt)}{by ? " · " + by.name : ""}</p>
              </div>
            );
          })}
        </div>
      )}

      {editing && <MemoryModal entry={editing === "new" ? null : editing} me={me} onClose={() => setEditing(null)} onSave={upsert} />}
    </div>
  );
}

function MemoryModal({ entry, me, onClose, onSave }) {
  const [f, setF] = useState(() => entry || { id: uid(), title: "", text: "", by: me.id });
  return (
    <Modal wide title={entry ? "Edit memory" : "Add memory"} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!f.title.trim() || !f.text.trim()} onClick={() => onSave({ ...f, updatedAt: nowTS(), by: me.id })}><Check size={15} /> Save</Btn></>}>
      <div className="space-y-3">
        <Field label="Title" req><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Discount approval limits" /></Field>
        <Field label="Memory" req hint="The Assistant treats this as always-true context.">
          <TA value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} className="min-h-32" />
        </Field>
      </div>
    </Modal>
  );
}

/* ============================================================
   ADMIN
   ============================================================ */

function AdminView({ me, data, saveUsers, saveGates, resetDemo }) {
  const { users, gates } = data;
  const [editUser, setEditUser] = useState(null); // user | "new"
  const [gateStage, setGateStage] = useState("rfq");
  const [gateText, setGateText] = useState(() => ((gates["rfq"] && gates["rfq"].length ? gates["rfq"] : DEFAULT_GATES["rfq"]) || []).join("\n"));
  const [gateSaved, setGateSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState(false);

  const pickStage = (k) => {
    setGateStage(k);
    setGateText(((gates[k] && gates[k].length ? gates[k] : DEFAULT_GATES[k]) || []).join("\n"));
  };
  const saveGate = () => {
    const lines = gateText.split("\n").map((l) => l.trim()).filter(Boolean);
    saveGates({ ...gates, [gateStage]: lines });
    setGateSaved(true); setTimeout(() => setGateSaved(false), 1500);
  };
  const resetGate = () => {
    const next = { ...gates }; delete next[gateStage];
    saveGates(next); setGateText((DEFAULT_GATES[gateStage] || []).join("\n"));
  };
  const upsertUser = (u) => {
    const exists = users.some((x) => x.id === u.id);
    saveUsers(exists ? users.map((x) => (x.id === u.id ? u : x)) : [...users, u]);
    setEditUser(null);
  };
  const backup = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle right={<Btn size="sm" kind="primary" onClick={() => setEditUser("new")}><Plus size={13} /> Add user</Btn>}>Users & roles</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-4 font-medium">Name</th><th className="py-2 pr-4 font-medium">Email</th><th className="py-2 pr-4 font-medium">Role</th><th className="py-2 pr-4 font-medium">Department</th><th className="py-2 pr-4 font-medium">Status</th><th className="py-2" />
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="py-2 pr-4"><span className="flex items-center gap-2"><Avatar name={u.name} size="sm" />{u.name}{u.id === me.id && <span className="text-xs text-slate-400">(you)</span>}</span></td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">{u.email || "—"}</td>
                  <td className="py-2 pr-4">{roleLabel(u.role)}</td>
                  <td className="py-2 pr-4">{u.dept}</td>
                  <td className="py-2 pr-4">{u.active !== false ? <Chip color="green">Active</Chip> : <Chip color="slate">Inactive</Chip>}</td>
                  <td className="py-2 text-right"><Btn size="sm" onClick={() => setEditUser(u)}><Pencil size={12} /></Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-3">KPI chain: you set targets for dept heads; dept heads set targets for their agents — in Performance → Set targets.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle>Stage gate questions — what the AI must extract</SectionTitle>
        <p className="text-xs text-slate-500 mb-3">One requirement per line. The gate interviews the agent until every line is covered with specifics. Edit per stage to match how Elecbits sells.</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {STAGES.filter((s) => s.key !== "lead").map((s) => (
            <button key={s.key} onClick={() => pickStage(s.key)}
              className={cls("px-2.5 py-1 rounded-lg text-xs font-medium border", gateStage === s.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100")}>
              {s.name}{gates[s.key] && gates[s.key].length ? " •" : ""}
            </button>
          ))}
        </div>
        <TA value={gateText} onChange={(e) => setGateText(e.target.value)} className="min-h-40 font-mono text-xs" />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Btn kind="primary" size="sm" onClick={saveGate}><Check size={13} /> Save for {stageName(gateStage)}</Btn>
          <Btn size="sm" onClick={resetGate}>Reset to default</Btn>
          {gateSaved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
          <span className="ml-auto text-xs text-slate-400 font-mono">• = customised</span>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle>Workspace data</SectionTitle>
        <p className="text-xs text-slate-500 mb-3 flex items-start gap-1.5"><FileText size={13} className="mt-0.5 flex-none" /> This is a shared workspace — everyone who opens the app sees and edits the same data. Copy a backup before big changes.</p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={backup}><Copy size={14} /> {copied ? "Copied" : "Copy backup JSON"}</Btn>
          {!confirmReset ? (
            <Btn kind="danger" onClick={() => setConfirmReset(true)}><Trash2 size={14} /> Reset to demo data</Btn>
          ) : (
            <>
              <Btn kind="danger" onClick={() => { resetDemo(); setConfirmReset(false); }}><AlertTriangle size={14} /> Yes, wipe everything</Btn>
              <Btn onClick={() => setConfirmReset(false)}>Cancel</Btn>
            </>
          )}
        </div>
      </div>

      {editUser && <UserModal user={editUser === "new" ? null : editUser} me={me} onClose={() => setEditUser(null)} onSave={upsertUser} />}
    </div>
  );
}

function UserModal({ user, me, onClose, onSave }) {
  const [f, setF] = useState(() => user || { id: uid(), name: "", email: "", role: "agent", dept: "Sales", active: true });
  const [password, setPassword] = useState("");
  const [resetPw, setResetPw] = useState(""); // optional new password for an existing user
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const isSelf = user && user.id === me.id;
  const isNew = !user;

  const save = async () => {
    setErr(""); setWarn("");
    const email = String(f.email || "").trim().toLowerCase();
    if (!f.name.trim()) { setErr("Name is required."); return; }
    if (!email) { setErr("Email is required — it's how they sign in."); return; }
    if (isNew && password.length < 6) { setErr("Set a password of at least 6 characters for the new login."); return; }
    setBusy(true);
    try {
      if (isNew) {
        // Create the Supabase Auth login first; only save the profile if it works,
        // so we never have a profile that can't sign in.
        await callAdminApi("create", { email, password });
      } else if (resetPw) {
        if (resetPw.length < 6) { setErr("New password must be at least 6 characters."); setBusy(false); return; }
        await callAdminApi("setPassword", { email, password: resetPw });
      }
      onSave({ ...f, email });
    } catch (e) {
      // The profile still saves so the workspace isn't blocked, but flag that the
      // login itself wasn't created/updated (e.g. /api/admin not deployed).
      setWarn((e && e.message ? e.message : "Login update failed.") + " Profile saved; create the login separately (see scripts/seed-auth.mjs).");
      onSave({ ...f, email });
    }
    setBusy(false);
  };

  return (
    <Modal title={user ? "Edit " + user.name : "Add user"} onClose={onClose}
      footer={<>
        {warn && <span className="mr-auto text-xs text-amber-600">{warn}</span>}
        {err && <span className="mr-auto text-xs text-red-600">{err}</span>}
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={busy || !f.name.trim()} onClick={save}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save user</Btn>
      </>}>
      <div className="space-y-3">
        <Field label="Name" req><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" req hint={isNew ? "used to sign in" : "sign-in email"}>
          <Input type="email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@elecbits.in" disabled={!isNew} />
        </Field>
        {isNew && (
          <Field label="Password" req hint="min 6 characters">
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Temporary password to share with them" />
          </Field>
        )}
        {!isNew && (
          <Field label="Reset password" hint="optional — leave blank to keep current">
            <Input type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="New password (min 6 characters)" />
          </Field>
        )}
        <Field label="Role">
          <Sel value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} disabled={!!isSelf}>
            {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Sel>
        </Field>
        <Field label="Department"><Input value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.active !== false} disabled={!!isSelf} onChange={(e) => setF({ ...f, active: e.target.checked })} className="rounded border-slate-300" />
          Active (inactive users can't sign in)
        </label>
        {isSelf && <p className="text-xs text-slate-400">You can't change your own role or deactivate yourself.</p>}
      </div>
    </Modal>
  );
}
