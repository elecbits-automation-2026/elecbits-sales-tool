import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Building2, Columns, TrendingUp, BookOpen, Receipt, Settings, Plus, X, Search,
  Mic, MicOff, Send, Check, CheckCircle2, XCircle, AlertTriangle, AlertCircle,
  Clock, Flame, LogOut, Pencil, Trash2, Sparkles, Loader2, Copy, ChevronRight,
  ArrowRight, Users, GraduationCap, ClipboardList, Phone, FileText,
  Bot, Database, CalendarCheck2, Sun, Moon, ListTodo, FolderOpen, PencilRuler,
  ExternalLink, BadgeCheck, Rocket, Gauge, Lightbulb, Paperclip, Play, GitBranch, Video
} from "lucide-react";
import { supabase } from "./lib/supabase";
import {
  loadWorkspace, syncUsers, syncCompanies, syncDeals, syncKpis, syncTrainings,
  syncWorklogs, syncKnowledge, syncExpenses, syncScrums, syncMemory, syncGates,
  syncTasks, syncLlds, syncQuestionSet, mintClientId, submitProjectRequest,
  loadChat, loadChatDates, saveChat, saveSession, loadAllIdeas,
  loadTouches, saveTouch, loadCommitments, saveCommitments,
  deleteTask, deleteScrum,
  saveDealPlan, setTemperature, saveNextStep, loadScrumSessions, upsertScrumSession,
  saveRfqLink, setRequestOvertake, deleteCompany, removeFromRoster, setCapacity, loadClientLog, loadAllClientLogs,
} from "./lib/data";
import { signInOrUp, signOut, currentAuthEmail, bootstrapFirstAdmin } from "./lib/auth";
import {
  askClaude, askWithDrive, fileToBlock, contentText, stripToolLines,
  extractMarkedJSON, withTimeout, setMemoryText, memoryTextFrom, DRIVE_TOOL_PROMPT,
} from "./lib/ai";
import * as drive from "./lib/drive";
import { driveFolderName } from "./lib/drive";
import * as fireflies from "./lib/fireflies";
import * as meet from "./lib/meet";
import * as recordings from "./lib/recordings";
import * as adminUsers from "./lib/adminUsers";
import {
  STAGES, stageIdx, stageName, DEFAULT_GATES, KPI_METRICS,
  COMPANY_FIELDS, REQ_FIELDS, STALE_AMBER, STALE_RED,
  STAGE_GUIDE, guideFor, entryGatesFor,
} from "./data/stages";
import {
  INDUSTRIES, ORG_SIZES, industryCodeOf, LLD_QUESTIONS, ROLES, roleLabel,
} from "./data/taxonomy";
import { SCRUM_PLACEHOLDER, isoDay, dayFor, fallbackScrum } from "./data/scrum";
import logoLight from "./assets/elecbits-logo.png";
import logoDark from "./assets/elecbits-logo-dark.png";
import markLight from "./assets/elecbits-mark.png";
import markDark from "./assets/elecbits-mark-dark.png";

/* ============================================================
   ELECBITS SALES OS
   Elecbits ODM PMS look-and-feel: clean slate-on-white canvas,
   blue accent, IBM Plex Mono readouts, light nav rail.
   LED status language kept — red = alarm = fix now.
   ============================================================ */

/* Official Elecbits wordmark. The artwork already contains the word
   "Elecbits", so never pair it with a separate text label.
   Each form ships in two files because the icon half is pure black: the light
   file would disappear on dark surfaces, so CSS (index.css) swaps in the
   white-icon file under [data-theme="dark"].
   variant="full" is the 5.4:1 lockup; variant="mark" is the circuit glyph
   alone, for tight spots (the mobile rail) where the wordmark would be too
   small to read. Sized by height — width follows the artwork's ratio. */
function Logo({ height = 28, variant = "full", className = "" }) {
  const isMark = variant === "mark";
  const style = { height, width: "auto" };
  return (
    <>
      <img src={isMark ? markLight : logoLight} alt="Elecbits" style={style}
        className={cls("eb-logo-light flex-none", className)} />
      <img src={isMark ? markDark : logoDark} alt="" aria-hidden="true" style={style}
        className={cls("eb-logo-dark flex-none", className)} />
    </>
  );
}

/* ---------- storage & auth ----------
   Phase 0 cut-over: data lives in the relational sales.* + core.* schemas of
   eb-core-database-1 (see supabase/01–03 SQL), loaded and synced through
   src/lib/data.ts. Login is Supabase Auth — an admin puts a person's email on
   the roster; their first sign-in creates the account and a DB trigger links
   it to their core.people row. */

/* Attachment chips + the paste/attach plumbing, one line to wire in. */
function AttachChips({ atts, setAtts }) {
  if (!atts.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {atts.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 rounded-full px-2.5 py-1">
          {a.type === "image" ? "🖼" : "📄"} {a._name}
          <button onClick={() => setAtts(atts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={11} /></button>
        </span>
      ))}
    </div>
  );
}

const fmtTime = (ts) => { try { return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

/* ── Task briefs: what to ask before the work, and after it ────────────────
   The AI writes these once, at Start. When it is unreachable the local bank
   below answers instead — same shape, no network, so the flow never stalls.
   Ordering matters: `produce` is tested first, so "prepare the deck for the
   meeting" needs a file while "ask for a meeting" does not.               */
// Naming a document is not producing one: "call them about the PO" creates
// nothing. A file is only expected when a producing VERB meets an artifact
// noun, or an artifact noun stands alone with no talking verb around it.
// Stems, so "update/updating/updated" all match — hence no trailing \b.
const PRODUCE_VERB = /\b(prepar|creat|draft|writ|mak|build|produc|issu|generat|compil|updat|revis|finalis|finaliz|put together|work out)/i;
const ARTIFACT_NOUN = /\b(quote|quotation|proposal|costing|lld|bom|report|deck|presentation|slides|mom|minutes|invoice|contract|nda|agreement|datasheet|drawing|schematic|spec|specification|sheet|document|draft)\b/i;
const TALK_KINDS = [
  ["visit", /\b(visit|site visit|factory|plant|onsite|on-site)\b/i],
  ["meeting", /\b(meeting|meet\b|catch ?up|appointment|schedule|book a|slot)\b/i],
  ["call", /\b(call|phone|ring|dial|speak to|talk to)\b/i],
  ["followup", /\b(follow[ -]?up|chase|remind|nudge|check in|revert|confirm)\b/i],
  ["send", /\b(send|share|mail|email|forward|submit|circulate)\b/i],
  ["price", /\b(price|pricing|negotiat|discount|rate)\b/i],
];
// A meeting that HAPPENED leaves minutes or a transcript; one that is merely
// being arranged leaves nothing.
const ATTENDED_RE = /\b(attend|had a|had the|did the|conduct|held|hosted|after the|debrief|wrap ?up|took place|went to)/i;
const MEETINGISH_RE = /\b(meeting|call|demo|review|discussion|presentation|session|visit)\b/i;
const classifyTask = (s) => {
  const talk = TALK_KINDS.find(([, re]) => re.test(s));
  if (PRODUCE_VERB.test(s) && ARTIFACT_NOUN.test(s)) return ["produce", "file"];
  if (ATTENDED_RE.test(s) && MEETINGISH_RE.test(s)) return ["attended", "link"];
  if (talk) return [talk[0], "none"];             // arranging/chasing leaves nothing
  if (ARTIFACT_NOUN.test(s)) return ["produce", "file"];
  return ["generic", "none"];
};
const QUESTION_BANK = {
  produce: { prep: ["What exactly are you producing, and who is it for?", "What numbers or inputs do you need before you start?", "Where will you save it when it's done?"],
             close: ["What did you produce, and what is it called?", "What are the key numbers in it?", "Who has it now, and what do they do next?"] },
  visit: { prep: ["What is the purpose of this visit?", "Who are you meeting, and what are you carrying?", "What must you walk out with?"],
           close: ["Who did you meet, and what did you see?", "What came out of it?", "What is the next step, and by when?"] },
  meeting: { prep: ["What is this meeting actually about?", "What agenda or material will you take in?", "What outcome do you want to walk out with?"],
             close: ["Did they agree — what date and time?", "What did you tell them the meeting is about?", "What did you commit to before it?"] },
  call: { prep: ["What is the one thing you need out of this call?", "What will they push back on, and what's your answer?", "What do you need in front of you before you dial?"],
          close: ["Who did you speak to, and what did they say?", "What was agreed, or refused?", "What is the next step, and by when?"] },
  followup: { prep: ["What are you chasing, and when did you last ask?", "What deadline will you put on it?", "What happens if they don't respond this time?"],
              close: ["What did they come back with?", "Has the thing you were chasing moved?", "What is the next step, and by when?"] },
  send: { prep: ["What exactly are you sending, and to whom?", "Does anyone need to approve it first?", "What do you want them to do after reading it?"],
          close: ["What did you send, and to whom?", "When did it go out?", "What response are you expecting, and by when?"] },
  price: { prep: ["What is your target number, and your walk-away?", "How will you justify it?", "What can you trade instead of a discount?"],
           close: ["What number was discussed, and how did they react?", "What did you concede or hold?", "What is the next step, and by when?"] },
  attended: { prep: ["What must you walk out of this with?", "Who from their side will be in the room?", "What will you show or take in?"],
              close: ["Who attended, from both sides?", "What was agreed, and what was pushed back on?", "What is the next step, and by when?"] },
  generic: { prep: ["What does 'done' look like for this?", "What do you need before you can start?", "Who else is involved?"],
             close: ["What exactly did you do?", "What was the outcome?", "What happens next, and by when?"] },
};
const EVIDENCE_WHAT = {
  file: "the document you produced",
  link: "the minutes (MoM) in the company folder, or a Fireflies / Meet / recording link",
};
// Finds the company a piece of text is about — "Sunrise Company" resolves to
// "Sunrise Retail Tech", an Eb- ID resolves too. Ambiguity yields nothing:
// two companies sharing a first word is not a match.
const GENERIC_WORD = /^(the|a|an|our|for|and|of|to|company|client|customer|ltd|limited|pvt|private|inc|llp|technologies|tech|solutions|industries|india)$/i;
function matchCompany(text, companies) {
  const hay = " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  if (!hay.trim() || !companies || !companies.length) return null;
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // 1. an ID mentioned outright
  const byId = companies.find((c) => (c.cid && hay.includes(" " + norm(c.cid) + " ")) || (c.legacyCid && hay.includes(" " + norm(c.legacyCid) + " ")));
  if (byId) return byId;
  // 2. the full name appears
  const byName = companies.filter((c) => norm(c.name) && hay.includes(" " + norm(c.name) + " "));
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return byName.sort((a, b) => norm(b.name).length - norm(a.name).length)[0];
  // 3. a distinctive leading word ("Sunrise", "Greenline")
  const byWord = companies.filter((c) => {
    const w = norm(c.name).split(" ").filter((x) => x.length > 3 && !GENERIC_WORD.test(x))[0];
    return w && hay.includes(" " + w + " ");
  });
  return byWord.length === 1 ? byWord[0] : null;
}

const fallbackBrief = (t) => {
  const [kind, ev] = classifyTask((t.title || "") + " " + (t.details || ""));
  return { kind, evidence: { kind: ev, what: EVIDENCE_WHAT[ev] || "" },
           prep: QUESTION_BANK[kind].prep, close: QUESTION_BANK[kind].close,
           tip: "", source: "fallback", at: nowTS() };
};
const cleanBrief = (b) => {
  const arr = (x) => (Array.isArray(x) ? x : []).map((q) => String(q || "").trim()).filter(Boolean).slice(0, 4);
  const prep = arr(b && b.prep), close = arr(b && b.close);
  if (prep.length < 2 || close.length < 2) return null;
  const raw = (b && b.evidence && b.evidence.kind) || (b && b.artifact && b.artifact.required ? "file" : "none");
  const kind = ["file", "link", "none"].includes(raw) ? raw : "none";
  return { kind: String((b && b.kind) || "").slice(0, 40),
           evidence: { kind, what: String((b && b.evidence && b.evidence.what) || (b && b.artifact && b.artifact.what) || EVIDENCE_WHAT[kind] || "").slice(0, 140) },
           prep, close, tip: String((b && b.tip) || "").slice(0, 160), source: "ai", at: nowTS() };
};

const briefSystem = (t, comp, who) => [
  "You are the task coach on the Elecbits Sales OS. A salesperson has just pressed Start on a task. You do two jobs, both in one reply.",
  "",
  "THE TASK",
  "Title: " + t.title,
  "Details: " + (t.details || "(none)"),
  comp ? "Company: " + comp.name + (comp.industry ? " — " + comp.industry : "") : "Company: (not linked)",
  "Owner: " + (who ? who.name : "unknown") + " · due " + (t.due || "no date") + " · today is " + todayStr(),
  "",
  "JOB 1 — decide what EVIDENCE this task leaves behind, if any.",
  "  kind 'file'  — the work creates a document: a quote, proposal, LLD, BOM, costing sheet, report, deck, invoice, PO, contract, NDA, drawing, spec.",
  "  kind 'link'  — the work HAPPENS and is recorded elsewhere: a meeting or call that took place, a demo, a client review. Ask for the minutes (MoM) saved in the company's Drive folder, OR a link — a Fireflies transcript, a Google Meet recording, a calendar invite.",
  "  kind 'none'  — nothing is produced: asking for a meeting, scheduling, chasing, a reminder, a quick confirmation.",
  "The distinction that matters: ARRANGING a meeting leaves nothing ('none'); ATTENDING one leaves minutes or a transcript ('link').",
  "Forcing someone to type a file name for a task that produced no document is the single worst thing you can do here. When unsure between file and none, choose none.",
  "",
  "JOB 2 — write the questions, about THIS task, in the salesperson's own language.",
  "prep: 2 to 4 questions asked BEFORE the work, that make them think about what they are walking into. Specific to this task and this company — never generic process questions.",
  "close: 2 to 4 questions asked AFTER, that prove the work actually happened. Ask for outcomes, names, dates, numbers, commitments.",
  "Worked example. Task: 'Ask the account owner for a meeting to discuss price.'",
  "  good prep: What is this meeting actually about? · What agenda will you take in? · What will you show or present? · What outcome do you want to walk out with?",
  "  good close: Did they agree, and on what date? · What did you tell them it was about? · What did you commit to send before it?",
  "  bad, never do this: What file did you produce? · Where is it stored?",
  "Rules: one sentence each, 14 words maximum, plain English, no numbering, no jargon. Never ask for a file name or a Drive path in your questions — the form collects those itself.",
  "",
  "Reply with ONLY this line and nothing else:",
  "BRIEF_JSON {\"kind\":\"two-word label, e.g. meeting request / quote / client meeting\",\"evidence\":{\"kind\":\"file|link|none\",\"what\":\"what to hand over, e.g. the MoM or a Fireflies transcript link\"},\"prep\":[\"...\"],\"close\":[\"...\"],\"tip\":\"one blunt sentence of advice, or empty\"}",
].filter(Boolean).join("\n");

const verdictSystem = (t, comp, brief, qa, file, path, link, driveCheck) => [
  "You are the closure gate on the Elecbits Sales OS. Judge whether this task was really done. Be strict about substance and relaxed about paperwork.",
  "",
  "TASK: " + t.title + (t.details ? " — " + t.details : ""),
  comp ? "COMPANY: " + comp.name : "COMPANY: (not linked)",
  "EVIDENCE THIS TASK SHOULD LEAVE: " + (brief.evidence.kind === "none" ? "none — it produces an outcome, not a document"
    : brief.evidence.kind === "file" ? "a document — " + (brief.evidence.what || "the file produced")
    : "the minutes or a recording — " + (brief.evidence.what || "MoM in the folder, or a transcript link")),
  "",
  "THEIR ANSWERS",
  qa.map((x, i) => "Q" + (i + 1) + ": " + x.q + "\nA" + (i + 1) + ": " + (String(x.a || "").trim() || "(blank)")).join("\n"),
  brief.evidence.kind !== "none"
    ? "WHAT THEY HANDED OVER\nFile: " + (file.trim() || "(none)") + "\nStored at: " + (path.trim() || "(none)") + "\nLink: " + (link.trim() || "(none)")
      + (driveCheck ? "\nDRIVE CHECK: " + driveCheck : "")
    : "",
  "",
  "HOW TO JUDGE",
  "PASS when the answers name real things — a person, a date, a number, a decision, a next step. A single specific line is a pass; length is not the test.",
  "FAIL when answers are blank, evasive, or could have been written without doing the work: 'done', 'ok', 'hello', 'yes', 'spoke to them', 'as discussed'.",
  "FAIL when the evidence is 'a document' and neither a file name nor a link was given.",
  "FAIL when the evidence is minutes/recording and they gave neither a MoM in the folder nor any link — a meeting that left no trace did not happen as far as this tool is concerned.",
  "When a DRIVE CHECK line says NOT FOUND, say so plainly and fail: the file they named is not in the folder they named. When it says FOUND, treat the artifact as real.",
  "NEVER fail a task for a missing document when the evidence is 'none'. Never ask for paperwork the task never needed.",
  "Do not demand more rigour than the task deserves. A five-minute phone task closes on two short lines.",
  "reasons: at most two sentences, second person, blunt. If you fail it, name the ONE thing that would fix it.",
  "",
  "Reply with ONLY: VERDICT_JSON {\"pass\":true,\"score\":7,\"reasons\":\"...\"}",
].filter(Boolean).join("\n");

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

// Entity ids are uuids now — the relational schema's primary keys.
const uid = () => crypto.randomUUID();
const pad4 = (n) => String(n).padStart(4, "0");
function localISO(d = new Date()) {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return t.toISOString().slice(0, 10);
}
const todayStr = () => localISO();
const monthKey = () => localISO().slice(0, 7);
const nowTS = () => new Date().toISOString();
/* Local wall-clock HH:MM — the time a note was written, as the writer saw it. */
const nowHM = () => new Date().toTimeString().slice(0, 5);
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
    purple: "bg-purple-50 text-purple-700",
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
// A width utility passed by the caller must actually win: the base style's
// w-full is dropped whenever the caller sets its own w-*.
const inputBase = (extra) => /(^|\s)w-/.test(extra || "") ? inputCls.replace("w-full ", "") : inputCls;
function Input(props) { return <input {...props} className={cls(inputBase(props.className), props.className)} />; }
function TA(props) { return <textarea {...props} className={cls(inputBase(props.className), "min-h-16", props.className)} />; }
function Sel(props) { return <select {...props} className={cls(inputBase(props.className), props.className)} />; }

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
  const [tasks, setTasks] = useState([]);
  const [llds, setLlds] = useState([]);
  const [questionSets, setQuestionSets] = useState({});
  const [requests, setRequests] = useState([]);
  const [rfq, setRfq] = useState([]);
  const [corePeople, setCorePeople] = useState([]);

  // Theme: default light; persisted per browser and applied to <html>.
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("sales:theme") === "dark" ? "dark" : "light"; } catch (e) { return "light"; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    try { localStorage.setItem("sales:theme", theme); } catch (e) { /* ignore */ }
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  // Auth: Supabase session drives everything. authReady guards the first
  // paint; authEmail resolves the roster row (me) once the workspace loads.
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState(null);

  const [focusCompanyId, setFocusCompanyId] = useState(null);

  useEffect(() => {
    let alive = true;
    currentAuthEmail().then((email) => {
      if (!alive) return;
      setAuthEmail(email); setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setAuthEmail(session?.user?.email?.toLowerCase() || null);
      setAuthReady(true);
    });
    return () => { alive = false; sub?.subscription?.unsubscribe(); };
  }, []);

  // Load the workspace from the relational schema once authenticated. On a
  // brand-new database the first signed-in person becomes admin (RPC), then
  // the load runs again.
  useEffect(() => {
    if (!authReady) return;
    if (!authEmail) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        let ws = await loadWorkspace();
        if (ws.users.length === 0) {
          await bootstrapFirstAdmin();
          ws = await loadWorkspace();
        }
        if (!alive) return;
        setUsers(ws.users); setCompanies(ws.companies); setDeals(ws.deals); setKpis(ws.kpis);
        setTrainings(ws.trainings); setWorklogs(ws.worklogs); setKnowledge(ws.knowledge);
        setExpenses(ws.expenses); setGates(ws.gates); setScrums(ws.scrums); setMemory(ws.memory);
        setTasks(ws.tasks || []); setLlds(ws.llds || []);
        setQuestionSets(ws.questionSets || {}); setRequests(ws.requests || []);
        setRfq(ws.rfq || []);
        setCorePeople(ws.corePeople || []);
        setMemoryText(memoryTextFrom(ws.memory || []));
      } catch (e) { console.error("loadWorkspace failed", e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [authReady, authEmail]);

  // Save wrappers: state updates immediately; the sync persists to the
  // relational schema and flags the toast on failure.
  const flag = (p) => { p.then((okd) => { if (!okd) setSaveErr(true); }); };
  const saveUsers = (v) => { setUsers(v); flag(syncUsers(v)); };
  const saveCompanies = (v) => { setCompanies(v); flag(syncCompanies(v)); };
  const saveDeals = (v) => { setDeals(v); flag(syncDeals(v)); };
  const saveKpis = (v) => { setKpis(v); flag(syncKpis(v)); };
  const saveTrainings = (v) => { setTrainings(v); flag(syncTrainings(v)); };
  const saveWorklogs = (v) => { setWorklogs(v); flag(syncWorklogs(v)); };
  const saveKnowledge = (v) => { setKnowledge(v); flag(syncKnowledge(v)); };
  const saveExpenses = (v) => { setExpenses(v); flag(syncExpenses(v)); };
  const saveGates = (v) => { setGates(v); flag(syncGates(v)); };
  const saveScrums = (v) => { setScrums(v); flag(syncScrums(v)); };
  const saveMemory = (v) => { setMemory(v); setMemoryText(memoryTextFrom(v)); flag(syncMemory(v)); };
  const saveTasks = (v) => { setTasks(v); flag(syncTasks(v)); };
  const saveLlds = (v) => { setLlds(v); flag(syncLlds(v)); };
  const saveQuestionSet = (key, title, questions) => {
    setQuestionSets({ ...questionSets, [key]: { title, questions } });
    flag(syncQuestionSet(key, title, questions));
  };

  const me = (authEmail && users.find((u) => (u.email || "").toLowerCase() === authEmail && u.active !== false)) || null;
  const data = { users, companies, deals, kpis, trainings, worklogs, knowledge, expenses, gates, scrums, memory, tasks, llds, questionSets, requests, rfq, setRfq, corePeople };
  const myHealth = useMemo(() => healthOf(me, data), [me, users, companies, deals, kpis, trainings, worklogs]);
  const fixNow = useMemo(() => (me ? fixNowItems(me, data) : []), [me, users, companies, deals, kpis, trainings, worklogs]);

  const logout = () => { signOut(); };

  // The public RFQ page: a client with a link needs no login and no app.
  const rfqToken = typeof window !== "undefined" && window.location.hash.startsWith("#rfq/")
    ? window.location.hash.slice(5).split(/[?&]/)[0] : "";
  if (rfqToken) return <RfqPublicPage token={rfqToken} />;

  if (!authReady) return <Splash />;
  if (!authEmail) return <Login />;
  if (loading) return <Splash />;
  if (!me) return <NoProfile email={authEmail} onLogout={logout} />;

  const goFix = (item) => { setTab(item.tab); if (item.type === "company") setFocusCompanyId(item.id); };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      <Sidebar me={me} tab={tab} setTab={setTab} onLogout={logout} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar me={me} health={myHealth} onAlarmClick={() => setTab("performance")} theme={theme} onToggleTheme={toggleTheme} />
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
          {tab === "companies" && <CompaniesView me={me} data={data} saveCompanies={saveCompanies} saveDeals={saveDeals} saveTasks={saveTasks} focusCompanyId={focusCompanyId} setFocusCompanyId={setFocusCompanyId} setTab={setTab} />}
          {tab === "pipeline" && <PipelineView me={me} data={data} saveDeals={saveDeals} saveCompanies={saveCompanies} saveTasks={saveTasks} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "tasks" && <MyTasksView me={me} data={data} saveTasks={saveTasks} saveScrums={saveScrums} saveDeals={saveDeals} saveCompanies={saveCompanies} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "rfqs" && <RfqsView me={me} data={data} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "chatlogs" && <WorkChatLogsView me={me} data={data} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "resources" && <ResourcesView me={me} data={data} saveUsers={saveUsers} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "performance" && <PerformanceView me={me} data={data} saveKpis={saveKpis} saveTrainings={saveTrainings} saveWorklogs={saveWorklogs} fixNow={fixNow} goFix={goFix} />}
          {tab === "expenses" && <ExpensesView me={me} data={data} saveExpenses={saveExpenses} />}
          {tab === "scrum" && <DailyScrumView me={me} data={data} saveScrums={saveScrums} saveTasks={saveTasks} />}
          {tab === "assistant" && me.role === "admin" && <AssistantView me={me} data={data} saveTasks={saveTasks} saveCompanies={saveCompanies} saveDeals={saveDeals} saveMemory={saveMemory} saveScrums={saveScrums} />}
          {tab === "memory" && me.role === "admin" && <SystemMemoryView me={me} data={data} saveMemory={saveMemory} />}
          {tab === "admin" && me.role === "admin" && <AdminView me={me} data={data} saveUsers={saveUsers} saveGates={saveGates} saveQuestionSet={saveQuestionSet} />}
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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-5">
      <Logo height={34} />
      <div className="flex items-center gap-3 text-slate-500 font-mono text-sm"><Loader2 className="animate-spin text-blue-600" size={18} /> loading sales os…</div>
    </div>
  );
}

/* Signed in, but this email has no active roster row in the Sales workspace. */
function NoProfile({ email, onLogout }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md fade text-center">
        <div className="flex items-center justify-center mb-4"><Logo height={34} /></div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <AlertTriangle size={26} className="text-amber-500 mx-auto mb-3" />
          <p className="font-semibold text-slate-900">No workspace access</p>
          <p className="text-sm text-slate-500 mt-1.5">
            You're signed in as <span className="font-mono text-slate-700">{email}</span>, but this
            email isn't on the Sales OS roster. Ask an admin to add you (Admin → Add user), then sign in again.
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
    // First sign-in with a roster email creates the account (the typed
    // password becomes theirs); after that it must match.
    const { ok, error } = await signInOrUp(email, password);
    if (!ok) { setErr(error || "Sign in failed."); setBusy(false); }
    // On success onAuthStateChange moves the app into the workspace.
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm fade">
        <div className="flex items-center justify-center mb-3">
          <Logo height={40} />
        </div>
        <p className="text-center font-mono text-xs text-slate-500 mb-8">sales os · lead → po, nothing missed</p>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">Sign in</p>
            <p className="text-xs text-slate-500 mt-0.5">Use your Elecbits work email. First sign-in sets your password.</p>
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
    { label: "Sell", items: [
      { key: "pipeline", label: "Pipeline", icon: Columns },
      { key: "companies", label: "Companies", icon: Building2 },
      { key: "rfqs", label: "RFQs", icon: FileText },
    ] },
    { label: "My day", items: [
      { key: "tasks", label: "My Tasks", icon: ListTodo },
      { key: "scrum", label: "Daily Scrum", icon: CalendarCheck2 },
      { key: "performance", label: "Performance", icon: TrendingUp },
    ] },
    { label: "Team", items: [
      { key: "resources", label: "Resources", icon: Users },
      { key: "chatlogs", label: "Work Chat Logs", icon: BookOpen },
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
          <Logo height={26} />
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Sales OS</p>
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
        {/* Glyph only — the full lockup's wordmark is unreadable at rail height */}
        <span className="flex items-center pr-2.5 mr-1 border-r border-slate-200 flex-none">
          <Logo variant="mark" height={22} />
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

function Topbar({ me, health, onAlarmClick, theme, onToggleTheme }) {
  const hc = healthColor(health);
  const alarm = health != null && health < 60;
  const themeBtn = (
    <button onClick={onToggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className={cls("flex items-center justify-center w-8 h-8 rounded-lg focus:outline-none focus-visible:ring-2",
        alarm ? "text-red-100 hover:bg-red-800 focus-visible:ring-white" : "text-slate-500 hover:bg-slate-100 focus-visible:ring-blue-500")}>
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
  return (
    <header className={cls("h-12 flex-none flex items-center justify-between px-4 md:px-6 border-b transition-colors",
      alarm ? "bg-red-700 border-red-800" : "bg-white border-slate-200")}>
      <div className={cls("text-sm font-medium", alarm ? "text-red-100" : "text-slate-500")}>
        {alarm ? "Performance alarm active" : "Workspace: Sales"}
      </div>
      <div className="flex items-center gap-2">
        {themeBtn}
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
      </div>
    </header>
  );
}

/* ============================================================
   COMPANIES
   ============================================================ */

function CompaniesView({ me, data, saveCompanies, saveDeals, saveTasks, focusCompanyId, setFocusCompanyId, setTab }) {
  const { users, companies, deals } = data;
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // company object or "new"
  const openId = focusCompanyId;
  const open = companies.find((c) => c.id === openId) || null;

  const [ownerF, setOwnerF] = useState("all");
  const [indF, setIndF] = useState("all");
  const [compF, setCompF] = useState("all");   // completeness band
  const [dealF, setDealF] = useState("all");   // open-deals presence
  const [sort, setSort] = useState("attention");
  const industries = [...new Set(companies.map((c) => c.industry).filter(Boolean))].sort();
  const peopleOn = (c) => {
    const ids = new Set();
    if (c.accountOwner) ids.add(c.accountOwner);
    deals.forEach((d) => { if (d.companyId === c.id && !d.lost && d.ownerId) ids.add(d.ownerId); });
    (data.tasks || []).forEach((t) => { if (t.companyId === c.id && t.status !== "done" && t.assignee) ids.add(t.assignee); });
    return [...ids].map((id) => users.find((u) => u.id === id)).filter(Boolean);
  };
  const visible = companies.filter((c) => {
    const s = (c.name + " " + c.cid + " " + (c.city || "") + " " + (c.contactPerson || "")).toLowerCase();
    if (!s.includes(q.toLowerCase())) return false;
    if (ownerF !== "all" && c.accountOwner !== ownerF) return false;
    if (indF !== "all" && c.industry !== indF) return false;
    const pct = completeness(c);
    if (compF === "red" && pct >= 70) return false;
    if (compF === "amber" && (pct < 70 || pct >= 90)) return false;
    if (compF === "green" && pct < 90) return false;
    const open = deals.some((d) => d.companyId === c.id && !d.lost && d.stage !== "po");
    if (dealF === "with" && !open) return false;
    if (dealF === "without" && open) return false;
    return true;
  }).sort((a, b) =>
    sort === "attention" ? completeness(a) - completeness(b)
    : sort === "potential" ? Number(b.potential || 0) - Number(a.potential || 0)
    : sort === "name" ? a.name.localeCompare(b.name)
    : String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  const upsert = (c) => {
    const exists = companies.some((x) => x.id === c.id);
    const isNew = !exists;
    const { _dealValue, ...clean } = c;
    const next = exists ? companies.map((x) => (x.id === c.id ? clean : x)) : [clean, ...companies];
    saveCompanies(next);
    setEditing(null);
    setFocusCompanyId(c.id);
    if (!isNew) return;
    // Onboarding in one go: mint the official client ID (when a size was
    // picked and the industry maps), and put the first deal on the board.
    (async () => {
      let latest = { ...clean };
      const note = (text) => { latest = { ...latest, activity: [...(latest.activity || []), { at: nowTS(), by: me.id, text }] }; };
      const ind = industryCodeOf(clean.industry);
      if (clean.orgSize && ind) {
        const cid = await mintClientId(clean.id, Number(ind), clean.orgSize);
        if (cid) { latest = { ...latest, cid, official: true }; note("Official client ID minted: " + cid); }
      }
      // The company's Drive folder, created up front so filing never waits.
      try {
        const r = await fetch("/api/drive?action=open&name=" + encodeURIComponent(driveFolderName(latest))).then((x) => x.json());
        if (r && r.id) note("Drive folder created: " + driveFolderName(latest));
      } catch (e) { /* Drive not configured — the folder can come later */ }
      saveCompanies(next.map((x) => (x.id === clean.id ? latest : x)));
      const val = Number(_dealValue || clean.potential || 0);
      const d = {
        id: uid(), did: nextSeq(deals, "did", "EB-D-"), companyId: clean.id, ownerId: clean.accountOwner || me.id,
        value: val, stage: "lead", createdAt: nowTS(), updatedAt: nowTS(), lost: false,
        temperature: "cold", tempHistory: [], plan: [], planLog: [],
        history: [{ from: null, to: "lead", at: nowTS(), by: me.id, summary: "Deal created with the company." }],
      };
      saveDeals([d, ...deals]);
    })();
  };

  if (open) {
    return <CompanyDetail me={me} company={open} data={data} saveCompanies={saveCompanies} saveDeals={saveDeals} saveTasks={saveTasks}
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

      <div className="bg-white border border-slate-200 rounded-xl p-3.5 mb-4 flex flex-wrap items-end gap-3">
        {[
          ["Owner", ownerF, setOwnerF, [["all", "All owners"], ...users.filter((u) => u.active !== false).map((u) => [u.id, u.name])], "w-40"],
          ["Industry", indF, setIndF, [["all", "All industries"], ...industries.map((i) => [i, i])], "w-44"],
          ["Data quality", compF, setCompF, [["all", "Any"], ["red", "Red — below 70%"], ["amber", "Amber — 70–89%"], ["green", "Green — 90%+"]], "w-40"],
          ["Open deals", dealF, setDealF, [["all", "Any"], ["with", "With open deals"], ["without", "No open deals"]], "w-40"],
        ].map(([label, val, set, opts, w]) => (
          <div key={label}>
            <p className="text-[11px] font-medium text-slate-400 mb-1">{label}</p>
            <Sel className={w} value={val} onChange={(e) => set(e.target.value)}>
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Sel>
          </div>
        ))}
        <div className="ml-auto">
          <p className="text-[11px] font-medium text-slate-400 mb-1">Sort</p>
          <Sel className="w-44" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="attention">Needs attention</option>
            <option value="potential">Potential ₹</option>
            <option value="name">Name</option>
            <option value="recent">Newest</option>
          </Sel>
        </div>
        <span className="text-xs text-slate-500 pb-2"><b className="text-slate-800 font-mono tabular-nums">{visible.length}</b> compan{visible.length === 1 ? "y" : "ies"}</span>
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
                  <span className="flex items-center text-xs text-slate-500">
                    <span className="flex -space-x-1.5 mr-2">
                      {peopleOn(c).slice(0, 4).map((u) => <span key={u.id} title={u.name + (u.id === c.accountOwner ? " · owner" : "")} className="ring-2 ring-white rounded-full"><Avatar name={u.name} size="sm" /></span>)}
                    </span>
                    {owner ? owner.name : "Unassigned"}{peopleOn(c).length > 1 && <span className="text-slate-400 ml-1">+{peopleOn(c).length - 1}</span>}
                  </span>
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
    orgSize: "", _dealValue: "",   // onboarding: mint + first deal happen on save
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
            {!users.some((u) => u.id === f.accountOwner) && <option value={f.accountOwner || ""}>— pick the owner —</option>}
            {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Sel>
        </Field>
      </div>
      {!company && (
        <div className="mt-4 border border-blue-200 bg-blue-50/40 rounded-lg p-3">
          <Lbl>On save — the client ID and the first deal, in one go</Lbl>
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            <Field label="Company size (for the official client ID)">
              <Sel value={f.orgSize || ""} onChange={(e) => set("orgSize", e.target.value)}>
                <option value="">— skip minting for now —</option>
                {ORG_SIZES.map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}
              </Sel>
            </Field>
            <Field label="First deal value (₹)" hint="A deal is created on the board in Cold. Leave blank to use annual potential.">
              <Input type="number" value={f._dealValue || ""} onChange={(e) => set("_dealValue", e.target.value.replace(/[^\d]/g, ""))} />
            </Field>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">Pick a size and the official <span className="font-mono">Eb-&lt;industry&gt;-&lt;size&gt;-&lt;serial&gt;</span> ID is minted from the shared serial the moment you save. The deal lands on the pipeline immediately.</p>
        </div>
      )}
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

function CompanyDetail({ me, company: c, data, saveCompanies, saveDeals, saveTasks, onBack, onEdit, editing, setEditing, upsert, setTab }) {
  const { users, deals, companies, tasks, requests } = data;
  const comp = completeness(c);
  const cc = comp >= 90 ? "green" : comp >= 70 ? "amber" : "red";
  const owner = users.find((u) => u.id === c.accountOwner);
  const myDeals = deals.filter((d) => d.companyId === c.id);
  const myTasks = (tasks || []).filter((t) => t.companyId === c.id && t.status !== "done");
  const myRequests = (requests || []).filter((r) => r.companyId === c.id);
  const [note, setNote] = useState("");
  const [newDeal, setNewDeal] = useState(false);
  const [minting, setMinting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rfqing, setRfqing] = useState(false);
  const [, bump] = useState(0);
  const delCompany = async () => {
    const typed = window.prompt("This deletes " + c.name + " and its deals, tasks, RFQ links and history from the Sales OS. Type the company name to confirm:");
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== c.name.trim().toLowerCase()) { window.alert("Name didn't match — nothing deleted."); return; }
    const res = await deleteCompany(c.id);
    if (res === "failed") { window.alert("Could not delete — check the connection and try again."); return; }
    // Local state: the company and its sales footprint disappear everywhere.
    saveDeals(data.deals.filter((d) => d.companyId !== c.id));
    saveTasks(data.tasks.filter((t) => t.companyId !== c.id));
    if (data.setRfq) data.setRfq((data.rfq || []).filter((l) => l.companyId !== c.id));
    saveCompanies(data.companies.filter((x) => x.id !== c.id));
    onBack();
  };
  const [ctab, setCtab] = useState("overview");

  const onRequestSubmitted = (reqId, title) => {
    setApplying(false);
    const next = companies.map((x) => x.id === c.id ? { ...x, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text: "Project-ID application submitted to ULM: " + title }] } : x);
    saveCompanies(next);
  };

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
            <p className="font-mono text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              {c.cid || "no ID yet"}
              {c.official
                ? <Chip color="green"><BadgeCheck size={11} /> official</Chip>
                : <button onClick={() => setMinting(true)} className="text-blue-600 hover:underline text-xs font-sans">mint official client ID →</button>}
              <span>· created {fmtDate(c.createdAt)}</span>
            </p>
          </div>
          <div className="text-right">
            <p className={cls("font-mono text-2xl tabular-nums", cc === "red" ? "text-red-600" : cc === "amber" ? "text-amber-600" : "text-green-600")}>{comp}%</p>
            <p className="text-xs text-slate-400">data complete</p>
          </div>
          {(me.role === "admin" || c.accountOwner === me.id) && (
            <button title="Delete this company" onClick={delCompany}
              className="text-slate-300 hover:text-red-600 p-1.5"><Trash2 size={15} /></button>
          )}
          <Btn onClick={() => setRfqing(true)}><Send size={14} /> RFQ link</Btn>
          <Btn onClick={onEdit}><Pencil size={14} /> Edit</Btn>
        </div>
        {myRequests.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {myRequests.map((r) => (
              <div key={r.id} className={cls("rounded-md border px-3 py-2 text-sm flex items-center gap-2 flex-wrap",
                r.status === "accepted" ? "bg-green-50 border-green-200 text-green-800" : r.status === "rejected" ? "bg-red-50 border-red-200 text-red-800" : "bg-blue-50 border-blue-200 text-blue-800")}>
                <Rocket size={14} className="flex-none" />
                <span className="font-medium mr-auto">{r.title}</span>
                <Chip color={r.status === "accepted" ? "green" : r.status === "rejected" ? "red" : "blue"}>{r.status === "submitted" ? "awaiting ULM sanction" : r.status}</Chip>
                                {r.decisionNote && <span className="text-xs w-full">{r.decisionNote}</span>}
              </div>
            ))}
          </div>
        )}
        {comp < 100 && (
          <div className={cls("mt-4 rounded-md border px-3 py-2 text-sm flex items-start gap-2", cc === "red" ? "bg-red-50 border-red-200 text-red-800" : "bg-amber-50 border-amber-200 text-amber-800")}>
            <AlertTriangle size={15} className="mt-0.5 flex-none" />
            <span><span className="font-semibold">Missing:</span> {missingFields(c).join(", ")}. No excuses — fill these before the next stage move.</span>
          </div>
        )}
      </div>

      {/* the workspace tabs — the PMS project-section, for a company */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 mt-4 flex items-center gap-1 overflow-x-auto">
        {[["overview", "Overview", TrendingUp], ["research", "Research", Search], ["deals", "Deals", Columns], ["rfq", "RFQ", Send], ["comms", "Client Comms", Phone], ["ask", "Ask the AI", Bot]].map(([k, l, Ic]) => (
          <button key={k} onClick={() => setCtab(k)}
            className={cls("flex items-center gap-1.5 px-3.5 py-3 text-sm border-b-2 -mb-px whitespace-nowrap", ctab === k ? "border-blue-600 text-blue-700 font-semibold" : "border-transparent text-slate-500 font-medium hover:text-slate-700")}>
            <Ic size={15} /> {l}
            {k === "todos" && myTasks.length > 0 && <span className="font-mono text-[10px] bg-blue-50 text-blue-700 rounded-full px-1.5">{myTasks.length}</span>}
          </button>
        ))}
      </div>

      {ctab === "overview" && (<>
      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
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
            <div className="mt-0.5 flex items-center gap-1.5">
              {owner && <Avatar name={owner.name} size="sm" />}
              {/* live-assignable: a company whose owner left the roster showed
                 "—" with no way to fix it from here */}
              <Sel className="w-44 text-sm py-1" value={owner ? owner.id : ""}
                onChange={(e) => e.target.value && saveCompanies(companies.map((x) => (x.id === c.id
                  ? { ...x, accountOwner: e.target.value, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text: "Account owner set to " + ((users.find((u) => u.id === e.target.value) || {}).name || "?") + "." }] } : x)))}>
                {!owner && <option value="">— unassigned, pick —</option>}
                {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Sel>
            </div>
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
                  <p className="text-xs text-slate-400 mt-0.5">{by ? by.name : "?"} · {fmtDate(a.at)}{fmtTime(a.at) ? " · " + fmtTime(a.at) : ""}</p>
                </div>
              );
            })}
            {(c.activity || []).length === 0 && <p className="text-sm text-slate-400">Nothing logged yet.</p>}
          </div>
        </div>
      </div>

      {/* ── RFQ links: requirement gathering, straight from the client ── */}
      {(data.rfq || []).some((l) => l.companyId === c.id) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <SectionTitle right={<Chip color="purple"><Send size={11} /> the client fills it, you read it</Chip>}>RFQ input status</SectionTitle>
          <div className="space-y-1.5">
            {(data.rfq || []).filter((l) => l.companyId === c.id).map((l) => <RfqLinkRow key={l.id} l={l} />)}
          </div>
        </div>
      )}

      {/* ── sanctioning: this company's requests to ULM, with live status ── */}
      {(data.requests || []).some((r) => r.companyId === c.id) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <SectionTitle right={<Chip color="blue"><Rocket size={11} /> sales.requests → core.intake → ULM</Chip>}>Sanctioning</SectionTitle>
          <div className="space-y-1.5">
            {(data.requests || []).filter((r) => r.companyId === c.id)
              .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
              .map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-sm border border-slate-200 rounded-md px-3 py-2">
                  <Chip color={r.status === "accepted" ? "green" : r.status === "rejected" ? "red" : r.status === "submitted" ? "blue" : "slate"}>
                    {r.status === "submitted" ? "with ULM" : r.status}
                  </Chip>
                  <div className="min-w-0 mr-auto">
                    <p className="text-slate-800">{r.title}</p>
                    {((r.requirement || {}).unknowns || []).length > 0 && r.status === "submitted" &&
                      <p className="text-[11px] text-amber-700 mt-0.5">{r.requirement.unknowns.length} open question{r.requirement.unknowns.length === 1 ? "" : "s"} for the client travelled with it</p>}
                    {r.decisionNote && <p className="text-xs text-slate-500 mt-0.5">ULM: {r.decisionNote}</p>}
                  </div>
                  {r.projectId && <Chip color="green">project allocated</Chip>}
                  {["submitted", "accepted"].includes(r.status) && (
                    me.role === "admin"
                      ? <Sel className="w-36 text-xs" value={r.overtake || "pending"}
                          onChange={(e) => { const v = e.target.value; setRequestOvertake(r.id, v); r.overtake = v; bump((x) => x + 1); }}>
                          <option value="pending">overtake: pending</option>
                          <option value="full">full overtake</option>
                          <option value="semi">semi overtake</option>
                        </Sel>
                      : <Chip color={r.overtake === "full" ? "purple" : r.overtake === "semi" ? "blue" : "slate"}>
                          {r.overtake === "full" ? "full overtake" : r.overtake === "semi" ? "semi overtake" : "overtake: pending"}
                        </Chip>
                  )}
                  <span className="text-[11px] font-mono text-slate-400 flex-none">{fmtDate(r.submittedAt)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      </>)}

      {ctab === "comms" && <CommsTab me={me} company={c} data={data} saveTasks={saveTasks} saveCompanies={saveCompanies} />}

      {ctab === "research" && (
        <div className="mt-4 space-y-4">
          <ResearchCard me={me} company={c} data={data} saveCompanies={saveCompanies} />
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <DriveIntel me={me} company={c} data={data} saveCompanies={saveCompanies} />
            <DriveCard company={c} />
          </div>
        </div>
      )}

      {ctab === "deals" && <CompanyDealsTab me={me} company={c} data={data} saveDeals={saveDeals} saveTasks={saveTasks} />}

      {/* RFQ — shared or not; opened or not; filled how much; the answers */}
      {ctab === "rfq" && (() => {
        const links = (data.rfq || []).filter((l) => l.companyId === c.id)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return (
          <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
            <SectionTitle right={<Btn size="sm" kind="primary" onClick={() => setRfqing(true)}><Send size={12} /> New RFQ link</Btn>}>
              RFQ forms shared with {c.name}
            </SectionTitle>
            {links.length === 0 && (
              <Empty icon={Send} title="No RFQ form shared yet" sub="Create the link and send it — the client fills a two-minute chat form, and every answer shows up here as they type." action={<Btn kind="primary" onClick={() => setRfqing(true)}><Send size={14} /> Create the link</Btn>} />
            )}
            <div className="space-y-3">
              {links.map((l) => {
                const p = l.response || {};
                const total = Number(p._total) || 9;
                const answered = l.status === "submitted" ? total : Math.min(Number(p._answered) || 0, total);
                const pct = Math.round((answered / total) * 100);
                const stageN = l.status === "submitted" ? 3 : answered > 0 ? 2 : l.status === "opened" ? 1 : 0;
                const who = data.users.find((u) => u.id === l.createdBy);
                return (
                  <div key={l.id} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="font-medium text-sm text-slate-900 mr-auto">
                        {l.contactName ? "Sent to " + l.contactName : (l.title || "RFQ form")}
                        <span className="font-mono text-[11px] text-slate-400 ml-2">{fmtDate(l.createdAt)}{who ? " · by " + who.name : ""}</span>
                      </p>
                      <Chip color={l.status === "submitted" ? "green" : stageN === 2 ? "amber" : l.status === "opened" ? "purple" : "blue"}>
                        {l.status === "submitted" ? "SUBMITTED" : stageN === 2 ? "FILLING · " + pct + "%" : l.status === "opened" ? "OPENED" : "SENT"}
                      </Chip>
                      {l.status !== "submitted" && (
                        <button onClick={() => navigator.clipboard?.writeText(rfqUrl(l.id))} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Copy size={11} /> copy link</button>
                      )}
                    </div>
                    {/* the journey: sent → opened → filling → submitted */}
                    <div className="flex items-center gap-1.5 mt-3">
                      {["Sent", "Opened", "Filling", "Submitted"].map((s, i) => (
                        <React.Fragment key={s}>
                          <span className={cls("text-[10.5px] font-semibold uppercase tracking-wide", i <= stageN ? "text-blue-700" : "text-slate-300")}>{s}</span>
                          {i < 3 && <span className={cls("h-px flex-1", i < stageN ? "bg-blue-400" : "bg-slate-200")} />}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="flex items-center gap-2.5 mt-2.5">
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className={cls("h-full", l.status === "submitted" ? "bg-green-500" : "bg-blue-500")} style={{ width: pct + "%" }} />
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 tabular-nums">{answered}/{total} answered</span>
                    </div>
                    {answered > 0 && (
                      <div className="mt-3 border-t border-slate-100 pt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                        {[["name", "Name"], ["need", "Requirement"], ["services", "Services"], ["qty", "Quantity"], ["timeline", "Timeline"], ["budget", "Budget"], ["docs", "Can share"], ["email", "Email"], ["phone", "Phone"], ["notes", "Notes"]].map(([k, label]) => {
                          const v = Array.isArray(p[k]) ? p[k].join(", ") : p[k];
                          if (!v) return null;
                          return (
                            <div key={k} className={k === "need" || k === "notes" ? "sm:col-span-2" : ""}>
                              <p className="text-[10.5px] text-slate-400 uppercase tracking-wide">{label}</p>
                              <p className="text-[13px] text-slate-800 leading-snug">{String(v)}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Only two ways in: this tab needs a sales sign-in, and the client's unique link is their key — the form works for nobody else, and the anon database key has no access to it at all.</p>
          </div>
        );
      })()}

      {ctab === "ask" && <div className="mt-4"><CompanyAssistant me={me} company={c} data={data} saveCompanies={saveCompanies} saveTasks={saveTasks} /><WorkLogCard company={c} users={users} /></div>}

      {editing && <CompanyModal me={me} data={data} company={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={upsert} />}
      {newDeal && <NewDealModal me={me} data={data} fixedCompany={c} onClose={() => setNewDeal(false)} onCreate={createDeal} />}
      {minting && <MintIdModal company={c} data={data} onClose={() => setMinting(false)} saveCompanies={saveCompanies} me={me} />}
      {applying && <ProjectIdModal me={me} data={data} company={c} deal={myDeals.find((d) => !d.lost)} onClose={() => setApplying(false)} onSubmitted={onRequestSubmitted} />}
      {rfqing && <RfqLinkModal me={me} data={data} company={c} deal={myDeals.find((d) => !d.lost)} onClose={() => setRfqing(false)} saveDeals={saveDeals} />}
    </div>
  );
}

/* Mint the official Eb-<industry>-<size>-<serial> from the shared company mint. */
function MintIdModal({ company: c, data, onClose, saveCompanies, me }) {
  const { companies } = data;
  const guess = industryCodeOf(c.industry);
  const [ind, setInd] = useState(guess || 21);
  const [size, setSize] = useState(c.orgSize || "ML");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mint = async () => {
    setBusy(true); setErr("");
    const cid = await mintClientId(c.id, Number(ind), size);
    setBusy(false);
    if (!cid) { setErr("Minting failed — check connection (the serial mint lives in core.numbering)."); return; }
    saveCompanies(companies.map((x) => x.id === c.id
      ? { ...x, cid, official: true, orgSize: size, legacyCid: x.official ? x.legacyCid : x.cid, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text: "Official client ID minted: " + cid }] }
      : x));
    onClose();
  };
  return (
    <Modal title="Mint official client ID" onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={busy} onClick={mint}>{busy ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />} Mint Eb-{String(ind).padStart(2, "0")}-{size}-…</Btn></>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">One serial, company-wide, from the shared mint — the same series the client ID sheet uses. This cannot be undone or retyped; the old working ID ({c.cid || "none"}) stays on record as the legacy ID.</p>
        <Field label="Industry / application" req>
          <Sel value={ind} onChange={(e) => setInd(e.target.value)}>
            {INDUSTRIES.map(([n, l]) => <option key={n} value={n}>{String(n).padStart(2, "0")} — {l}</option>)}
          </Sel>
        </Field>
        <Field label="Org size" req>
          <Sel value={size} onChange={(e) => setSize(e.target.value)}>
            {ORG_SIZES.map(([k, l]) => <option key={k} value={k}>{k} — {l}</option>)}
          </Sel>
        </Field>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </Modal>
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

/* ============================================================
   THE PIPELINE BRAIN — judged temperature, the commitment alarm,
   and each deal's own stage plan. (23-pipeline-brain.sql)
   ============================================================ */

/* Temperature is decided against written criteria, never on vibes. */
const TEMP_CRITERIA = [
  "cold — no client response yet, or polite replies with no intent; we are chasing.",
  "warm — the client is responding with intent: asked questions, shared requirements or specs, agreed to a meeting, named people or dates.",
  "rfq  — the requirement is being gathered formally: an RFQ link was sent or the client is filling in / has submitted their requirement.",
  "hot  — the client is driving: asking for commercials, timelines or next steps; negotiating; internal approvals in motion; a PO is being discussed.",
].join("\n");

const PHASES = [
  ["cold", "Cold", "No real client response yet — we are reaching out."],
  ["warm", "Warm", "The client is responding with intent: questions, meetings, requirements."],
  ["rfq", "RFQ", "Requirement being gathered — link sent / input received. ULM decides the overtake here."],
  ["hot", "Hot", "The client is driving to commercials: pricing, timelines, negotiation."],
  ["won", "Closed Won", "PO in hand. The project moves to delivery."],
  ["lost", "Closed Lost", "Decided against us — post-mortem on record."],
];
const tempColor = (t) => (t === "hot" ? "red" : t === "rfq" ? "purple" : t === "warm" ? "amber" : "blue");

/* The commitment alarm: RED is "your own committed date passed", never a
   generic clock. No commitment on record is its own (amber) state. */
function nextStepState(d) {
  if (d.lost || d.stage === "po") return { key: "closed" };
  if (!d.nextStep || d.nextStepDoneAt) return { key: "none" };
  if (d.nextStepDue && new Date(d.nextStepDue).getTime() < Date.now()) return { key: "overdue" };
  return { key: "committed" };
}

const tempSystem = (deal, comp, evidence) => [
  "You judge the TEMPERATURE of a sales deal at Elecbits (electronics ODM/EMS). Temperature measures the CLIENT's live intent — not our effort, not how nice the notes sound.",
  "THE CRITERIA:\n" + TEMP_CRITERIA,
  "DEAL: " + (deal.did || "") + " · " + (comp ? comp.name : "unlinked") + " · stage " + stageName(deal.stage) + " · value ₹" + (deal.value || 0),
  "CURRENT READING: " + (deal.temperature || "cold") + (deal.temperatureWhy ? " (" + deal.temperatureWhy + ")" : ""),
  "THE EVIDENCE (recent touches, tasks, commitments — newest first):\n" + (evidence || "(nothing on record)"),
  "Judge ONLY from the evidence. No evidence of client response = cold, however busy our side looks. If the evidence is too thin to move the reading, keep it and say why.",
  "Reply with ONLY: TEMP_JSON {\"temperature\":\"cold|warm|rfq|hot\",\"why\":\"one sentence naming the evidence that decides it\",\"changed\":true}",
].join("\n");

const planSystem = (deal, comp, req, evidence) => [
  "You lay out the plan for one sales deal at Elecbits as EXACTLY THREE CLEAR STAGES — the three outcomes between where this deal is now and a PO. Every deal is different; name the stages for THIS deal.",
  "Under each stage, decide the ACTIVITIES yourself — 3 to 5 concrete actions that get that stage done ('Send the RFQ link to Rahul', 'Price the pilot BOM'), phrased so a person can do them. These are what the Scrum Master will question the salesperson on.",
  "DEAL: " + (deal.did || "") + " · " + (comp ? comp.name : "") + " · phase " + (deal.temperature || "cold") + " · value ₹" + (deal.value || 0),
  req ? "THE REQUIREMENT:\n" + req : "",
  "WHAT HAS HAPPENED SO FAR:\n" + (evidence || "(nothing on record)"),
  "The first stage reflects where the deal ACTUALLY is (work already done is not re-planned). Dates only when the evidence names one.",
  "Reply with ONLY: PLAN_STAGES_JSON {\"summary\":\"one line on the route to the PO\",\"stages\":[{\"name\":\"...\",\"status\":\"done|active|pending\",\"end\":\"YYYY-MM-DD or empty\",\"activities\":[\"...\"]}]} — exactly 3 stages.",
].join("\n");

const reqSystem = (comp) => [
  "You are the requirement analyst on the Elecbits Sales OS. A salesperson pastes everything they have about a client request — emails, call notes, a transcript. Your job: structure the REQUIREMENT so it can be sanctioned, and name what is still unknown.",
  "CLIENT: " + comp.name + (comp.whatTheyDo ? " — " + comp.whatTheyDo : "") + (comp.industry ? " · " + comp.industry : ""),
  "Be exact about quantities, specs, standards and dates that appear in the text. NEVER invent a spec, a quantity or a date that is not there — missing facts go in `unknowns`, phrased as the exact question to ask the client.",
  "kind: odm = we design and build; boxbuild = assemble/integrate to their design; product = our existing product line. Pick from the work described.",
  "Reply with ONLY: REQ_JSON {\"what\":\"two or three sentences: what the client actually needs\",\"kind\":\"odm|boxbuild|product\",\"services\":[\"the concrete services involved, e.g. PCB design, firmware, enclosure, certification, assembly\"],\"specs\":[\"each hard requirement stated in the text\"],\"qty\":\"number or empty\",\"timeline\":\"what they said about when, or empty\",\"budget\":\"what they said about money, or empty\",\"unknowns\":[\"the questions still to ask the client\"],\"title\":\"short request title\"}",
].join("\n");

/* Everything recent and factual about a deal, for the AI to judge from. */
function dealEvidence(deal, comp, tasks, touches, commits) {
  const lines = [];
  for (const t of (touches || []).slice(0, 10)) {
    const w = t.ai || {};
    lines.push(fmtDate(t.at) + " " + t.kind + " (" + (t.direction === "in" ? "they came to us" : "we reached out") + "): "
      + (t.subject || "") + (w.temperature ? " · write-up read " + w.temperature : "")
      + ((w.clientSaid || []).length ? " · client said: " + w.clientSaid.slice(0, 2).join("; ") : ""));
  }
  for (const cm of (commits || []).filter((x) => x.status === "open").slice(0, 6))
    lines.push("open promise (" + cm.side + "): " + cm.what + (cm.due ? " by " + fmtDate(cm.due) : ""));
  const open = (tasks || []).filter((t) => t.companyId === (comp && comp.id) && t.status !== "done");
  if (open.length) lines.push("open tasks: " + open.slice(0, 5).map((t) => t.title).join(" · "));
  const hist = (deal.history || []).slice(-3);
  for (const h of hist) lines.push("stage " + (h.from ? stageName(h.from) + "→" : "") + stageName(h.to) + " " + fmtDate(h.at) + (h.summary ? ": " + String(h.summary).slice(0, 120) : ""));
  return lines.join("\n");
}

/* Days spent in each temperature, from the append-only history. */
function tempVelocity(d) {
  const moves = (d.tempHistory || []).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  const out = { cold: 0, warm: 0, rfq: 0, hot: 0 };
  let cur = "cold", curAt = new Date(d.createdAt || Date.now()).getTime();
  for (const m of moves) {
    const t = new Date(m.at).getTime();
    if (out[cur] !== undefined) out[cur] += Math.max(0, t - curAt);
    cur = m.to; curAt = t;
  }
  const end = d.lost || d.stage === "po" ? new Date(d.updatedAt || Date.now()).getTime() : Date.now();
  if (out[cur] !== undefined) out[cur] += Math.max(0, end - curAt);
  const days = (ms) => Math.round(ms / 86400000);
  return { cold: days(out.cold), warm: days(out.warm), rfq: days(out.rfq), hot: days(out.hot) };
}

/* The freshest RFQ link on a deal (or its company), as a card badge. */
function rfqBadgeFor(d, rfq) {
  const l = (rfq || []).filter((x) => x.dealId === d.id || (!x.dealId && x.companyId === d.companyId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (!l) return null;
  const answered = Number((l.response || {})._answered) || 0;
  const total = Number((l.response || {})._total) || 9;
  return l.status === "submitted" ? { label: "RFQ input received", color: "green", link: l }
    : answered > 0 ? { label: "RFQ filling · " + Math.round((answered / total) * 100) + "%", color: "amber", link: l }
    : l.status === "opened" ? { label: "RFQ opened, awaiting input", color: "purple", link: l }
    : l.status === "created" ? { label: "RFQ link sent", color: "purple", link: l } : null;
}

/* Closed Won: the PO is the proof — capture its reference and the deal
   settles into the won column, stamped on the record. */
function WonModal({ me, deal: d, deals, saveDeals, companies, saveCompanies, onClose }) {
  const [note, setNote] = useState("");
  const apply = () => {
    setTemperature(d.id, { from: d.temperature || "cold", to: "won", why: note.trim(), decided: "human", by: me.id });
    saveDeals(deals.map((x) => (x.id === d.id
      ? { ...x, stage: "po", updatedAt: nowTS(),
          history: [...(x.history || []), { from: x.stage, to: "po", at: nowTS(), by: me.id, summary: "CLOSED WON. " + note.trim() }],
          tempHistory: [...(x.tempHistory || []), { from: d.temperature || "cold", to: "won", why: note.trim(), decided: "human", at: nowTS() }] }
      : x)));
    const c = companies.find((x) => x.id === d.companyId);
    if (c) saveCompanies(companies.map((x) => (x.id === c.id ? { ...x, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text: "Deal " + d.did + " CLOSED WON. " + note.trim() }] } : x)));
    onClose();
  };
  return (
    <Modal title={"Closed Won — " + d.did} onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="success" disabled={note.trim().length < 5} onClick={apply}><Check size={14} /> It's won</Btn>
      </>}>
      <Field label="The PO — reference, value, what was agreed" req hint="This line is the deal's closing record.">
        <TA value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" placeholder="e.g. PO #4471 received, ₹18.5L, 500 units, delivery from Oct" />
      </Field>
    </Modal>
  );
}

/* ── RESEARCH — what we know about this client, written once, kept ─────── */
const researchSystem = (c) => [
  "You write the RESEARCH DOSSIER on a client of Elecbits (Indian electronics ODM/EMS). Work from the record, the conversation history, anything you find in Drive, and general knowledge of the industry — and say plainly what is assumption versus fact.",
  "CLIENT: " + c.name + (c.industry ? " · " + c.industry : "") + (c.city ? " · " + c.city : "") + (c.whatTheyDo ? " — " + c.whatTheyDo : "") + (c.website ? " · " + c.website : ""),
  "Reply with ONLY: RESEARCH_JSON {\"about\":\"3-4 sentences on who they are and how they make money\",\"products\":[\"what they make or sell\"],\"signals\":[\"buying signals and needs visible in the record\"],\"competitors\":[\"who else likely serves them, or empty\"],\"opportunities\":[\"what Elecbits can realistically sell them, sharpest first\"],\"questions\":[\"what we still need to find out\"]}",
].join("\n");

function ResearchCard({ me, company: c, data, saveCompanies }) {
  const { companies } = data;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const r = (c.plan && c.plan.research) || null;
  const generate = async () => {
    setBusy(true); setErr("");
    try {
      let touches = [];
      try { touches = await loadTouches(c.id); } catch (e) {}
      const convo = [{ role: "user", content: "THE RECORD:\n" + JSON.stringify({ contact: c.contactPerson, designation: c.designation, source: c.source, potential: c.potential, custom: c.custom }).slice(0, 2000)
        + "\n\nRECENT CONVERSATIONS:\n" + touches.slice(0, 8).map((t) => fmtDate(t.at) + " " + t.kind + ": " + (t.subject || "") + " — " + ((t.ai || {}).summary || t.body || "").slice(0, 200)).join("\n")
        + "\n\nWrite the dossier. Check the company's Drive folder if useful." }];
      const { reply } = await askWithDrive(researchSystem(c), convo);
      const v = extractMarkedJSON(reply, "RESEARCH_JSON");
      if (!v || !v.about) throw new Error("unparseable");
      const research = { ...v, at: nowTS(), by: me.id };
      saveCompanies(companies.map((x) => (x.id === c.id ? { ...x, plan: { ...(x.plan || {}), research } } : x)));
    } catch (e) { setErr("Research failed — try again."); }
    setBusy(false);
  };
  const Sec = ({ label, items }) => (items || []).length ? (
    <div><Lbl>{label}</Lbl>{items.map((x, i) => <p key={i} className="text-sm text-slate-700 py-0.5">• {x}</p>)}</div>
  ) : null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <SectionTitle right={<Btn size="sm" kind={r ? "default" : "primary"} disabled={busy} onClick={generate}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {r ? "Refresh" : "Research this client"}</Btn>}>
        Research
      </SectionTitle>
      {!r && !busy && <p className="text-sm text-slate-400">Nothing yet. The AI reads the record, the conversations and the Drive folder, and writes the dossier — who they are, what to sell them, what to find out.</p>}
      {r && (
        <div className="space-y-3">
          <p className="text-sm text-slate-800">{r.about}</p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            <Sec label="What they make" items={r.products} />
            <Sec label="Buying signals" items={r.signals} />
            <Sec label="Competition" items={r.competitors} />
            <Sec label="What Elecbits can sell them" items={r.opportunities} />
          </div>
          <Sec label="Still to find out" items={r.questions} />
          <p className="text-[11px] text-slate-400">researched {fmtDate(r.at)} · treat unverified lines as assumptions</p>
        </div>
      )}
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
    </div>
  );
}

/* ── DEALS TAB — what exactly is happening with this client, deal by deal ── */
/* ONE rule for EVERY task generator — copilot, Scrum Master, stage kickoff,
   step button, assistant: never file a near-duplicate of a task already open
   on the same company. Generation behaves the same everywhere. */
const normTitle = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function openTaskDupe(tasks, companyId, title) {
  const want = normTitle(title);
  if (!want) return true;
  return (tasks || []).some((t) => t.status !== "done" && (t.companyId || "") === (companyId || "")
    && (normTitle(t.title) === want || normTitle(t.title).includes(want) || want.includes(normTitle(t.title))));
}

/* Every AI conversation about a client lands in ONE work chat log — per
   person, per client, per date (sales.chats). Entries append; nothing is
   clobbered. Attachments log by name, the words stay verbatim. */
function logClientChat(meId, orgId, kind, entries) {
  if (!orgId || !entries || !entries.length) return;
  const date = todayStr();
  loadChat(meId, date, orgId).then((existing) => {
    const add = entries
      .map((m) => {
        // Pasted/uploaded images travel INTO the log as data URIs (bounded),
        // so the work chat log shows the picture, not just a filename.
        const images = (m.atts || [])
          .filter((b) => b && b.type === "image" && b.source && b.source.data && String(b.source.data).length < 1200000)
          .map((b) => "data:" + (b.source.media_type || "image/png") + ";base64," + b.source.data)
          .slice(0, 4);
        return { role: m.role, kind, at: nowTS(),
          content: typeof m.content === "string" ? m.content : (m.display || "(attachment)"),
          ...(images.length ? { images } : {}) };
      })
      .filter((m) => m.content || (m.images && m.images.length));
    return saveChat(meId, date, [...(existing || []), ...add], orgId);
  }).catch(() => { /* the log is best-effort; the conversation itself is not */ });
}

function CompanyDealsTab({ me, company: c, data, saveDeals, saveTasks }) {
  const { deals } = data;
  const [room, setRoom] = useState(null);
  const mine = deals.filter((d) => d.companyId === c.id)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const phaseOf = (d) => d.lost ? "lost" : d.stage === "po" ? "won" : (d.temperature || "cold");
  return (
    <div className="mt-4 space-y-3">
      {mine.length === 0 && <Empty icon={Columns} title="No deals yet" sub="Create one from the Overview — it lands on the pipeline in Cold." />}
      {mine.map((d) => {
        const ph = phaseOf(d);
        const ns = nextStepState(d);
        return (
          <div key={d.id} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-sm text-slate-500">{d.did}</span>
              <Chip color={ph === "won" ? "green" : ph === "lost" ? "slate" : tempColor(d.temperature)}>{ph === "won" ? "CLOSED WON" : ph === "lost" ? "CLOSED LOST" : ph.toUpperCase()}</Chip>
              <span className="font-mono text-sm tabular-nums text-slate-800">{fmtINRc(d.value)}</span>
              {rfqBadgeFor(d, data.rfq) && <Chip color={rfqBadgeFor(d, data.rfq).color}>{rfqBadgeFor(d, data.rfq).label}</Chip>}
              <span className="mr-auto" />
              <Btn size="sm" onClick={() => setRoom(d.id)}>Deal Room</Btn>
            </div>
            {d.temperatureWhy && <p className="text-xs text-slate-500 mt-1.5">{d.temperatureWhy}</p>}
            {!d.lost && d.stage !== "po" && (
              ns.key === "overdue"
                ? <p className="text-xs font-semibold text-red-600 mt-1.5 flex items-center gap-1"><AlertTriangle size={12} /> committed step overdue since {fmtDate(d.nextStepDue)}: {d.nextStep}</p>
                : ns.key === "none"
                ? <p className="text-xs text-amber-700 mt-1.5">no committed next step</p>
                : <p className="text-xs text-slate-600 mt-1.5">next: {d.nextStep}{d.nextStepDue ? " · by " + fmtDate(d.nextStepDue) : ""}</p>
            )}
            {/* the deal's next tasks — raised by scrums or stage changes,
               completed only from My Tasks */}
            {(() => {
              const open = (data.tasks || []).filter((t) => t.status !== "done" && (t.dealId === d.id || (!t.dealId && t.companyId === c.id))).slice(0, 5);
              if (!open.length) return null;
              return (
                <div className="mt-2.5 space-y-1">
                  {open.map((t) => {
                    const late = t.due && t.due < todayStr();
                    return (
                      <p key={t.id} className="text-[12px] text-slate-600 flex items-center gap-1.5">
                        <span className={cls("w-1.5 h-1.5 rounded-full flex-none", late ? "bg-red-500" : "bg-slate-300")} />
                        {t.title}
                        {t.due && <span className={cls("font-mono text-[10px]", late ? "text-red-600 font-semibold" : "text-slate-400")}>{late ? "overdue " : ""}{fmtDate(t.due)}</span>}
                      </p>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        );
      })}
      {room && <DealRoom me={me} data={data} deal={room} onClose={() => setRoom(null)} saveDeals={saveDeals} saveTasks={saveTasks} openCompany={() => {}} />}
    </div>
  );
}

/* ── PHASE MOVE CHAT — the big box on every stage change. It digs into the
   sales collateral folder in Drive and asks the right questions for this
   type of client before the card moves. ─────────────────────────────────── */
const phaseMoveSystem = (d, comp, to, ev) => [
  "You are the STAGE-CHANGE GATE on the Elecbits Sales OS pipeline. A salesperson wants to move a deal to " + to.toUpperCase() + ". Run it like a mature sales manager, not a suggestion machine:",
  "1. OPEN BY ASKING, never by recommending. One or two sharp questions at a time, grounded in what the move means and what the record already shows:",
  "   cold→warm: what did the client actually respond to? · warm→rfq: is the requirement being gathered — RFQ link sent, input coming? · →hot: what commercial signal did the client give (pricing ask, timeline, negotiation)? · →won (CLOSED WON): the PO — its reference, value, and what was agreed; that line becomes the deal's closing record, so pin all three down.",
  "2. While they answer, quietly use the sales COLLATERAL in Drive — search 'collateral', browse the sales folders — to understand what Elecbits has for THIS type of client (industry, size, what they do). Do NOT list or dump files unprompted.",
  "3. Only AFTER their answers give you the real picture: recommend, in a line or two, what to do next and which collateral fits — by file name. The recommendation follows the evidence, never precedes it.",
  "CLIENT: " + comp.name + (comp.industry ? " · " + comp.industry : "") + (comp.orgSize ? " · size " + comp.orgSize : "") + (comp.whatTheyDo ? " — " + comp.whatTheyDo : ""),
  "DEAL: " + d.did + " · currently " + (d.temperature || "cold") + " · ₹" + (d.value || 0) + (d.nextStep ? " · committed step: " + d.nextStep : ""),
  ev ? "WHAT IS ALREADY ON THE RECORD (newest first) — use it, never ask for what is written here:\n" + ev : "",
  "Keep it tight — 2 to 4 questions total, then close. Sharp and specific beats thorough: reference real names, dates and files from the record. When you have what you need, end your reply with:",
  "PHASE_JSON {\"summary\":\"one line: what the client did that justifies " + to + "\",\"share\":\"collateral to send next, by name — or empty\"}",
].join("\n");

/* When a deal REACHES a phase, the AI writes what happens next — the next
   step and the phase's first tasks — with no confirmation step. They land in
   the deal, the Scrum Master's book, and My Tasks, where they get completed. */
const stageKickoffSystem = (d, comp, to, ev) => [
  "The deal with " + (comp ? comp.name : "a client") + " (₹" + (d.value || 0) + ") just reached " + to.toUpperCase() + " on the Elecbits Sales OS. Today: " + todayStr() + ".",
  "THE RECORD (newest first):\n" + (ev || "(thin)"),
  "Write what happens next in this phase. Reply with ONLY one line:",
  'KICKOFF_JSON {"next_step":{"what":"first person, concrete","due":"YYYY-MM-DD"},"tasks":[{"title":"action-first, specific","due":"YYYY-MM-DD"}]}',
  "2 to 4 tasks for THIS phase only, realistic dues within 14 days.",
].join("\n");

function PhaseMoveChat({ me, move, data, deals, saveDeals, saveTasks, saveCompanies, onClose }) {
  const { companies } = data;
  const d = move.deal;
  const comp = companies.find((x) => x.id === d.companyId) || { name: "?" };
  const target = PHASES.find(([k]) => k === move.to) || [move.to, move.to, ""];
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(null);   // PHASE_JSON when the gate is satisfied
  const [skip, setSkip] = useState(false);
  const [manual, setManual] = useState("");
  const [atts, setAtts] = useState([]);       // pasted/uploaded evidence for the gate
  const fileRef = useRef(null);
  const bodyRef = useRef(null);
  const kicked = useRef(false);
  const evRef = useRef("");
  const addFiles = (files) => { [...files].forEach((f) => fileToBlock(f).then((b) => b && setAtts((a) => [...a, b]))); };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].map((it) => it.getAsFile && it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy, ready]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (kicked.current) return;
    kicked.current = true;
    (async () => {
      setBusy(true);
      // Everything on the record travels into the gate — touches, promises,
      // research, the RFQ input — so it questions like someone who read the file.
      try {
        const [tch, cms] = await Promise.all([
          loadTouches(d.companyId).catch(() => []),
          loadCommitments(d.companyId).catch(() => []),
        ]);
        const rfqL = rfqBadgeFor(d, data.rfq);
        const research = comp.plan && comp.plan.research;
        evRef.current = [
          dealEvidence(d, comp, data.tasks || [], tch, cms),
          rfqL && rfqL.link && (rfqL.link.response || {}).need ? "RFQ input from the client: " + rfqL.link.response.need : "",
          research ? "Research: " + research.about : "",
        ].filter(Boolean).join("\n");
      } catch (e) { evRef.current = ""; }
      try {
        const { reply, notes } = await askWithDrive(phaseMoveSystem(d, comp, move.to, evRef.current),
          [{ role: "user", content: "I want to move this deal to " + move.to + ". Start the gate." }]);
        const opener = stripToolLines(String(reply).replace(/PHASE_JSON[\s\S]*$/, "")).trim() + (notes.length ? "\n\n" + notes.map((n) => "🔎 " + n).join("\n") : "");
        setMsgs([{ role: "assistant", content: opener }]);
        logClientChat(me.id, d.companyId, "stage gate → " + move.to, [{ role: "assistant", content: opener }]);
      } catch (e) { setMsgs([{ role: "assistant", content: "Couldn't reach the AI — use “skip the chat” below and move it with a line." }]); }
      setBusy(false);
    })();
  }, []);

  const send = async () => {
    const t = input.trim();
    if ((!t && !atts.length) || busy) return;
    setInput("");
    const content = atts.length
      ? [...atts.map(({ _name, ...b }) => b), { type: "text", text: t || "See the attached." }]
      : t;
    const display = (t || "") + (atts.length ? (t ? "\n" : "") + atts.map((a) => "📎 " + a._name).join("  ") : "");
    const sentAtts = atts.map(({ _name, ...b }) => b);
    setAtts([]);
    const next = [...msgs, { role: "user", content, display, atts: sentAtts }];
    setMsgs(next); setBusy(true);
    try {
      const { reply, notes } = await askWithDrive(phaseMoveSystem(d, comp, move.to, evRef.current),
        [{ role: "user", content: "I want to move this deal to " + move.to + ". Start the gate." },
         ...next.map((m) => ({ role: m.role, content: m.content }))]);
      const v = extractMarkedJSON(reply, "PHASE_JSON");
      const shown = (stripToolLines(String(reply).replace(/PHASE_JSON[\s\S]*$/, "")).trim() || "Good — that clears it.")
        + (notes.length ? "\n\n" + notes.map((n) => "🔎 " + n).join("\n") : "");
      setMsgs([...next, { role: "assistant", content: shown }]);
      logClientChat(me.id, d.companyId, "stage gate → " + move.to, [{ role: "user", content: display, atts: sentAtts }, { role: "assistant", content: shown }]);
      if (v && v.summary) setReady(v);
    } catch (e) { setMsgs([...next, { role: "assistant", content: "Lost the AI mid-chat — try again, or skip the chat below." }]); }
    setBusy(false);
  };

  const apply = (summary, share) => {
    setTemperature(d.id, { from: d.temperature || "cold", to: move.to, why: summary, evidence: share || "", decided: "human", by: me.id });
    if (move.to === "won") {
      // Closed Won through the same chat gate: the PO line is the record.
      const moved = deals.map((x) => (x.id === d.id
        ? { ...x, stage: "po", updatedAt: nowTS(),
            history: [...(x.history || []), { from: x.stage, to: "po", at: nowTS(), by: me.id, summary: "CLOSED WON. " + summary }],
            tempHistory: [...(x.tempHistory || []), { from: d.temperature || "cold", to: "won", why: summary, decided: "human", at: nowTS() }] }
        : x));
      saveDeals(moved);
      const c0 = companies.find((x) => x.id === d.companyId);
      if (c0 && saveCompanies) saveCompanies(data.companies.map((x) => (x.id === c0.id
        ? { ...x, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text: "Deal " + d.did + " CLOSED WON. " + summary }] } : x)));
      onClose();
      return;
    }
    const moved = deals.map((x) => (x.id === d.id
      ? { ...x, temperature: move.to, temperatureAt: nowTS(), temperatureWhy: summary, updatedAt: nowTS(),
          tempHistory: [...(x.tempHistory || []), { from: d.temperature || "cold", to: move.to, why: summary, evidence: share || "", decided: "human", at: nowTS() }] }
      : x));
    saveDeals(moved);
    onClose();
    // Reaching a phase writes its opening moves — no confirmation, chat-bot
    // style. The step and tasks land in the deal, the scrum book, My Tasks.
    if (saveTasks && ["cold", "warm", "rfq", "hot"].includes(move.to)) {
      askClaude(stageKickoffSystem(d, comp, move.to, evRef.current + "\nJust moved because: " + summary),
        [{ role: "user", content: "Write the kickoff." }], { maxTokens: 500 })
        .then((reply) => {
          const v = extractMarkedJSON(reply, "KICKOFF_JSON");
          if (!v) return;
          const rows = [];
          if (v.next_step && v.next_step.what && !(d.nextStep && !d.nextStepDoneAt)) {
            const what = String(v.next_step.what);
            const due = v.next_step.due ? v.next_step.due + "T18:30" : "";
            saveNextStep(d.id, { what, due, owner: d.ownerId });
            saveDeals(moved.map((x) => (x.id === d.id
              ? { ...x, nextStep: what, nextStepDue: due, nextStepOwner: d.ownerId, nextStepSetAt: nowTS(), nextStepDoneAt: "" } : x)));
            // the step's own task, always
            if (!openTaskDupe(data.tasks, d.companyId, what)) rows.push({
              id: uid(), companyId: d.companyId, dealId: d.id, assignee: d.ownerId || me.id, author: me.id, title: what,
              details: "From the committed next step — complete it in My Tasks; the AI checks the evidence there.",
              due: v.next_step.due || "", status: "open", source: "step",
              createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" });
          }
          const list = (Array.isArray(v.tasks) ? v.tasks : []).filter((t) => t && t.title)
            .filter((t) => !openTaskDupe([...rows, ...(data.tasks || [])], d.companyId, t.title)).slice(0, 4);
          rows.push(...list.map((t) => ({
            id: uid(), companyId: d.companyId, dealId: d.id, assignee: d.ownerId || me.id, author: me.id,
            title: String(t.title), details: "Raised when the deal reached " + move.to + ".", due: t.due || "",
            status: "open", source: "stage", createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "",
          })));
          if (rows.length) saveTasks([...rows, ...(data.tasks || [])]);
        }).catch(() => { /* the move itself already stands */ });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3 md:p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden"
        style={{ height: "min(85vh, 46rem)" }} onClick={(e) => e.stopPropagation()}>

        {/* header: who, and which move */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/60">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-bold text-slate-900">{comp.name}</span>
            <span className="font-mono text-xs text-slate-400">{d.did}</span>
            <span className="flex items-center gap-1.5 ml-1">
              <Chip color={tempColor(d.temperature)}>{(d.temperature || "cold").toUpperCase()}</Chip>
              <ArrowRight size={13} className="text-slate-400" />
              <Chip color={move.to === "won" ? "green" : tempColor(move.to)}>{move.to === "won" ? "CLOSED WON" : move.to.toUpperCase()}</Chip>
            </span>
            <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 p-1"><X size={17} /></button>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">{target[2]} The gate checks the collateral in Drive and asks what earned this move.</p>
        </div>

        {/* the conversation */}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cls("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                m.role === "user" ? "bg-blue-600 text-white rounded-br-md" : "bg-slate-100 text-slate-800 rounded-bl-md")}>{m.display || (typeof m.content === "string" ? m.content : "📎")}</div>
            </div>
          ))}
          {busy && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> reading the collateral…</p>}
        </div>

        {/* gate verdict */}
        {ready && (
          <div className="mx-5 mb-2 border border-green-300 bg-green-50 rounded-lg px-3.5 py-2.5">
            <p className="text-xs font-semibold text-green-800 flex items-center gap-1.5"><CheckCircle2 size={13} /> Gate satisfied</p>
            <p className="text-xs text-green-900 mt-0.5">{ready.summary}</p>
            {ready.share && <p className="text-[11px] text-green-700 mt-0.5">send next: {ready.share}</p>}
          </div>
        )}

        {/* answer — paste a screenshot or attach the mail/doc as evidence */}
        <div className="px-5 pb-3">
          {atts.length > 0 && (
            <p className="text-xs text-slate-500 mb-1.5">{atts.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 mr-3">📎 {a._name}
                <button onClick={() => setAtts(atts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={11} /></button></span>
            ))}</p>
          )}
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files || []); e.target.value = ""; }} />
            <button title="Attach a file or image" onClick={() => fileRef.current && fileRef.current.click()}
              className="text-slate-400 hover:text-blue-600 p-1.5 flex-none"><Paperclip size={16} /></button>
            <Input value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Answer the gate… (paste an image straight in)" />
            <Btn kind="primary" disabled={busy || (!input.trim() && !atts.length)} onClick={send}><Send size={14} /></Btn>
          </div>
        </div>

        {/* decide */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center gap-2">
          {skip ? (
            <div className="flex items-center gap-2 mr-auto">
              <Input className="w-72 text-xs" autoFocus value={manual} onChange={(e) => setManual(e.target.value)}
                placeholder="the reason, in one line (min 8 chars)" />
              <Btn size="sm" disabled={manual.trim().length < 8} onClick={() => apply(manual.trim(), "")}>Move it</Btn>
            </div>
          ) : (
            <button onClick={() => setSkip(true)} className="text-xs text-slate-400 hover:text-slate-600 mr-auto">skip the chat →</button>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind={move.to === "won" ? "success" : "primary"} disabled={!ready} onClick={() => apply(ready.summary, ready.share)}>
            <Check size={14} /> {move.to === "won" ? "It's won" : "Confirm the move"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── THE DEAL COPILOT — the AI in the room. It has read everything: the
   record, the phases, the promises, the RFQ input, the research, and it can
   look in Drive. What gets agreed in chat is executed, not just said. ──── */
const dealChatSystem = (d, comp, ev) => [
  "You are the DEAL COPILOT on the Elecbits Sales OS — the sharpest colleague on this one deal. Direct, specific, brief. Today: " + todayStr() + ".",
  "DEAL: " + d.did + " · " + (comp ? comp.name : "") + " · phase " + (d.temperature || "cold") + " · ₹" + (d.value || 0)
    + (d.nextStep && !d.nextStepDoneAt ? " · committed next step: '" + d.nextStep + "'" + (d.nextStepDue ? " by " + fmtDate(d.nextStepDue) : "") : " · NO committed next step"),
  "EVERYTHING ON THE RECORD (newest first):\n" + (ev || "(nothing yet)"),
  "You can read the sales Drive for collateral and the client's folder — use it quietly to inform yourself; never dump file listings unprompted.",
  "BE MATURE: when the record is thin or something is unclear, ASK a sharp question first and recommend after the answer — recommendation follows evidence. Answer from the record, never invent facts. Push toward the ONE next move. You WRITE the next step yourself when the conversation shows it — no permission-asking, just commit it via the action line and say so in a word.",
  "NEVER take 'done' on faith. When they claim a step or task is DONE, get evidence first — what exactly happened, with whom, when, where the artefact lives (a document name, a mail thread, a pasted screenshot — they can paste images right into this chat). Only emit task_done once the evidence is stated.",
  "When something concrete lands in the conversation, end your reply with ONE line:",
  "DEAL_ACT_JSON {\"actions\":[{\"type\":\"next_step\",\"what\":\"...\",\"due\":\"YYYY-MM-DD\"} | {\"type\":\"task_done\",\"task\":\"the open task's title, close to verbatim\"} | {\"type\":\"task\",\"title\":\"...\",\"due\":\"YYYY-MM-DD or empty\"} | {\"type\":\"task_due\",\"task\":\"the open task's title, close to verbatim\",\"due\":\"YYYY-MM-DD\"} | {\"type\":\"fact\",\"field\":\"contactPerson|designation|phone|email\",\"value\":\"...\"}]}",
  "task_due moves an existing task's date — use it when they ask to reschedule a task, instead of committing a new step. To rewrite a task's wording, use {\"type\":\"task_edit\",\"task\":\"old title, close to verbatim\",\"title\":\"the corrected title\"}.",
  "When they name a stakeholder or contact detail, SAVE it with a fact action — it lands on the company record, editable later on the Overview.",
  "OPEN TASKS ON THIS DEAL:\n" + ((d._openTasks || []).join("\n") || "(none)"),
  "Dates: tomorrow = " + localISO(new Date(Date.now() + 86400000)) + ". Never invent a date the person did not say — ask for it. Never show the DEAL_ACT_JSON contents in prose.",
].join("\n");

function DealChat({ me, d, comp, data, touches, commits, saveDeals, saveTasks, saveCompanies }) {
  const { deals, tasks } = data;
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [atts, setAtts] = useState([]);
  const fileRef = useRef(null);
  const bodyRef = useRef(null);
  const kicked = useRef(false);
  const addFiles = (files) => { [...files].forEach((f) => fileToBlock(f).then((b) => b && setAtts((a) => [...a, b]))); };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].map((it) => it.getAsFile && it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  const openTaskTitles = tasks
    .filter((t) => t.status !== "done" && (t.dealId === d.id || (!t.dealId && t.companyId === d.companyId)))
    .map((t) => "• " + t.title + (t.due ? " (due " + fmtDate(t.due) + ")" : "")).slice(0, 10);

  // The date option: pick a day and read that day's logged conversation on
  // this deal from the work chat log — the live chat is one click back.
  const [histDate, setHistDate] = useState("");
  const [hist, setHist] = useState(null);
  useEffect(() => {
    if (!histDate) { setHist(null); return; }
    let a = true;
    loadClientLog(d.companyId).then((rows) => {
      if (!a) return;
      setHist(rows.filter((r) => r.date === histDate)
        .flatMap((r) => r.messages).filter((m) => String(m.kind || "").startsWith("deal " + d.did)));
    }).catch(() => a && setHist([]));
    return () => { a = false; };
  }, [histDate]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy]);

  const evidence = () => {
    const rfqL = rfqBadgeFor(d, data.rfq);
    const research = comp && comp.plan && comp.plan.research;
    return [
      dealEvidence(d, comp, tasks, touches, commits),
      rfqL && rfqL.link && (rfqL.link.response || {}).need ? "RFQ input from the client: " + rfqL.link.response.need : "",
      research ? "Research: " + research.about + ((research.opportunities || []).length ? " Opportunities: " + research.opportunities.join("; ") : "") : "",
    ].filter(Boolean).join("\n");
  };

  const runActions = (list) => {
    const done = [];
    let nextDeals = deals, nextTasks = tasks;
    for (const a of Array.isArray(list) ? list : []) {
      try {
        if (a.type === "next_step" && a.what) {
          saveNextStep(d.id, { what: a.what, due: a.due ? a.due + "T18:30" : "", owner: d.ownerId });
          nextDeals = nextDeals.map((x) => (x.id === d.id ? { ...x, nextStep: a.what, nextStepDue: a.due ? a.due + "T18:30" : "", nextStepOwner: d.ownerId, nextStepSetAt: nowTS(), nextStepDoneAt: "", updatedAt: nowTS() } : x));
          done.push("✓ committed: " + a.what + (a.due ? " by " + fmtDate(a.due) : ""));
          // every step carries its task
          if (!openTaskDupe(nextTasks, d.companyId, a.what)) {
            nextTasks = [{ id: uid(), companyId: d.companyId, dealId: d.id, assignee: d.ownerId || me.id, author: me.id, title: a.what,
              details: "From the committed next step — complete it in My Tasks; the AI checks the evidence there.",
              due: a.due || "", status: "open", source: "step",
              createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...nextTasks];
          }
        }
        if ((a.type === "task_done" || a.type === "activity_done") && (a.task || a.activity)) {
          const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const want = norm(a.task || a.activity);
          let hit = "";
          nextTasks = nextTasks.map((x) => {
            if (hit || x.status === "done" || !(x.dealId === d.id || (!x.dealId && x.companyId === d.companyId))) return x;
            if (norm(x.title).includes(want) || want.includes(norm(x.title))) { hit = x.title; return { ...x, status: "done", doneAt: nowTS() }; }
            return x;
          });
          if (hit) done.push("✓ task done: " + hit);
        }
        if (a.type === "task_due" && a.task && a.due) {
          const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const want = norm(a.task);
          let hit = "";
          nextTasks = nextTasks.map((x) => {
            if (hit || x.status === "done" || !(x.dealId === d.id || (!x.dealId && x.companyId === d.companyId))) return x;
            if (norm(x.title).includes(want) || want.includes(norm(x.title))) { hit = x.title; return { ...x, due: a.due }; }
            return x;
          });
          if (hit) done.push("✓ moved: " + hit + " → " + fmtDate(a.due));
        }
        if (a.type === "task_edit" && a.task && a.title) {
          const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const want = norm(a.task);
          let hit = "";
          nextTasks = nextTasks.map((x) => {
            if (hit || x.status === "done" || !(x.dealId === d.id || (!x.dealId && x.companyId === d.companyId))) return x;
            if (norm(x.title).includes(want) || want.includes(norm(x.title))) { hit = x.title; return { ...x, title: String(a.title) }; }
            return x;
          });
          if (hit) done.push("✓ rewrote the task: " + a.title);
        }
        if (a.type === "task" && a.title) {
          if (openTaskDupe(nextTasks, d.companyId, a.title)) {
            done.push("· already open, not duplicated: " + a.title);
          } else {
            nextTasks = [{ id: uid(), companyId: d.companyId, dealId: d.id, assignee: d.ownerId || me.id, author: me.id,
              title: a.title, details: "From the Deal Room", due: a.due || todayStr(), status: "open", source: "chat",
              createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...nextTasks];
            done.push("✓ task: " + a.title);
          }
        }
        if (a.type === "fact" && comp && saveCompanies && a.value != null && String(a.value).trim()) {
          const FIELDS = { contactPerson: "contact person", designation: "designation", phone: "phone", email: "email" };
          if (FIELDS[a.field]) {
            const v = String(a.value).trim();
            saveCompanies(data.companies.map((c) => (c.id === comp.id
              ? { ...c, [a.field]: v, activity: [...(c.activity || []), { at: nowTS(), by: me.id, text: "Set " + FIELDS[a.field] + " = " + v + " (from the deal chat)." }] } : c)));
            done.push("✓ saved: " + FIELDS[a.field] + " = " + v + " — edit any time on the company Overview.");
          }
        }
      } catch (e) { /* one bad action never sinks the chat */ }
    }
    if (nextDeals !== deals) saveDeals(nextDeals);
    if (nextTasks !== tasks) saveTasks(nextTasks);
    return done;
  };

  const converse = async (history) => {
    setBusy(true);
    try {
      const convo = history.length ? history.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: "user", content: "Open the conversation: in two or three sharp lines, where does this deal actually stand and what is the ONE next move?" }];
      // The Drive-searching loop can stall on a slow lookup — cap it, and fall
      // back to answering from the record alone rather than spinning forever.
      const sys = dealChatSystem({ ...d, _openTasks: openTaskTitles }, comp, evidence());
      let reply, notes;
      try {
        ({ reply, notes } = await withTimeout(askWithDrive(sys, convo), 40000));
      } catch (e1) {
        reply = await withTimeout(askClaude(sys, convo, { maxTokens: 700 }), 20000);
        notes = [];
      }
      const acts = extractMarkedJSON(reply, "DEAL_ACT_JSON");
      const done = runActions(acts && acts.actions);
      const shown = stripToolLines(String(reply).replace(/DEAL_ACT_JSON[\s\S]*$/, "")).trim()
        + (notes.length ? "\n\n" + notes.map((n) => "🔎 " + n).join("\n") : "") + (done.length ? "\n\n" + done.join("\n") : "");
      setMsgs([...history, { role: "assistant", content: shown }]);
      // The whole exchange lands in the client's date-wise work chat log.
      const last = history[history.length - 1];
      logClientChat(me.id, d.companyId, "deal " + d.did,
        [...(last && last.role === "user" ? [{ role: "user", content: last.display || last.content, atts: last.atts }] : []), { role: "assistant", content: shown }]);
    } catch (e) {
      setMsgs([...history, { role: "assistant", content: "Couldn't reach the AI — send that again." }]);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (kicked.current) return;
    kicked.current = true;
    converse([]);
  }, []);

  const send = () => {
    const t = input.trim();
    if ((!t && !atts.length) || busy) return;
    setInput("");
    const content = atts.length
      ? [...atts.map(({ _name, ...b }) => b), { type: "text", text: t || "See the attached." }]
      : t;
    const display = (t || "") + (atts.length ? (t ? "\n" : "") + atts.map((a) => "📎 " + a._name).join("  ") : "");
    const sentAtts = atts.map(({ _name, ...b }) => b);
    setAtts([]);
    converse([...msgs, { role: "user", content, display, atts: sentAtts }]);
  };

  return (
    <div className="border border-slate-200 rounded-xl flex flex-col bg-white overflow-hidden lg:sticky lg:top-4" style={{ height: "min(70vh, 34rem)" }}>
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 bg-slate-50/60">
        <Bot size={15} className="text-blue-600" />
        <span className="text-sm font-semibold text-slate-800 mr-auto">Deal copilot</span>
        {/* pick a day to read that day's logged conversation on this deal */}
        <input type="date" value={histDate} onChange={(e) => setHistDate(e.target.value)} max={todayStr()}
          className="text-[10.5px] border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-500 bg-white" title="Read a past day's conversation" />
        {!histDate && <span className="text-[10px] text-slate-400 uppercase tracking-wide">can act</span>}
      </div>
      {histDate && (
        <div className="px-3.5 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <span className="text-[11px] text-amber-800 mr-auto">Reading the log for {fmtDate(histDate)}</span>
          <button onClick={() => setHistDate("")} className="text-[11px] text-blue-600 hover:underline">back to live →</button>
        </div>
      )}
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 space-y-2.5">
        {histDate ? (<>
          {hist === null && <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> opening the log…</p>}
          {hist && !hist.length && <p className="text-[11.5px] text-slate-400">Nothing logged on this deal for {fmtDate(histDate)}.</p>}
          {(hist || []).map((m, i) => (
            <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cls("max-w-[90%] rounded-2xl px-3 py-1.5 text-[13px] whitespace-pre-wrap leading-relaxed",
                m.role === "user" ? "bg-blue-600/80 text-white rounded-br-md" : "bg-slate-100 text-slate-700 rounded-bl-md")}>
                {typeof m.content === "string" ? m.content : (m.display || "📎")}
                {(m.images || []).length > 0 && (
                  <span className="flex gap-1.5 mt-1 flex-wrap">
                    {m.images.slice(0, 4).map((src, k) => <a key={k} href={src} target="_blank" rel="noreferrer"><img src={src} alt="attachment" className="h-16 rounded-md border border-slate-200 object-cover" /></a>)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </>) : (<>
          {msgs.map((m, i) => (
            <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cls("max-w-[90%] rounded-2xl px-3 py-1.5 text-[13px] whitespace-pre-wrap leading-relaxed",
                m.role === "user" ? "bg-blue-600 text-white rounded-br-md" : "bg-slate-100 text-slate-800 rounded-bl-md")}>{m.display || (typeof m.content === "string" ? m.content : "📎")}</div>
            </div>
          ))}
          {busy && <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> reading the file…</p>}
        </>)}
      </div>
      <div className="border-t border-slate-100 p-2.5">
        {atts.length > 0 && (
          <p className="text-[11px] text-slate-500 mb-1">{atts.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 mr-2.5">📎 {a._name}
              <button onClick={() => setAtts(atts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={10} /></button></span>
          ))}</p>
        )}
        <div className="flex items-center gap-1.5">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files || []); e.target.value = ""; }} />
          <button title="Attach a file or image" onClick={() => fileRef.current && fileRef.current.click()}
            className="text-slate-400 hover:text-blue-600 p-1 flex-none"><Paperclip size={15} /></button>
          <Input value={input} onChange={(e) => setInput(e.target.value)} className="text-[13px]" onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask, or agree the next move — it executes…" />
          <Btn kind="primary" size="sm" disabled={busy || (!input.trim() && !atts.length)} onClick={send}><Send size={13} /></Btn>
        </div>
      </div>
    </div>
  );
}

/* ── THE DEAL ROOM — a full-screen sheet, not a cramped modal. One header,
   three answer cards (phase / commitment / RFQ), the three-stage route with
   its activities, and the trail. Everything contained, nothing bleeding. ── */
/* Done is not claimed, it is proven. The AI reads the person's account, the
   attached documents and the mail chain, and only a believable step closes. */
const stepProofSystem = (d, comp, account, mailCtx, ev) => [
  "You are the EVIDENCE CHECKER on the Elecbits Sales OS. Today is " + todayStr() + ".",
  "A salesperson says this committed next step on the " + (comp ? comp.name : "client") + " deal is DONE:",
  "THE STEP: " + (d.nextStep || "(unnamed)") + (d.nextStepDue ? " — was due " + fmtDate(d.nextStepDue) : ""),
  "THEIR ACCOUNT OF WHAT THEY DID:\n" + (account || "(none given)"),
  mailCtx ? "PULLED FROM THE MAIL CHAIN (shared sales mailbox):\n" + mailCtx : "No mail evidence was pulled.",
  "THE DEAL RECORD (newest first):\n" + (ev || "(empty)"),
  "Any attached files are part of the evidence — read them.",
  "Judge it like a sharp sales manager. Believe it only when the evidence actually shows the step happened — the who, the when, the outcome. A vague claim with no document, no mail and no verifiable specifics does NOT pass; late is fine, unproven is not.",
  'Reply with two or three plain lines addressed to the salesperson, then end with exactly: STEP_VERDICT_JSON {"believe":true,"score":7,"why":"one line","missing":"what would make it believable — empty if believed"}',
].join("\n");

function StepProof({ me, d, comp, data, touches, commits, onBelieved, onClose }) {
  const { tasks } = data;
  const [account, setAccount] = useState("");
  const [atts, setAtts] = useState([]);
  const [mailCtx, setMailCtx] = useState("");
  const [mailMsg, setMailMsg] = useState("");
  const [mailBusy, setMailBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const fileRef = useRef(null);
  const addFiles = (files) => { [...files].forEach((f) => fileToBlock(f).then((b) => b && setAtts((a) => [...a, b]))); };
  const boxes = ((comp && comp.plan && comp.plan.comms && comp.plan.comms.mailboxes) || "").trim();

  // "Add the AI to the mail chain": CC the shared mailbox, and this pulls the
  // thread so the checker reads it as evidence.
  const pullMail = async () => {
    if (!boxes.includes("@") || mailBusy) return;
    setMailBusy(true); setMailMsg("");
    try {
      const q = "newer_than:45d " + ((comp && (comp.email || comp.name)) || "");
      const r = await fetch("/api/inbox?action=fetch&mailboxes=" + encodeURIComponent(boxes) + "&q=" + encodeURIComponent(q.trim()) + "&max=15").then((x) => x.json());
      if (r.error) setMailMsg(r.error);
      else if (!(r.messages || []).length) setMailMsg("Nothing in the mailbox mentions " + (comp ? comp.name : "this client") + " in the last 45 days — CC " + boxes.split(",")[0] + " on the thread and pull again.");
      else {
        setMailCtx(r.messages.slice(0, 12).map((m) => m.date + " · " + m.from + " → " + m.to + " · " + (m.subject || "(no subject)") + " — " + (m.snippet || "")).join("\n"));
        setMailMsg(r.messages.length + " message(s) pulled — the checker reads them as evidence.");
      }
    } catch (e) { setMailMsg("Could not reach the mailbox."); }
    setMailBusy(false);
  };

  const judge = async () => {
    if (busy || (!account.trim() && !atts.length && !mailCtx)) return;
    setBusy(true); setVerdict(null);
    try {
      const content = atts.length
        ? [...atts.map(({ _name, ...b }) => b), { type: "text", text: "Judge the claim on this evidence." }]
        : "Judge the claim.";
      const reply = await withTimeout(askClaude(
        stepProofSystem(d, comp, account.trim(), mailCtx, dealEvidence(d, comp, tasks, touches, commits)),
        [{ role: "user", content }], { maxTokens: 500 }), 30000);
      const v = extractMarkedJSON(reply, "STEP_VERDICT_JSON");
      if (!v || typeof v.believe !== "boolean") throw new Error("unparseable");
      const out = { believe: v.believe, score: Number(v.score) || (v.believe ? 7 : 3),
        why: String(v.why || ""), missing: String(v.missing || ""), offline: false,
        text: stripToolLines(String(reply).replace(/STEP_VERDICT_JSON[\s\S]*$/, "")).trim() };
      setVerdict(out);
      if (out.believe) onBelieved(out);
    } catch (e) {
      // AI unreachable: strict but not a trap — a real account PLUS a document
      // or the mail chain passes; a bare claim never does.
      const solid = account.trim().length >= 30 && (atts.length > 0 || !!mailCtx);
      const out = { believe: solid, score: solid ? 6 : 3, offline: true, why: solid ? "Checked offline — account plus attached evidence." : "",
        missing: solid ? "" : "The AI was unreachable. Offline it needs a real account of what happened AND a document or the mail chain.", text: "" };
      setVerdict(out);
      if (out.believe) onBelieved(out);
    }
    setBusy(false);
  };

  return (
    <Modal title="Close the step — with evidence" onClose={onClose}
      footer={verdict && verdict.believe
        ? <><span className="mr-auto text-xs text-green-700 font-mono">believed · {verdict.score}/10{verdict.offline ? " · offline" : ""}</span><Btn kind="primary" onClick={onClose}><Check size={14} /> Done — commit the next one</Btn></>
        : <>
            <span className="mr-auto text-[11px] text-slate-400">The AI needs evidence to believe it.</span>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn kind="primary" disabled={busy || (!account.trim() && !atts.length && !mailCtx)} onClick={judge}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {verdict ? "Check again" : "Check it"}
            </Btn>
          </>}>
      <div className="space-y-3">
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide">The committed step</p>
          <p className="text-sm text-slate-800 mt-0.5">{d.nextStep}{d.nextStepDue && <span className="text-[11px] font-mono text-slate-400"> · was due {fmtDate(d.nextStepDue)}</span>}</p>
        </div>
        <Field label="What exactly did you do?" req hint="The who, the when, the outcome — in your words.">
          <TA value={account} onChange={(e) => setAccount(e.target.value)} className="min-h-20"
            placeholder="e.g. Called Rahul at 3pm, walked him through the revised quote, he confirmed the 8-week timeline works and will send the PO draft by Friday." />
        </Field>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files || []); e.target.value = ""; }} />
          <button onClick={() => fileRef.current && fileRef.current.click()} className="text-blue-600 hover:underline flex items-center gap-1"><Paperclip size={12} /> attach a document</button>
          {boxes.includes("@")
            ? <button onClick={pullMail} disabled={mailBusy} className="text-blue-600 hover:underline flex items-center gap-1">
                {mailBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} pull the mail chain ({boxes.split(",")[0]})
              </button>
            : <span className="text-slate-400">No shared mailbox on this company yet — add one in Client Comms and the AI can read the mail chain.</span>}
        </div>
        {atts.length > 0 && <p className="text-xs text-slate-500">{atts.map((a, i) => <span key={i} className="inline-flex items-center gap-1 mr-3">📎 {a._name}<button onClick={() => setAtts(atts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={11} /></button></span>)}</p>}
        {mailMsg && <p className="text-xs text-slate-500">{mailMsg}</p>}
        {verdict && !verdict.believe && (
          <div className="border border-red-200 bg-red-50/60 rounded-lg p-3">
            <p className="text-xs font-bold text-red-700 flex items-center gap-1"><XCircle size={13} /> Not believed{verdict.offline ? " (offline check)" : " · " + verdict.score + "/10"}</p>
            {verdict.text && <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap leading-relaxed">{verdict.text}</p>}
            {verdict.missing && <p className="text-xs text-slate-600 mt-1"><b>To make it believable:</b> {verdict.missing}</p>}
          </div>
        )}
        {verdict && verdict.believe && (
          <div className="border border-green-200 bg-green-50/60 rounded-lg p-3">
            <p className="text-xs font-bold text-green-700 flex items-center gap-1"><CheckCircle2 size={13} /> Believed · {verdict.score}/10</p>
            {(verdict.text || verdict.why) && <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap leading-relaxed">{verdict.text || verdict.why}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* NEXT PROSPECT STEPS — "change" opens this modal: the AI reads the record
   and lays out the distinct moves that take the deal forward; pick one and it
   commits (step + its task), or write your own at the bottom. */
const stepOptionsSystem = (d, comp, ev) => [
  "You lay out the POSSIBLE NEXT STEPS for a sales deal at Elecbits (electronics design & manufacturing services). Today: " + todayStr() + ".",
  "DEAL: " + (comp ? comp.name : "") + " · phase " + (d.temperature || "cold") + " · ₹" + (d.value || 0)
    + (d.nextStep && !d.nextStepDoneAt ? " · currently committed: '" + d.nextStep + "'" : ""),
  "THE RECORD (newest first):\n" + (ev || "(thin)"),
  "Write 3 DISTINCT candidate next steps that would actually take this deal forward — different angles (clear the blocker, widen the contact, force the commercial question), ordered by leverage. First person, concrete, each with a realistic due date within 10 days.",
  'Reply ONLY: STEP_OPTIONS_JSON {"options":[{"what":"...","due":"YYYY-MM-DD","why":"one factual line on why this is the move"}]}',
].join("\n");

function NextStepModal({ me, d, comp, data, touches, commits, onCommit, onClose }) {
  const { tasks } = data;
  const [opts, setOpts] = useState(null);
  const [err, setErr] = useState("");
  const [what, setWhat] = useState(d.nextStep && !d.nextStepDoneAt ? d.nextStep : "");
  const [due, setDue] = useState(d.nextStepDue ? String(d.nextStepDue).slice(0, 16) : "");
  useEffect(() => {
    let a = true;
    withTimeout(askClaude(stepOptionsSystem(d, comp, dealEvidence(d, comp, tasks, touches, commits)),
      [{ role: "user", content: "Lay out the possible next steps." }], { maxTokens: 800 }), 30000)
      .then((reply) => {
        if (!a) return;
        const v = extractMarkedJSON(reply, "STEP_OPTIONS_JSON");
        setOpts(v && Array.isArray(v.options) ? v.options.filter((o) => o && o.what).slice(0, 4) : []);
      })
      .catch(() => { if (a) { setOpts([]); setErr("Couldn't draft the options — write your own below, or ask the copilot."); } });
    return () => { a = false; };
  }, []);
  return (
    <Modal title="Next prospect steps" onClose={onClose}
      footer={<><span className="mr-auto text-[11px] text-slate-400">Committing writes the step AND its task — one unit.</span><Btn onClick={onClose}>Cancel</Btn></>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500 -mt-1">The AI reads the record and lays out the moves that take {comp ? comp.name : "this deal"} forward — pick one, or write your own.</p>
        {opts === null && <p className="text-sm text-slate-400 flex items-center gap-2 py-3"><Loader2 size={14} className="animate-spin" /> reading the record…</p>}
        {err && <p className="text-xs text-red-600">{err}</p>}
        {(opts || []).map((o, i) => (
          <button key={i} onClick={() => onCommit(o.what, o.due ? o.due + "T18:30" : "")}
            className="w-full text-left border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 rounded-xl p-3.5 group transition-colors">
            <p className="text-sm text-slate-800 leading-snug group-hover:text-slate-900">{o.what}</p>
            {o.due && <p className="text-[11px] font-mono text-slate-400 mt-1">by {fmtDate(o.due)}</p>}
            {o.why && <p className="text-xs text-slate-500 mt-1 leading-snug">{o.why}</p>}
            <p className="text-[11px] text-blue-600 font-medium mt-1.5 opacity-0 group-hover:opacity-100">Commit this →</p>
          </button>
        ))}
        <div className="border-t border-slate-100 pt-3">
          <Lbl>Write my own</Lbl>
          <div className="mt-1.5 space-y-1.5">
            <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="what happens next — your words" />
            <div className="flex gap-1.5">
              <Input type="datetime-local" className="flex-1 text-xs" value={due} onChange={(e) => setDue(e.target.value)} />
              <Btn kind="primary" size="sm" disabled={!what.trim()} onClick={() => onCommit(what.trim(), due || "")}><Check size={12} /> Commit</Btn>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* GENERATE TASKS — click as often as you like. It reads the step, every open
   task and the record, then realigns the whole set: merges duplicates, drops
   the obsolete, fixes titles and dates, adds what is missing. */
const realignSystem = (d, comp, step, taskLines, ev) => [
  "You are the TASK REALIGNER for one deal on the Elecbits Sales OS. Today: " + todayStr() + ".",
  "DEAL: " + (comp ? comp.name : "") + " · phase " + (d.temperature || "cold") + " · ₹" + (d.value || 0),
  "COMMITTED NEXT STEP: " + (step || "(none committed)"),
  "OPEN TASKS ON THE DEAL:\n" + (taskLines || "(none)"),
  "THE RECORD (newest first):\n" + (ev || "(thin)"),
  "Rebuild the list into the SHARPEST minimal set that carries the step and this phase:",
  "• merge duplicates and near-duplicates (drop the extras) • drop obsolete or irrelevant ones • fix vague titles to action-first and specific • fix dues into a realistic order • add what is missing (max 3). Never drop a task marked [in progress].",
  'Reply with ONE short line of reasoning, then exactly: REALIGN_JSON {"summary":"what changed, one line","ops":[{"op":"drop","task":"title, close to verbatim"} | {"op":"retitle","task":"old title","title":"new title"} | {"op":"due","task":"title","due":"YYYY-MM-DD"} | {"op":"add","title":"...","due":"YYYY-MM-DD"}]}',
  "Emit ops ONLY for changes — untouched tasks need no op. An already-clean list gets an empty ops array.",
].join("\n");

function DealRoom({ me, data, deal: dealId, onClose, saveDeals, saveTasks, saveCompanies, openCompany }) {
  const { users, companies, deals, tasks } = data;
  const d = deals.find((x) => x.id === dealId);
  const comp = d && companies.find((x) => x.id === d.companyId);
  const owner = d && users.find((u) => u.id === d.ownerId);
  const [touches, setTouches] = useState([]);
  const [commits, setCommits] = useState([]);
  const [busyTemp, setBusyTemp] = useState(false);
  const [err, setErr] = useState("");
  const [editStep, setEditStep] = useState(false); // the Next prospect steps modal
  const [realigning, setRealigning] = useState(false);
  const [realignNote, setRealignNote] = useState("");

  useEffect(() => {
    if (!comp) return;
    let a = true;
    loadTouches(comp.id).then((x) => a && setTouches(x)).catch(() => {});
    loadCommitments(comp.id).then((x) => a && setCommits(x)).catch(() => {});
    return () => { a = false; };
  }, [comp && comp.id]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The AI thinks the step itself: opening a deal that has NO committed next
  // step makes it write one from the record — with its task — and the chat on
  // the right is where you improvise it. Once per open, silent on failure.
  const [drafting, setDrafting] = useState(false);
  const draftedRef = useRef("");
  useEffect(() => {
    const dd = deals.find((x) => x.id === dealId);
    if (!dd || dd.lost || dd.stage === "po") return;
    if (dd.nextStep && !dd.nextStepDoneAt) return;
    if (draftedRef.current === dealId) return;
    draftedRef.current = dealId;
    const cc = companies.find((x) => x.id === dd.companyId);
    setDrafting(true);
    askClaude(stageKickoffSystem(dd, cc, dd.temperature || "cold", dealEvidence(dd, cc, tasks, touches, commits)),
      [{ role: "user", content: "Write the kickoff." }], { maxTokens: 500 })
      .then((reply) => {
        const v = extractMarkedJSON(reply, "KICKOFF_JSON");
        if (!v || !v.next_step || !v.next_step.what) return;
        const what = String(v.next_step.what);
        const due = v.next_step.due ? v.next_step.due + "T18:30" : "";
        saveNextStep(dd.id, { what, due, owner: dd.ownerId });
        saveDeals(deals.map((x) => (x.id === dd.id ? { ...x, nextStep: what, nextStepDue: due, nextStepOwner: dd.ownerId, nextStepSetAt: nowTS(), nextStepDoneAt: "", updatedAt: nowTS() } : x)));
        const rows = [];
        if (!openTaskDupe(tasks, dd.companyId, what)) rows.push({
          id: uid(), companyId: dd.companyId, dealId: dd.id, assignee: dd.ownerId || me.id, author: me.id, title: what,
          details: "From the committed next step — complete it in My Tasks; the AI checks the evidence there.",
          due: v.next_step.due || "", status: "open", source: "step",
          createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" });
        const list = (Array.isArray(v.tasks) ? v.tasks : []).filter((t) => t && t.title)
          .filter((t) => !openTaskDupe([...rows, ...tasks], dd.companyId, t.title)).slice(0, 3);
        rows.push(...list.map((t) => ({
          id: uid(), companyId: dd.companyId, dealId: dd.id, assignee: dd.ownerId || me.id, author: me.id,
          title: String(t.title), details: "Planned for the " + (dd.temperature || "cold") + " phase.", due: t.due || "",
          status: "open", source: "stage", createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" })));
        if (rows.length) saveTasks([...rows, ...tasks]);
      })
      .catch(() => { /* the chat on the right can still write it */ })
      .finally(() => setDrafting(false));
  }, [deals, dealId]);

  // When the step's task closes in My Tasks (evidence checked there), the
  // committed step marks itself done here — one loop, no second click.
  useEffect(() => {
    const dd = deals.find((x) => x.id === dealId);
    if (!dd || !dd.nextStep || dd.nextStepDoneAt) return;
    const lt = tasks.find((t) => t.status === "done"
      && (t.dealId === dd.id || (!t.dealId && t.companyId === dd.companyId))
      && (normTitle(t.title) === normTitle(dd.nextStep)
        || normTitle(t.title).includes(normTitle(dd.nextStep)) || normTitle(dd.nextStep).includes(normTitle(t.title))));
    if (!lt) return;
    saveNextStep(dd.id, { what: dd.nextStep, due: dd.nextStepDue, owner: dd.nextStepOwner, doneAt: lt.doneAt || nowTS() });
    saveDeals(deals.map((x) => (x.id === dd.id ? { ...x, nextStepDoneAt: lt.doneAt || nowTS(), updatedAt: nowTS() } : x)));
  }, [tasks, deals, dealId]);

  if (!d) return null;
  const patchDeal = (fields) => saveDeals(deals.map((x) => (x.id === d.id ? { ...x, ...fields, updatedAt: nowTS() } : x)));
  const ns = nextStepState(d);
  const ph = d.lost ? "lost" : d.stage === "po" ? "won" : (d.temperature || "cold");
  const rfqB = rfqBadgeFor(d, data.rfq);

  // The story, phase by phase: what each one actually produced, straight from
  // the record — no AI call, so the room opens instantly. Segments follow the
  // temperature history, so a deal that bounced shows every visit.
  const PH_SET = ["cold", "warm", "rfq", "hot"];
  const story = (() => {
    const moves = [...(d.tempHistory || [])].sort((a, b) => (a.at < b.at ? -1 : 1));
    const segs = [];
    let cur = moves.length ? (moves[0].from || "cold") : (d.temperature || "cold");
    let curAt = d.createdAt || "";
    for (const m of moves) {
      segs.push({ phase: cur, from: curAt, to: m.at, why: m.why || "", ai: m.decided === "ai" });
      cur = PH_SET.includes(m.to) ? m.to : cur;
      curAt = m.at;
    }
    if (!d.lost && d.stage !== "po") segs.push({ phase: cur, from: curAt, to: "", current: true });
    const inWin = (at, s) => at && (!s.from || at >= s.from) && (!s.to || at < s.to);
    return segs.filter((s) => PH_SET.includes(s.phase)).map((s) => {
      const items = [];
      if (s.phase === "cold" && comp && comp.plan && comp.plan.research && comp.plan.research.about)
        items.push("Research on file: " + String(comp.plan.research.about).slice(0, 130));
      const tw = (touches || []).filter((t) => inWin(t.at, s));
      if (tw.length) items.push(tw.length + " client touch" + (tw.length > 1 ? "es" : "") + " — latest: " + (tw[0].subject || tw[0].kind || "logged"));
      for (const cm of (commits || []).filter((c) => inWin(c.createdAt, s)).slice(0, 2))
        items.push((cm.side === "us" ? "We promised: " : "They promised: ") + cm.what + (cm.status !== "open" ? " (" + cm.status + ")" : ""));
      if (s.phase === "rfq" && rfqB && rfqB.link)
        items.push(rfqB.link.status === "submitted"
          ? "Client filled the RFQ: " + String((rfqB.link.response || {}).need || "").slice(0, 130)
          : "RFQ link " + rfqB.link.status + (rfqB.link.contactName ? " to " + rfqB.link.contactName : ""));
      const days = Math.max(0, Math.round(((s.to ? new Date(s.to).getTime() : Date.now()) - new Date(s.from || Date.now()).getTime()) / 86400000));
      return { ...s, days, items };
    });
  })();


  const reassess = async () => {
    setBusyTemp(true); setErr("");
    try {
      const reply = await withTimeout(askClaude(tempSystem(d, comp, dealEvidence(d, comp, tasks, touches, commits)),
        [{ role: "user", content: "Judge the temperature now." }], { maxTokens: 400 }), 20000);
      const v = extractMarkedJSON(reply, "TEMP_JSON");
      if (!v || !["cold", "warm", "rfq", "hot"].includes(v.temperature)) throw new Error("unparseable");
      if (v.temperature !== d.temperature) {
        setTemperature(d.id, { from: d.temperature, to: v.temperature, why: v.why || "", decided: "ai", by: me.id });
        patchDeal({ temperature: v.temperature, temperatureAt: nowTS(), temperatureWhy: v.why || "",
          tempHistory: [...(d.tempHistory || []), { from: d.temperature, to: v.temperature, why: v.why || "", decided: "ai", at: nowTS() }] });
      } else {
        patchDeal({ temperatureAt: nowTS(), temperatureWhy: v.why || d.temperatureWhy });
      }
    } catch (e) { setErr("Could not judge the temperature — try again."); }
    setBusyTemp(false);
  };

  // One committer for every door — the modal's picked option, the manual
  // write-my-own — and the step's task comes with it.
  const commitStepWith = (what0, due0) => {
    const what = String(what0 || "").trim();
    if (!what) return;
    const due = due0 || "";
    saveNextStep(d.id, { what, due, owner: d.ownerId });
    patchDeal({ nextStep: what, nextStepDue: due, nextStepOwner: d.ownerId, nextStepSetAt: nowTS(), nextStepDoneAt: "" });
    if (!openTaskDupe(tasks, d.companyId, what)) {
      saveTasks([{ id: uid(), companyId: d.companyId, dealId: d.id, assignee: d.ownerId || me.id, author: me.id, title: what,
        details: "From the committed next step — complete it in My Tasks; the AI checks the evidence there.",
        due: due ? String(due).slice(0, 10) : "", status: "open", source: "step",
        createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...tasks]);
    }
    setEditStep(false);
  };
  // The step becomes a TASK — the evidence check lives in the task's closure
  // (My Tasks), not here. The card shows the task's live status, and the step
  // marks itself done when its task closes. ANY same-titled task on this deal
  // counts as the step's task, whoever raised it — copilot, scrum, kickoff.
  const stepTask = d.nextStep && !d.nextStepDoneAt
    ? (tasks.find((t) => t.dealId === d.id && t.source === "step" && t.title === d.nextStep)
      || tasks.find((t) => (t.dealId === d.id || (!t.dealId && t.companyId === d.companyId))
        && (normTitle(t.title) === normTitle(d.nextStep)
          || normTitle(t.title).includes(normTitle(d.nextStep)) || normTitle(d.nextStep).includes(normTitle(t.title)))))
    : null;
  // GENERATE TASKS — repeatable: audits every open task against the step and
  // the record, applies the realignment, and reports what changed.
  const realignTasks = async () => {
    if (realigning) return;
    setRealigning(true); setRealignNote("");
    try {
      const open = tasks.filter((t) => t.status !== "done" && (t.dealId === d.id || (!t.dealId && t.companyId === d.companyId)));
      const lines = open.map((t) => "• " + t.title + (t.due ? " (due " + fmtDate(t.due) + ")" : " (no date)") + (t.status === "doing" ? " [in progress]" : "")).join("\n");
      const stepLine = d.nextStep && !d.nextStepDoneAt ? d.nextStep + (d.nextStepDue ? " (by " + fmtDate(d.nextStepDue) + ")" : "") : "";
      // A long task list needs a long answer — a tight budget truncated the
      // JSON mid-op and looked like "no brain". Budget scales, timeout too.
      const reply = await withTimeout(askClaude(realignSystem(d, comp, stepLine, lines, dealEvidence(d, comp, tasks, touches, commits)),
        [{ role: "user", content: "Realign the tasks." }], { maxTokens: 2000 }), 45000);
      const v = extractMarkedJSON(reply, "REALIGN_JSON");
      if (!v || !Array.isArray(v.ops)) throw new Error("no ops");
      let next = [...tasks];
      const matchIn = (list, title) => { const w = normTitle(title); return list.find((t) => t.status !== "done" && (t.dealId === d.id || (!t.dealId && t.companyId === d.companyId)) && (normTitle(t.title) === w || normTitle(t.title).includes(w) || w.includes(normTitle(t.title)))); };
      let dropped = 0, edited = 0, added = 0;
      for (const op of v.ops.slice(0, 12)) {
        try {
          if (op.op === "drop" && op.task) {
            const t0 = matchIn(next, op.task);
            if (t0 && t0.status !== "doing") { deleteTask(t0.id); next = next.filter((x) => x.id !== t0.id); dropped++; }
          }
          if (op.op === "retitle" && op.task && op.title) {
            const t0 = matchIn(next, op.task);
            if (t0) { next = next.map((x) => (x.id === t0.id ? { ...x, title: String(op.title) } : x)); edited++; }
          }
          if (op.op === "due" && op.task && op.due) {
            const t0 = matchIn(next, op.task);
            if (t0) { next = next.map((x) => (x.id === t0.id ? { ...x, due: String(op.due) } : x)); edited++; }
          }
          if (op.op === "add" && op.title && !openTaskDupe(next, d.companyId, op.title)) {
            next = [{ id: uid(), companyId: d.companyId, dealId: d.id, assignee: d.ownerId || me.id, author: me.id,
              title: String(op.title), details: "From Generate tasks — aligned to the step and the record.", due: op.due || "",
              status: "open", source: "stage", createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...next];
            added++;
          }
        } catch (e) { /* one bad op never sinks the pass */ }
      }
      // the committed step must exist as a task, always
      if (d.nextStep && !d.nextStepDoneAt && !matchIn(next, d.nextStep)) {
        next = [{ id: uid(), companyId: d.companyId, dealId: d.id, assignee: d.nextStepOwner || d.ownerId || me.id, author: me.id,
          title: d.nextStep, details: "From the committed next step — complete it in My Tasks; the AI checks the evidence there.",
          due: d.nextStepDue ? String(d.nextStepDue).slice(0, 10) : "", status: "open", source: "step",
          createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...next];
        added++;
      }
      if (dropped + edited + added > 0) saveTasks(next);
      setRealignNote((v.summary ? v.summary + " — " : "") + (dropped + edited + added === 0 ? "already aligned, nothing to change." : "dropped " + dropped + " · edited " + edited + " · added " + added));
    } catch (e) { setRealignNote("Couldn't realign — try again."); }
    setRealigning(false);
  };

  // The deal's NEXT TASKS: raised by scrums or when the deal reached this
  // stage. They are completed in My Tasks (where the AI checks the evidence),
  // never ticked off here.
  const dealTasks = tasks
    .filter((t) => t.status !== "done" && (t.dealId === d.id || (!t.dealId && t.companyId === d.companyId)))
    .sort((a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : 1)).slice(0, 8);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 overflow-y-auto" onClick={onClose}>
      <div className="max-w-5xl mx-auto my-4 md:my-8 bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3 flex-wrap bg-slate-50/60">
          <div className="min-w-0 mr-auto">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg font-bold text-slate-900 truncate">{comp ? comp.name : "Deal"}</h2>
              <span className="font-mono text-xs text-slate-400">{d.did}</span>
              <Chip color={ph === "won" ? "green" : ph === "lost" ? "slate" : tempColor(d.temperature)}>
                {ph === "won" ? "CLOSED WON" : ph === "lost" ? "CLOSED LOST" : ph.toUpperCase()}
              </Chip>
              {rfqB && <Chip color={rfqB.color}>{rfqB.label}</Chip>}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="font-mono tabular-nums text-slate-600">{fmtINRc(d.value)}</span>
              {/* the owner is always editable, right here */}
              <Sel className="w-36 text-xs py-0.5" value={owner ? owner.id : ""}
                onChange={(e) => e.target.value && patchDeal({ ownerId: e.target.value })}>
                {!owner && <option value="">— assign an owner —</option>}
                {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Sel>
              {comp && comp.city ? <span>· {comp.city}</span> : null}
              {d.createdAt ? <span>· started {fmtDate(d.createdAt)}</span> : null}
            </p>
          </div>
          {comp && <button onClick={() => { onClose(); openCompany(comp.id); }} className="text-xs text-blue-600 hover:underline">open the company →</button>}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>

        <div className="p-6 grid lg:grid-cols-[1fr,21rem] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {/* 1 · WHAT HAPPENED — and, on the last row, what is going on now */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Lbl className="mr-auto">What happened</Lbl>
              {rfqB && rfqB.link && rfqB.link.status !== "submitted" && (
                <button onClick={() => navigator.clipboard?.writeText(rfqUrl(rfqB.link.id))} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Copy size={11} /> copy the RFQ link</button>
              )}
              <button onClick={reassess} disabled={busyTemp} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                {busyTemp ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} reassess the phase
              </button>
            </div>
            <div>
              {story.map((s, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={cls("w-3 h-3 rounded-full border-2 flex-none mt-0.5",
                      s.current ? "bg-blue-500 border-blue-500" : "bg-white border-slate-300")} />
                    {i < story.length - 1 && <span className="w-px flex-1 bg-slate-200 my-0.5" />}
                  </div>
                  <div className="pb-3.5 min-w-0 flex-1 -mt-0.5">
                    <p className="flex items-center gap-2 flex-wrap">
                      <span className={cls("font-bold uppercase tracking-wide text-xs", s.current ? "text-blue-700" : "text-slate-500")}>{s.phase}</span>
                      <span className="text-[11px] font-mono text-slate-400">{s.days}d{s.current ? " · now" : ""}</span>
                      {s.current && d.temperatureWhy && <span className="text-[11px] text-slate-500">— {d.temperatureWhy}</span>}
                    </p>
                    {s.items.map((it, j) => (
                      <p key={j} className="text-xs text-slate-600 mt-1 leading-snug flex gap-1.5"><span className="text-slate-300 flex-none">▸</span><span className="min-w-0">{it}</span></p>
                    ))}
                    {!s.items.length && !s.current && <p className="text-xs text-slate-400 mt-1">nothing on the record from this phase.</p>}
                    {s.why && !s.current && <p className="text-xs text-slate-500 mt-1 leading-snug flex gap-1.5"><span className="text-green-500 flex-none">↳</span><span>moved on{s.ai ? " (AI)" : ""}: {s.why}</span></p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2 · WHAT IS NEXT — the committed step. The chat on the right
             writes and commits steps itself; here it just shows, gets marked
             done with evidence, or edited by hand. */}
          <div className={cls("border rounded-xl p-4",
            ns.key === "overdue" ? "border-red-300 bg-red-50/60" : ns.key === "none" ? "border-amber-300 bg-amber-50/50" : "border-slate-200")}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2">
                <Lbl>Next step</Lbl>
                {/* the step's task carries the status — and the evidence check
                   happens when THAT closes in My Tasks */}
                {stepTask && (
                  <Chip color={stepTask.status === "done" ? "green" : stepTask.status === "doing" ? "blue" : "slate"}>
                    {stepTask.status === "done" ? "task done" : stepTask.status === "doing" ? "task in progress" : "task open"}
                    {stepTask.status === "done" && (stepTask.ai || {}).score != null ? " · " + stepTask.ai.score + "/10" : ""}
                  </Chip>
                )}
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditStep(true)}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Sparkles size={11} /> next prospect steps</button>
              </div>
            </div>
            {ns.key === "overdue" && <p className="text-xs font-bold text-red-700 mt-2 flex items-center gap-1"><AlertTriangle size={12} /> OVERDUE since {fmtDate(d.nextStepDue)}</p>}
            {ns.key === "none" && (drafting
              ? <p className="text-xs text-blue-700 mt-2 leading-relaxed flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> The AI is reading the record and writing the next step — improvise it in the chat on the right.</p>
              : <p className="text-xs text-amber-800 mt-2 leading-relaxed">Nothing committed — tell the chat on the right where this stands and it writes the step itself.</p>)}
            {d.nextStep && !d.nextStepDoneAt && (
              <p className="text-sm text-slate-800 mt-1.5 leading-snug">{d.nextStep}
                {d.nextStepDue && ns.key !== "overdue" && <span className="block text-[11px] font-mono text-slate-500 mt-0.5">by {fmtDate(d.nextStepDue)}</span>}
              </p>
            )}
            {/* the step's tasks live UNDER the step — one unit. Raised by
               scrums or by reaching this stage; completed only in My Tasks. */}
            <div className="mt-3 pt-2.5 border-t border-slate-200/70">
            <div className="flex items-center gap-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mr-auto">Tasks under this step{dealTasks.length ? " · " + dealTasks.length : ""}</p>
              {/* repeatable: every click audits the whole set and realigns it */}
              <button onClick={realignTasks} disabled={realigning}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                {realigning ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Generate tasks
              </button>
            </div>
            {realignNote && <p className="text-[10.5px] text-slate-500 mt-1">{realignNote}</p>}
            <div className="mt-1.5 space-y-1">
              {dealTasks.map((t) => {
                const who = users.find((u) => u.id === t.assignee);
                const late = t.due && t.due < todayStr();
                return (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className={cls("w-1.5 h-1.5 rounded-full flex-none", late ? "bg-red-500" : t.status === "doing" ? "bg-blue-500" : "bg-slate-300")} />
                    <span className="text-[12.5px] text-slate-700 leading-snug mr-auto">{t.title}
                      {t.source === "stage" && <span className="ml-1.5 text-[9.5px] uppercase text-blue-500">stage</span>}
                      {t.source === "scrum" && <span className="ml-1.5 text-[9.5px] uppercase text-purple-500">scrum</span>}
                    </span>
                    {who && who.id !== me.id && <span className="text-[10px] text-slate-400 flex-none">{who.name}</span>}
                    {late && <span className="text-[10px] font-mono font-semibold text-red-600 flex-none">overdue</span>}
                    {/* the date is editable right here */}
                    <input type="date" value={t.due || ""} title="Edit the due date"
                      onChange={(e) => saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, due: e.target.value } : x)))}
                      className={cls("text-[10px] font-mono border border-transparent hover:border-slate-300 focus:border-blue-400 rounded px-0.5 py-0 bg-transparent flex-none w-[7.2rem] cursor-pointer",
                        late ? "text-red-600 font-semibold" : "text-slate-500")} />
                  </div>
                );
              })}
              {!dealTasks.length && <p className="text-xs text-slate-400">Nothing open — the next scrum, the next stage change, or the copilot on the right writes them.</p>}
              <p className="text-[10.5px] text-slate-400 pt-1">Completed only from My Tasks — the AI checks the evidence there, and this list updates itself.</p>
            </div>
            </div>
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        {/* the AI in the room */}
        <DealChat me={me} d={d} comp={comp} data={data} touches={touches} commits={commits} saveDeals={saveDeals} saveTasks={saveTasks} saveCompanies={saveCompanies} />
        </div>

        {editStep && <NextStepModal me={me} d={d} comp={comp} data={data} touches={touches} commits={commits}
          onCommit={(w, dd2) => commitStepWith(w, dd2)} onClose={() => setEditStep(false)} />}

      </div>
    </div>
  );
}

function PipelineView({ me, data, saveDeals, saveCompanies, saveTasks, openCompany }) {
  const { users, companies, deals, gates, rfq } = data;
  const rfqBadge = (d) => { const b = rfqBadgeFor(d, rfq); return b ? <Chip color={b.color}>{b.label}</Chip> : null; };
  const [scope, setScope] = useState(me.role === "agent" ? "mine" : "team");
  const [gate, setGate] = useState(null); // {deal, from, to, mode} — the lost post-mortem
  const [newDeal, setNewDeal] = useState(false);
  const [room, setRoom] = useState(null); // deal id open in the Deal Room
  const [tempMove, setTempMove] = useState(null); // {deal, to} awaiting the why
  const [winning, setWinning] = useState(null);   // deal being closed-won
  const dragId = useRef(null);

  const [view, setView] = useState("board");      // board | list
  const [personF, setPersonF] = useState("all");
  const [companyF, setCompanyF] = useState("all");
  const scopeIds = scope === "mine" ? [me.id]
    : me.role === "dept_head" ? [me.id, ...teamOf(me, users).map((u) => u.id)]
    : users.map((u) => u.id);
  // A deal whose owner left the roster must never vanish — surface it as
  // unassigned (outside "Mine") so someone can claim it in the Deal Room.
  const rosterIds = new Set(users.map((u) => u.id));
  const visible = deals.filter((d) =>
    (scopeIds.includes(d.ownerId) || (scope !== "mine" && !rosterIds.has(d.ownerId)))
    && (personF === "all" || d.ownerId === personF)
    && (companyF === "all" || d.companyId === companyF));
  const phaseOf = (d) => d.lost ? "lost" : d.stage === "po" ? "won" : (d.temperature || "cold");

  const onDrop = (toKey) => {
    const d = deals.find((x) => x.id === dragId.current);
    dragId.current = null;
    if (!d || d.lost || d.stage === "po") return;
    if (phaseOf(d) === toKey) return;
    if (toKey === "lost") { setGate({ deal: d, from: d.stage, to: "lost", mode: "lost" }); return; }
    if (toKey === "won") { setWinning(d); return; }
    setTempMove({ deal: d, to: toKey });
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
        <Btn kind="primary" onClick={() => setNewDeal(true)}><Plus size={15} /> New deal</Btn>
      </div>

      <p className="text-xs text-slate-500 mb-3 flex items-center gap-1.5"><Sparkles size={13} className="text-blue-600" /> Cold → Warm → RFQ → Hot. Drag a card to move it — you will be asked what the client did to earn it. Click a card for the Deal Room.</p>

      {/* the PMS filter bar: view toggle · person · company · count */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
          {[["board", "Board", Columns], ["list", "List", ListTodo]].map(([k, l, I]) => (
            <button key={k} onClick={() => setView(k)} className={cls("px-3 py-1.5 font-medium flex items-center gap-1", view === k ? "bg-blue-600 text-white" : "bg-white text-slate-600")}>
              <I size={12} /> {l}
            </button>
          ))}
        </div>
        <Sel className="w-44" value={personF} onChange={(e) => setPersonF(e.target.value)}>
          <option value="all">All people</option>
          {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Sel>
        <Sel className="w-48" value={companyF} onChange={(e) => setCompanyF(e.target.value)}>
          <option value="all">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Sel>
        <span className="ml-auto text-xs text-slate-500"><b className="text-slate-800 font-mono tabular-nums">{visible.length}</b> deal{visible.length !== 1 ? "s" : ""}</span>
      </div>

      {view === "list" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10.5px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 bg-slate-50/60">
                <th className="py-2.5 px-4">Deal</th><th className="py-2.5 px-4">Company</th>
                <th className="py-2.5 px-4">Phase</th><th className="py-2.5 px-4">Value</th>
                <th className="py-2.5 px-4">Owner</th><th className="py-2.5 px-4">Next step</th>
                <th className="py-2.5 px-4">RFQ</th><th className="py-2.5 px-4">Started</th><th className="py-2.5 px-4">Age</th>
              </tr></thead>
              <tbody>
                {[...visible].sort((a, b) => {
                  const order = { hot: 0, rfq: 1, warm: 2, cold: 3, won: 4, lost: 5 };
                  return (order[phaseOf(a)] ?? 9) - (order[phaseOf(b)] ?? 9) || Number(b.value || 0) - Number(a.value || 0);
                }).map((d) => {
                  const c = companies.find((x) => x.id === d.companyId);
                  const o = users.find((u) => u.id === d.ownerId);
                  const ns = nextStepState(d);
                  const pk = phaseOf(d);
                  return (
                    <tr key={d.id} onClick={() => setRoom(d.id)} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/40 cursor-pointer">
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-500">{d.did}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">{c ? c.name : "?"}</td>
                      <td className="py-2.5 px-4"><Chip color={pk === "won" ? "green" : pk === "lost" ? "slate" : tempColor(d.temperature)}>{pk === "won" ? "WON" : pk === "lost" ? "LOST" : pk.toUpperCase()}</Chip></td>
                      <td className="py-2.5 px-4 font-mono tabular-nums">{fmtINRc(d.value)}</td>
                      <td className="py-2.5 px-4">{o
                        ? <span className="flex items-center gap-1.5"><Avatar name={o.name} size="sm" /><span className="text-xs">{o.name}</span></span>
                        : <span className="text-xs font-semibold text-red-600">unassigned</span>}</td>
                      <td className="py-2.5 px-4 max-w-56">
                        {d.lost || d.stage === "po" ? <span className="text-slate-300 text-xs">—</span>
                          : ns.key === "overdue" ? <span className="text-xs font-semibold text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> overdue {fmtDate(d.nextStepDue)}</span>
                          : ns.key === "none" ? <span className="text-xs text-amber-700">none committed</span>
                          : <span className="text-xs text-slate-600 truncate block">{d.nextStep}{d.nextStepDue ? " · " + fmtDate(d.nextStepDue) : ""}</span>}
                      </td>
                      <td className="py-2.5 px-4">{rfqBadge(d) || <span className="text-slate-300 text-xs">—</span>}</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums">{d.createdAt ? fmtDate(d.createdAt) : "—"}</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-400 tabular-nums">{dealStaleDays(d)}d</td>
                    </tr>
                  );
                })}
                {visible.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sm text-slate-400">No deals match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "board" && (
      <div className="flex gap-3 overflow-x-auto pb-4 items-start">
        {PHASES.map(([key, label, defn]) => {
          const col = visible.filter((d) => phaseOf(d) === key);
          const colVal = col.reduce((sum, d) => sum + Number(d.value || 0), 0);
          return (
            <div key={key} className="w-64 flex-none bg-slate-50 border border-slate-200 rounded-xl"
              onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(key)}>
              <div className={cls("px-3 py-2 border-b rounded-t-xl",
                key === "hot" ? "border-red-200 bg-red-50/60" : key === "rfq" ? "border-purple-200 bg-purple-50/60"
                : key === "warm" ? "border-amber-200 bg-amber-50/60" : key === "won" ? "border-green-200 bg-green-50/60"
                : key === "lost" ? "border-slate-300 bg-slate-100" : "border-slate-200")}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{label}</span>
                  <span className="font-mono text-xs text-slate-400 tabular-nums">{col.length}{colVal > 0 ? " · " + fmtINRc(colVal) : ""}</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{defn}</p>
              </div>
              <div className="p-2 space-y-2 min-h-16">
                {col.map((d) => {
                  const c = companies.find((x) => x.id === d.companyId);
                  const o = users.find((u) => u.id === d.ownerId);
                  const stale = dealStaleDays(d);
                  const ns = nextStepState(d);
                  // RED is the broken commitment first; the stale clock is the fallback signal.
                  const sc = d.lost || ns.key === "overdue" ? "red"
                    : ns.key === "none" || stale >= STALE_AMBER ? "amber" : "green";
                  const compPct = c ? completeness(c) : 0;
                  return (
                    <div key={d.id} draggable={!d.lost && d.stage !== "po"} onDragStart={() => (dragId.current = d.id)}
                      onClick={() => setRoom(d.id)}
                      className={cls("bg-white border rounded-md p-2.5 cursor-grab active:cursor-grabbing border-l-4",
                        sc === "red" ? "border-slate-200 border-l-red-600" : sc === "amber" ? "border-slate-200 border-l-amber-500" : "border-slate-200 border-l-green-500")}>
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={(e) => { e.stopPropagation(); c && openCompany(c.id); }} className="font-medium text-sm text-slate-900 hover:text-blue-700 text-left truncate">{c ? c.name : "?"}</button>
                        <span className="font-mono text-xs text-slate-400 flex-none">{d.did}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="font-mono text-sm tabular-nums text-slate-800">{fmtINRc(d.value)}</span>
                        <span className="flex items-center gap-1.5">
                          {rfqBadge(d)}
                          <span className={cls("flex items-center gap-1 font-mono text-xs tabular-nums", stale >= STALE_RED ? "text-red-600 font-semibold" : stale >= STALE_AMBER ? "text-amber-600" : "text-slate-400")}>
                            <Clock size={11} /> {stale}d
                          </span>
                        </span>
                      </div>
                      {!d.lost && (ns.key === "overdue"
                        ? <p className="mt-1.5 text-[11px] font-semibold text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> committed {fmtDate(d.nextStepDue)} — overdue</p>
                        : ns.key === "none"
                        ? <p className="mt-1.5 text-[11px] text-amber-700">no committed next step</p>
                        : ns.key === "committed"
                        ? <p className="mt-1.5 text-[11px] text-slate-500 truncate">next: {d.nextStep}{d.nextStepDue ? " · " + fmtDate(d.nextStepDue) : ""}</p>
                        : null)}
                      <div className="flex items-center justify-between mt-2">
                        <span className="flex items-center gap-1 text-xs text-slate-500">{o ? <Avatar name={o.name} size="sm" /> : <span className="text-[10px] font-semibold text-red-600 uppercase">unassigned</span>}</span>
                        <div className="flex items-center gap-2">
                          {c && stageIdx(d.stage) >= stageIdx("rfq") && !d.lost && (
                            <button onClick={(e) => { e.stopPropagation(); openCompany(c.id); }} className="text-xs text-blue-600 hover:underline flex items-center gap-0.5" title="RFQ in hand? Apply for the official Project ID — ULM sanctions it."><Rocket size={11} /> Project ID</button>
                          )}
                          {c && compPct < 70 && <span title="Company data incomplete"><AlertTriangle size={13} className="text-red-500" /></span>}
                          {!d.lost && (
                            <button onClick={(e) => { e.stopPropagation(); setGate({ deal: d, from: d.stage, to: "lost", mode: "lost" }); }}
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
      )}

      {gate && gate.mode === "back" && (
        <BackMoveModal gate={gate} onClose={() => setGate(null)} onConfirm={(reason) => applyMove(gate.deal, gate.to, { summary: "Moved back: " + reason })} />
      )}
      {room && <DealRoom me={me} data={data} deal={room} onClose={() => setRoom(null)} saveDeals={saveDeals} saveTasks={saveTasks} saveCompanies={saveCompanies} openCompany={openCompany} />}
      {tempMove && <PhaseMoveChat me={me} move={tempMove} data={data} deals={deals} saveDeals={saveDeals} saveTasks={saveTasks} saveCompanies={saveCompanies} onClose={() => setTempMove(null)} />}
      {winning && <PhaseMoveChat me={me} move={{ deal: winning, to: "won" }} data={data} deals={deals} saveDeals={saveDeals} saveTasks={saveTasks} saveCompanies={saveCompanies} onClose={() => setWinning(null)} />}
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
        {[["kpi", "KPI", TrendingUp], ["training", "Training", GraduationCap], ["worklog", "Work update sheet", ClipboardList], ["ideas", "Ideas & contribution", Lightbulb]].map(([k, l, I]) => (
          <button key={k} onClick={() => setPtab(k)}
            className={cls("flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px", ptab === k ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-slate-500 hover:text-slate-800")}>
            <I size={14} /> {l}
          </button>
        ))}
      </div>

      {ptab === "kpi" && <KpiTab me={me} viewUser={viewUser} data={data} saveKpis={saveKpis} goFix={goFix} />}
      {ptab === "training" && <TrainingTab me={me} viewUser={viewUser} data={data} saveTrainings={saveTrainings} />}
      {ptab === "worklog" && <WorklogTab me={me} viewUser={viewUser} data={data} saveWorklogs={saveWorklogs} />}
      {ptab === "ideas" && <IdeasTab viewUser={viewUser} data={data} />}
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

/* Ideas credited from brainstorming write-ups — per person + across the team
   (the PMS Ideas & contribution tab). */
function IdeasTab({ viewUser, data }) {
  const { companies } = data;
  const [ideas, setIdeas] = useState(null);
  useEffect(() => { let a = true; loadAllIdeas().then((x) => a && setIdeas(x)); return () => { a = false; }; }, []);
  const first = (n) => String(n || "").trim().toLowerCase().split(" ")[0];
  const mineList = (ideas || []).filter((x) => x.authorId === viewUser.id || (x.by && first(x.by) === first(viewUser.name)));
  const compName = (id) => (companies.find((c) => c.id === id) || {}).name || "";
  const IdeaRow = ({ x, showBy }) => (
    <div className="border-l-2 border-purple-300 pl-3 py-1.5">
      <p className="text-sm text-slate-800">{showBy && <Chip color="purple" className="mr-1.5">{x.by || "?"}</Chip>}{x.idea} {x.value && <span className="font-mono text-xs text-purple-600">· {x.value}/5</span>}</p>
      <p className="text-xs text-slate-400 mt-0.5">{[x.why, compName(x.companyId), fmtDate(x.date)].filter(Boolean).join(" · ")}</p>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle><span className="flex items-center gap-2"><Lightbulb size={15} className="text-purple-600" /> {viewUser.name}</span></SectionTitle>
        {ideas === null ? <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
          : mineList.length === 0 ? (
            <div className="text-center py-8">
              <Lightbulb size={28} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">No ideas credited yet</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">Ideas are credited when a client conversation is written up with AI in a company's Client Comms tab — and only when the suggestion actually changed the approach, saved time or money, caught a risk, or lifted quality.</p>
            </div>
          ) : <div className="space-y-1">{mineList.map((x) => <IdeaRow key={x.id} x={x} />)}</div>}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle>Across the team</SectionTitle>
        {ideas === null ? null
          : ideas.length === 0 ? <p className="text-sm text-slate-400">Nothing written up yet.</p>
          : <div className="space-y-1">{ideas.slice(0, 20).map((x) => <IdeaRow key={x.id} x={x} showBy />)}</div>}
      </div>
    </div>
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
  // EVERY person writes the day — admins included. Viewing someone else's
  // page hides the editor, nothing else does.
  const isSelf = viewUser.id === me.id;
  const team = teamOf(me, users);

  const [scoring, setScoring] = useState(false);
  const submit = async () => {
    if (!String(doc || "").trim() || scoring) return;
    setScoring(true);
    // The PMS pattern: submitting runs the AI against your KPI targets and
    // stores the score + feedback with the day. Scoring failure never blocks
    // the log — the entry saves either way.
    let score = null, feedback = "";
    try {
      const t = data.kpis[me.id] || {};
      const sys = [
        "You score a salesperson's daily work update against their KPI targets, 1-10, like a fair but demanding sales head.",
        "THEIR MONTHLY KPI TARGETS: " + JSON.stringify(t),
        "Reward concrete movement (calls made, meetings held, RFQs advanced, blockers cleared, honest lessons). Punish vagueness and activity theatre.",
        "Reply ONLY: SCORE_JSON {\"score\":1-10,\"feedback\":\"two blunt sentences: what aligned with the KPI, what to do differently tomorrow\"}",
      ].join("\n");
      const reply = await askClaude(sys, [{ role: "user", content: doc.trim() }]);
      const v = extractMarkedJSON(reply, "SCORE_JSON");
      if (v && v.score) { score = Number(v.score); feedback = v.feedback || ""; }
    } catch (e) { /* save unscored */ }
    const entry = { id: existing ? existing.id : uid(), userId: me.id, date: today, progress: doc.trim(), score, feedback };
    const next = worklogs.some((w) => w.id === entry.id) ? worklogs.map((w) => (w.id === entry.id ? entry : w)) : [entry, ...worklogs];
    saveWorklogs(next); setScoring(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
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
              {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={13} /> Logged{existing && existing.score ? " · scored" : ""}</span>}
              <Btn kind="primary" disabled={!String(doc || "").trim() || scoring} onClick={submit}>
                {scoring ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {scoring ? "Scoring vs KPI…" : "Submit — AI scores it vs your KPI"}
              </Btn>
            </span>
          </div>
          {existing && existing.score != null && (
            <div className={cls("mt-3 rounded-lg border px-3 py-2 text-sm flex items-start gap-2",
              existing.score >= 7 ? "bg-green-50 border-green-200 text-green-800" : existing.score >= 4 ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-red-50 border-red-200 text-red-800")}>
              <Gauge size={15} className="mt-0.5 flex-none" />
              <span><b className="font-mono">{existing.score}/10</b> vs your KPI — {existing.feedback}</span>
            </div>
          )}
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

/* An if/else contingency, shown as a branch rather than a sentence. Ported
   from the PMS: the point is that a reader can see at a glance that this task
   has a fork in it, and how long they have before the fork matters. */
function ConditionRail({ conditions }) {
  if (!conditions || !conditions.length) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {conditions.map((c, i) => (
        <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs">
          <div className="flex items-start gap-1.5 flex-wrap">
            <Chip color="amber"><GitBranch size={10} /> IF</Chip>
            <span className="text-slate-700 flex-1 min-w-[140px]">{c.if}</span>
          </div>
          <div className="flex items-start gap-1.5 flex-wrap mt-1">
            <Chip color="blue"><ArrowRight size={10} /> THEN</Chip>
            <span className="text-slate-700 flex-1 min-w-[140px]">{c.then}</span>
            {c.timeboxMinutes ? <Chip color="purple"><Clock size={10} /> {c.timeboxMinutes}m</Chip> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── The stand-up that nobody had to type ──────────────────────────────────
   Fireflies sits in the call and writes down what was said. This panel brings
   that in: the day's meetings are listed, and picking one APPENDS its
   transcript to the box.

   Appending, never replacing, is the whole design. A stand-up is usually a
   call plus a few things somebody typed afterwards, and silently eating what
   is already in the box would be the worst possible behaviour here — the
   previous version auto-picked one meeting and overwrote whatever was there. */
/* ── Start the call from here ──────────────────────────────────────────────
   The event is created on the CALLER'S own Google Calendar, so it lands in
   their diary and the invitees see who called it. Ticking the notetaker is
   what makes the transcript come back on its own — which is the whole loop:
   schedule here, talk there, read it in the scrum tomorrow morning.

   Hidden entirely when /api/meet is not configured: an inert button that
   always errors is worse than no button. */
/* ── A feature that exists but is switched off ─────────────────────────────
   Hiding an unconfigured control makes "not set up" and "not built" look
   identical, and the only way to tell them apart is to read the source. So the
   control stays on the page, greyed, wearing its own reason and the fix.

   The rule: never render nothing. Either the working control, or this. */
function OffNotice({ icon: Ic, title, why, fix }) {
  return (
    <div className="border border-dashed border-slate-300 rounded-lg px-3 py-2.5 bg-slate-50/60">
      <div className="flex items-center gap-2 flex-wrap">
        {Ic ? <Ic size={13} className="text-slate-400 flex-none" /> : null}
        <span className="text-[12.5px] font-semibold text-slate-400">{title}</span>
        <Chip color="slate">not configured</Chip>
      </div>
      {why && <p className="text-[11px] text-slate-500 mt-1">{why}</p>}
      {fix && <p className="text-[11px] text-slate-400 mt-0.5">{fix}</p>}
    </div>
  );
}

function ScheduleMeet({ date, users, present, onScheduled }) {
  // Typed: the inferred {connected:boolean} has no notetaker field, and the
  // guest-list line below reads it.
  const [cfg, setCfg] = useState<meet.MeetStatus>({ connected: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("Eb — Daily scrum");
  const [start, setStart] = useState("09:30");
  const [end, setEnd] = useState("10:00");
  const [record, setRecord] = useState(true);

  useEffect(() => { meet.status().then(setCfg).catch(() => {}); }, []);

  if (!cfg.connected) {
    return (
      <OffNotice icon={Video} title="Start a Google Meet"
        why={cfg.reason ? "The scheduler is not connected — " + cfg.reason + "." : "The scheduler is not connected."}
        fix="This uses the PMS's deployed meet function on the shared Supabase project — Sales holds no Google keys for it. If it is failing, check that function's secrets and its Calendar delegation, not Vercel." />
    );
  }

  const invitees = users.filter((u) => u.active !== false && present[u.id] && u.email).map((u) => u.email);

  const go = async () => {
    setBusy(true); setErr("");
    const r = await meet.create({
      date, startTime: start, endTime: end, title,
      attendees: invitees, recordWithFireflies: record,
    });
    if (r.error) { setErr(r.error); setBusy(false); return; }
    onScheduled(r);
    setOpen(false); setBusy(false);
  };

  return (
    <div className="mt-2">
      {!open ? (
        <Btn size="sm" onClick={() => setOpen(true)}><Video size={12} /> Start a Google Meet</Btn>
      ) : (
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" />
          <div className="flex flex-wrap items-center gap-2">
            <Input type="time" className="w-28 font-mono" value={start} onChange={(e) => setStart(e.target.value)} />
            <ArrowRight size={13} className="text-slate-300" />
            <Input type="time" className="w-28 font-mono" value={end} onChange={(e) => setEnd(e.target.value)} />
            <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-1">
              <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
              Invite the notetaker
            </label>
          </div>
          <p className="text-[11px] text-slate-400">
            {invitees.length
              ? invitees.length + " invitee" + (invitees.length === 1 ? "" : "s") + " — whoever is ticked as present above"
              : "Nobody is ticked as present, so nobody will be invited."}
            {record && cfg.notetaker ? " · plus " + cfg.notetaker : ""}
          </p>
          {err && <p className="text-[11px] text-red-600">{err}</p>}
          <div className="flex items-center gap-2">
            <Btn size="sm" kind="primary" disabled={busy} onClick={go}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Create the meeting
            </Btn>
            <Btn size="sm" kind="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Audio from a call the notetaker missed ────────────────────────────────
   A phone call, a laptop recording, a site visit on a handset. The file goes
   into a PRIVATE bucket; playing it back needs a signed link that expires, so
   a leaked path is not a leaked recording.

   Transcription is deliberately a separate, manual step — handing Fireflies a
   signed URL to a client call should be somebody's decision, not a side
   effect of dragging a file in. */
function UploadRecording({ date }) {
  const [on, setOn] = useState(null);          // null = not checked yet
  const [why, setWhy] = useState("");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const refresh = React.useCallback(async (d) => {
    setItems(await recordings.list(d));
  }, []);

  useEffect(() => {
    let alive = true;
    recordings.available().then((r) => {
      if (!alive) return;
      setOn(r.ok); setWhy(r.reason);
      if (r.ok) refresh(date);
    });
    return () => { alive = false; };
  }, [date, refresh]);

  // null = the check has not answered yet; showing a notice then retracting it
  // would flicker. false = genuinely off, and that gets said out loud.
  if (on === null) return null;
  if (on === false) {
    return (
      <OffNotice icon={Mic} title="Upload a recording" why={why}
        fix="For a call the notetaker could not join — a phone call, a laptop recording, a site visit." />
    );
  }

  const pick = async (f) => {
    if (!f) return;
    setBusy(true); setErr("");
    const r = await recordings.upload(f, date);
    if (!r.ok) setErr(r.error || "Upload failed.");
    else await refresh(date);
    setBusy(false);
  };

  const play = async (path) => {
    const url = await recordings.signedUrl(path);
    if (url) window.open(url, "_blank");
    else setErr("Could not sign a link for that file.");
  };

  return (
    <div className="mt-2">
      <input ref={fileRef} type="file" hidden accept="audio/*,video/mp4,video/webm"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="flex items-center gap-2 flex-wrap">
        <Btn size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />} Upload a recording
        </Btn>
        <span className="text-[11px] text-slate-400">Private — playback is a signed link that expires.</span>
      </div>
      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
      {items.length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          {items.map((f) => (
            <div key={f.path} className="flex items-center gap-2 text-xs bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
              <span className="truncate flex-1 text-slate-700">{f.name}</span>
              <span className="text-slate-400 font-mono text-[11px] flex-none">{recordings.humanSize(f.size)}</span>
              <button onClick={() => play(f.path)} className="text-blue-600 hover:underline flex-none">play</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingsPanel({ date, users, present, onUse, onScheduled, usedIds }) {
  const [ff, setFf] = useState<fireflies.FfStatus>({ on: false });
  const [items, setItems] = useState(null);   // null = not looked yet
  const [open, setOpen] = useState(false);    // ODM2's Show / Hide
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { fireflies.status().then(setFf).catch(() => {}); }, []);
  // A new day is a new list — never show yesterday's meetings under today.
  useEffect(() => { setItems(null); setErr(""); }, [date]);

  const look = async () => {
    setBusy(true); setErr("");
    try {
      const { from, to } = fireflies.dayRange(date);
      const list = await fireflies.list(from, to);
      setItems(list);
      if (!list.length) setErr("Fireflies recorded nothing on " + fmtDate(date) + ".");
    } catch (e) { setErr("Could not reach Fireflies."); }
    setBusy(false);
  };

  const use = async (m) => {
    setPulling(m.id); setErr("");
    try {
      const t = await fireflies.transcript(m.id);
      if (t.error) { setErr("Fireflies: " + t.error); setPulling(""); return; }
      if (!String(t.text || "").trim()) { setErr("That meeting has no transcript text yet."); setPulling(""); return; }
      onUse(t.text, m, t.url || "");
    } catch (e) { setErr("Could not read that meeting."); }
    setPulling("");
  };

  /* The panel ALWAYS renders. Which half is switched on is a deployment
     detail, and a reader should be able to see that a feature exists and is
     merely off — not be left guessing whether it was ever built. */
  return (
    <div className="border border-slate-200 rounded-lg p-3 mb-3 bg-slate-50">
      <div className="flex items-center gap-2 flex-wrap">
        <Video size={14} className="text-blue-600" />
        <span className="text-[13px] font-semibold text-slate-700">Meeting transcripts</span>
        <span className="text-[11.5px] text-slate-500">Google Meet, captured by Fireflies</span>
        {usedIds.length > 0 && <Chip color="green">{usedIds.length} pulled in</Chip>}
        <div className="ml-auto flex items-center gap-2">
          {open && ff.on && (
            <Btn size="sm" kind="ghost" disabled={busy} onClick={look}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} {busy ? "Looking…" : "Find meetings"}
            </Btn>
          )}
          <Btn size="sm" kind="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</Btn>
        </div>
      </div>

      {open && (
      <div className="mt-3 flex flex-col gap-2">
      {/* Fireflies: the day's calls, or why there are none to show. */}
      {!ff.on && (
        <OffNotice icon={Sparkles} title="Find recorded meetings"
          why={ff.why ? "Fireflies is not connected — " + ff.why + "." : "Fireflies is not connected."}
          fix="Set FIREFLIES_API_KEY in Vercel. API access needs a paid Fireflies plan." />
      )}
      {ff.on && items !== null && items.length === 0 && !err && (
        <p className="text-[12.5px] text-slate-500">No meetings recorded on {fmtDate(date)}. Fireflies only sees calls it was invited to.</p>
      )}

      {ff.on && items !== null && items.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {items.map((m) => {
            const used = usedIds.includes(m.id);
            return (
              <div key={m.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
                <span className="text-xs text-slate-700 truncate flex-1" title={m.title || "Untitled"}>{m.title || "Untitled call"}</span>
                {m.duration ? <span className="text-[11px] text-slate-400 font-mono flex-none">{Math.round(m.duration)}m</span> : null}
                <Btn size="sm" kind={used ? "ghost" : "primary"} disabled={!!pulling}
                  onClick={() => use(m)} title={used ? "Already added — this will append it again" : "Append this call's transcript"}>
                  {pulling === m.id ? <Loader2 size={11} className="animate-spin" /> : used ? <Check size={11} /> : <Plus size={11} />}
                  {used ? " added" : " use"}
                </Btn>
              </div>
            );
          })}
        </div>
      )}
      {err && <p className="text-[11px] text-amber-600">{err}</p>}
      {ff.on && <p className="text-[11px] text-slate-400">Picking a call adds it to the box below — it never replaces what is already there.</p>}

      {/* Start one, and hand over a recording of one that happened off the
          books. Each says so itself when its backend is not configured. */}
      <UploadRecording date={date} />
      <ScheduleMeet date={date} users={users} present={present} onScheduled={onScheduled} />
      </div>
      )}
    </div>
  );
}

function DailyScrumView({ me, data, saveScrums, saveTasks }) {
  // A scrum line becomes a real task: owner matched to the roster by name
  // (unmatched → the note's author), due = the scrum's date.
  const scrumToTasks = (s) => {
    const { users, tasks } = data;
    const fresh = (s.tasks || []).filter((t) => t.include !== false).map((t) => {
      // Preview edits win over name-matching: assigneeId/start/end may already
      // be set by the "AI organised" card before saving.
      const owner = (t.assigneeId && users.find((u) => u.id === t.assigneeId))
        || users.find((u) => t.owner && u.name.toLowerCase().startsWith(String(t.owner).trim().toLowerCase().split(" ")[0]));
      const win = t.start || t.end ? { start: t.start || "", end: t.end || "" } : parseWin(t.window);
      return {
        id: uid(), companyId: t.companyId || "", dealId: "",
        assignee: owner ? owner.id : s.userId, author: me.id,
        title: t.task,
        details: "",
        // The day the work is FOR, not the day the note was written. This is
        // the whole point of resolving "tomorrow" in the organiser.
        due: t.date || s.date || todayStr(),
        windowStart: win.start, windowEnd: win.end,
        steps: Array.isArray(t.steps) ? t.steps : [],
        conditions: Array.isArray(t.conditions) ? t.conditions : [],
        work: {}, ai: {}, escalated: false, branchedFrom: "",
        status: "open", source: s.source === "transcript" ? "transcript" : "scrum",
        scrumNoteId: s.id, createdAt: nowTS(),
      };
    });
    if (fresh.length) saveTasks([...fresh, ...tasks]);
    return fresh.length;
  };
  return <DailyScrumInner me={me} data={data} saveScrums={saveScrums} scrumToTasks={scrumToTasks} />;
}

function DailyScrumInner({ me, data, saveScrums, scrumToTasks }) {
  const { users, scrums } = data;
  const [date, setDate] = useState(todayStr());
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(null); // AI-organised note awaiting review
  const [mode, setMode] = useState("write");    // write | transcript
  const [link, setLink] = useState(() => (scrums.find((s) => s.link) || {}).link || "");
  const [present, setPresent] = useState({});   // personId -> true
  const [guests, setGuests] = useState([]);
  const [guestName, setGuestName] = useState("");
  const [tr, setTr] = useState("");             // raw transcript
  const [trUrl, setTrUrl] = useState("");
  const trFileRef = useRef(null);
  // Which recorded calls fed this note, so the saved note can point back at
  // the transcripts it came from.
  const [fromMeetings, setFromMeetings] = useState([]);

  /* A pulled call is APPENDED, never a replacement — a stand-up is often a
     call plus a few things somebody typed, and silently eating what was
     already in the box would be the worst possible behaviour here. */
  const useMeeting = useCallback((text, meeting, url) => {
    if (!String(text || "").trim()) return;
    setTr((d) => (d.trim() ? d.trim() + "\n\n" + text : text));
    if (url) setTrUrl((u) => u || url);
    if (meeting?.id) setFromMeetings((m) => (m.includes(meeting.id) ? m : [...m, meeting.id]));
    setMode("transcript");
    setErr("");
  }, []);
  const norm = useMemo(() => normaliseTranscript(tr), [tr]);
  const attendanceObj = () => ({
    present: Object.keys(present).filter((k) => present[k]),
    absent: users.filter((u) => u.active !== false && !present[u.id]).map((u) => u.id),
    guests, markedBy: me.id, markedAt: nowTS(),
  });
  const setPendingTask = (i, patch) => setPending({ ...pending, tasks: pending.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const savePending = (withTasks) => {
    // Unticked rows never become tasks and are not kept on the note — the
    // preview is the last place to say "not that one".
    const kept = (pending.tasks || []).filter((t) => t.include !== false);
    // "Note 1, Note 2…" within the day, so a note has a human reference that
    // survives being one of six written that morning.
    const sameDay = scrums.filter((x) => x.date === pending.date);
    const note = { ...pending, tasks: kept, noteNo: sameDay.length + 1, time: nowHM() };
    note.tasked = withTasks ? scrumToTasks(note) > 0 : false;
    saveScrums([note, ...scrums]);
    setPending(null); setFromMeetings([]); setTr(""); setTrUrl("");
  };
  const speech = useSpeech((t) => setRaw((p) => (p ? p + " " : "") + t));

  const scopeIds = me.role === "admin" ? users.map((u) => u.id)
    : me.role === "dept_head" ? [me.id, ...teamOf(me, users).map((u) => u.id)]
    : [me.id];
  const dayNotes = scrums
    .filter((s) => s.date === date && scopeIds.includes(s.userId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const organise = async () => {
    const text = mode === "transcript" ? norm.text : raw.trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    const { users, companies } = data;
    const system = [
      "You organise a typed/spoken daily sales scrum at Elecbits into clear, assigned, time-boxed tasks. Extract EVERY actionable item — a scrum line with no task extracted is a failure.",
      "TEAM ROSTER (match owners to these people; default owner = the note's author): " + users.filter((u) => u.active !== false).map((u) => u.name).join(", "),
      "COMPANIES with their account owners (match any client mentioned, even loosely — 'Sunrise Company' means 'Sunrise Retail Tech'): " + companies.map((c) => { const o = users.find((u) => u.id === c.accountOwner); return c.name + (o ? " (owner: " + o.name + ")" : ""); }).join(", "),
      "ROLE REFERENCES: 'the account owner' / 'the owner' of a company means that company's owner from the list above — put their actual roster NAME in owner, never the phrase.",
      "TIME WINDOWS: normalise everything to 24h HH:MM. 'by 2pm' / 'before 2' → end 14:00 with empty start. '12 to 1pm' → 12:00–13:00. 'today' with no time → empty window.",
      "WHEN — resolve the day and put it in \"date\" as YYYY-MM-DD. 'today' or no day mentioned = " + date + "; 'tomorrow' = the day after " + date + "; a weekday name = the next such day on or after " + date + ". A note written today can raise work for tomorrow, and the task must land on the day the work is FOR — never on the day the note was written.",
      "STEPS — where the note spells out how something is to be done, break it into short imperative steps. Omit steps entirely for a one-action task; do not pad.",
      "CONDITIONS — capture every if/else contingency as a STRUCTURED row: what the condition is, what to do when it holds, and a timebox in minutes when one is stated ('in an hour' = 60, 'within 30 mins' = 30). Do not bury a contingency in the task text.",
      "Keep task text short and action-first ('Send Sunrise Retail the pilot quote'). Preserve IDs, part numbers and figures verbatim.",
      "Reply with ONLY one line: SCRUM_JSON {\"tasks\":[{\"owner\":\"roster name or empty\",\"task\":\"...\",\"company\":\"exact company name from the list or empty\",\"date\":\"YYYY-MM-DD\",\"start\":\"HH:MM or empty\",\"end\":\"HH:MM or empty\",\"steps\":[\"\"],\"conditions\":[{\"if\":\"\",\"then\":\"\",\"timeboxMinutes\":60}]}],\"summary\":\"one-line summary\"}",
      "Valid JSON. No markdown.",
    ].join("\n");
    try {
      const isTr = mode === "transcript";
      const sys = isTr ? scrumTranscriptSystem(date, users, companies,
        Object.keys(present).filter((k) => present[k]).map((id) => (users.find((u) => u.id === id) || {}).name).filter(Boolean).join(", ")) : system;
      const reply = await askClaude(sys, [{ role: "user", content: text }], { maxTokens: isTr ? 4000 : 1500 });
      const parsed = extractMarkedJSON(reply, "SCRUM_JSON") || {};
      const note = {
        id: uid(), userId: me.id, date,
        raw: mode === "transcript" ? (parsed.summary || "Read from the call transcript.") : text,
        tasks: (Array.isArray(parsed.tasks) ? parsed.tasks : []).map((t) => {
          const owner = users.find((u) => t.owner && u.name.toLowerCase().startsWith(String(t.owner).trim().toLowerCase().split(" ")[0]));
          const comp = matchCompany(t.company, companies) || matchCompany(t.task, companies);
          // "the account owner" without a name resolves to the matched
          // company's owner — never to the note's author by accident.
          const compOwner = comp && !owner && /owner/i.test(String(t.owner || "") + " " + String(t.task || ""))
            ? users.find((u) => u.id === comp.accountOwner) : null;
          const win = t.start || t.end ? { start: t.start || "", end: t.end || "" } : parseWin(t.window);
          const assigneeId = owner ? owner.id : (compOwner ? compOwner.id : me.id);
          return {
            ...t, assigneeId, companyId: comp ? comp.id : "", start: win.start, end: win.end,
            // Every row starts included and can be unticked. Deleting was the
            // only way to drop one before, which is destructive and has no undo.
            include: true,
            // The day the work is FOR. A note written today can raise work for
            // tomorrow; the model resolves it, and this is the floor when it
            // answers with something that is not a date.
            date: isoDay(t.date) || dayFor(String(t.task || ""), date) || date,
            steps: Array.isArray(t.steps) ? t.steps.filter(Boolean) : [],
            // Structured rows. A flat `condition` string from an older note
            // (or an older model reply) is lifted into the same shape so the
            // rail renders one thing, not two.
            conditions: Array.isArray(t.conditions) && t.conditions.length
              ? t.conditions.filter((c) => c && (c.if || c.then))
              : (t.condition ? [{ if: String(t.condition), then: "follow the contingency as written", timeboxMinutes: null }] : []),
            // Assigning work on an account to someone who does not own it is
            // usually a mis-read of "the account owner" — say so before saving.
            offAccount: !!(comp && comp.accountOwner && assigneeId !== comp.accountOwner),
          };
        }),
        summary: parsed.summary || "", createdAt: nowTS(),
        blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        ignored: parsed.ignored || "",
        link, attendance: attendanceObj(),
        source: mode === "transcript" ? "transcript" : "typed",
        origin: fromMeetings.length ? "meeting" : "manual", meetingIds: fromMeetings,
        transcript: mode === "transcript" ? norm.text : "",
        transcriptUrl: mode === "transcript" ? trUrl : "",
      };
      // The PMS preview: adjust assignee + time windows before anything saves.
      setPending(note);
      setRaw("");
    } catch (e) {
      // The AI is unreachable. The person has just typed the day's plan —
      // failing the save loses it. Parse it crudely instead, flag the preview
      // as an offline parse, and let them correct it.
      const fb = fallbackScrum(text, date, users, companies);
      setPending({
        id: uid(), userId: me.id, date, raw: text, engine: "offline",
        tasks: fb.tasks.map((t) => {
          const owner = users.find((u) => t.owner && u.name.toLowerCase().startsWith(String(t.owner).trim().toLowerCase().split(" ")[0]));
          const comp = matchCompany(t.company, companies) || matchCompany(t.task, companies);
          const assigneeId = owner ? owner.id : me.id;
          return { ...t, assigneeId, companyId: comp ? comp.id : "", include: true,
                   offAccount: !!(comp && comp.accountOwner && assigneeId !== comp.accountOwner) };
        }),
        summary: fb.summary, createdAt: nowTS(),
        blockers: [], decisions: [], ignored: "",
        link, attendance: attendanceObj(),
        source: mode === "transcript" ? "transcript" : "typed",
        origin: fromMeetings.length ? "meeting" : "manual", meetingIds: fromMeetings,
        transcript: mode === "transcript" ? norm.text : "",
        transcriptUrl: mode === "transcript" ? trUrl : "",
      });
      setErr("AI unreachable — this is an offline parse. Check every row before saving.");
      setRaw("");
    }
    setBusy(false);
  };

  const saveRawOnly = () => {
    const text = mode === "transcript" ? norm.text : raw.trim();
    if (!text) return;
    saveScrums([{ id: uid(), userId: me.id, date, raw: text, tasks: [], summary: "", createdAt: nowTS() }, ...scrums]);
    setRaw("");
  };
  const remove = (id) => { deleteScrum(id); saveScrums(scrums.filter((s) => s.id !== id)); };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h1 className="text-lg font-semibold mr-auto">Daily Scrum</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " w-auto"} />
      </div>
      <p className="text-sm text-slate-500 mb-4">Write it as it comes — the AI turns it into assigned, time-boxed, if/else-aware tasks.</p>

      {/* the call itself — link, who was on it */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <Lbl>The scrum call</Lbl>
        <div className="flex flex-wrap items-end gap-2 mt-2">
          <div className="flex-1 min-w-[260px]">
            <p className="text-[12.5px] text-slate-700 mb-1.5">Meet link</p>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          </div>
          {/^https?:\/\//.test(link) && <Btn onClick={() => window.open(link, "_blank")}><ExternalLink size={13} /> Join</Btn>}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">Remembered from the last note — same link every morning.</p>
        <div className="mt-3">
          <p className="text-[12.5px] text-slate-700 mb-1.5">Who was on it</p>
          <div className="flex flex-wrap gap-1.5">
            {users.filter((u) => u.active !== false).map((u) => (
              <button key={u.id} onClick={() => setPresent({ ...present, [u.id]: !present[u.id] })}
                className={cls("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  present[u.id] ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-500 border-slate-300 hover:border-blue-400")}>
                {present[u.id] ? "✓ " : ""}{u.name}
              </button>
            ))}
            {guests.map((g, i) => (
              <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 inline-flex items-center gap-1">
                {g}<button onClick={() => setGuests(guests.filter((_, j) => j !== i))} className="hover:text-red-500"><X size={10} /></button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Input className="w-52" value={guestName} onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && guestName.trim()) { setGuests([...guests, guestName.trim()]); setGuestName(""); } }}
              placeholder="guest — client, PMS…" />
            <Btn size="sm" disabled={!guestName.trim()} onClick={() => { setGuests([...guests, guestName.trim()]); setGuestName(""); }}>Add</Btn>
            <button onClick={() => { const all = {}; users.filter((u) => u.active !== false).forEach((u) => (all[u.id] = true)); setPresent(all); }}
              className="text-xs text-blue-600 hover:underline ml-auto">Mark everyone present</button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            {Object.values(present).filter(Boolean).length} of {users.filter((u) => u.active !== false).length} present
            {users.filter((u) => u.active !== false && !present[u.id]).length > 0 &&
              " · absent: " + users.filter((u) => u.active !== false && !present[u.id]).map((u) => u.name).join(", ")}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <CalendarCheck2 size={16} className="text-blue-600" />
          <p className="text-sm font-semibold text-slate-800 mr-auto">{mode === "write" ? "Daily scrum — write it as it comes" : "Read the call"}</p>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
            {[["write", "Write the note"], ["transcript", "Paste the call transcript"]].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} className={cls("px-3 py-1.5 font-medium", mode === k ? "bg-blue-600 text-white" : "bg-white text-slate-600")}>{l}</button>
            ))}
          </div>
        </div>
        <MeetingsPanel date={date} users={users} present={present} onUse={useMeeting} usedIds={fromMeetings}
          onScheduled={(m) => {
            if (m.meetLink) setLink(m.meetLink);
            setErr(m.warning || (m.recording && !m.notetakerInvited
              ? "Meeting created, but the notetaker was dropped from the guest list — this Workspace may block external guests, so the call will not be transcribed."
              : ""));
          }} />
        {mode === "transcript" ? (
          <div className="space-y-2">
            <input ref={trFileRef} type="file" hidden accept=".txt,.vtt,.srt,.md,.json,.csv"
              onChange={(e) => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = () => setTr(String(r.result)); r.readAsText(f); } e.target.value = ""; }} />
            <div className="flex items-center gap-2">
              <Btn size="sm" onClick={() => trFileRef.current?.click()}><Paperclip size={12} /> Upload a file</Btn>
              {tr && <button onClick={() => setTr("")} className="text-xs text-slate-400 hover:text-red-500 ml-auto">clear</button>}
            </div>
            <TA value={tr} onChange={(e) => setTr(e.target.value)} className="min-h-40 font-mono text-xs"
              placeholder="Paste the transcript — Fireflies, Meet captions, a .vtt/.srt file's contents, or what someone typed up. Speaker names help but are not required." />
            <div>
              <p className="text-[12.5px] text-slate-700 mb-1.5">Where it came from</p>
              <Input value={trUrl} onChange={(e) => setTrUrl(e.target.value)} placeholder="https://app.fireflies.ai/view/… — kept as the source of record" />
              <p className="text-[11px] text-slate-400 mt-1">The link alone is not readable by the tool — paste or upload the text as well.</p>
            </div>
            {tr && (
              <p className="text-[11px] text-slate-500 font-mono">
                {norm.words.toLocaleString()} words · {norm.speakers.length || "no"} speaker{norm.speakers.length === 1 ? "" : "s"}
                {norm.speakers.length > 0 && " (" + norm.speakers.slice(0, 6).join(", ") + ")"}
                {norm.chars > 60000 && <span className="text-amber-600"> · very long — the reader may miss the tail</span>}
              </p>
            )}
          </div>
        ) : (
        <TA value={raw} onChange={(e) => setRaw(e.target.value)} className="min-h-32"
          placeholder={speech.on ? "Listening… speak the scrum" : SCRUM_PLACEHOLDER} />
        )}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Btn kind="primary" disabled={busy || !(mode === "transcript" ? tr.trim() : raw.trim())} onClick={organise}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {mode === "transcript" ? " Read the call and pull out the tasks" : " Organise with AI"}
          </Btn>
          {speech.supported && <Btn kind={speech.on ? "danger" : "ghost"} onClick={speech.toggle}>{speech.on ? <MicOff size={14} /> : <Mic size={14} />}</Btn>}
          <Btn kind="ghost" disabled={busy || !(mode === "transcript" ? tr.trim() : raw.trim())} onClick={saveRawOnly}>
            {mode === "transcript" ? "Save transcript only" : "Save raw note"}
          </Btn>
          <span className="text-xs text-slate-400 ml-auto">Mention project ID, people, time windows and any if/else.</span>
        </div>
        {busy && (
          <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
            <Loader2 size={13} className="animate-spin" />
            Splitting the note into tasks, matching people and companies, resolving days and extracting contingencies…
          </div>
        )}
        {err && <p className="text-xs text-red-600 mt-2 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</p>}

        {pending && (
          <div className="mt-4 border-t border-dashed border-slate-200 pt-4">
            <p className="text-xs mb-2">
              {pending.engine === "offline"
                ? <Chip color="amber"><AlertTriangle size={10} /> Offline parse — review carefully</Chip>
                : <Chip color="purple">AI organised</Chip>}
              <span className="text-slate-500 italic ml-1">{pending.summary}</span></p>
            {pending.ignored && <p className="text-[11px] text-slate-400 mb-2">Left out: {pending.ignored}</p>}
            {(pending.blockers || []).length > 0 && (
              <p className="text-[11px] text-red-600 mb-2">Blockers raised: {pending.blockers.map((b) => b.what + (b.who ? " (" + b.who + ")" : "")).join(" · ")}</p>
            )}
            <div className="space-y-2">
              {pending.tasks.map((t, i) => (
                <div key={i} className={cls("border border-slate-200 rounded-lg p-3 flex items-start gap-2.5",
                  t.include === false && "opacity-45")}>
                  {/* Untick to leave a row out. Deleting is still there, but
                      unticking is reversible and this is a review step. */}
                  <input type="checkbox" checked={t.include !== false} className="mt-1 flex-none"
                    onChange={(e) => setPendingTask(i, { include: e.target.checked })}
                    aria-label={"Include: " + t.task} />
                  <div className="flex-1 min-w-0">
                    <Input className="font-medium mb-2" value={t.task}
                      onChange={(e) => setPendingTask(i, { task: e.target.value })} />
                    {t.agreed === false && <span className="text-[10px] text-amber-600 uppercase">not accepted in the call</span>}
                    {t.said && <p className="text-[11px] text-slate-400 italic mb-2 border-l-2 border-slate-200 pl-2">“{t.said}”</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <Sel className="w-40" value={t.assigneeId} onChange={(e) => setPendingTask(i, { assigneeId: e.target.value })}>
                        {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </Sel>
                      <Sel className="w-44" value={t.companyId || ""} onChange={(e) => setPendingTask(i, { companyId: e.target.value })}>
                        <option value="">— no company —</option>
                        {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Sel>
                      {/* The day the work is FOR. A note written today can
                          raise work for tomorrow, and that has to be visible
                          and correctable before it is saved. */}
                      <Input type="date" className="w-36 font-mono" value={t.date || date}
                        onChange={(e) => setPendingTask(i, { date: e.target.value })} />
                      <Input type="time" className="w-28 font-mono" value={t.start || ""} onChange={(e) => setPendingTask(i, { start: e.target.value })} />
                      <ArrowRight size={13} className="text-slate-300" />
                      <Input type="time" className="w-28 font-mono" value={t.end || ""} onChange={(e) => setPendingTask(i, { end: e.target.value })} />
                      <button onClick={() => setPending({ ...pending, tasks: pending.tasks.filter((_, j) => j !== i) })}
                        className="text-slate-300 hover:text-red-500 ml-auto" title="Remove this row"><Trash2 size={13} /></button>
                    </div>
                    {t.offAccount && (
                      <p className="mt-1.5 text-[11px] text-amber-600 flex items-center gap-1.5">
                        <AlertTriangle size={11} />
                        {(users.find((u) => u.id === t.assigneeId) || {}).name || "That person"} does not own{" "}
                        {(data.companies.find((c) => c.id === t.companyId) || {}).name || "this account"} — check this is who you meant.
                      </p>
                    )}
                    {t.date && t.date !== date && (
                      <p className="mt-1 text-[11px] text-slate-500">Scheduled for {fmtDate(t.date)}, not the note's day.</p>
                    )}
                    {(t.steps || []).length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {t.steps.map((st, si) => (
                          <div key={si} className="text-xs text-slate-600 flex gap-2">
                            <span className="text-slate-400 font-mono text-[11px]">{si + 1}.</span>{st}
                          </div>
                        ))}
                      </div>
                    )}
                    <ConditionRail conditions={t.conditions} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Btn onClick={() => savePending(false)}>Save note only</Btn>
              <Btn kind="primary" disabled={pending.tasks.filter((t) => t.include !== false).length === 0}
                onClick={() => savePending(true)}><ListTodo size={14} /> Save note + create {pending.tasks.filter((t) => t.include !== false).length} task{pending.tasks.filter((t) => t.include !== false).length === 1 ? "" : "s"}</Btn>
              <Btn kind="ghost" onClick={() => setPending(null)}>Discard</Btn>
            </div>
          </div>
        )}
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
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {/* "Note 1, Note 2…" within the day — the reference people
                      actually use when a morning produced six of them. */}
                  {s.noteNo ? <span className="font-semibold text-sm text-slate-900">Note {s.noteNo}</span> : null}
                  <span className="font-mono text-xs text-slate-400">{s.time || new Date(s.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                  <Chip color="slate">{by ? by.name : "?"}</Chip>
                  {(() => { const n = (s.tasks || []).filter((t) => t.include !== false).length;
                    return n > 0 ? <Chip color="blue">{n} task{n === 1 ? "" : "s"}</Chip> : <Chip color="slate">raw note</Chip>; })()}
                  {s.engine === "offline" && <Chip color="amber"><AlertTriangle size={10} /> offline parse</Chip>}
                  {s.source === "transcript" && <Chip color="purple">from the call</Chip>}
                  {s.attendance && (s.attendance.present || []).length > 0 && (
                    <span className="text-[11px] text-slate-400">{s.attendance.present.length} on the call</span>
                  )}
                  {s.transcriptUrl && <a href={s.transcriptUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline">transcript ↗</a>}
                  {(me.role === "admin" || s.userId === me.id) && (
                    <button onClick={() => remove(s.id)} className="ml-auto text-slate-400 hover:text-red-600" title="Delete"><Trash2 size={13} /></button>
                  )}
                </div>
                {s.tasks && s.tasks.length > 0 ? (
                  <div className="space-y-2">
                    {s.summary && <p className="text-xs text-slate-500 italic">{s.summary}</p>}
                    {s.tasks.filter((t) => t.include !== false).map((t, i) => {
                      const owner = users.find((u) => u.id === t.assigneeId);
                      const comp = data.companies.find((c) => c.id === t.companyId);
                      // The day the work is FOR. Shown only when it differs
                      // from the note's own day — otherwise it is noise, and
                      // when it differs it is the single most important thing
                      // on the row.
                      const otherDay = t.date && t.date !== s.date;
                      const win = t.start || t.end
                        ? (t.start || "") + "–" + (t.end || "")
                        : (t.window || "");
                      return (
                        <div key={i} className="flex items-start gap-2 text-sm flex-wrap">
                          <span className="font-mono text-[10.5px] text-slate-400 mt-1 flex-none">{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-slate-800 flex-1 min-w-[160px]">{t.task}</span>
                          <span className="inline-flex flex-wrap gap-1.5 items-center">
                            {(owner || t.owner) && <Chip color="blue">{owner ? owner.name : t.owner}</Chip>}
                            {comp && <Chip color="slate">{comp.name}</Chip>}
                            {otherDay && <Chip color="purple"><CalendarCheck2 size={10} /> {fmtDate(t.date)}</Chip>}
                            {win && <Chip color="slate"><Clock size={10} /> {win}</Chip>}
                            {(t.conditions || []).length > 0 &&
                              <Chip color="amber"><GitBranch size={10} /> {t.conditions.length} if/else</Chip>}
                            {(t.steps || []).length > 0 &&
                              <Chip color="slate"><ListTodo size={10} /> {t.steps.length} step{t.steps.length === 1 ? "" : "s"}</Chip>}
                          </span>
                          {(t.conditions || []).length > 0 && (
                            <div className="w-full pl-6"><ConditionRail conditions={t.conditions} /></div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-3 mt-1">
                      {s.tasked
                        ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} /> in My Tasks</span>
                        : <Btn size="sm" onClick={() => { const n = scrumToTasks(s); if (n) saveScrums(scrums.map((x) => x.id === s.id ? { ...x, tasked: true } : x)); }}><ListTodo size={12} /> Send to My Tasks</Btn>}
                      <details>
                        <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">Original note</summary>
                        <p className="text-xs text-slate-500 whitespace-pre-wrap mt-1">{s.raw}</p>
                      </details>
                    </div>
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

function AssistantView({ me, data, saveTasks, saveCompanies, saveDeals, saveMemory, saveScrums }) {
  const { users, companies, deals, kpis, memory, tasks, scrums } = data;
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [date, setDate] = useState(todayStr());
  const [dates, setDates] = useState([]);
  const bodyRef = useRef(null);
  const speech = useSpeech((t) => setInput((p) => (p ? p + " " : "") + t));

  // Date-wise threads: each day is its own saved conversation, like the PMS.
  useEffect(() => {
    let alive = true;
    loadChat(me.id, date).then((m) => { if (alive) setMsgs(m); });
    loadChatDates(me.id).then((d) => { if (alive) setDates(d); });
    return () => { alive = false; };
  }, [me.id, date]);
  const persist = (m) => { setMsgs(m); saveChat(me.id, date, m).catch(() => {}); };

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
      "YOU RUN THE WHOLE TOOL. When the user asks you to DO something, do it by ending your reply with one line: ACTIONS_JSON [ ... ] where each action is one of:",
      "{\"type\":\"task\",\"title\":\"...\",\"company\":\"name or empty\",\"assignee\":\"name or empty\",\"due\":\"YYYY-MM-DD or empty\"} · {\"type\":\"company\",\"name\":\"...\",\"industry\":\"\",\"city\":\"\",\"contact\":\"\"} · {\"type\":\"deal\",\"company\":\"existing company name\",\"value\":0,\"owner\":\"name or empty\"} · {\"type\":\"memory\",\"title\":\"...\",\"text\":\"...\"} · {\"type\":\"scrum\",\"text\":\"the scrum note to file for today\"}",
      "Confirm in plain words what you did BEFORE the ACTIONS_JSON line. Never invent companies for tasks — leave company empty if unsure.",
      "GOOGLE DRIVE: you CAN read the sales Drive (folders and file listings — names, dates, links; not file contents yet).",
      "To look something up, reply with ONLY one line and nothing else: DRIVE_JSON {\"action\":\"root\"} to list the top-level folders · DRIVE_JSON {\"action\":\"list\",\"name\":\"<exact folder name>\"} for a folder's files · DRIVE_JSON {\"action\":\"search\",\"q\":\"<term>\"} to find files by name.",
      "You'll get the listing back as data and can then answer, citing file names and links. Company folders are named '<client-ID> — <company name>'.",
    ].join("\n\n");
  };

  const [atts, setAtts] = useState([]);
  const fileRef = useRef(null);
  const addFiles = (files) => { [...files].forEach((f) => fileToBlock(f).then((b) => b && setAtts((a) => [...a, b]))); };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].map((it) => it.getAsFile && it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !atts.length) || busy) return;
    setInput(""); setErr("");
    const content = atts.length
      ? [...atts.map(({ _name, ...b }) => b), { type: "text", text: text || "See the attached file." }]
      : text;
    const display = (text || "") + (atts.length ? "\n" + atts.map((a) => "📎 " + a._name).join("  ") : "");
    setAtts([]);
    const next = [...msgs, { role: "user", content, display }];
    setMsgs(next); setBusy(true);
    try {
      const convo = next.map((m) => ({ role: m.role, content: m.content }));
      let { reply, notes } = await askWithDrive(buildSystem(), convo);
      // Agentic: execute any actions the model returned, then confirm.
      const actions = extractMarkedJSON(reply, "ACTIONS_JSON");
      let doneNote = "";
      if (Array.isArray(actions) && actions.length) {
        const byName = (n, list, key = "name") => list.find((x) => n && String(x[key] || "").toLowerCase().startsWith(String(n).trim().toLowerCase().split(" ")[0]));
        const results = [];
        let nextTasks = [...tasks], nextCompanies = [...companies], nextDeals = [...deals], nextMemory = [...memory], nextScrums = [...scrums];
        for (const a of actions) {
          try {
            if (a.type === "task" && a.title) {
              const comp = byName(a.company, nextCompanies) || matchCompany(a.title, nextCompanies);
              const who = byName(a.assignee, users) || me;
              if (!openTaskDupe(nextTasks, comp ? comp.id : "", a.title))
                nextTasks = [{ id: uid(), companyId: comp ? comp.id : "", dealId: "", assignee: who.id, author: me.id, title: a.title, details: "Via Assistant", due: a.due || localISO(new Date(Date.now() + 86400000)), status: "open", source: "chat", createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...nextTasks];
              results.push("✓ task: " + a.title + (who ? " → " + who.name : ""));
            } else if (a.type === "company" && a.name && !byName(a.name, nextCompanies)) {
              nextCompanies = [{ id: uid(), cid: nextSeq(nextCompanies, "cid", "EB-C-"), name: a.name, contactPerson: a.contact || "", designation: "", phone: "", email: "", city: a.city || "", industry: a.industry || "", whatTheyDo: "", source: "Assistant", potential: 0, website: "", address: "", accountOwner: me.id, createdBy: me.id, createdAt: nowTS(), custom: [], activity: [{ at: nowTS(), by: me.id, text: "Company created via Assistant." }] }, ...nextCompanies];
              results.push("✓ company: " + a.name);
            } else if (a.type === "deal" && a.company) {
              const comp = byName(a.company, nextCompanies);
              if (comp) {
                const owner = byName(a.owner, users) || me;
                nextDeals = [{ id: uid(), did: nextSeq(nextDeals, "did", "EB-D-"), companyId: comp.id, ownerId: owner.id, value: Number(a.value || 0), stage: "lead", createdAt: nowTS(), updatedAt: nowTS(), lost: false, history: [{ from: null, to: "lead", at: nowTS(), by: me.id, summary: "Deal created via Assistant." }] }, ...nextDeals];
                results.push("✓ deal on " + comp.name);
              }
            } else if (a.type === "memory" && a.text) {
              nextMemory = [{ id: uid(), title: a.title || "Note", text: a.text, updatedAt: nowTS(), by: me.id }, ...nextMemory];
              results.push("✓ remembered: " + (a.title || a.text.slice(0, 40)));
            } else if (a.type === "scrum" && a.text) {
              nextScrums = [{ id: uid(), userId: me.id, date: todayStr(), raw: a.text, tasks: [], summary: "", tasked: false, createdAt: nowTS() }, ...nextScrums];
              results.push("✓ scrum note filed for today");
            }
          } catch (e) { /* skip bad action */ }
        }
        if (nextTasks !== tasks) saveTasks(nextTasks);
        if (nextCompanies !== companies) saveCompanies(nextCompanies);
        if (nextDeals !== deals) saveDeals(nextDeals);
        if (nextMemory !== memory) saveMemory(nextMemory);
        if (nextScrums !== scrums) saveScrums(nextScrums);
        doneNote = results.length ? "\n\n" + results.join("\n") : "";
      }
      const shown = stripToolLines(reply)
        + (notes.length ? "\n\n" + notes.map((n) => "🔎 " + n).join("\n") : "")
        + doneNote;
      persist([...next, { role: "assistant", content: shown, at: nowTS() }]);
    } catch (e) { setErr("AI call failed — try again."); setInput(text); setMsgs(msgs); }
    setBusy(false);
  };

  const suggestions = [
    "Create a task: follow up with Sunrise Retail tomorrow about the pilot",
    "Add company Acme Devices, Bengaluru, consumer IoT",
    "What files are in the Sunrise Retail folder?",
    "Remember: quotes are valid 30 days, 50% advance with PO",
    "Which deals are stuck the longest?",
    "Who on the team is behind and why?",
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-lg font-semibold mr-auto flex items-center gap-2"><Bot size={18} className="text-blue-600" /> Assistant</h1>
        <Chip color="blue"><Sparkles size={11} /> Runs the whole tool</Chip>
        <Chip color="green"><Database size={11} /> Reads the workspace</Chip>
        <Chip color="blue"><FolderOpen size={11} /> Reads Google Drive</Chip>
        <Sel className="w-auto text-xs" value={date} onChange={(e) => setDate(e.target.value)} title="Chats are saved per day — browse any earlier day">
          {[todayStr(), ...dates.filter((d) => d !== todayStr())].map((d) => (
            <option key={d} value={d}>{d === todayStr() ? "Today" : fmtDate(d)}</option>
          ))}
        </Sel>
      </div>
      <p className="text-sm text-slate-500 mb-4">Say it in plain words — it adds companies, raises tasks, starts deals, files the scrum, remembers, and reads the Drive. Answers come from live workspace data and system memory.</p>

      <div className="bg-white border border-slate-200 rounded-xl flex flex-col">
        <div ref={bodyRef} className="h-[28rem] overflow-y-auto p-4 space-y-3">
          {msgs.length === 0 && (
            <div className="text-sm">
              <p className="text-slate-700 leading-relaxed max-w-2xl">Hi {me.name.split(" ")[0]} — write it the way you'd say it out loud. I'll add companies, raise tasks, start deals, file today's scrum, remember what you tell me, and read the sales Drive. Everything we say here is kept day by day.</p>
              <div className="flex flex-col items-start gap-1.5 mt-4">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => setInput(s)} className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:border-blue-400 hover:text-blue-700 transition-colors">{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cls("max-w-lg rounded-lg px-3 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-50 border border-slate-200 text-slate-800")}>{m.display || contentText(m.content)}</div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-slate-400 font-mono"><Loader2 size={13} className="animate-spin" /> thinking…</div>}
          {err && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={13} /> {err}</p>}
        </div>
        <div className="border-t border-slate-200 p-3">
          <AttachChips atts={atts} setAtts={setAtts} />
          <div className="flex gap-2 items-end">
            <input ref={fileRef} type="file" hidden multiple accept="image/*,application/pdf" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <Btn kind="ghost" title="Attach an image or PDF — or just paste a screenshot" onClick={() => fileRef.current?.click()}><Paperclip size={15} /></Btn>
            <TA value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste}
              placeholder={speech.on ? "Listening…" : "Ask, or paste a screenshot — e.g. a client's mail or an RFQ page"}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} className="flex-1 min-h-10" />
            {speech.supported && <Btn kind={speech.on ? "danger" : "ghost"} onClick={speech.toggle}>{speech.on ? <MicOff size={15} /> : <Mic size={15} />}</Btn>}
            <Btn kind="primary" disabled={busy || (!input.trim() && !atts.length)} onClick={send}><Send size={15} /></Btn>
          </div>
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

/* ============================================================
   GOOGLE DRIVE — one folder per company under the shared root
   ============================================================ */


function DriveCard({ company }) {
  const [state, setState] = useState({ phase: "loading" }); // loading | off | ready | error
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await drive.status();
        if (!alive) return;
        if (!s.connected) { setState({ phase: "off", email: s.email }); return; }
        const l = await drive.list(driveFolderName(company));
        if (!alive) return;
        setState(l.error ? { phase: "error", msg: l.error } : { phase: "ready", ...l });
      } catch (e) { if (alive) setState({ phase: "error", msg: "Drive check failed — is the app deployed on Vercel?" }); }
    })();
    return () => { alive = false; };
  }, [company.id]);

  const open = async () => {
    setOpening(true);
    try {
      const r = await drive.open(driveFolderName(company));
      if (r.link) window.open(r.link, "_blank");
      else setState({ phase: "error", msg: r.error || "Could not open folder" });
    } catch (e) { setState({ phase: "error", msg: "Could not reach /api/drive" }); }
    setOpening(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <SectionTitle right={state.phase === "ready" || state.phase === "error" ? (
        <Btn size="sm" kind="primary" disabled={opening} onClick={open}>
          {opening ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />} Open Drive folder
        </Btn>) : null}>Documents — Google Drive</SectionTitle>
      {state.phase === "loading" && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking Drive…</p>}
      {state.phase === "off" && (
        <p className="text-sm text-slate-500">Google Drive is <span className="font-medium text-slate-700">not connected</span>. An admin adds two Vercel env vars — <span className="font-mono text-xs">GOOGLE_SERVICE_ACCOUNT_JSON</span> and <span className="font-mono text-xs">DRIVE_ROOT_FOLDER_ID</span> — and every company gets its own folder here (RFQs, quotes, drawings).</p>
      )}
      {state.phase === "error" && <p className="text-sm text-red-600 flex items-start gap-1.5"><AlertCircle size={14} className="mt-0.5 flex-none" /> {state.msg}</p>}
      {state.phase === "ready" && (
        (state.files || []).length === 0
          ? <p className="text-sm text-slate-400">Folder is empty (or not created yet — “Open Drive folder” creates it). Drop RFQs, drawings and quotes there; they'll list here.</p>
          : <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
              {state.files.map((f) => (
                <a key={f.id} href={f.link} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover:bg-slate-50 border border-transparent hover:border-slate-200">
                  <FileText size={14} className="text-slate-400 flex-none" />
                  <span className="truncate text-slate-700">{f.name}</span>
                  <span className="ml-auto text-xs text-slate-400 flex-none">{fmtDate(f.modified)}</span>
                  <ExternalLink size={12} className="text-slate-300 flex-none" />
                </a>
              ))}
            </div>
      )}
    </div>
  );
}

/* ============================================================
   COMPANY ASSISTANT — trainable questions + chat → notes & tasks
   ============================================================ */

/* WORK CHAT LOGS — the sidebar view: the same date-wise log, across EVERY
   client, filterable by company and person. Read-only; click through to the
   company for the full workspace. */
function WorkChatLogsView({ me, data, openCompany }) {
  const { users, companies } = data;
  const [rows, setRows] = useState(null);
  const [companyF, setCompanyF] = useState("all");
  const [personF, setPersonF] = useState("all");
  const [dateF, setDateF] = useState("");
  const [open, setOpen] = useState({});
  useEffect(() => { let a = true; loadAllClientLogs().then((x) => a && setRows(x)); return () => { a = false; }; }, []);
  const list = (rows || []).filter((r) =>
    (companyF === "all" || r.orgId === companyF)
    && (personF === "all" || r.personId === personF)
    && (!dateF || r.date === dateF));
  const nPeople = new Set(list.map((r) => r.personId)).size;
  const nComps = new Set(list.map((r) => r.orgId)).size;
  const nConvos = list.reduce((s, r) => s + r.messages.length, 0);
  const filtered = companyF !== "all" || personF !== "all" || !!dateF;
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2"><BookOpen size={18} className="text-blue-600" /> Work Chat Logs</h1>
        <p className="text-xs text-slate-500 mt-0.5">Every AI conversation about every client — who is working with the copilot, on which deal and step, day by day.</p>
      </div>
      {/* the ODM filter card: company · person · date · clear, counts right */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 mb-4 flex flex-wrap items-center gap-2.5">
        <Sel className="w-48" value={companyF} onChange={(e) => setCompanyF(e.target.value)}>
          <option value="all">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Sel>
        <Sel className="w-40" value={personF} onChange={(e) => setPersonF(e.target.value)}>
          <option value="all">Everyone</option>
          {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Sel>
        <Input type="date" className="w-40" value={dateF} onChange={(e) => setDateF(e.target.value)} />
        {filtered && <Btn size="sm" onClick={() => { setCompanyF("all"); setPersonF("all"); setDateF(""); }}>Clear</Btn>}
        <span className="ml-auto text-xs text-slate-400">
          <b className="text-slate-700 font-mono tabular-nums">{nConvos}</b> conversations · <b className="text-slate-700 font-mono tabular-nums">{nPeople}</b> people · <b className="text-slate-700 font-mono tabular-nums">{nComps}</b> companies
        </span>
      </div>
      {rows === null && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> loading the logs…</p>}
      {rows && !list.length && (
        <div className="bg-white border border-slate-200 rounded-xl">
          <div className="border border-dashed border-slate-200 rounded-xl m-4 py-14 text-center">
            <BookOpen size={30} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-semibold text-slate-700">No work chats {filtered ? "match these filters" : "yet"}</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
              {filtered ? "Widen the date or drop a filter — the log keeps everything." : "Conversations start in a deal room, a stage gate or Ask the AI — they show up here the moment somebody talks to the copilot."}
            </p>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {list.map((day, i) => {
          const who = users.find((u) => u.id === day.personId);
          const comp = companies.find((c) => c.id === day.orgId);
          const key = day.date + "|" + day.personId + "|" + day.orgId;
          const isOpen = open[key] !== undefined ? open[key] : i === 0;
          return (
            <div key={key} className="bg-white border border-slate-200 rounded-xl">
              <button onClick={() => setOpen({ ...open, [key]: !isOpen })} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50/60 rounded-xl">
                <span className="font-mono text-xs text-slate-500 flex-none">{fmtDate(day.date)}</span>
                {comp && <span onClick={(e) => { e.stopPropagation(); openCompany(comp.id); }} className="text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline cursor-pointer">{comp.name}</span>}
                {who && <span className="text-xs text-slate-600 flex items-center gap-1.5"><Avatar name={who.name} size="sm" /> {who.name}</span>}
                <span className="text-[11px] text-slate-400 mr-auto">{day.messages.length} entr{day.messages.length === 1 ? "y" : "ies"}</span>
                <ChevronRight size={13} className={cls("text-slate-400 transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="px-4 pb-3 pt-2 space-y-1.5 border-t border-slate-100 max-h-96 overflow-y-auto">
                  {day.messages.map((m, j) => {
                    const blockImgs = Array.isArray(m.content)
                      ? m.content.filter((b) => b && b.type === "image" && b.source && b.source.data)
                          .map((b) => "data:" + (b.source.media_type || "image/png") + ";base64," + b.source.data)
                      : [];
                    const imgs = [...(m.images || []), ...blockImgs].slice(0, 4);
                    return (
                      <div key={j} className="text-[12px] leading-snug">
                        {m.kind && <span className="text-[9px] font-bold uppercase tracking-wide text-purple-500 mr-1.5">{m.kind}</span>}
                        <span className={cls("text-[9.5px] font-bold uppercase mr-1.5", m.role === "user" ? "text-blue-600" : "text-slate-400")}>{m.role === "user" ? (who ? who.name.split(" ")[0] : "user") : "ai"}</span>
                        <span className="text-slate-700 whitespace-pre-wrap">{typeof m.content === "string" ? m.content : (m.display || (imgs.length ? "" : "📎 attachment"))}</span>
                        {imgs.length > 0 && (
                          <span className="flex gap-1.5 mt-1 flex-wrap">
                            {imgs.map((src, k) => (
                              <a key={k} href={src} target="_blank" rel="noreferrer">
                                <img src={src} alt="attachment" className="h-20 rounded-md border border-slate-200 object-cover hover:opacity-90" />
                              </a>
                            ))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* THE WORK CHAT LOG — every AI conversation about this client, date-wise:
   deal copilot, stage gates, Ask-the-AI. Read-only history; latest day open. */
function WorkLogCard({ company: c, users }) {
  const [log, setLog] = useState(null);
  const [open, setOpen] = useState({});
  useEffect(() => { let a = true; loadClientLog(c.id).then((x) => a && setLog(x)); return () => { a = false; }; }, [c.id]);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
      <SectionTitle right={<span className="text-xs text-slate-400">every AI conversation about {c.name}, date-wise</span>}>Work chat log</SectionTitle>
      {log === null && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> loading…</p>}
      {log && !log.length && <p className="text-xs text-slate-400">Nothing logged yet — deal chats, stage gates and Ask-the-AI conversations all land here as they happen.</p>}
      <div className="space-y-2">
        {(log || []).map((day, i) => {
          const who = users.find((u) => u.id === day.personId);
          const key = day.date + "|" + day.personId;
          const isOpen = open[key] !== undefined ? open[key] : i === 0;
          return (
            <div key={key} className="border border-slate-200 rounded-lg">
              <button onClick={() => setOpen({ ...open, [key]: !isOpen })} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50/60">
                <span className="font-mono text-xs text-slate-500 flex-none">{fmtDate(day.date)}</span>
                {who && <span className="text-xs font-medium text-slate-700 flex items-center gap-1.5"><Avatar name={who.name} size="sm" /> {who.name}</span>}
                <span className="text-[11px] text-slate-400 mr-auto">{day.messages.length} entr{day.messages.length === 1 ? "y" : "ies"}</span>
                <ChevronRight size={13} className={cls("text-slate-400 transition-transform", isOpen && "rotate-90")} />
              </button>
              {isOpen && (
                <div className="px-3 pb-2.5 pt-2 space-y-1.5 border-t border-slate-100 max-h-96 overflow-y-auto">
                  {day.messages.map((m, j) => {
                    // Older Ask-the-AI rows store raw content blocks — pull the
                    // pictures out of those too.
                    const blockImgs = Array.isArray(m.content)
                      ? m.content.filter((b) => b && b.type === "image" && b.source && b.source.data)
                          .map((b) => "data:" + (b.source.media_type || "image/png") + ";base64," + b.source.data)
                      : [];
                    const imgs = [...(m.images || []), ...blockImgs].slice(0, 4);
                    return (
                      <div key={j} className="text-[12px] leading-snug">
                        {m.kind && <span className="text-[9px] font-bold uppercase tracking-wide text-purple-500 mr-1.5">{m.kind}</span>}
                        <span className={cls("text-[9.5px] font-bold uppercase mr-1.5", m.role === "user" ? "text-blue-600" : "text-slate-400")}>{m.role === "user" ? "you" : "ai"}</span>
                        <span className="text-slate-700 whitespace-pre-wrap">{typeof m.content === "string" ? m.content : (m.display || (imgs.length ? "" : "📎 attachment"))}</span>
                        {imgs.length > 0 && (
                          <span className="flex gap-1.5 mt-1 flex-wrap">
                            {imgs.map((src, k) => (
                              <a key={k} href={src} target="_blank" rel="noreferrer">
                                <img src={src} alt="attachment" className="h-20 rounded-md border border-slate-200 object-cover hover:opacity-90" />
                              </a>
                            ))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompanyAssistant({ me, company: c, data, saveCompanies, saveTasks }) {
  const { users, companies, tasks, questionSets } = data;
  const [msgs, setMsgs] = useState([]); // {role, content}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggested, setSuggested] = useState([]); // [{title, due}]
  const endRef = useRef(null);
  // Date-wise persistence, scoped to this company (needs 16-company-chat.sql).
  useEffect(() => { let a = true; loadChat(me.id, todayStr(), c.id).then((m) => a && setMsgs(m)); return () => { a = false; }; }, [c.id, me.id]);
  const persistMsgs = (m) => { setMsgs(m); saveChat(me.id, todayStr(), m, c.id).catch(() => {}); };
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, suggested]);

  const qset = (questionSets.company_card && questionSets.company_card.questions) || [];
  const missing = missingFields(c);

  const fileNote = (text) => {
    const next = companies.map((x) => x.id === c.id ? { ...x, activity: [...(x.activity || []), { at: nowTS(), by: me.id, text }] } : x);
    saveCompanies(next);
  };
  const addTask = (title, due) => {
    if (openTaskDupe(tasks, c.id, title)) return;
    saveTasks([{ id: uid(), companyId: c.id, dealId: "", assignee: me.id, author: me.id, title, details: "", due: due || localISO(new Date(Date.now() + 86400000)), status: "open", source: "chat", createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...tasks]);
  };

  const [atts, setAtts] = useState([]);
  const fileRef = useRef(null);
  const addFiles = (files) => { [...files].forEach((f) => fileToBlock(f).then((b) => b && setAtts((a) => [...a, b]))); };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].map((it) => it.getAsFile && it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !atts.length) || busy) return;
    setInput("");
    const content = atts.length
      ? [...atts.map(({ _name, ...b }) => b), { type: "text", text: text || "See the attached file — read it and update me." }]
      : text;
    const display = (text || "") + (atts.length ? "\n" + atts.map((a) => "📎 " + a._name).join("  ") : "");
    setAtts([]);
    const nm = [...msgs, { role: "user", content, display }];
    setMsgs(nm); setBusy(true);
    // everything the agent types is knowledge — file it on the record
    if (text) fileNote(text);
    try {
      const system = [
        "You are the company-record assistant on the Elecbits Sales OS, working the record of \"" + c.name + "\" like a disciplined HubSpot operator.",
        "COMPANY RECORD: " + JSON.stringify({ name: c.name, cid: c.cid, industry: c.industry, city: c.city, whatTheyDo: c.whatTheyDo, potential: c.potential, contact: c.contactPerson, designation: c.designation, source: c.source }),
        "FIELDS STILL MISSING ON THE RECORD: " + (missing.join(", ") || "none"),
        "THE TRAINED QUESTION SET (ask these, one at a time, most important first — never a wall of questions): " + JSON.stringify(qset),
        "Rules: acknowledge what the agent just told you in one short sentence; extract any facts (including from attached images/PDFs — read them carefully); then ask exactly ONE next question from the set that is still unanswered. Be specific and factual, never generic.",
        "THIS COMPANY'S DRIVE FOLDER is named \"" + driveFolderName(c) + "\" — use it when asked about files.",
        DRIVE_TOOL_PROMPT,
        "If the agent's message contains anything that should be FOLLOWED UP (a call to make, a document to send, a meeting to book), propose tasks by ending your reply with one line: TASKS_JSON [{\"title\":\"...\",\"due\":\"YYYY-MM-DD\"}] — due defaults to tomorrow. No tasks: no line.",
      ].join("\n");
      const convo = nm.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const { reply, notes } = await askWithDrive(system, convo);
      const t = extractMarkedJSON(reply, "TASKS_JSON");
      if (Array.isArray(t) && t.length) setSuggested(t);
      persistMsgs([...nm, { role: "assistant", content: stripToolLines(reply) + (notes.length ? "\n\n" + notes.map((n) => "🔎 " + n).join("\n") : "") }]);
    } catch (e) {
      persistMsgs([...nm, { role: "assistant", content: "Couldn't reach the AI — the note is filed on the record anyway." }]);
    }
    setBusy(false);
  };

  // The date option: reopen any previous day's thread with this company.
  const [histDate, setHistDate] = useState("");
  const [hist, setHist] = useState(null);
  useEffect(() => {
    if (!histDate || histDate === todayStr()) { setHist(null); if (histDate === todayStr()) setHistDate(""); return; }
    let a = true;
    loadChat(me.id, histDate, c.id).then((m) => a && setHist(m || [])).catch(() => a && setHist([]));
    return () => { a = false; };
  }, [histDate]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
      <SectionTitle right={
        <input type="date" value={histDate} onChange={(e) => setHistDate(e.target.value)} max={todayStr()}
          className="text-[10.5px] border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-500 bg-white" title="Reopen a previous day's chat" />
      }>Record assistant — chat, notes & tasks</SectionTitle>
      <p className="text-xs text-slate-500 mb-3">Talk to the record. Everything you write is filed as activity; the AI works the trained question set ({qset.length} questions, editable in Admin) and proposes tasks — accepted tasks land in <span className="font-medium">My Tasks</span> and on this company.</p>
      {histDate && (
        <div className="px-3 py-1.5 mb-2 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-2">
          <span className="text-[11px] text-amber-800 mr-auto">Chat from {fmtDate(histDate)}</span>
          <button onClick={() => setHistDate("")} className="text-[11px] text-blue-600 hover:underline">back to today →</button>
        </div>
      )}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1 mb-3">
        {histDate ? (<>
          {hist === null && <p className="text-sm text-slate-400 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> opening…</p>}
          {hist && !hist.length && <p className="text-sm text-slate-400">Nothing on {fmtDate(histDate)}.</p>}
          {(hist || []).map((m, i) => (
            <div key={i} className={cls("text-sm rounded-lg px-3 py-2 max-w-[92%] whitespace-pre-wrap", m.role === "user" ? "bg-blue-50 text-slate-800 ml-auto" : "bg-slate-50 text-slate-700")}>
              {m.kind && <span className="text-[9px] font-bold uppercase tracking-wide text-purple-500 mr-1.5">{m.kind}</span>}
              {m.display || (typeof m.content === "string" ? m.content : contentText(m.content))}
            </div>
          ))}
        </>) : (<>
        {msgs.length === 0 && <p className="text-sm text-slate-400">Start with what happened — “spoke to {c.contactPerson || "the client"}, they want…”</p>}
        {msgs.map((m, i) => (
          <div key={i} className={cls("text-sm rounded-lg px-3 py-2 max-w-[92%] whitespace-pre-wrap", m.role === "user" ? "bg-blue-50 text-slate-800 ml-auto" : "bg-slate-50 text-slate-700")}>{m.display || contentText(m.content)}</div>
        ))}
        {suggested.length > 0 && (
          <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-3">
            <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1"><ListTodo size={13} /> Suggested tasks</p>
            {suggested.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-1">
                <span className="mr-auto text-slate-700">{t.title} <span className="text-xs text-slate-400">due {fmtDate(t.due || localISO(new Date(Date.now() + 86400000)))}</span></span>
                <Btn size="sm" kind="primary" onClick={() => { addTask(t.title, t.due); setSuggested(suggested.filter((_, j) => j !== i)); }}><Plus size={12} /> Add</Btn>
              </div>
            ))}
          </div>
        )}
        </>)}
        <div ref={endRef} />
      </div>
      <div className="mt-auto">
        <AttachChips atts={atts} setAtts={setAtts} />
        <div className="flex gap-2">
          <input ref={fileRef} type="file" hidden multiple accept="image/*,application/pdf" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <Btn kind="ghost" title="Attach an image or PDF — or paste a screenshot" onClick={() => fileRef.current?.click()}><Paperclip size={14} /></Btn>
          <Input placeholder="What happened? Paste a client mail screenshot or attach the RFQ…" value={input} onChange={(e) => setInput(e.target.value)} onPaste={onPaste} onKeyDown={(e) => e.key === "Enter" && send()} />
          <Btn kind="primary" disabled={busy || (!input.trim() && !atts.length)} onClick={send}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PLAN — the AI account plan (the PMS project plan, for a company)
   ============================================================ */

function PlanTab({ me, company: c, data, saveCompanies, saveTasks }) {
  const { companies, deals, tasks } = data;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const plan = (c.plan && c.plan.stages) ? c.plan : null;
  const STAGE_COLORS = { done: "green", now: "blue", next: "amber", later: "slate", blocked: "red" };

  const generate = async () => {
    setBusy(true); setErr("");
    try {
      const myDeals = deals.filter((d) => d.companyId === c.id);
      const myTasks = tasks.filter((t) => t.companyId === c.id);
      const sys = [
        "You are the account strategist on the Elecbits Sales OS. Build a staged ACCOUNT PLAN that takes this company from where it is today to a closed PO — the sales equivalent of a project plan.",
        "COMPANY: " + JSON.stringify({ name: c.name, industry: c.industry, city: c.city, whatTheyDo: c.whatTheyDo, potential: c.potential, source: c.source, contact: c.contactPerson }),
        "DEALS: " + JSON.stringify(myDeals.map((d) => ({ stage: d.lost ? "lost" : d.stage, value: d.value }))),
        "OPEN TASKS: " + JSON.stringify(myTasks.filter((t) => t.status !== "done").map((t) => t.title)),
        "RECENT ACTIVITY: " + JSON.stringify((c.activity || []).slice(-8).map((a) => a.text)),
        "5-8 stages, each: name, status (done|now|next|later|blocked), why (one factual sentence tied to THIS company's data), actions (1-3 concrete next moves). Statuses must reflect the actual deal stage and activity — never mark 'done' without evidence.",
        "Reply ONLY: PLAN_JSON {\"summary\":\"2-3 sentences on where this account stands and the play\",\"stages\":[{\"name\":\"...\",\"status\":\"now\",\"why\":\"...\",\"actions\":[\"...\"]}]}",
      ].join("\n");
      const reply = await askClaude(sys, [{ role: "user", content: "Build the plan." }]);
      const p = extractMarkedJSON(reply, "PLAN_JSON");
      if (!p || !Array.isArray(p.stages)) throw new Error("no plan");
      saveCompanies(companies.map((x) => x.id === c.id ? { ...x, plan: { ...(x.plan || {}), summary: p.summary || "", stages: p.stages, generatedAt: nowTS(), by: me.id } } : x));
    } catch (e) { setErr("Plan generation failed — check the AI connection and try again."); }
    setBusy(false);
  };

  const addAction = (title) => {
    saveTasks([{ id: uid(), companyId: c.id, dealId: "", assignee: me.id, author: me.id, title, details: "From the account plan", due: localISO(new Date(Date.now() + 86400000)), status: "open", source: "system", createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...tasks]);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
      <SectionTitle right={<Btn size="sm" kind="primary" disabled={busy} onClick={generate}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {plan ? "Re-plan from live data" : "Generate account plan"}</Btn>}>
        Account plan{plan && plan.generatedAt ? <span className="font-normal text-xs text-slate-400 ml-2">generated {fmtDate(plan.generatedAt)}</span> : null}
      </SectionTitle>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {!plan && !busy && <Empty icon={ClipboardList} title="No plan yet" sub="The AI reads this company's record, deals, tasks and activity, and lays out the staged route to a PO — like the PMS project plan." action={<Btn kind="primary" onClick={generate}><Sparkles size={14} /> Generate account plan</Btn>} />}
      {plan && (
        <div className="space-y-4">
          {plan.summary && <p className="text-sm text-slate-600 border-l-2 border-blue-500 pl-3">{plan.summary}</p>}
          {plan.stages.map((s, i) => (
            <div key={i} className="border-l-2 border-slate-200 pl-4 relative">
              <span className={cls("absolute -left-[5px] top-1.5 w-2 h-2 rounded-full", s.status === "done" ? "bg-green-500" : s.status === "now" ? "bg-blue-600" : s.status === "blocked" ? "bg-red-500" : s.status === "next" ? "bg-amber-500" : "bg-slate-300")} />
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">{s.name} <Chip color={STAGE_COLORS[s.status] || "slate"}>{s.status}</Chip></p>
              {s.why && <p className="text-xs text-slate-500 mt-0.5">{s.why}</p>}
              {(s.actions || []).map((a, j) => (
                <p key={j} className="text-sm text-slate-700 mt-1 flex items-center gap-2">• {a}
                  <button onClick={() => addAction(a)} className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"><Plus size={11} /> task</button>
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   CLIENT COMMS — every touch with a client, and every promise
   made in one. Quick log in 15 seconds; AI write-up when it
   deserves one. The account's memory.
   ============================================================ */

const TOUCH_KINDS = [
  ["call", "Call", Phone], ["email", "Email", FileText], ["whatsapp", "WhatsApp", Send],
  ["meeting", "Meeting", Users], ["visit", "Visit", Building2], ["other", "Other", ClipboardList],
];

const commsSystem = (c, users, touch) => [
  "You write up a CONVERSATION WITH A CLIENT for the permanent record on the Elecbits Sales OS. This is the account's memory: what the client said and asked for, what we promised, what they promised, what was decided, the objections and how they were or will be beaten, and whose idea moved it forward.",
  "CLIENT: " + c.name + (c.city ? ", " + c.city : "") + (c.whatTheyDo ? " — " + c.whatTheyDo : "") + ".",
  "THIS TOUCH: " + touch.kind + ", " + (touch.direction === "in" ? "they came to us" : "we reached out") + ", on " + fmtDate(touch.at) + (touch.contactName ? ", with " + touch.contactName : "") + ".",
  "OUR PEOPLE (use these spellings): " + users.filter((u) => u.active !== false).map((u) => u.name).join(", ") + ". Anyone else named is on the client's side — keep their name as written and never map it to our roster.",
  "",
  "COMMITMENTS ARE THE POINT OF THIS RECORD. Pull out every promise separately:",
  "  ourCommitments — anything WE said we would do, with the date we said it by. 'I'll get it to you by Friday' is promised; 'we should be able to look at that next week' is implied. Mark which.",
  "  theirCommitments — anything THEY said they would do, with the date.",
  "  A commitment with no date is still a commitment: leave due empty rather than inventing Friday.",
  "  If nothing was promised on either side, return empty arrays. Do not manufacture a promise to look thorough.",
  "IDEAS: credit one ONLY when the suggestion changed the approach, saved time or money, caught a risk, or lifted quality — value 1-5 and a one-line why. Agreeing with someone is not an idea. Client-side people can be credited too.",
  "CHALLENGES: every objection, blocker or push-back the client raised, what was done about it, and whether it is genuinely settled. An unsettled objection recorded as 'solved' is worse than one recorded as open.",
  "TEMPERATURE: hot = they are moving and asking for next steps; warm = interested, no urgency; cold = polite, stalling or going quiet. Judge it from what they said, not from how the note was written.",
  "Plain English. No jargon, no markdown symbols, no praise.",
  "",
  "Reply with ONLY: COMMS_JSON {\"title\":\"short, factual, e.g. 'Pricing call — pilot split agreed'\",\"summary\":\"two or three sentences a colleague can read in ten seconds\",\"clientSaid\":[\"the things the client actually said that matter, in their terms\"],\"ourCommitments\":[{\"what\":\"...\",\"owner\":\"our roster name or empty\",\"toWhom\":\"client person or empty\",\"due\":\"YYYY-MM-DD or empty\",\"certainty\":\"promised|implied\"}],\"theirCommitments\":[{\"what\":\"...\",\"who\":\"client person\",\"due\":\"YYYY-MM-DD or empty\"}],\"ideas\":[{\"by\":\"name\",\"idea\":\"...\",\"impact\":\"timeline|cost|quality|risk|other\",\"value\":4,\"why\":\"one line\"}],\"decisions\":[{\"what\":\"...\",\"owner\":\"name or empty\"}],\"challenges\":[{\"challenge\":\"...\",\"action\":\"...\",\"status\":\"solved|open|watch\"}],\"nextStep\":{\"what\":\"...\",\"who\":\"name or empty\",\"when\":\"YYYY-MM-DD or empty\"},\"temperature\":\"hot|warm|cold\",\"risk\":\"the one thing that could kill this, or empty\"}",
].join("\n");

const draftSystem = (c, me, touch, writeup) => [
  "You draft the follow-up after a conversation with a client of Elecbits, an Indian electronics ODM/EMS company. You are writing as " + me.name + " to " + (touch.contactName || "the client contact") + " at " + c.name + ".",
  "You are given the write-up of the conversation. Use only what is in it — never invent a price, a lead time, a spec or a commitment that was not made.",
  "The email: a subject line that says the substance, three short paragraphs at most, every commitment restated with its date so the client can hold us to it, and one clear ask. No 'I hope this email finds you well'. No adjectives about ourselves.",
  "The WhatsApp: under 40 words, same commitments, no salutation theatre. Indian business English, polite and direct.",
  "If the conversation produced nothing worth sending, say so in \"skip\" and leave the drafts empty — a follow-up with nothing in it costs credibility.",
  "THE WRITE-UP: " + JSON.stringify(writeup).slice(0, 6000),
  "Reply with ONLY: DRAFT_JSON {\"subject\":\"...\",\"email\":\"...\",\"whatsapp\":\"...\",\"skip\":\"reason to not send, or empty\"}",
].join("\n");

function CommsTab({ me, company: c, data, saveTasks, saveCompanies }) {
  const { users, tasks } = data;
  const [touches, setTouches] = useState(null);
  const [commits, setCommits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);      // expanded touch id
  const [draft, setDraft] = useState(null);    // {touchId, subject, email, whatsapp, skip}

  // the composer
  const [kind, setKind] = useState("call");
  const [dir, setDir] = useState("out");
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 16));
  const [contact, setContact] = useState(c.contactPerson || "");
  const [line, setLine] = useState("");
  const [more, setMore] = useState(false);
  const [notes, setNotes] = useState("");
  const [link, setLink] = useState("");
  const [driveFile, setDriveFile] = useState("");
  const [checkMsg, setCheckMsg] = useState("");

  const reload = () => {
    loadTouches(c.id).then(setTouches).catch(() => setTouches([]));
    loadCommitments(c.id).then(setCommits).catch(() => {});
  };
  useEffect(() => { reload(); }, [c.id]);

  // ── email intake: two boxes. WHAT to fetch (a plain-language brief) and
  //    WHICH mailbox has the access (sales@elecbits.in, comma for several).
  //    The AI reads the mailbox and keeps only what the brief describes. ──
  const isManager = me.role === "admin" || me.role === "dept_head";
  const commsCfg = (c.plan && c.plan.comms) || {};
  const [about, setAbout] = useState(commsCfg.about || "");
  const [boxes, setBoxes] = useState(commsCfg.mailboxes || "");
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const saveCfg = () => saveCompanies(data.companies.map((x) => (x.id === c.id
    ? { ...x, plan: { ...(x.plan || {}), comms: { about: about.trim(), mailboxes: boxes.trim() } } } : x)));

  const fetchMail = async () => {
    if (!boxes.includes("@") || fetching) return;
    setFetching(true); setFetchMsg("");
    saveCfg();
    try {
      const r = await fetch("/api/inbox?action=fetch&mailboxes=" + encodeURIComponent(boxes.trim())).then((x) => x.json());
      if (r.error) { setFetchMsg(r.error); setFetching(false); return; }
      const seen = new Set((touches || []).map((t) => (t.ai || {}).gmailId).filter(Boolean));
      const fresh = (r.messages || []).filter((m) => !seen.has(m.id));
      if (!fresh.length) { setFetchMsg("Nothing new — " + (r.count || 0) + " message(s) checked, all already on the record."); setFetching(false); return; }
      const sys = [
        "You read a raw batch of mailbox messages and keep ONLY what belongs on the record of " + c.name + " (" + (c.industry || "") + (c.whatTheyDo ? " — " + c.whatTheyDo : "") + ") on the Elecbits Sales OS. Today: " + todayStr() + ".",
        "THE BRIEF from the sales manager — this defines what to fetch: " + (about.trim() || "(none given — keep only mail clearly involving this client)"),
        "A message qualifies only if it matches the brief or clearly involves this client (their people, their domain, their project). Internal chatter, other clients, newsletters: drop silently.",
        "Direction: mail FROM the client side is 'in'; mail our side sent is 'out'.",
        "For each kept mail, one touch: when (from its Date), a clean subject, and a one-line summary of what it means for the deal.",
        "todos: ONLY actions the mail actually demands of us — a reply owed, a document promised, a meeting to set. Concrete titles, real dates when the mail names one.",
        "Reply with ONLY: INBOX_JSON {\"touches\":[{\"gmailId\":\"the id given\",\"direction\":\"in|out\",\"at\":\"ISO datetime\",\"subject\":\"...\",\"summary\":\"one line\"}],\"todos\":[{\"title\":\"...\",\"due\":\"YYYY-MM-DD or empty\"}],\"kept\":3,\"dropped\":17}",
      ].join("\n");
      const reply = await withTimeout(askClaude(sys,
        [{ role: "user", content: JSON.stringify(fresh).slice(0, 80000) }], { maxTokens: 3000 }), 60000);
      const v = extractMarkedJSON(reply, "INBOX_JSON");
      if (!v) throw new Error("unparseable");
      for (const t of (v.touches || [])) {
        await saveTouch({ id: uid(), companyId: c.id, kind: "email", direction: t.direction === "in" ? "in" : "out",
          at: t.at || nowTS(), subject: t.subject || "", body: t.summary || "", contactName: c.contactPerson || "",
          author: me.id, link: "", driveFile: "", source: "inbox", ai: { summary: t.summary || "", gmailId: t.gmailId || "" } });
      }
      if ((v.todos || []).length) {
        saveTasks([...(v.todos || []).map((td) => ({ id: uid(), companyId: c.id, dealId: "", assignee: c.accountOwner || me.id, author: me.id,
          title: td.title, details: "From the client's email", due: td.due || todayStr(), status: "open", source: "comms",
          createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" })), ...tasks]);
      }
      setFetchMsg("Filed " + (v.touches || []).length + " email(s) on the record" + ((v.todos || []).length ? ", raised " + v.todos.length + " to-do(s)" : "") + (v.dropped ? " · " + v.dropped + " unrelated dropped." : "."));
      reload();
    } catch (e) { setFetchMsg("Fetch failed — try again."); }
    setFetching(false);
  };

  const openCommits = commits.filter((x) => x.status === "open");
  const overdue = openCommits.filter((x) => x.due && x.due < todayStr());

  const fileToDrive = async (title, body) => {
    try {
      const slug = String(title).toLowerCase().replace(/[^\w\- ]/g, "").trim().replace(/\s+/g, "-").slice(0, 50);
      await drive.write(driveFolderName(c), "Client-Comms",
        todayStr() + "_" + kind + "_" + slug + ".md", body);
    } catch (e) { /* filing is best-effort; the record is in the DB either way */ }
  };

  const log = async (withAI) => {
    if (!line.trim() && !notes.trim()) return;
    setBusy(true); setErr("");
    const touch = {
      id: uid(), companyId: c.id, kind, direction: dir, at: new Date(when).toISOString(),
      subject: line.trim(), body: notes.trim() || line.trim(), contactName: contact.trim(),
      author: me.id, link: link.trim(), driveFile: driveFile.trim(), source: "manual", ai: {},
    };
    if (withAI) {
      try {
        const reply = await askClaude(commsSystem(c, users, touch),
          [{ role: "user", content: (notes.trim() || line.trim()).slice(0, 120000) }], { maxTokens: 2500 });
        const w = extractMarkedJSON(reply, "COMMS_JSON");
        if (w) {
          touch.ai = w;
          touch.subject = w.title || touch.subject;
          // promises become tracked commitments
          const fresh = [
            ...(w.ourCommitments || []).map((x) => ({
              id: uid(), companyId: c.id, activityId: touch.id, side: "us", what: x.what,
              toWhom: x.toWhom || contact.trim(), due: x.due || "", certainty: x.certainty || "promised",
              status: "open", ownerId: (users.find((u) => u.name === x.owner) || me).id, createdBy: me.id,
            })),
            ...(w.theirCommitments || []).map((x) => ({
              id: uid(), companyId: c.id, activityId: touch.id, side: "them", what: x.what,
              toWhom: x.who || contact.trim(), due: x.due || "", certainty: "promised",
              status: "open", ownerId: null, createdBy: me.id,
            })),
          ];
          if (fresh.length) { await saveCommitments(fresh); }
          // Credited ideas feed the Performance → Ideas & contribution tab,
          // which reads the meetings quartet — file this conversation there.
          if ((w.ideas || []).length) {
            const first = (n) => String(n || "").trim().toLowerCase().split(" ")[0];
            const session = {
              id: uid(), companyId: c.id, dealId: "", date: todayStr(),
              title: w.title || touch.subject || "Client conversation",
              attendees: contact.trim() ? [contact.trim()] : [],
              raw: touch.body, createdBy: me.id,
              ideas: w.ideas.map((x) => ({
                by: x.by || "", idea: x.idea || "", impact: x.impact || "",
                value: Math.min(5, Math.max(1, Number(x.value) || 3)), why: x.why || "",
                authorId: (users.find((u) => x.by && first(u.name) === first(x.by)) || {}).id || null,
              })).filter((x) => x.idea),
              decisions: (w.decisions || []).map((x) => ({ what: x.what || "", ownerName: x.owner || "" })).filter((x) => x.what),
              challenges: (w.challenges || []).map((x) => ({
                challenge: x.challenge || "", action: x.action || "",
                status: ["solved", "open", "watch"].includes(x.status) ? x.status : "open",
              })).filter((x) => x.challenge),
            };
            await saveSession(session);
            touch.meetingId = session.id;
          }
          const md = ["# " + (w.title || touch.subject), c.name + " · " + fmtDate(touch.at) + " · " + kind + ", " + (dir === "in" ? "they came to us" : "we reached out"),
            contact.trim() ? "With: " + contact.trim() : "", link.trim() ? "Source: " + link.trim() : "", "",
            w.summary || "", "", "## What the client said", ...(w.clientSaid || []).map((x) => "- " + x),
            "", "## We promised", ...(w.ourCommitments || []).map((x) => "- " + x.what + (x.due ? " — by " + x.due : "")),
            "## They promised", ...(w.theirCommitments || []).map((x) => "- " + x.what + (x.due ? " — by " + x.due : "")),
            "", "## Objections and how they went", ...(w.challenges || []).map((x) => "- " + x.challenge + " → " + (x.action || "") + " (" + x.status + ")"),
            "", "## Decided", ...(w.decisions || []).map((x) => "- " + x.what),
            "", "## Next step", (w.nextStep && w.nextStep.what) || "—", "", "## The note as it was written", touch.body,
          ].filter((x) => x !== undefined).join("\n");
          fileToDrive(w.title || touch.subject, md);
        }
      } catch (e) { setErr("Logged, but the write-up failed — the touch is saved."); }
    }
    await saveTouch(touch);
    setLine(""); setNotes(""); setLink(""); setDriveFile(""); setMore(false);
    reload(); setBusy(false);
  };

  const closeCommit = async (cm, status) => {
    const note = status === "kept" ? window.prompt("What closed it?") : window.prompt("What happened?");
    if (note === null) return;
    const next = commits.map((x) => x.id === cm.id ? { ...x, status, closedNote: note, closedAt: nowTS() } : x);
    setCommits(next);
    await saveCommitments(next.filter((x) => x.id === cm.id));
  };

  const commitToTask = async (cm) => {
    const tid = uid();
    saveTasks([{ id: tid, companyId: c.id, dealId: "", assignee: cm.ownerId || me.id, author: me.id,
      title: cm.what, details: "Promised to " + (cm.toWhom || c.name), due: cm.due || todayStr(),
      status: "open", source: "commitment", createdAt: nowTS(), windowStart: "", windowEnd: "",
      work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...tasks]);
    // Stamp the link back, or the button stays and every click duplicates.
    const linked = { ...cm, taskId: tid };
    setCommits(commits.map((x) => (x.id === cm.id ? linked : x)));
    await saveCommitments([linked]);
  };

  const makeDraft = async (t) => {
    setBusy(true);
    try {
      const reply = await askClaude(draftSystem(c, me, t, t.ai || {}), [{ role: "user", content: "Draft the follow-up." }], { maxTokens: 1500 });
      const d = extractMarkedJSON(reply, "DRAFT_JSON");
      if (d) setDraft({ ...d, touchId: t.id });
    } catch (e) { setErr("Could not draft the follow-up."); }
    setBusy(false);
  };

  const KindIcon = ({ k }) => { const f = TOUCH_KINDS.find((x) => x[0] === k); const I = f ? f[2] : ClipboardList; return <I size={13} />; };

  return (
    <div className="mt-4 space-y-4">
      {/* ── email intake: the brief and the mailbox ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle right={<Btn size="sm" kind="primary" disabled={!boxes.includes("@") || fetching} onClick={fetchMail}>
          {fetching ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Fetch &amp; file</Btn>}>
          Email intake
        </SectionTitle>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1">What kind of email to fetch</p>
            <TA value={about} onChange={(e) => setAbout(e.target.value)} onBlur={saveCfg} disabled={!isManager && !about} className="min-h-16"
              placeholder={"e.g. Everything about " + c.name + "'s pilot order — mails from S. Iyer or their purchase team, quotes, POs, timelines."} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1">Mailbox with the access (one or more, comma-separated)</p>
            <Input value={boxes} onChange={(e) => setBoxes(e.target.value)} onBlur={saveCfg} disabled={!isManager && !boxes}
              placeholder="sales@elecbits.in" className="font-mono text-xs" />
            <p className="text-[11px] text-slate-400 mt-1.5">Set by the sales manager. The AI reads the mailbox, keeps only what the brief describes, files each mail as a touch and raises to-dos for what the mail demands.</p>
          </div>
        </div>
        {fetchMsg && <p className="text-xs text-slate-600 mt-2">{fetchMsg}</p>}
      </div>

      {/* ── log a touch: one hero line, quiet controls under it ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start gap-2">
          <Input value={line} onChange={(e) => setLine(e.target.value)} className="text-[15px] py-2.5"
            onKeyDown={(e) => { if (e.key === "Enter" && line.trim()) log(true); }}
            placeholder={"What happened with " + c.name + "? — “Sent the revised quote, they pushed back on tooling cost”"} />
          <Btn disabled={busy || (!line.trim() && !notes.trim())} onClick={() => log(false)} className="flex-none py-2.5">Log</Btn>
          <Btn kind="primary" disabled={busy || (!line.trim() && !notes.trim())} onClick={() => log(true)} className="flex-none py-2.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Log + AI
          </Btn>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3 text-xs">
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            {TOUCH_KINDS.map(([k, label, I]) => (
              <button key={k} onClick={() => setKind(k)} title={label}
                className={cls("px-2 py-1.5 flex items-center gap-1", kind === k ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>
                <I size={13} />{kind === k && <span className="font-medium">{label}</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            {[["out", "we reached out"], ["in", "they came to us"]].map(([k, l]) => (
              <button key={k} onClick={() => setDir(k)} className={cls("px-2.5 py-1.5 font-medium", dir === k ? "bg-slate-700 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>{l}</button>
            ))}
          </div>
          <span className="flex items-center gap-1.5 text-slate-400">with
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="who?"
              className="border-0 border-b border-dashed border-slate-300 focus:border-blue-500 focus:outline-none bg-transparent text-slate-700 font-medium w-28 py-0.5" />
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <Clock size={12} />
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              className="border-0 bg-transparent text-slate-600 focus:outline-none font-mono text-[11px] w-44" />
          </span>
          <button onClick={() => setMore(!more)} className="text-blue-600 hover:underline">{more ? "▾ less" : "▸ detail, link, minutes"}</button>
          <span className="text-slate-300 ml-auto font-mono">{touches ? touches.length + " on record" : "…"}</span>
        </div>

        {more && (
          <div className="space-y-2 mt-3 border-t border-slate-100 pt-3">
            <TA value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-24"
              placeholder="Everything worth keeping. Paste a transcript here and the write-up will use all of it." />
            <div className="grid sm:grid-cols-2 gap-2">
              <div><p className="text-[11px] text-slate-400 mb-1">Link</p><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Fireflies / Meet recording / the mail thread" /></div>
              <div>
                <p className="text-[11px] text-slate-400 mb-1">Saved in Drive as</p>
                <div className="flex gap-2">
                  <Input value={driveFile} onChange={(e) => setDriveFile(e.target.value)} placeholder="2026-08-14_MoM_pricing.docx" />
                  <Btn size="sm" disabled={!driveFile.trim()} onClick={async () => {
                    setCheckMsg("checking…");
                    try {
                      const r = await fetch("/api/drive?action=verify&name=" + encodeURIComponent(driveFolderName(c)) + "&file=" + encodeURIComponent(driveFile.trim())).then((x) => x.json());
                      setCheckMsg(r.found ? "✓ found in " + (r.matches[0] || {}).where : "✗ not in the folder — did it save?");
                    } catch (e) { setCheckMsg("could not check"); }
                  }}>Check</Btn>
                </div>
                {checkMsg && <p className="text-[11px] text-slate-500 mt-1">{checkMsg}</p>}
              </div>
            </div>
          </div>
        )}
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      </div>

      {/* ── commitments ── */}
      {commits.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <SectionTitle right={<span className="text-xs text-slate-400">{openCommits.length} open{overdue.length ? " · " + overdue.length + " overdue" : ""}</span>}>Commitments</SectionTitle>
          {["us", "them"].map((side) => {
            const list = commits.filter((x) => x.side === side && x.status === "open");
            if (!list.length) return null;
            return (
              <div key={side} className="mb-3">
                <Lbl>{side === "us" ? "We promised" : "They promised"}</Lbl>
                <div className="space-y-1.5 mt-1.5">
                  {list.map((cm) => {
                    const late = cm.due && cm.due < todayStr();
                    const owner = users.find((u) => u.id === cm.ownerId);
                    return (
                      <div key={cm.id} className={cls("flex items-center gap-2 text-sm border rounded-md px-3 py-2", late ? "border-red-200 bg-red-50/40" : "border-slate-200")}>
                        <span className={cls("w-1.5 h-1.5 rounded-full flex-none", late ? "bg-red-500" : "bg-slate-300")} />
                        <span className="mr-auto text-slate-800">{cm.what}
                          {cm.certainty === "implied" && <span className="text-[10px] text-slate-400 uppercase ml-1.5">implied</span>}</span>
                        {cm.toWhom && <span className="text-xs text-slate-400">to {cm.toWhom}</span>}
                        {owner && <Avatar name={owner.name} size="sm" />}
                        {cm.due && <span className={cls("text-xs font-mono", late ? "text-red-600 font-semibold" : "text-slate-400")}>{fmtDate(cm.due)}</span>}
                        {side === "us" && !cm.taskId && <Btn size="sm" onClick={() => commitToTask(cm)}><Plus size={11} /> Task</Btn>}
                        <Btn size="sm" onClick={() => closeCommit(cm, "kept")}><Check size={11} /></Btn>
                        <button onClick={() => closeCommit(cm, "missed")} className="text-slate-300 hover:text-red-500 text-xs">missed</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {commits.some((x) => x.status !== "open") && (
            <p className="text-[11px] text-slate-400 mt-2">
              Closed: {commits.filter((x) => x.status === "kept").length} kept · {commits.filter((x) => x.status === "missed").length} missed
            </p>
          )}
        </div>
      )}

      {/* ── the timeline: a feed with a rail, newest first ── */}
      {(touches || []).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <SectionTitle>Every touch, newest first</SectionTitle>
          <div className="relative">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200" />
            <div className="space-y-4">
              {(touches || []).map((t) => {
                const w = t.ai || {};
                const by = users.find((u) => u.id === t.author);
                const kd = TOUCH_KINDS.find((x) => x[0] === t.kind);
                const KI = kd ? kd[2] : ClipboardList;
                const inbound = t.direction === "in";
                return (
                  <div key={t.id} className="relative pl-11">
                    <span className={cls("absolute left-0 top-0.5 w-8 h-8 rounded-full flex items-center justify-center border-2 bg-white",
                      inbound ? "border-green-300 text-green-600" : "border-slate-200 text-slate-400")}>
                      <KI size={14} />
                    </span>
                    <div className={cls("border rounded-xl px-4 py-3", inbound ? "border-green-200 bg-green-50/30" : "border-slate-200")}>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 mr-auto">{t.subject || w.title || (kd ? kd[1] : "Touch")}</span>
                        {w.temperature && <Chip color={w.temperature === "hot" ? "red" : w.temperature === "cold" ? "blue" : "amber"}>{w.temperature}</Chip>}
                        <span className="text-[11px] font-mono text-slate-400 flex-none">{fmtDate(t.at)} · {fmtTime(t.at)}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {inbound ? "they came to us" : "we reached out"}
                        {by ? " · " + by.name : ""}{t.contactName ? (inbound ? " ← " : " → ") + t.contactName : ""}
                        {t.source === "inbox" ? " · from the mailbox" : ""}
                        {t.link && <a href={t.link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline ml-1.5">source ↗</a>}
                      </p>
                      {w.summary && <p className="text-[13px] text-slate-700 mt-1.5 leading-relaxed">{w.summary}</p>}
                      {!w.summary && t.body && t.body !== t.subject && <p className="text-[13px] text-slate-600 mt-1.5 leading-relaxed line-clamp-2">{t.body}</p>}
                      {(w.ourCommitments || w.challenges || w.clientSaid) && (
                        <button onClick={() => setOpen(open === t.id ? null : t.id)} className="text-xs text-blue-600 hover:underline mt-1.5">
                          {open === t.id ? "▾ hide the write-up" : "▸ full write-up"}
                        </button>
                      )}
                      {open === t.id && (
                        <div className="mt-2.5 space-y-2.5 border-t border-slate-100 pt-2.5">
                          {(w.clientSaid || []).length > 0 && (<div><Lbl>What the client said</Lbl>{w.clientSaid.map((x, i) => <p key={i} className="text-sm text-slate-700 py-0.5">• {x}</p>)}</div>)}
                          {(w.ourCommitments || []).length > 0 && (<div><Lbl>We promised</Lbl>{w.ourCommitments.map((x, i) => <p key={i} className="text-sm text-slate-700 py-0.5">• {x.what}{x.due ? " — by " + fmtDate(x.due) : ""}</p>)}</div>)}
                          {(w.theirCommitments || []).length > 0 && (<div><Lbl>They promised</Lbl>{w.theirCommitments.map((x, i) => <p key={i} className="text-sm text-slate-700 py-0.5">• {x.what}{x.due ? " — by " + fmtDate(x.due) : ""}</p>)}</div>)}
                          {(w.challenges || []).length > 0 && (<div><Lbl>Objections — and how they went</Lbl>{w.challenges.map((x, i) => (
                            <p key={i} className="text-sm text-slate-700 py-0.5"><Chip color={x.status === "solved" ? "green" : x.status === "watch" ? "amber" : "red"}>{x.status}</Chip> {x.challenge}{x.action && <span className="text-slate-500"> → {x.action}</span>}</p>))}</div>)}
                          {(w.ideas || []).length > 0 && (<div><Lbl>Ideas credited</Lbl>{w.ideas.map((x, i) => (
                            <p key={i} className="text-sm text-slate-700 py-0.5"><Chip color="purple">{x.by || "?"}</Chip> {x.idea} {x.value && <span className="font-mono text-xs text-purple-600">·{x.value}/5</span>}</p>))}</div>)}
                          {(w.decisions || []).length > 0 && (<div><Lbl>Decided</Lbl>{w.decisions.map((x, i) => <p key={i} className="text-sm text-slate-700 py-0.5">• {x.what}</p>)}</div>)}
                          {w.nextStep && w.nextStep.what && (<div><Lbl>Next step</Lbl><p className="text-sm text-slate-700">{w.nextStep.what}{w.nextStep.when ? " — by " + fmtDate(w.nextStep.when) : ""}</p></div>)}
                          {w.risk && <p className="text-xs text-red-600">Risk: {w.risk}</p>}
                          <details><summary className="text-xs text-slate-400 cursor-pointer">The note as it was written</summary><p className="text-xs text-slate-500 whitespace-pre-wrap mt-1">{t.body}</p></details>
                          <Btn size="sm" disabled={busy} onClick={() => makeDraft(t)}><Sparkles size={12} /> Draft the follow-up</Btn>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {touches && touches.length === 0 && (
        <Empty icon={Phone} title={"Nothing logged with " + c.name + " yet"}
          sub="Every call, mail and meeting belongs here — it is what the account remembers when someone else picks it up." />
      )}

      {draft && (
        <Modal title="Follow-up draft" onClose={() => setDraft(null)} wide
          footer={<Btn kind="primary" onClick={() => setDraft(null)}>Close</Btn>}>
          {draft.skip ? <p className="text-sm text-amber-700">{draft.skip}</p> : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5"><Lbl className="mr-auto">Email</Lbl>
                  <Btn size="sm" onClick={() => navigator.clipboard?.writeText("Subject: " + draft.subject + "\n\n" + draft.email)}><Copy size={12} /> Copy</Btn>
                </div>
                <p className="text-sm font-medium text-slate-800 mb-1">{draft.subject}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3">{draft.email}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5"><Lbl className="mr-auto">WhatsApp</Lbl>
                  <Btn size="sm" onClick={() => navigator.clipboard?.writeText(draft.whatsapp)}><Copy size={12} /> Copy</Btn>
                </div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3">{draft.whatsapp}</p>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   DRIVE INTELLIGENCE — "re-analyse how it's moving" per company
   ============================================================ */

function DriveIntel({ me, company: c, data, saveCompanies }) {
  const { companies } = data;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const intel = c.plan && c.plan.driveIntel;

  const analyse = async () => {
    setBusy(true); setErr("");
    try {
      const l = await drive.list(driveFolderName(c));
      const sys = [
        "You are the Drive-intelligence analyst on the Elecbits Sales OS. From the company record and its Drive folder listing, say how this account is ACTUALLY moving — blunt, factual, no praise.",
        "COMPANY: " + JSON.stringify({ name: c.name, cid: c.cid, potential: c.potential, activity: (c.activity || []).slice(-6).map((a) => a.text) }),
        "DRIVE FOLDER (" + driveFolderName(c) + "): " + JSON.stringify((l.files || []).map((f) => ({ name: f.name, modified: f.modified }))) + (l.error ? " (Drive error: " + l.error + ")" : ""),
        "An empty folder for an active account is itself a finding — quotes, RFQs and MoMs should leave artifacts.",
        "Reply ONLY: INTEL_JSON {\"stands\":\"WHERE IT STANDS — 2-3 sentences\",\"moving\":\"HOW IT IS MOVING — 2-3 sentences\",\"risks\":\"RISKS / BLOCKERS — 1-3 sentences\",\"next\":\"NEXT MOVES — who must do what\"}",
      ].join("\n");
      const reply = await askClaude(sys, [{ role: "user", content: "Analyse it." }]);
      const v = extractMarkedJSON(reply, "INTEL_JSON");
      if (!v) throw new Error("no intel");
      saveCompanies(companies.map((x) => x.id === c.id ? { ...x, plan: { ...(x.plan || {}), driveIntel: { ...v, at: nowTS(), by: me.id } } } : x));
    } catch (e) { setErr("Analysis failed — check the AI/Drive connection."); }
    setBusy(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <SectionTitle right={<Btn size="sm" kind="primary" disabled={busy} onClick={analyse}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Re-analyse how it's moving</Btn>}>Drive intelligence</SectionTitle>
      <p className="text-xs text-slate-500 mb-3">The OS reads this company's folder and tells you what's going on — artifacts are the truth, claims are not.</p>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      {!intel && !busy && <p className="text-sm text-slate-400">Not analysed yet.</p>}
      {intel && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 text-sm text-slate-700">
          {[["WHERE IT STANDS", intel.stands], ["HOW IT IS MOVING", intel.moving], ["RISKS / BLOCKERS", intel.risks], ["NEXT MOVES", intel.next]].map(([h, t]) => t && (
            <div key={h}><p className="text-xs font-bold text-slate-500 tracking-wide mb-0.5">{h}</p><p>{t}</p></div>
          ))}
          <p className="text-xs text-slate-400">analysed {fmtDate(intel.at)}</p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   PROJECT-ID APPLICATION — sales.requests → core.intake → ULM
   ============================================================ */

/* ============================================================
   THE RFQ LINK — requirement gathering the client does for you.
   The salesperson picks what Elecbits will share back (Quote /
   LLD, with effort, time and cost), creates a link, and sends it.
   The client's browser talks only to /api/rfq. (24-rfq-links.sql)
   ============================================================ */

const RFQ_SERVICES = ["PCB design", "Firmware", "Enclosure / mechanical", "Certification", "Assembly / EMS", "Box build", "Complete product (ODM)"];
const rfqUrl = (id) => window.location.origin + "/#rfq/" + id;

/* Every RFQ link ever generated, across the whole book — who it went to,
   whether the client opened it, and the filled form when it came back. */
function RfqsView({ me, data, openCompany }) {
  const { users, companies, rfq } = data;
  const [statusF, setStatusF] = useState("all");
  const [open, setOpen] = useState("");     // expanded link id
  const [copied, setCopied] = useState(""); // link id just copied
  const list = (rfq || [])
    .filter((l) => statusF === "all" || l.status === statusF)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const compOf = (l) => companies.find((c) => c.id === l.companyId);
  const F = ({ label, v }) => v ? <p className="text-sm"><span className="font-semibold text-slate-600">{label}:</span> <span className="text-slate-800">{v}</span></p> : null;
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-auto flex items-center gap-2"><FileText size={18} className="text-blue-600" /> RFQs</h1>
        <div className="flex rounded-md border border-slate-300 overflow-hidden">
          {[["all", "All"], ["created", "Sent"], ["opened", "Opened"], ["submitted", "Input received"]].map(([k, l]) => (
            <button key={k} onClick={() => setStatusF(k)} className={cls("px-2.5 py-1 text-xs font-medium", statusF === k ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100")}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-3">Every requirement link generated from a company page. Your job: get them filled — chase the ones stuck on “sent”.</p>
      {list.length === 0 ? (
        <Empty icon={FileText} title="No RFQ links yet" sub="Create one from any company page — the client fills in the requirement themselves." />
      ) : (
        <div className="space-y-2">
          {list.map((l) => {
            const c = compOf(l);
            const by = users.find((u) => u.id === l.createdBy);
            const r = l.response || {};
            return (
              <div key={l.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <Chip color={l.status === "submitted" ? "green" : l.status === "opened" ? "purple" : "slate"}>
                    {l.status === "submitted" ? "input received" : l.status === "opened" ? "opened" : "sent"}
                  </Chip>
                  <button onClick={() => c && openCompany(c.id)} className="font-medium text-sm text-slate-900 hover:text-blue-700">{c ? c.name : "?"}</button>
                  {l.contactName && <span className="text-xs text-slate-500">→ {l.contactName}</span>}
                  <span className="mr-auto" />
                  {by && <span className="text-xs text-slate-400 flex items-center gap-1"><Avatar name={by.name} size="sm" /> {by.name}</span>}
                  <span className="text-[11px] font-mono text-slate-400">{fmtDate(l.createdAt)}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(rfqUrl(l.id)); setCopied(l.id); setTimeout(() => setCopied(""), 1500); }}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Copy size={11} /> {copied === l.id ? "copied!" : "copy link"}</button>
                  {l.status === "submitted" && (
                    <Btn size="sm" onClick={() => setOpen(open === l.id ? "" : l.id)}>{open === l.id ? "hide form" : "view form"}</Btn>
                  )}
                </div>
                {l.status === "submitted" && (
                  <p className="text-xs text-slate-500 mt-1.5 line-clamp-1">{r.need || ""}</p>
                )}
                {open === l.id && l.status === "submitted" && (
                  <div className="mt-3 border-t border-slate-100 pt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    <div className="sm:col-span-2"><F label="Requirement" v={r.need} /></div>
                    <F label="Services" v={(r.services || []).join(", ")} />
                    <F label="Quantity" v={r.qty} />
                    <F label="Timeline" v={r.timeline} />
                    <F label="Budget" v={r.budget} />
                    <F label="Can share" v={(r.docs || []).join(", ")} />
                    <F label="Notes" v={r.notes} />
                    <div className="sm:col-span-2 text-[11px] text-slate-400 mt-1">
                      From {r.name || "?"}{r.email ? " · " + r.email : ""}{r.phone ? " · " + r.phone : ""} · submitted {fmtDate(l.submittedAt)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RfqLinkRow({ l }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const r = l.response || {};
  return (
    <div className="border border-slate-200 rounded-md px-3 py-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <Chip color={l.status === "submitted" ? "green" : l.status === "opened" ? "purple" : "slate"}>
          {l.status === "submitted" ? "input received" : l.status === "opened" ? "opened — awaiting input" : "sent, not opened yet"}
        </Chip>
        <span className="text-slate-800 mr-auto">{l.title || "RFQ"}{l.contactName ? " → " + l.contactName : ""}</span>
        {l.status === "submitted" && (
          <button onClick={() => setOpen(!open)} className="text-xs text-blue-600 hover:underline">{open ? "hide" : "view"} input</button>
        )}
        <button onClick={() => { navigator.clipboard?.writeText(rfqUrl(l.id)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Copy size={11} /> {copied ? "copied!" : "copy link"}</button>
        <span className="text-[11px] font-mono text-slate-400">{fmtDate(l.createdAt)}</span>
      </div>
      {open && l.status === "submitted" && (
        <div className="mt-2 border-t border-slate-100 pt-2 space-y-1 text-[13px]">
          {r.need && <p><span className="font-semibold text-slate-600">Need:</span> {r.need}</p>}
          {(r.services || []).length > 0 && <p><span className="font-semibold text-slate-600">Services:</span> {r.services.join(", ")}</p>}
          <p className="text-xs text-slate-500 font-mono">{[r.qty && "qty " + r.qty, r.timeline && "when: " + r.timeline, r.budget && "budget: " + r.budget].filter(Boolean).join(" · ")}</p>
          {(r.docs || []).length > 0 && <p className="text-xs text-slate-500">Can share: {r.docs.join(", ")}</p>}
          {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
          <p className="text-[11px] text-slate-400">From {r.name || "?"}{r.email ? " · " + r.email : ""}{r.phone ? " · " + r.phone : ""} · {fmtDate(l.submittedAt)}</p>
        </div>
      )}
    </div>
  );
}

function RfqLinkModal({ me, data, company, deal, onClose, saveDeals }) {
  const { deals, rfq, setRfq } = data;
  const [contact, setContact] = useState(company.contactPerson || "");
  const [note, setNote] = useState("");
  const [made, setMade] = useState(null); // the created link id
  const [copied, setCopied] = useState(false);

  const create = async () => {
    const l = { id: uid(), companyId: company.id, dealId: deal ? deal.id : "", title: "RFQ — " + company.name,
      offer: [], note: note.trim(), contactName: contact.trim(), status: "created", createdBy: me.id, createdAt: nowTS() };
    await saveRfqLink(l);
    setRfq([l, ...(rfq || [])]);
    // An RFQ in flight IS the rfq phase — recorded like any other move.
    if (deal && !deal.lost && ["cold", "warm"].includes(deal.temperature || "cold")) {
      setTemperature(deal.id, { from: deal.temperature || "cold", to: "rfq", why: "RFQ link sent" + (contact.trim() ? " to " + contact.trim() : ""), decided: "human", by: me.id });
      saveDeals(deals.map((x) => (x.id === deal.id ? { ...x, temperature: "rfq", temperatureAt: nowTS(), temperatureWhy: "RFQ link sent", updatedAt: nowTS(),
        tempHistory: [...(x.tempHistory || []), { from: deal.temperature || "cold", to: "rfq", why: "RFQ link sent", decided: "human", at: nowTS() }] } : x)));
    }
    setMade(l.id);
  };

  return (
    <Modal title={"RFQ link — " + company.name} onClose={onClose}
      footer={made
        ? <Btn kind="primary" onClick={onClose}>Done</Btn>
        : <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn kind="primary" onClick={create}><Send size={14} /> Create the link</Btn>
          </>}>
      {made ? (
        <div className="text-center py-6">
          <CheckCircle2 size={30} className="mx-auto text-green-600 mb-2" />
          <p className="text-sm font-semibold text-slate-800 mb-1">The link is live</p>
          <p className="font-mono text-xs text-blue-700 break-all mb-3">{rfqUrl(made)}</p>
          <Btn kind="primary" onClick={() => { navigator.clipboard?.writeText(rfqUrl(made)); setCopied(true); }}><Copy size={14} /> {copied ? "Copied!" : "Copy link"}</Btn>
          <p className="text-xs text-slate-400 mt-3 max-w-sm mx-auto">Send it to {contact.trim() || "the client"} on WhatsApp or mail — your only job is getting it filled. You'll see “opened” and “input received” on the company page and the pipeline card.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">The client gets a chat that walks them through their requirement — it tells them what Elecbits will share back as they fill it. You just get this link filled.</p>
          <Field label="Send to (client contact)"><Input value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
          <Field label="A line to open the chat with (optional)"><TA value={note} onChange={(e) => setNote(e.target.value)} className="min-h-14" placeholder="e.g. Great speaking today, Rahul — this takes two minutes." /></Field>
        </div>
      )}
    </Modal>
  );
}

/* The public page at #rfq/<id> — a CHAT, not a form. A scripted
   conversation asks one thing at a time, tells the client what Elecbits
   will share back along the way, and files the answers through /api/rfq.
   Deterministic (no AI call from a public page), so it never stalls. */
function RfqPublicPage({ token }) {
  const [link, setLink] = useState(null);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [msgs, setMsgs] = useState([]);     // {who:'bot'|'me', text}
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [picks, setPicks] = useState([]);   // multi-select buffer for chip steps
  const f = useRef({ name: "", email: "", phone: "", need: "", qty: "", timeline: "", budget: "", notes: "", services: [], docs: [] });
  const bodyRef = useRef(null);

  const STEPS = [
    { key: "name", ask: "First things first — what should we call you?", type: "text", placeholder: "Your name" },
    { key: "need", ask: (v) => "Nice to meet you, " + v.name + "! Tell us what you need built or supplied — what it does, key specs, standards, anything that matters. The more you give us, the sharper our answer.", type: "textarea", placeholder: "Describe the product or work…" },
    { key: "services", ask: () => "Got it. Which of these does it involve? Pick all that apply.", type: "chips", options: RFQ_SERVICES },
    { key: "qty", ask: () => "How many units are we talking? A rough number is fine.", type: "text", placeholder: "e.g. 500 units, pilot of 20", skip: true },
    { key: "timeline", ask: () => "When do you need it? (Once you finish here, the Elecbits team reviews this and comes back with a detailed quotation — and a low-level design document where design work is involved.)", type: "text", placeholder: "e.g. pilot by November", skip: true },
    { key: "budget", ask: () => "Do you have a budget range in mind? Skip this if you'd rather not say.", type: "text", placeholder: "e.g. ₹8-10 lakh for the pilot", skip: true },
    { key: "docs", ask: () => "What can you share with us to speed things up?", type: "chips", options: ["Specifications", "BOM", "Drawings / CAD", "Reference sample", "Nothing yet"] },
    { key: "contact", ask: () => "Almost done. Where should we reach you — email, phone or WhatsApp?", type: "text", placeholder: "email and/or phone" },
    { key: "notes", ask: () => "Anything else we should know before we get to work?", type: "textarea", placeholder: "optional", skip: true },
  ];

  useEffect(() => {
    fetch("/api/rfq?id=" + encodeURIComponent(token)).then((r) => r.json())
      .then((j) => {
        if (j.error) { setErr(j.error); return; }
        setLink(j);
        if (j.submitted) { setSent(true); return; }
        const hello = [
          { who: "bot", text: "Hi! You're talking to Elecbits" + (j.company ? " about " + j.company + "'s requirement" : "") + ". This takes about two minutes, and at the end our team gets everything they need to come back to you properly." },
          ...(j.note ? [{ who: "bot", text: j.note }] : []),
          { who: "bot", text: STEPS[0].ask },
        ];
        setMsgs(hello);
      })
      .catch(() => setErr("Could not load this link — check your connection."));
  }, [token]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, typing, sent]);

  const botSay = (text, after) => {
    setTyping(true);
    setTimeout(() => { setTyping(false); setMsgs((m) => [...m, { who: "bot", text }]); if (after) after(); }, 450);
  };

  const advance = (echo) => {
    const cur = STEPS[step];
    setMsgs((m) => [...m, { who: "me", text: echo }]);
    const next = step + 1;
    // Every answer is saved as it lands — the salesperson's RFQ tab shows
    // live how much of the form is filled, not just sent/submitted.
    try {
      fetch("/api/rfq?id=" + encodeURIComponent(token), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partial: true, response: { ...f.current, _answered: next, _total: STEPS.length } }),
      }).catch(() => {});
    } catch (e) { /* progress is best-effort */ }
    if (next < STEPS.length) {
      setStep(next);
      const q = STEPS[next].ask;
      botSay(typeof q === "function" ? q(f.current) : q);
    } else {
      setStep(next);
      botSay("That's everything. Hit send and it goes straight to the Elecbits team — you'll hear back with the quotation" + ((f.current.services || []).some((x) => /design|firmware|enclosure|odm|complete/i.test(x)) ? " and the low-level design plan" : "") + ".");
    }
  };

  const submitText = () => {
    const cur = STEPS[step];
    const v = input.trim();
    if (!v && !cur.skip) return;
    if (cur.key === "contact") {
      const em = v.match(/\S+@\S+\.\S+/); f.current.email = em ? em[0] : "";
      const ph = v.replace(em ? em[0] : "", "").replace(/[^\d+ ]/g, " ").trim(); f.current.phone = ph;
      if (!f.current.email && !f.current.phone) { f.current.notes = (f.current.notes || "") + " contact: " + v; }
    } else {
      f.current[cur.key] = v;
    }
    setInput("");
    advance(v || "(skipped)");
  };
  const submitChips = () => {
    const cur = STEPS[step];
    f.current[cur.key] = picks;
    const echo = picks.length ? picks.join(", ") : "(none)";
    setPicks([]);
    advance(echo);
  };

  const sendAll = async () => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/rfq?id=" + encodeURIComponent(token), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: f.current }),
      }).then((x) => x.json());
      if (r.error) setErr(r.error);
      else { setSent(true); setMsgs((m) => [...m, { who: "bot", text: "Received — thank you" + (f.current.name ? ", " + f.current.name : "") + "! The Elecbits team is on it. 🚀" }]); }
    } catch (e) { setErr("Could not submit — please try again."); }
    setBusy(false);
  };

  const cur = step < STEPS.length ? STEPS[step] : null;
  const started = msgs.length > 0;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col">
      <div className="max-w-xl w-full mx-auto px-4 py-6 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-4"><Logo height={26} /><span className="text-xs text-slate-400 ml-auto font-mono">requirement chat</span></div>
        {err && !link && <p className="text-sm text-red-600 mt-6">{err}</p>}
        {!err && !link && <p className="text-sm text-slate-400 mt-6 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</p>}
        {link && (
          <div className="bg-white border border-slate-200 rounded-2xl flex-1 flex flex-col min-h-0 shadow-sm">
            <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
              {sent && !started && (
                <div className="text-center py-10">
                  <CheckCircle2 size={30} className="mx-auto text-green-600 mb-2" />
                  <p className="text-sm font-semibold">We already have your requirement — thank you!</p>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={cls("flex", m.who === "me" ? "justify-end" : "justify-start")}>
                  <div className={cls("max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] whitespace-pre-wrap leading-relaxed",
                    m.who === "me" ? "bg-blue-600 text-white rounded-br-md" : "bg-slate-100 text-slate-800 rounded-bl-md")}>
                    {m.text}
                  </div>
                </div>
              ))}
              {typing && <div className="flex"><div className="bg-slate-100 rounded-2xl rounded-bl-md px-3.5 py-2 text-slate-400 text-sm">…</div></div>}
            </div>

            {!sent && cur && !typing && (
              <div className="border-t border-slate-100 p-3">
                {cur.type === "chips" ? (
                  <div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {cur.options.map((o) => (
                        <button key={o} onClick={() => setPicks(picks.includes(o) ? picks.filter((x) => x !== o) : [...picks, o])}
                          className={cls("px-2.5 py-1.5 rounded-lg text-xs font-medium border", picks.includes(o) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:border-blue-400")}>{o}</button>
                      ))}
                    </div>
                    <Btn kind="primary" size="sm" disabled={!picks.length} onClick={submitChips}><Check size={12} /> That's them</Btn>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    {cur.type === "textarea"
                      ? <TA value={input} onChange={(e) => setInput(e.target.value)} className="min-h-16 flex-1" placeholder={cur.placeholder} />
                      : <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={cur.placeholder}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitText(); } }} />}
                    <div className="flex flex-col gap-1">
                      <Btn kind="primary" size="sm" disabled={!input.trim() && !cur.skip} onClick={submitText}><Send size={13} /></Btn>
                      {cur.skip && !input.trim() && <button onClick={submitText} className="text-[11px] text-slate-400 hover:text-slate-600">skip</button>}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!sent && !cur && started && (
              <div className="border-t border-slate-100 p-3">
                <Btn kind="primary" disabled={busy} onClick={sendAll} className="w-full justify-center">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send to Elecbits
                </Btn>
                {err && <p className="text-xs text-red-600 mt-1.5">{err}</p>}
              </div>
            )}
          </div>
        )}
        <p className="text-[11px] text-slate-400 text-center mt-3">Powered by the Elecbits Sales OS. Your details reach only the Elecbits team.</p>
      </div>
    </div>
  );
}

function ProjectIdModal({ me, data, company, deal, onClose, onSubmitted }) {
  const { questionSets } = data;
  const criteria = (questionSets.boxbuild_criteria && questionSets.boxbuild_criteria.questions) || [];
  const [kind, setKind] = useState("odm");
  const [svc, setSvc] = useState("01");
  const [priority, setPriority] = useState("P2");
  const [spoc, setSpoc] = useState(company.contactPerson || "");
  const [desc, setDesc] = useState("");
  const [target, setTarget] = useState("");
  const [margin, setMargin] = useState("");
  const [value, setValue] = useState(deal ? String(deal.value || "") : "");
  const [pm, setPm] = useState("");
  const [checks, setChecks] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Requirement analysis: paste everything, the AI structures it, the
  // unknowns become the questions to take back to the client. The analysed
  // requirement travels to ULM as data — no more random emails.
  const [raw, setRaw] = useState("");
  const [req, setReq] = useState(null);       // REQ_JSON output
  const [analysing, setAnalysing] = useState(false);
  const analyse = async () => {
    if (!raw.trim() || analysing) return;
    setAnalysing(true); setErr("");
    try {
      const reply = await withTimeout(askClaude(reqSystem(company),
        [{ role: "user", content: raw.trim().slice(0, 100000) }], { maxTokens: 1500 }), 30000);
      const v = extractMarkedJSON(reply, "REQ_JSON");
      if (!v || !v.what) throw new Error("unparseable");
      setReq(v);
      if (v.kind && ["odm", "boxbuild"].includes(v.kind)) setKind(v.kind);
      if (!desc.trim()) setDesc(v.what + ((v.specs || []).length ? "\n\nSpecs:\n" + v.specs.map((x) => "• " + x).join("\n") : ""));
    } catch (e) { setErr("Could not analyse — try again, or fill the form by hand."); }
    setAnalysing(false);
  };

  const allChecked = criteria.every((_, i) => checks[i]);
  const understood = !req || !(req.unknowns || []).length;
  const ready = desc.trim() && spoc.trim() && (kind !== "boxbuild" || allChecked);

  const submit = async () => {
    setBusy(true); setErr("");
    const title = (req && req.title) || (company.name + " — " + (kind === "boxbuild" ? "Box Build" : "ODM") + " (" + (svc === "01" ? "01 R&D" : "02 SCS") + ")");
    const summary = [
      "Priority: " + priority, "Customer SPOC: " + spoc, "Service category: " + (svc === "01" ? "01 R&D" : "02 SCS/Manufacturing"),
      "Description: " + desc.trim(), margin ? "Margin %: " + margin : "", pm ? "Proposed PM: " + pm : "",
      deal ? "Deal: " + deal.did : "",
      req && (req.services || []).length ? "Services: " + req.services.join(", ") : "",
      req && req.qty ? "Qty: " + req.qty : "", req && req.timeline ? "Timeline: " + req.timeline : "",
      req && req.budget ? "Budget signal: " + req.budget : "",
      req && (req.unknowns || []).length ? "STILL UNKNOWN: " + req.unknowns.join(" · ") : "",
      kind === "boxbuild" ? "Box-build acceptance criteria: ALL " + criteria.length + " passed" : "",
    ].filter(Boolean).join("\n");
    const id = await submitProjectRequest({
      companyId: company.id, title, summary, kind, targetDate: target || null,
      value: value || 0, urgency: priority === "P0" ? "high" : priority === "P3" ? "low" : "normal", by: me.id,
      requirement: req ? { ...req, raw: raw.trim().slice(0, 20000), spoc, priority, svc } : { spoc, priority, svc, description: desc.trim() },
    });
    setBusy(false);
    if (!id) { setErr("Submission failed — check connection and that the Phase-1 SQL has run."); return; }
    onSubmitted(id, title);
  };

  return (
    <Modal title={"Apply for Project ID — " + company.name} onClose={onClose} wide
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!ready || busy} onClick={submit}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />} Submit to ULM for sanction</Btn>
      </>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Requirement first, sanction second. On sanction, ULM mints the official project ID <span className="font-mono">{c0(company)}-{svc}-…</span> and allocates the project.</p>

        {/* ── requirement analysis ── */}
        <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Lbl className="mr-auto">The requirement — added, then understood</Lbl>
            <Btn size="sm" kind="primary" disabled={analysing || !raw.trim()} onClick={analyse}>
              {analysing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Analyse
            </Btn>
          </div>
          <TA value={raw} onChange={(e) => setRaw(e.target.value)} className="min-h-20 bg-white"
            placeholder="Paste everything about this request — the client's email, call notes, the transcript. The AI structures it and names what is still unknown." />
          {req && (
            <div className="mt-2.5 space-y-2 text-sm">
              <p className="text-slate-800">{req.what}</p>
              {(req.services || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">{req.services.map((s, i) => <Chip key={i} color="blue">{s}</Chip>)}</div>
              )}
              <p className="text-xs text-slate-500 font-mono">
                {[req.qty && "qty " + req.qty, req.timeline && "when: " + req.timeline, req.budget && "budget: " + req.budget].filter(Boolean).join(" · ")}
              </p>
              {(req.specs || []).length > 0 && (
                <div><Lbl>Hard requirements</Lbl>{req.specs.map((x, i) => <p key={i} className="text-xs text-slate-700 py-0.5">• {x}</p>)}</div>
              )}
              {(req.unknowns || []).length > 0 ? (
                <div className="border border-amber-300 bg-amber-50 rounded-md p-2.5">
                  <p className="text-xs font-semibold text-amber-800 mb-1">Not understood yet — ask the client before sanctioning:</p>
                  {req.unknowns.map((x, i) => <p key={i} className="text-xs text-amber-800 py-0.5">? {x}</p>)}
                  <p className="text-[11px] text-amber-700 mt-1">You can still submit — the unknowns travel with the request so ULM sees them.</p>
                </div>
              ) : (
                <p className="text-xs text-green-700 flex items-center gap-1"><CheckCircle2 size={12} /> Requirement understood — nothing flagged unknown.</p>
              )}
            </div>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Project kind" req>
            <Sel value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="odm">ODM (design + build)</option>
              <option value="boxbuild">Box Build</option>
            </Sel>
          </Field>
          <Field label="Service category" req>
            <Sel value={svc} onChange={(e) => setSvc(e.target.value)}>
              <option value="01">01 — R&D</option>
              <option value="02">02 — SCS / Manufacturing</option>
            </Sel>
          </Field>
          <Field label="Priority" req>
            <Sel value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option>P0</option><option>P1</option><option>P2</option><option>P3</option>
            </Sel>
          </Field>
          <Field label="Customer SPOC" req><Input value={spoc} onChange={(e) => setSpoc(e.target.value)} placeholder="Name — designation — phone" /></Field>
          <Field label="Target delivery date"><Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label="Expected order value (₹)"><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Margin %"><Input type="number" value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>
          <Field label="Proposed PM"><Input value={pm} onChange={(e) => setPm(e.target.value)} /></Field>
        </div>
        <Field label="Project description" req hint="What exactly is being built or supplied — this is what ULM sanctions."><TA value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-24" /></Field>
        {kind === "boxbuild" && (
          <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-3">
            <p className="text-xs font-semibold text-amber-800 mb-2">Box-build RFQ acceptance criteria — every box must be ticked or this cannot be submitted</p>
            {criteria.map((q, i) => (
              <label key={i} className="flex items-start gap-2 text-sm py-1 cursor-pointer">
                <input type="checkbox" checked={!!checks[i]} onChange={(e) => setChecks({ ...checks, [i]: e.target.checked })} className="mt-0.5" />
                <span className="text-slate-700">{q}</span>
              </label>
            ))}
          </div>
        )}
        
        <p className="text-xs text-slate-500">Attach the RFQ file in the company's Drive folder (Documents card) — reviewers open the same folder.</p>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}
const c0 = (company) => company.official ? company.cid : "Eb-…";

/* ============================================================
   MY TASKS — today / tomorrow, grouped per company
   ============================================================ */

/* ── task-gate helpers ── */
const parseWin = (w) => {
  const s = String(w || "");
  const h = (n, ap, apOther) => { let x = Number(n) % 12; const a = (ap || apOther || "").toLowerCase(); if (a === "pm") x += 12; return x; };
  const p = (n) => String(n).padStart(2, "0");
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|–|-|—)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) return { start: p(h(m[1], m[3], m[6])) + ":" + (m[2] || "00"), end: p(h(m[4], m[6], m[3])) + ":" + (m[5] || "00") };
  // "by 2pm" / "before 14:00" / "at 2pm" — a deadline, not a window
  const d = s.match(/(?:by|before|till|until|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (d) return { start: "", end: p(h(d[1], d[3], "")) + ":" + (d[2] || "00") };
  return { start: "", end: "" };
};
// Normalise any transcript flavour into "Speaker: text" lines. Meet's live
// captions repeat rolling text; VTT/SRT carry cue numbers and timecodes. Left
// raw, all of it triples the token bill and confuses the reader.
function normaliseTranscript(input) {
  let raw = String(input || "").trim();
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const j = JSON.parse(raw);
      const sents = j.sentences || (j.transcript && j.transcript.sentences) || (Array.isArray(j) ? j : null);
      if (sents) raw = sents.map((x) => (x.speaker_name || x.speaker || "Speaker") + ": " + (x.text || x.raw_text || "")).join("\n");
    } catch (e) { /* not JSON after all */ }
  }
  const out = [];
  for (let l of raw.split(/\r?\n/)) {
    l = l.trim();
    if (!l) continue;
    if (/^WEBVTT/i.test(l) || /^NOTE\b/.test(l)) continue;
    if (/^\d+$/.test(l)) continue;                                      // SRT cue number
    if (/\d{1,2}:\d{2}(:\d{2})?[.,]?\d*\s*-->\s*/.test(l)) continue;    // timecode
    l = l.replace(/^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*/, "");
    l = l.replace(/^(.{1,40}?)\s*\(\d{1,2}:\d{2}(:\d{2})?\)\s*:?\s*/, "$1: ");
    l = l.replace(/<[^>]+>/g, "");
    if (!l.trim()) continue;
    const prev = out[out.length - 1];
    if (prev === l) continue;
    if (prev && (prev.endsWith(l) || l.startsWith(prev))) { out[out.length - 1] = l.length > prev.length ? l : prev; continue; }
    out.push(l);
  }
  const merged = [];
  for (const l of out) {
    const m = l.match(/^([A-Z][\w .'-]{1,38}):\s*(.*)$/);
    const last = merged[merged.length - 1];
    if (m && last && last.speaker === m[1]) { last.text += " " + m[2]; continue; }
    merged.push(m ? { speaker: m[1], text: m[2] } : { speaker: "", text: l });
  }
  const speakers = [...new Set(merged.map((x) => x.speaker).filter(Boolean))];
  const text = merged.map((x) => (x.speaker ? x.speaker + ": " : "") + x.text).join("\n");
  return { text, speakers, words: text ? text.split(/\s+/).length : 0, chars: text.length };
}

// Reading a real call is a different job from reading a typed note: most of a
// transcript is chatter, and only the commitments matter.
const scrumTranscriptSystem = (date, users, companies, attendance) => [
  "You are the Elecbits Sales OS scrum-call reader. You are given the RAW, UNEDITED transcript of the 'Eb - Daily scrum' Google Meet: speech-to-text, no punctuation discipline, people talking over each other, names misspelt by the transcriber. Your job is to return the day's COMMITTED WORK — not a summary of the conversation.",
  "DATE OF THE CALL: " + date,
  "TEAM ROSTER (every owner must be one of these people; transcriber spellings vary — 'Akash', 'akash s', 'Aakash' are the same person): " + users.filter((u) => u.active !== false).map((u) => u.name).join(", "),
  "COMPANIES with their account owners (match a client mentioned even loosely — 'Sunrise Company' means 'Sunrise Retail Tech'): " + companies.map((c) => { const o = users.find((u) => u.id === c.accountOwner); return c.name + (o ? " (owner: " + o.name + ")" : ""); }).join(", "),
  attendance ? "MARKED PRESENT BEFORE THE CALL WAS READ: " + attendance : "",
  "",
  "WHAT COUNTS AS A TASK — extract it only if a human will DO something after this call:",
  "  · an explicit commitment ('I'll send Sunrise the quote by 2')",
  "  · an instruction that was accepted ('Ankit, call Nevon today' — 'ok, done by 1')",
  "  · a promise made to a client, repeated in the call ('I told them Friday')",
  "  · a decision that requires an action to become real",
  "  · an if/else contingency ('if Greenline shares the BOM, price it; if not, chase the SPOC')",
  "",
  "WHAT TO THROW AWAY — greetings, roll-call, 'can you hear me', screen-share fumbling, small talk, jokes, opinions with no action, someone restating another person's point, and STATUS REPORTS ABOUT WORK ALREADY FINISHED. A 5,000-word scrum contains 6 to 15 real tasks. If you return 40 you have transcribed chatter; if you return 2 you have missed commitments.",
  "NEVER INVENT. If a time, a company or an owner was not said, leave the field empty. An empty field is correct; a guessed field is a lie the team will act on.",
  "AGREEMENT: if work was assigned but nobody accepted it, still extract it and set agreed=false. If something was raised and explicitly dropped in the call, do not extract it at all.",
  "OWNERS: 'I' and 'me' mean the person speaking that line. 'the account owner' means that company's owner from the list above — put the roster NAME, never the phrase. If genuinely unattributed, leave owner empty rather than defaulting it to anyone.",
  "TIME WINDOWS: 24h HH:MM only. 'by 2' → end 14:00, start empty. '12 to 1' → 12:00–13:00. 'first thing' / 'morning' → empty. 'end of day' → end 18:30.",
  "THE DAY: put it in \"date\" as YYYY-MM-DD. No day said = " + date + "; 'tomorrow' = the day after " + date + "; a weekday name = the next such day on or after " + date + ". Work promised for tomorrow must land on tomorrow, not on the day of the call.",
  "STEPS: when someone spelt out how they will do it, break that into short imperative steps. A one-action commitment has no steps — leave the array empty rather than restating the task.",
  "CONDITIONS: every if/else heard in the call becomes a STRUCTURED row — the condition, the action, and a timebox in minutes if one was said. 'if they don't reply in an hour, call the SPOC' is {if:\"they don't reply\", then:\"call the SPOC\", timeboxMinutes:60}. Never leave a contingency inside the task sentence.",
  "EVIDENCE: every task carries \"said\" — the verbatim fragment of the transcript it came from, 140 characters maximum, copied exactly, so a human can check you in two seconds. A task with no quotable line is a task you invented: drop it.",
  "TASK TEXT: action-first and short — 'Send Sunrise Retail the pilot quote', not 'Akash mentioned that he would probably try to send'. Keep IDs, part numbers and figures verbatim.",
  "",
  "Reply with ONLY one line, valid JSON, no markdown, no preamble:",
  "SCRUM_JSON {\"summary\":\"one line on what this call actually committed to\",\"speakers\":[{\"heard\":\"label as it appears\",\"name\":\"roster name or empty\",\"guest\":false}],\"tasks\":[{\"owner\":\"roster name or empty\",\"task\":\"...\",\"company\":\"exact company name or empty\",\"date\":\"YYYY-MM-DD\",\"start\":\"HH:MM or empty\",\"end\":\"HH:MM or empty\",\"steps\":[\"\"],\"conditions\":[{\"if\":\"\",\"then\":\"\",\"timeboxMinutes\":60}],\"agreed\":true,\"said\":\"verbatim quote, max 140 chars\"}],\"blockers\":[{\"what\":\"...\",\"who\":\"roster name or empty\"}],\"decisions\":[\"...\"],\"ignored\":\"one line naming what you deliberately left out\"}",
].filter(Boolean).join("\n");

const overdueSecs = (t) => {
  if (!t.due || t.status === "done") return 0;
  const end = new Date(t.due + "T" + (t.windowEnd || "23:59") + ":00");
  return Math.max(0, Math.floor((Date.now() - end.getTime()) / 1000));
};
const fmtDur = (s) => { const p = (n) => String(n).padStart(2, "0"); return p(Math.floor(s / 3600)) + ":" + p(Math.floor((s % 3600) / 60)) + ":" + p(s % 60); };

/* ============================================================
   TASK CLOSE FLOW — work window → honesty gate → AI verdict /
   branch sub-tasks. The PMS closure pattern, on sales tasks.
   ============================================================ */
/* A brief is only usable when it has the full modern shape — prep AND close
   arrays plus the evidence block. Briefs written by earlier versions of this
   flow miss pieces; rendering them raw crashes the modal, so they are
   re-fetched instead. */
const briefOk = (b) => !!(b && b.evidence && Array.isArray(b.prep) && Array.isArray(b.close) && b.close.length);

/* Fetch (or recall) the brief for a task. Never throws, never blocks the UI:
   a dead network yields the local brief instead. */
async function getBrief(t, comp, who) {
  const cached = (t.ai || {}).brief;
  if (briefOk(cached)) return cached;
  try {
    const reply = await withTimeout(
      askClaude(briefSystem(t, comp, who), [{ role: "user", content: "Brief me on this task." }]), 12000);
    return cleanBrief(extractMarkedJSON(reply, "BRIEF_JSON")) || fallbackBrief(t);
  } catch (e) { return fallbackBrief(t); }
}

function TaskCloseFlow({ me, data, task: t, onClose, saveTasks }) {
  const { users, companies, tasks } = data;
  const W = t.work || {}, A = t.ai || {};
  const comp = companies.find((c) => c.id === t.companyId);
  const who = users.find((u) => u.id === t.assignee);
  const deptHead = users.find((u) => u.role === "dept_head" && u.active !== false);
  const [brief, setBrief] = useState(briefOk(A.brief) ? A.brief : null);
  const [step, setStep] = useState("close"); // close | verdict | branch
  const [answers, setAnswers] = useState(() => {
    const seed = {};
    if (!briefOk(A.brief)) return seed;
    A.brief.close.forEach((q, i) => {
      const prior = (A.qa || []).find((x) => x.q === q);
      if (prior && prior.a) seed[i] = prior.a;
      else if ((W.prepAnswers || {})[i] && String(W.prepAnswers[i]).length > 12 && A.brief.prep.length === A.brief.close.length) seed[i] = W.prepAnswers[i];
    });
    return seed;
  });
  const [file, setFile] = useState(W.file || "");
  const [path, setPath] = useState(W.path || (comp ? "/Eb-07-Sales/" + driveFolderName(comp) + "/" : ""));
  const [link, setLink] = useState(W.link || "");
  const [checking, setChecking] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const [escalate, setEscalate] = useState(!!t.escalated);
  const [showEsc, setShowEsc] = useState(false);
  const [blocker, setBlocker] = useState("");
  const [subs, setSubs] = useState([]);

  // A task started before this flow existed has no brief — fetch on open.
  useEffect(() => {
    let alive = true;
    if (!brief) getBrief(t, comp, who).then((b) => { if (alive) setBrief(b); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (verdict && verdict.pass) { const h = setTimeout(onClose, 1500); return () => clearTimeout(h); }
  }, [verdict]);

  const patch = (fields) => {
    const next = { ...t, ...fields, escalated: escalate || fields.escalated || false };
    saveTasks(tasks.map((x) => (x.id === t.id ? next : x)));
  };

  const qList = brief ? brief.close : [];
  const qa = qList.map((q, i) => ({ q, a: answers[i] || "" }));
  const evKind = (brief && brief.evidence && brief.evidence.kind) || "none";
  const needsEvidence = evKind !== "none";
  const allAnswered = qList.length > 0 && qList.every((_, i) => String(answers[i] || "").trim());

  const closeTask = async () => {
    if (!brief) return;
    setBusy(true);
    const workOut = { ...W, prepAnswers: W.prepAnswers || {}, file: needsEvidence ? file : "", path: needsEvidence ? path : "",
      link: needsEvidence ? link : "", what: qa.map((x) => x.q + " — " + x.a).join(" · ") };
    // Claiming a file is not the same as saving one — look in the folder.
    let driveCheck = "";
    if (needsEvidence && file.trim() && comp) {
      setChecking("Looking for “" + file.trim() + "” in the Drive folder…");
      try {
        const r = await withTimeout(drive.verify(driveFolderName(comp), file.trim()), 12000);
        driveCheck = r && r.found
          ? "FOUND — " + r.matches.map((m) => m.name + " (in " + m.where + ")").join("; ")
          : "NOT FOUND — nothing matching that name in " + (r && r.folderFound ? "the company folder or its sub-folders" : "Drive (the folder itself is not shared with this tool)");
        workOut.driveCheck = driveCheck;
      } catch (e) { driveCheck = ""; }
      setChecking("");
    }
    try {
      const reply = await withTimeout(
        askClaude(verdictSystem(t, comp, brief, qa, file, path, link, driveCheck), [{ role: "user", content: "Judge this closure." }]), 20000);
      const v = extractMarkedJSON(reply, "VERDICT_JSON");
      if (!v || typeof v.pass !== "boolean") throw new Error("unparseable");
      const out = { pass: !!v.pass, score: Number(v.score) || (v.pass ? 7 : 3), reasons: String(v.reasons || ""), offline: false };
      setVerdict(out);
      patch({ status: out.pass ? "done" : t.status, doneAt: out.pass ? nowTS() : null,
        work: workOut, ai: { ...A, brief, qa, ...out } });
    } catch (e) {
      // AI unreachable: judge locally so nobody is trapped with finished work.
      const artOk = !needsEvidence || (file.trim() && path.trim()) || link.trim();
      const solid = qa.every((x) => x.a.trim().length >= 12) && artOk;
      const out = { pass: solid, score: solid ? 6 : 3, offline: true,
        reasons: solid
          ? "Checked offline — the AI was unreachable, so this closed on your answers alone. Substance not verified."
          : (artOk ? "Checked offline — your answers are too thin to stand on their own. Add the who, the when, and the number."
                   : "Checked offline — this task produces a document, so it needs the file name and where you saved it.") };
      setVerdict(out);
      patch({ status: out.pass ? "done" : t.status, doneAt: out.pass ? nowTS() : null,
        work: workOut, ai: { ...A, brief, qa, ...out } });
    }
    setBusy(false);
    setStep("verdict");
  };

  const suggestSubs = async () => {
    setBusy(true);
    try {
      const sys = "Break the remaining or blocked work on this task into 2 to 4 concrete next actions. Imperative titles, realistic minutes."
        + "\nTASK: " + t.title + (comp ? " (company: " + comp.name + ")" : "")
        + "\nWHAT REMAINS / BLOCKER: " + (blocker || "(unstated)")
        + "\nReply with ONLY: BRANCH_JSON {\"subtasks\":[{\"title\":\"...\",\"mins\":30}]}";
      const reply = await withTimeout(askClaude(sys, [{ role: "user", content: "Propose the next actions." }]), 15000);
      const out = extractMarkedJSON(reply, "BRANCH_JSON");
      const list = out && Array.isArray(out.subtasks) ? out.subtasks : null;
      if (list && list.length) setSubs(list.slice(0, 4).map((s) => ({ title: String(s.title || ""), mins: Number(s.mins) || 30, assignee: t.assignee })));
    } catch (e) { /* manual rows remain */ }
    setBusy(false);
  };

  const createSubs = () => {
    const fresh = subs.filter((s) => s.title.trim()).map((s) => ({
      id: uid(), companyId: t.companyId || (matchCompany(s.title + " " + t.title + " " + blocker, companies) || {}).id || "",
      dealId: t.dealId, assignee: s.assignee || t.assignee, author: me.id,
      title: s.title.trim(), details: blocker ? "From blocker: " + blocker : "", due: todayStr(),
      status: "open", source: "system", createdAt: nowTS(), windowStart: "", windowEnd: "",
      work: {}, ai: {}, escalated: false, branchedFrom: t.id,
    }));
    const closed = { ...t, status: "done", doneAt: nowTS(), escalated: escalate,
      work: { ...W, blocker }, ai: { ...A, brief, verdict: "branched", reasons: blocker } };
    saveTasks([...fresh, ...tasks.map((x) => (x.id === t.id ? closed : x))]);
    onClose();
  };

  const EscBlock = showEsc ? (
    <label className="flex items-start gap-2 border border-dashed border-slate-300 rounded-lg p-3 cursor-pointer mt-3">
      <input type="checkbox" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} className="mt-0.5" />
      <span className="text-sm text-slate-700">Shall I escalate this to {deptHead ? deptHead.name : "the dept head"}?
        <span className="block text-xs text-slate-400">Escalations are tracked in the KPI block — fewer is better, but a needed escalation beats a silently stuck task.</span></span>
    </label>
  ) : null;

  return (
    <Modal title={"Close: " + t.title} onClose={onClose} wide
      footer={step === "close" ? <>
        <button onClick={() => { setSubs([{ title: "", mins: 30, assignee: t.assignee }]); setStep("branch"); suggestSubs(); }}
          className="text-xs text-slate-500 hover:text-slate-800">Not finished? Split what's left →</button>
        <button onClick={() => setShowEsc(!showEsc)} className="text-xs text-slate-500 hover:text-slate-800 ml-3 mr-auto">
          Escalate to {deptHead ? deptHead.name : "dept head"}
        </button>
        {checking && <span className="text-[11px] text-slate-400 mr-2 self-center">{checking}</span>}
        <Btn kind="primary" disabled={busy || !brief || !allAnswered} onClick={closeTask}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Checking…</> : <><CheckCircle2 size={14} /> Close task</>}
        </Btn>
      </> : null}>

      {step === "close" && (!brief ? (
        <p className="text-sm text-slate-400 flex items-center gap-2 py-6"><Loader2 size={15} className="animate-spin" /> Reading the task…</p>
      ) : (<>
        <p className="text-xs text-slate-400 -mt-2 mb-4">
          {[comp && comp.name, who && who.name].filter(Boolean).join(" · ")}
          {(comp || who) ? " · " : ""}the gate protects closure quality
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <TaskScopeCard task={t} comp={comp} brief={brief} companies={companies}
            onLink={(id) => saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, companyId: id } : x)))} />
          <div className="space-y-3">
            <div>
              <Lbl>How did it go?</Lbl>
              <p className="text-[11px] text-slate-400 mt-1">Short answers are fine — name the person, the date, the number.</p>
            </div>
            {qList.map((q, i) => (
              <div key={i}>
                <p className="text-[12.5px] text-slate-700 mb-1.5">{q}</p>
                <TA className="min-h-14" value={answers[i] || ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} />
              </div>
            ))}
            {needsEvidence && (
              <div className="border-t border-slate-200 pt-3 space-y-3">
                <Lbl>{evKind === "link" ? "Minutes or recording" : "The document"}</Lbl>
                <p className="text-[11px] text-slate-400 -mt-1.5">
                  {evKind === "link"
                    ? "Save the MoM in the company's Drive folder and name it below, or paste a link — Fireflies transcript, Meet recording, or the doc itself."
                    : "Name the file and where you saved it. The gate looks for it in the Drive folder."}
                </p>
                <div>
                  <p className="text-[12.5px] text-slate-700 mb-1.5">{evKind === "link" ? "MoM / file name in Drive" : "File produced (name)"}</p>
                  <Input value={file} onChange={(e) => setFile(e.target.value)}
                    placeholder={evKind === "link" ? "e.g. 2026-08-14_MoM_Sunrise-pricing.docx" : "e.g. 2026-08-14_quote_FMS-200.pdf"} />
                </div>
                {file.trim() && (
                  <div>
                    <p className="text-[12.5px] text-slate-700 mb-1.5">Stored at (Drive path)</p>
                    <Input value={path} onChange={(e) => setPath(e.target.value)} />
                  </div>
                )}
                <div>
                  <p className="text-[12.5px] text-slate-700 mb-1.5">
                    {evKind === "link" ? "…or paste a link" : "…or a link, if it lives outside Drive"}
                  </p>
                  <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https:// — Fireflies, Meet recording, Drive link" />
                </div>
                <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                  <Search size={12} className="mt-0.5 flex-none" />
                  Name a file and the gate will go into the Drive folder and check it is really there.
                </p>
              </div>
            )}
            {EscBlock}
          </div>
        </div>
      </>))}

      {step === "verdict" && verdict && (
        <div className="space-y-3">
          <div className={cls("rounded-xl border p-4", verdict.pass ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300")}>
            <p className={cls("text-sm font-bold flex items-center gap-2", verdict.pass ? "text-green-700" : "text-red-700")}>
              {verdict.pass ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {verdict.pass ? "CLOSED" : "NOT YET"} · {verdict.score}/10
              {verdict.offline && <Chip color="amber">checked offline</Chip>}
            </p>
            <p className="text-sm text-slate-700 mt-1">{verdict.reasons}</p>
          </div>
          {verdict.pass
            ? <div className="flex justify-end"><Btn kind="primary" onClick={onClose}><Check size={14} /> Done</Btn></div>
            : <div className="flex gap-2">
                <Btn onClick={() => { setVerdict(null); setStep("close"); }}>Fix my answers</Btn>
                <Btn kind="primary" onClick={() => { setSubs([{ title: "", mins: 30, assignee: t.assignee }]); setStep("branch"); suggestSubs(); }}>Split what's left</Btn>
              </div>}
        </div>
      )}

      {step === "branch" && (
        <div className="space-y-3">
          <Field label="What's the blocker / what remains?">
            <TA value={blocker} onChange={(e) => setBlocker(e.target.value)} className="min-h-16" placeholder="e.g. client hasn't shared the BOM — quote can't be finalised" />
          </Field>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sub-tasks</p>
            <button onClick={suggestSubs} disabled={busy} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} AI re-suggest from blocker
            </button>
          </div>
          {subs.map((s, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input value={s.title} onChange={(e) => setSubs(subs.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="next action" />
              <Sel className="w-40" value={s.assignee} onChange={(e) => setSubs(subs.map((x, j) => j === i ? { ...x, assignee: e.target.value } : x))}>
                {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Sel>
              <Input type="number" className="w-20" value={s.mins} onChange={(e) => setSubs(subs.map((x, j) => j === i ? { ...x, mins: e.target.value } : x))} />
              <span className="text-xs text-slate-400">min</span>
              <button onClick={() => setSubs(subs.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
            </div>
          ))}
          <button onClick={() => setSubs([...subs, { title: "", mins: 30, assignee: t.assignee }])} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={11} /> add row</button>
          <Btn kind="primary" disabled={!subs.some((s) => s.title.trim())} onClick={createSubs}><ArrowRight size={14} /> Create sub-tasks &amp; close this as branched</Btn>
          {EscBlock}
        </div>
      )}
    </Modal>
  );
}

/* Small-caps section label — the PMS's typographic signature. */
function Lbl({ children, className }) {
  return <p className={cls("text-[10.5px] font-bold text-slate-400 uppercase tracking-[0.06em]", className)}>{children}</p>;
}

/* The scope card that sits on the left of both task modals, exactly as the
   ODM PMS lays it out: what the task is, where its files live, the quality
   bar, and the deadline with a live overdue counter. */
function TaskScopeCard({ task: t, comp, brief, companies, onLink }) {
  const secs = overdueSecs(t);
  const suggestion = !comp && companies ? matchCompany(t.title + " " + (t.details || ""), companies) : null;
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3.5">
      <div>
        <Lbl>Scope &amp; guidance</Lbl>
        <p className="text-sm text-slate-800 mt-1.5">{t.title}</p>
        {t.details && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{t.details}</p>}
        {brief && (brief.kind || brief.tip) && (
          <div className="flex items-start gap-2 mt-2 flex-wrap">
            {brief.kind && <Chip color="blue">{brief.kind}</Chip>}
            {brief.tip && <span className="text-xs text-slate-600 flex-1">{brief.tip}</span>}
          </div>
        )}
      </div>
      {!comp && onLink && (
        <div className="border-t border-slate-200 pt-3">
          <Lbl>Company</Lbl>
          <p className="text-[11px] text-slate-400 mt-1 mb-1.5">
            Not linked to a company, so it will not show up on any client's record.
            {suggestion ? " This looks like " + suggestion.name + "." : ""}
          </p>
          <div className="flex gap-2">
            <Sel className="flex-1" value="" onChange={(e) => e.target.value && onLink(e.target.value)}>
              <option value="">— pick a company —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Sel>
            {suggestion && <Btn size="sm" onClick={() => onLink(suggestion.id)}>Link {suggestion.name.split(" ")[0]}</Btn>}
          </div>
        </div>
      )}
      {comp && (
        <div className="border-t border-slate-200 pt-3">
          <Lbl>Where things live</Lbl>
          <p className="text-xs text-blue-700 font-mono mt-1.5 break-all">/Eb-07-Sales/{driveFolderName(comp)}/</p>
          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            Everything for {comp.name} — RFQs, quotes, drawings, mails worth keeping — belongs in that folder.
            File names are not consistent, so look at what is actually in there rather than expecting a name.
          </p>
        </div>
      )}
      <div className="bg-blue-50/60 border border-blue-100 rounded-md px-3 py-2.5">
        <p className="text-[11px] text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-700">Task quality bar:</span>{" "}
          {(() => {
            const k = (brief && brief.evidence && brief.evidence.kind) || "none";
            if (k === "file") return <>this one produces {(brief.evidence.what) || "a document"} — name the file and where you saved it, and the gate will check the folder. A task without its artifact is not a finished task.</>;
            if (k === "link") return <>this one leaves minutes. Save the MoM in the company folder, or paste a Fireflies / Meet link. A meeting with no record did not happen.</>;
            return <>this one produces an outcome, not a document. Name the person, the date and what was agreed — that is the artifact.</>;
          })()}
        </p>
      </div>
      <p className="text-[11px] text-slate-400">
        Due {t.due ? fmtDate(t.due) : "—"}
        {(t.windowStart || t.windowEnd) && <span className="font-mono"> · {t.windowStart || "…"}–{t.windowEnd || "…"}</span>}
        {secs > 0 && <span className="ml-2 text-red-600 font-mono font-semibold">OVERDUE {fmtDur(secs)}</span>}
      </p>
    </div>
  );
}

/* WORK WINDOW — the PMS layout: full scope on the left, your prep on the
   right. Opened from the row while a task is in progress. */
/* ── WHICH STAGE IS THIS TASK PART OF? ─────────────────────────────────────
   The PMS equivalent searches 308 process steps. Sales has ten pipeline
   stages, so this is a list rather than a search — but the point is the same:
   link it once, and the task opens with what that stage demands and what it
   has to leave behind. */
function StagePicker({ task, onPick }) {
  const suggestion = useMemo(() => {
    // A task raised against a company usually belongs to that deal's current
    // stage. Offered, never applied — a guess written to the record silently
    // is worse than no guess.
    const txt = String(task.title || "").toLowerCase();
    const hit = STAGES.find((st) => txt.includes(st.name.toLowerCase()));
    return hit ? hit.key : "";
  }, [task.title]);

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Which stage of the deal is this?
        </span>
      </div>
      <p className="text-[11.5px] text-slate-400 mt-1 mb-2">
        Link it once and this task opens with what the stage needs and what it should produce.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <Sel className="w-52" value={task.stage || ""} onChange={(e) => onPick(e.target.value)}>
          <option value="">— no stage (admin work) —</option>
          {STAGES.map((st, i) => (
            <option key={st.key} value={st.key}>{String(i + 1).padStart(2, "0")} · {st.name}</option>
          ))}
        </Sel>
        {!task.stage && suggestion && (
          <button onClick={() => onPick(suggestion)} className="text-[11.5px] text-blue-600 hover:underline">
            looks like {stageName(suggestion)} — use that?
          </button>
        )}
      </div>
    </div>
  );
}

/* ── WHAT THE STAGE ASKS OF YOU ────────────────────────────────────────────
   The PMS reads this off a generated process map: the step's action, its
   entry and exit questions, its template and the exact Drive path its output
   is filed at. Sales has no such map, so the parts here come from different
   places and are labelled accordingly — the exit questions are the real gate
   the deal will be interviewed against, the rest is a first draft in
   src/data/stages.ts for the team to correct. */
function StageGuidance({ task, comp, onPick }) {
  const g = guideFor(task.stage);
  if (!g) return null;
  const i = stageIdx(task.stage);
  const exits = DEFAULT_GATES[task.stage] || [];
  const entries = entryGatesFor(task.stage);
  const folder = comp ? driveFolderName(comp) : "";

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Chip color="purple">Stage {String(i + 1).padStart(2, "0")}</Chip>
        <Chip color="slate">{stageName(task.stage)}</Chip>
        <button onClick={() => onPick("")} className="ml-auto text-[11px] text-slate-400 hover:underline">not this stage?</button>
      </div>

      <p className="text-[12.5px] leading-relaxed mb-3"><b>{g.action}:</b> {g.whatToDo}</p>

      <div className="flex flex-col gap-1.5 mb-3">
        <div className="flex gap-2 text-[11.5px] leading-snug">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-none mt-1.5" />
          <span><b className="text-amber-600">Before you start</b> <span className="text-slate-600">— {g.entry}</span></span>
        </div>
        <div className="flex gap-2 text-[11.5px] leading-snug">
          <span className="w-1.5 h-1.5 rounded-full bg-green-600 flex-none mt-1.5" />
          <span><b className="text-green-700">Before you close</b> <span className="text-slate-600">— the stage gate will ask {exits.length} question{exits.length === 1 ? "" : "s"}</span></span>
        </div>
      </div>

      {/* The real gate, verbatim. Not a paraphrase — this is the list the
          stage-gate interview runs against, so seeing it now is the whole
          advantage of linking the task to a stage. */}
      {exits.length > 0 && (
        <div className="border border-slate-200 rounded-lg bg-white px-3 py-2.5 mb-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">What the gate will ask</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            {exits.map((q, n) => <li key={n} className="text-[11.5px] text-slate-600">{q}</li>)}
          </ol>
        </div>
      )}

      {entries.length > 0 && (
        <details className="mb-2">
          <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">
            {entries.length} thing{entries.length === 1 ? "" : "s"} the previous stage should already have answered
          </summary>
          <ol className="list-decimal ml-5 mt-1 space-y-0.5">
            {entries.map((q, n) => <li key={n} className="text-[11px] text-slate-400">{q}</li>)}
          </ol>
        </details>
      )}

      <div className="border border-slate-200 rounded-lg bg-slate-50 px-3 py-2.5 mb-2">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">This stage should leave behind</p>
        <p className="text-[11.5px] text-slate-600">{g.produces}</p>
        {folder && <p className="font-mono text-[10.5px] text-blue-600 mt-1 break-all">Drive · {folder}</p>}
      </div>

      <div className="border border-slate-200 rounded-lg bg-slate-50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">How to do it</p>
        <p className="text-[11.5px] text-slate-600 leading-relaxed">{g.guidance}</p>
      </div>
    </div>
  );
}

/* ── TALK IT THROUGH WHILE YOU WORK ────────────────────────────────────────
   The PMS's WorkChat can read AND WRITE the step's Drive document. Sales
   cannot: its Drive layer lists, verifies and files, but nothing here edits a
   document in place. So this is the readable half — a conversation that knows
   the task, the company, the deal and the stage, and can go and look in the
   company's Drive folder to answer a question about it.

   Kept ON the task (t.workChat), not in the chats table: this is working
   context for one job, and it should die with the task rather than turn into
   another thread somebody has to keep. Trimmed to the last 60 turns.        */
function TaskChat({ task: t, comp, data, saveTasks, saveCompanies }) {
  const { users, deals, tasks } = data;
  const [msgs, setMsgs] = useState((t.work || {}).chat || []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [atts, setAtts] = useState([]);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e6 }); }, [msgs, busy]);
  const addFiles = (files) => { [...files].forEach((f) => fileToBlock(f).then((b) => b && setAtts((a) => [...a, b]))); };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.items || [])].map((it) => it.getAsFile && it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  // Recover a previous day's chat about this company from the work log.
  const [histDate, setHistDate] = useState("");
  const [hist, setHist] = useState(null);
  useEffect(() => {
    if (!histDate || !t.companyId) { setHist(null); return; }
    let a = true;
    loadClientLog(t.companyId).then((rows) => {
      if (!a) return;
      const all = rows.filter((r) => r.date === histDate).flatMap((r) => r.messages);
      const taskOnly = all.filter((m) => String(m.kind || "").startsWith("task"));
      setHist(taskOnly.length ? taskOnly : all);
    }).catch(() => a && setHist([]));
    return () => { a = false; };
  }, [histDate]);

  const persist = (next) => {
    setMsgs(next);
    const trimmed = next.slice(-60);
    saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, work: { ...(x.work || {}), chat: trimmed } } : x)));
  };

  // Executing what the conversation produced: facts onto the company record,
  // notes onto the activity trail, documents into the client's Drive folder.
  const runActs = async (list) => {
    const done = [];
    let nextCompanies = null;
    const FIELDS = { contactPerson: "contact person", designation: "designation", phone: "phone", email: "email", website: "website", address: "address", city: "city" };
    for (const a of Array.isArray(list) ? list : []) {
      try {
        if (a.type === "fact" && comp && FIELDS[a.field] && a.value != null && String(a.value).trim()) {
          const v = String(a.value).trim();
          nextCompanies = (nextCompanies || data.companies).map((c) => (c.id === comp.id
            ? { ...c, [a.field]: v, activity: [...(c.activity || []), { at: nowTS(), by: t.assignee, text: "Set " + FIELDS[a.field] + " = " + v + " (from the task chat)." }] } : c));
          done.push("✓ saved: " + FIELDS[a.field] + " = " + v + " — edit any time on the company Overview.");
        }
        if (a.type === "note" && comp && a.text) {
          nextCompanies = (nextCompanies || data.companies).map((c) => (c.id === comp.id
            ? { ...c, activity: [...(c.activity || []), { at: nowTS(), by: t.assignee, text: String(a.text).slice(0, 500) }] } : c));
          done.push("✓ noted on the company record.");
        }
        if (a.type === "file" && comp && a.fileName && a.content) {
          const okd = await drive.write(driveFolderName(comp), "", String(a.fileName), String(a.content));
          done.push(okd ? "✓ filed in Drive: " + a.fileName + " → " + driveFolderName(comp)
            : "✗ couldn't file " + a.fileName + " — is the client folder shared with the tool?");
        }
      } catch (e) { /* one bad action never sinks the chat */ }
    }
    if (nextCompanies && saveCompanies) saveCompanies(nextCompanies);
    return done;
  };

  const send = async () => {
    const q = draft.trim();
    if ((!q && !atts.length) || busy) return;
    const content = atts.length
      ? [...atts.map(({ _name, ...b }) => b), { type: "text", text: q || "See the attached." }]
      : q;
    const display = (q || "") + (atts.length ? (q ? "\n" : "") + atts.map((a) => "📎 " + a._name).join("  ") : "");
    const sentAtts = atts.map(({ _name, ...b }) => b);
    setAtts([]);
    const next = [...msgs, { role: "user", content, display, at: nowTS() }];
    persist(next); setDraft(""); setBusy(true); setNote("");

    const deal = deals.find((d) => d.companyId === t.companyId && !d.lost);
    const g = guideFor(t.stage);
    const owner = users.find((u) => u.id === t.assignee);
    const system = [
      "You are helping one person finish one task at Elecbits. Be short and concrete — they are mid-job, not reading a report.",
      "THE TASK: " + t.title,
      t.details ? "Detail: " + t.details : "",
      "Owner: " + (owner ? owner.name : "unassigned") + ". Due " + (t.due || "no date") +
        ((t.windowStart || t.windowEnd) ? ", window " + (t.windowStart || "…") + "–" + (t.windowEnd || "…") : "") + ".",
      (t.steps || []).length ? "Steps already written on it: " + t.steps.join(" · ") : "",
      (t.conditions || []).length ? "Contingencies: " + t.conditions.map((c) => "if " + c.if + " then " + c.then).join(" · ") : "",
      comp ? "THE ACCOUNT: " + comp.name + (comp.cid ? " (" + comp.cid + ")" : "") +
        [comp.city && ", " + comp.city, comp.industry && ", " + comp.industry].filter(Boolean).join("") +
        (comp.whatTheyDo ? ". They do: " + comp.whatTheyDo : "") : "No company linked to this task.",
      deal ? "THE DEAL: " + (deal.did || "") + " at stage " + stageName(deal.stage) + ", value " + fmtINR(deal.value) + "." : "",
      g ? "THIS TASK'S STAGE — " + stageName(t.stage) + ". " + g.action + ": " + g.whatToDo +
          " It should leave behind: " + g.produces +
          " The gate will ask: " + (DEFAULT_GATES[t.stage] || []).join(" | ") : "",
      comp ? "Their Drive folder is named exactly: " + driveFolderName(comp) : "",
      "",
      DRIVE_TOOL_PROMPT,
      "",
      "YOUR REAL JOB — carry this task to done:",
      "1. TAKE the information the person has (ask for what is missing — the who, the when, the number; they can paste screenshots and attach files right here).",
      "2. CHECK its quality against what this task must produce. Thin or mismatched data gets a follow-up question, not a filing.",
      "3. When the data is good, ACT — file it. End your reply with ONE line:",
      'TASK_ACT_JSON {"actions":[{"type":"fact","field":"contactPerson|designation|phone|email|website|address|city","value":"..."} | {"type":"note","text":"a dated note for the company activity trail"} | {"type":"file","fileName":"e.g. Stakeholder-Notes-' + todayStr() + '.txt","content":"the document text, complete"}]}',
      "fact = updates the company record (the person can edit it later on the Overview). note = the activity trail. file = creates the document in the client's Drive folder. Never emit the line when nothing was collected; never show its contents in prose.",
      "Answer from what you are given. If you genuinely do not know, say so and say what would settle it — never invent a file, a figure or a commitment.",
    ].filter(Boolean).join("\n");

    try {
      const convo = next.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const { reply, notes } = await askWithDrive(system, convo);
      const acts = extractMarkedJSON(reply, "TASK_ACT_JSON");
      const done = await runActs(acts && acts.actions);
      const shown = stripToolLines(String(reply).replace(/TASK_ACT_JSON[\s\S]*$/, "")).trim()
        + (done.length ? "\n\n" + done.join("\n") : "");
      persist([...next, { role: "assistant", content: shown, at: nowTS() }]);
      if (t.companyId) logClientChat(t.assignee, t.companyId, "task: " + String(t.title).slice(0, 40),
        [{ role: "user", content: display, atts: sentAtts }, { role: "assistant", content: shown }]);
      if (notes.length) setNote(notes.join(" · "));
    } catch (e) {
      persist([...next, { role: "assistant", content: "Could not reach the assistant. Your message is kept — try again.", at: nowTS() }]);
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col border border-slate-200 rounded-lg bg-white overflow-hidden" style={{ minHeight: 220 }}>
      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
        <Bot size={13} className="text-blue-600" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mr-auto">Talk it through</span>
        {t.companyId && <input type="date" value={histDate} onChange={(e) => setHistDate(e.target.value)} max={todayStr()}
          className="text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-500 bg-white" title="Read a previous day's chat" />}
        {msgs.length > 0 && !histDate && (
          <button onClick={() => persist([])} className="text-[11px] text-slate-400 hover:text-red-500">clear</button>
        )}
      </div>
      {histDate && (
        <div className="px-3 py-1 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <span className="text-[10.5px] text-amber-800 mr-auto">log · {fmtDate(histDate)}</span>
          <button onClick={() => setHistDate("")} className="text-[10.5px] text-blue-600 hover:underline">back to live →</button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ maxHeight: 260 }}>
        {histDate ? (<>
          {hist === null && <p className="text-[11.5px] text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> opening the log…</p>}
          {hist && !hist.length && <p className="text-[11.5px] text-slate-400">Nothing logged for {fmtDate(histDate)}.</p>}
          {(hist || []).map((m, i) => (
            <div key={i} className={cls("text-[12.5px] leading-relaxed", m.role === "user" ? "text-slate-800" : "text-slate-600")}>
              {m.kind && <span className="text-[9px] font-bold uppercase tracking-wide text-purple-500 mr-1.5">{m.kind}</span>}
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mr-1.5">{m.role === "user" ? "you" : "ai"}</span>
              <span className="whitespace-pre-wrap">{typeof m.content === "string" ? m.content : "📎"}</span>
              {(m.images || []).length > 0 && <span className="flex gap-1.5 mt-1 flex-wrap">
                {m.images.slice(0, 4).map((src, k) => <a key={k} href={src} target="_blank" rel="noreferrer"><img src={src} alt="attachment" className="h-16 rounded border border-slate-200 object-cover" /></a>)}
              </span>}
            </div>
          ))}
        </>) : (<>
          {msgs.length === 0 && (
            <p className="text-[11.5px] text-slate-400">
              It knows this task, the account, the deal and what the stage has to produce — and it can look in {comp ? "their" : "the"} Drive folder. Give it what you have (paste a screenshot straight in) — it checks the quality, then files it: the record, the trail, or a document in the client's folder.
            </p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cls("text-[12.5px] leading-relaxed", m.role === "user" ? "text-slate-800" : "text-slate-600")}>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mr-1.5">{m.role === "user" ? "you" : "ai"}</span>
              <span className="whitespace-pre-wrap">{m.display || (typeof m.content === "string" ? m.content : "📎")}</span>
            </div>
          ))}
          {busy && <p className="text-[11.5px] text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> thinking…</p>}
          {note && !busy && <p className="text-[10.5px] text-slate-400 italic">{note}</p>}
        </>)}
      </div>
      <div className="border-t border-slate-100 p-2">
        {atts.length > 0 && (
          <p className="text-[10.5px] text-slate-500 mb-1">{atts.map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 mr-2.5">📎 {a._name}
              <button onClick={() => setAtts(atts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={10} /></button></span>
          ))}</p>
        )}
        <div className="flex items-center gap-1.5">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files || []); e.target.value = ""; }} />
          <button title="Attach a file or image" onClick={() => fileRef.current && fileRef.current.click()}
            className="text-slate-400 hover:text-blue-600 p-1 flex-none"><Paperclip size={14} /></button>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="what should I do next? (paste an image straight in)" className="text-[12.5px]" />
          <Btn size="sm" kind="primary" disabled={busy || (!draft.trim() && !atts.length)} onClick={send}><Send size={12} /></Btn>
        </div>
      </div>
    </div>
  );
}

/* Where the deal exactly is — no questionnaires, just the position: the
   phase strip, why it sits there, and the committed step. */
function DealPosition({ data, companyId }) {
  const deal = (data.deals || []).filter((x) => x.companyId === companyId && !x.lost && x.stage !== "po")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (!deal) return null;
  const phase = deal.temperature || "cold";
  const idx = ["cold", "warm", "rfq", "hot"].indexOf(phase);
  const vel = tempVelocity(deal);
  const ns = nextStepState(deal);
  return (
    <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Where the deal is · <span className="font-mono">{deal.did}</span></p>
      <div className="flex gap-1">
        {["cold", "warm", "rfq", "hot"].map((k, i) => (
          <div key={k} className="flex-1 text-center">
            <div className={cls("h-1.5 rounded-full", i < idx ? "bg-slate-300" : i === idx ? "bg-blue-500" : "bg-slate-100")} />
            <p className={cls("text-[10px] font-mono mt-1", i === idx ? "text-blue-700 font-bold" : "text-slate-400")}>{k}{i === idx ? " · " + vel[k] + "d" : ""}</p>
          </div>
        ))}
      </div>
      {deal.temperatureWhy && <p className="text-[11.5px] text-slate-600 mt-2 leading-snug">{deal.temperatureWhy}</p>}
      {ns.key === "overdue" ? <p className="text-[11.5px] font-semibold text-red-600 mt-1.5">Committed step OVERDUE since {fmtDate(deal.nextStepDue)}: {deal.nextStep}</p>
        : ns.key === "committed" ? <p className="text-[11.5px] text-slate-600 mt-1.5">next: {deal.nextStep}{deal.nextStepDue ? " · by " + fmtDate(deal.nextStepDue) : ""}</p>
        : <p className="text-[11.5px] text-amber-700 mt-1.5">no committed next step</p>}
    </div>
  );
}

function WorkWindow({ task: t, data, saveTasks, saveCompanies, onClose, onComplete }) {
  const { users, companies, tasks } = data;
  const comp = companies.find((c) => c.id === t.companyId);
  const who = users.find((u) => u.id === t.assignee);
  const [brief, setBrief] = useState(briefOk((t.ai || {}).brief) ? (t.ai || {}).brief : null);

  useEffect(() => {
    let alive = true;
    if (!brief) getBrief(t, comp, who).then((b) => {
      if (!alive) return;
      setBrief(b);
      saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, ai: { ...(x.ai || {}), brief: b } } : x)));
    });
    return () => { alive = false; };
  }, [t.id]);

  return (
    <Modal title={t.title} onClose={onClose} wide
      footer={<>
        <Btn onClick={onClose}>Save progress</Btn>
        <Btn kind="primary" onClick={onComplete}><CheckCircle2 size={14} /> Complete Now</Btn>
      </>}>
      <p className="text-xs text-slate-400 -mt-2 mb-4">
        {[comp && comp.name, who && who.name, (t.windowStart || t.windowEnd) ? (t.windowStart || "…") + "–" + (t.windowEnd || "…") : null]
          .filter(Boolean).join(" · ")} · scope and the deal's position on the left, the AI on the right
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <TaskScopeCard task={t} comp={comp} brief={brief} companies={companies}
            onLink={(id) => saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, companyId: id } : x)))} />
          {/* No questionnaires — just where the deal exactly is. */}
          <DealPosition data={data} companyId={t.companyId} />
        </div>
        <div className="space-y-3">
          <TaskChat task={t} comp={comp} data={data} saveTasks={saveTasks} saveCompanies={saveCompanies} />
        </div>
      </div>
    </Modal>
  );
}

/* My Tasks = one room for the whole working day: the Scrum Master chat on
   the left (free-flowing — it files next steps, marks activities, raises
   tasks), and the live task list on the right, where anything can also be
   finished by plain clicking. Same data, two doors. */
function MyTasksView({ me, data, saveTasks, saveScrums, saveDeals, saveCompanies, openCompany }) {
  const { users, companies, tasks } = data;
  const [scope, setScope] = useState("mine");
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: "", companyId: "", due: localISO(new Date(Date.now() + 86400000)), assignee: me.id });
  const today = todayStr();
  const tomorrow = localISO(new Date(Date.now() + 86400000));

  const canTeam = me.role !== "agent";
  const [group, setGroup] = useState("due"); // due | company | person
  const [personF, setPersonF] = useState("all");
  const [companyF, setCompanyF] = useState("all");
  const mine = tasks.filter((t) =>
    (scope === "mine" ? t.assignee === me.id : true) &&
    (personF === "all" || t.assignee === personF) &&
    (companyF === "all" || t.companyId === companyF) &&
    (showDone ? true : t.status !== "done"));
  const buckets = [
    ["Overdue", mine.filter((t) => t.status !== "done" && t.due && t.due < today)],
    ["Today", mine.filter((t) => t.due === today)],
    ["Tomorrow", mine.filter((t) => t.due === tomorrow)],
    ["Later / no date", mine.filter((t) => (!t.due || t.due > tomorrow) && !(t.status !== "done" && t.due && t.due < today))],
  ];

  const toggle = (t) => saveTasks(tasks.map((x) => x.id === t.id ? { ...x, status: "open", doneAt: null } : x));
  // Deleting is explicit — the sync layer never prunes, so the DB row must go here.
  const remove = (t) => { deleteTask(t.id); saveTasks(tasks.filter((x) => x.id !== t.id)); };

  /* Carried from the ODM PMS: a row offers only the buttons this viewer is
     allowed to press. Seeing a task is not the same as owning it — the
     Mine/Team toggle above decides what is on screen, this decides what can
     be done to it. Admin acts on anything; a dept head on their own team. */
  const teamIds = useMemo(() => new Set(teamOf(me, users).map((u) => u.id)), [me, users]);
  const canAct = (t) => t.assignee === me.id || t.author === me.id || me.role === "admin"
    || (me.role === "dept_head" && teamIds.has(t.assignee));

  /* Also from the PMS: deleting arms first and deletes second, and looking
     away for four seconds disarms it. remove() calls deleteTask() straight
     against the DB with no undo — one stray click must not be enough. One
     task armed at a time; the id lives here so a parent re-render (a filter
     change, a sync) cannot strand a row in the armed state. */
  const [armDel, setArmDel] = useState(null);
  useEffect(() => { if (!armDel) return; const h = setTimeout(() => setArmDel(null), 4000); return () => clearTimeout(h); }, [armDel]);
  const add = () => {
    if (!f.title.trim()) return;
    saveTasks([{ id: uid(), companyId: f.companyId || "", dealId: "", assignee: f.assignee, author: me.id, title: f.title.trim(), details: "", due: f.due || "", status: "open", source: "manual", createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "" }, ...tasks]);
    setAdding(false); setF({ ...f, title: "" });
  };

  const [closing, setClosing] = useState(null);   // the task being closed
  const [working, setWorking] = useState(null);   // task whose Work window is open
  // Start is instant: the row flips to "doing" with no modal and no AI wait.
  const startTask = (t) => {
    saveTasks(tasks.map((x) => (x.id === t.id
      ? { ...x, status: "doing", work: { ...(x.work || {}), startedAt: (x.work || {}).startedAt || nowTS() } }
      : x)));
    setWorking({ ...t, status: "doing" });
  };

  const TaskRow = ({ t }) => {
    const comp = companies.find((c) => c.id === t.companyId);
    const who = users.find((u) => u.id === t.assignee);
    const secs = overdueSecs(t);
    const W = t.work || {}, A = t.ai || {};
    const mayAct = canAct(t);
    return (
      <div>
        <div className="flex items-center gap-2.5 border border-slate-200 rounded-md px-3 py-2 bg-white">
          {t.status === "open" && <span className="w-4 h-4 rounded-full border border-slate-300 flex-none" />}
          {t.status === "doing" && (mayAct
            ? <button title="Complete this task" onClick={() => setClosing(t)} className="w-4 h-4 rounded-full border-2 border-blue-500 flex-none hover:bg-blue-50" />
            : <span className="w-4 h-4 rounded-full border-2 border-blue-500 flex-none" />
          )}
          {t.status === "done" && (mayAct
            ? <button title="Reopen" onClick={() => toggle(t)} className="w-4 h-4 rounded border bg-green-600 border-green-600 text-white flex-none flex items-center justify-center"><Check size={11} /></button>
            : <span className="w-4 h-4 rounded border bg-green-600 border-green-600 text-white flex-none flex items-center justify-center"><Check size={11} /></span>
          )}
          <div className="min-w-0 mr-auto">
            <p className={cls("text-sm", t.status === "done" ? "line-through text-slate-400" : "text-slate-800")}>{t.title}
              {t.status === "doing" && <span className="ml-1.5 text-[10px] text-blue-600 uppercase">in progress</span>}
              {t.branchedFrom && <span className="ml-1.5 text-[10px] text-purple-600 uppercase">branch</span>}
              {t.escalated && <span className="ml-1.5 text-[10px] text-red-600 uppercase">escalated</span>}</p>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 flex-wrap">
              {comp && <button className="text-blue-600 hover:underline" onClick={() => openCompany(comp.id)}>{comp.name}</button>}
              {who && scope === "team" && <span>{who.name}</span>}
              {(t.windowStart || t.windowEnd) && <span className="font-mono">{t.windowStart || "…"}–{t.windowEnd || "…"}</span>}
              {t.due && <span>due {fmtDate(t.due)}</span>}
              {secs > 0 && <span className="text-red-600 font-mono font-semibold flex items-center gap-0.5"><Clock size={10} /> OVERDUE {fmtDur(secs)}</span>}
              {t.status === "doing" && W.startedAt && <span>started {fmtTime(W.startedAt)}</span>}
              <span className="uppercase text-[10px] tracking-wide">{t.source}</span>
              {t.status === "done" && A.score != null && <span className="text-green-600 font-mono">gate {A.score}/10</span>}
              {t.status === "done" && A.offline && <span className="text-amber-600">checked offline</span>}
              {t.status === "done" && A.verdict === "branched" && <span className="text-purple-600">branched</span>}
            </p>
          </div>
          {mayAct && t.status === "open" && <Btn size="sm" kind="primary" onClick={() => startTask(t)}><Play size={12} /> Start</Btn>}
          {mayAct && t.status === "doing" && <>
            <Btn size="sm" onClick={() => setWorking(t)}><FileText size={12} /> Work window</Btn>
            <Btn size="sm" kind="primary" onClick={() => setClosing(t)}><CheckCircle2 size={12} /> Complete Now</Btn>
          </>}
          {!mayAct && <span className="text-[10px] uppercase tracking-wide text-slate-400 flex-none">view only</span>}
          {mayAct && (armDel === t.id
            ? <Btn size="sm" kind="danger" onClick={() => { setArmDel(null); remove(t); }}><Trash2 size={12} /> Sure — delete</Btn>
            : <button onClick={() => setArmDel(t.id)} title="Delete this task" className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto grid gap-4 items-start xl:grid-cols-[minmax(0,25rem),minmax(0,1fr)]">
      {/* left: the daily conversation. Sticky and full-height on wide screens,
          a bounded card above the list on narrow ones. */}
      <div className="min-h-0 xl:sticky xl:top-4 h-[26rem] xl:h-[calc(100vh-6.5rem)]">
        <ScrumMasterPanel me={me} data={data} saveScrums={saveScrums} saveTasks={saveTasks} saveDeals={saveDeals} />
      </div>

      {/* right: the aligned tasks */}
      <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-auto">My Tasks</h1>
        {canTeam && (
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
            {["mine", "team"].map((s) => (
              <button key={s} onClick={() => setScope(s)} className={cls("px-3 py-1.5 font-medium", scope === s ? "bg-blue-600 text-white" : "bg-white text-slate-600")}>{s === "mine" ? "Mine" : "Team"}</button>
            ))}
          </div>
        )}
        <label className="text-xs text-slate-500 flex items-center gap-1.5"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> show done</label>
        <Btn kind="primary" size="sm" onClick={() => setAdding(true)}><Plus size={13} /> New task</Btn>
      </div>

      {/* the PMS filter bar: grouping toggle · people · companies · count */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs">
          {[["due", "By due date"], ["company", "By company"], ["person", "By person"]].map(([k, l]) => (
            <button key={k} onClick={() => setGroup(k)} className={cls("px-3 py-1.5 font-medium flex items-center gap-1", group === k ? "bg-blue-600 text-white" : "bg-white text-slate-600")}>
              {k === "company" ? <Building2 size={12} /> : k === "person" ? <Users size={12} /> : <Clock size={12} />} {l}
            </button>
          ))}
        </div>
        {canTeam && (
          <Sel className="w-44" value={personF} onChange={(e) => setPersonF(e.target.value)}>
            <option value="all">All people</option>
            {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Sel>
        )}
        <Sel className="w-48" value={companyF} onChange={(e) => setCompanyF(e.target.value)}>
          <option value="all">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Sel>
        <span className="ml-auto text-xs text-slate-500"><b className="text-slate-800 font-mono tabular-nums">{mine.length}</b> task{mine.length !== 1 ? "s" : ""}</span>
      </div>
      {tasks.length === 0 && <Empty icon={ListTodo} title="No tasks yet" sub="Tasks arrive from the company chat, Daily Scrum, or by hand — and every one is tied to a company." action={<Btn kind="primary" onClick={() => setAdding(true)}><Plus size={14} /> New task</Btn>} />}
      {group === "due" && (
        <div className="space-y-5">
          {buckets.map(([label, list]) => list.length > 0 && (
            <div key={label}>
              <p className={cls("text-xs font-semibold uppercase tracking-wide mb-2", label === "Overdue" ? "text-red-600" : "text-slate-500")}>{label} · {list.length}</p>
              <div className="space-y-1.5">{list.map((t) => <TaskRow key={t.id} t={t} />)}</div>
            </div>
          ))}
        </div>
      )}
      {group !== "due" && (
        <div className="space-y-5">
          {(group === "company"
            ? [...companies.map((c) => [c.name, mine.filter((t) => t.companyId === c.id)]), ["No company", mine.filter((t) => !t.companyId)]]
            : users.filter((u) => u.active !== false).map((u) => [u.name, mine.filter((t) => t.assignee === u.id)])
          ).map(([label, list]) => list.length > 0 && (
            <div key={label} className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
                {group === "person" ? <Avatar name={label} size="sm" /> : <Building2 size={14} className="text-slate-400" />}
                {label}
                <Chip color="blue">{list.filter((t) => t.status !== "done").length} open</Chip>
              </p>
              <div className="space-y-1.5">{list.sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1).map((t) => <TaskRow key={t.id} t={t} />)}</div>
            </div>
          ))}
        </div>
      )}
      {working && !closing && <WorkWindow task={tasks.find((x) => x.id === working.id) || working} data={data} saveTasks={saveTasks} saveCompanies={saveCompanies}
        onClose={() => setWorking(null)} onComplete={() => { const t = tasks.find((x) => x.id === working.id) || working; setWorking(null); setClosing(t); }} />}
      {closing && <TaskCloseFlow me={me} data={data} task={tasks.find((x) => x.id === closing.id) || closing} onClose={() => setClosing(null)} saveTasks={saveTasks} saveCompanies={saveCompanies} />}
      {adding && (
        <Modal title="New task" onClose={() => setAdding(false)}
          footer={<><Btn onClick={() => setAdding(false)}>Cancel</Btn><Btn kind="primary" disabled={!f.title.trim()} onClick={add}><Check size={14} /> Add</Btn></>}>
          <div className="space-y-3">
            <Field label="Task" req><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Call Rahul about the pilot PO" /></Field>
            <Field label="Company"><Sel value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}><option value="">— none —</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Sel></Field>
            <Field label="Due"><Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
            {me.role !== "agent" && <Field label="Assignee"><Sel value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>{users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Sel></Field>}
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}

/* ============================================================
   RESOURCES — carried from the ODM PMS Resources module, driven
   by this tool's data: Team View · Resource Planning · Efficiency
   ============================================================ */

/* ============================================================
   SCRUM MASTER — the daily AI check-in. Interaction IS attendance:
   no check-in by the 10:30 cutoff = absent for the day. The team
   scrum needs its transcript as proof or it counts as a NO, and
   the no's are counted per week — that is how the team lead is
   evaluated. Then it walks your companies, one by one, and every
   answer leaves a committed next step. (23-pipeline-brain.sql)
   ============================================================ */

const SM_CUTOFF_MIN = 10 * 60 + 30; // 10:30 IST

function istMinutesNow() {
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const [h, m] = p.split(":").map(Number);
    return h * 60 + m;
  } catch (e) { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
}

/* The Scrum Master's brain: one system prompt carrying the person's whole
   book — phases, plans, pending activities, commitments — and a protocol
   for acting on what gets said. Tool lines are stripped before display. */
const smChatSystem = (me, ctx) => [
  "You are the SCRUM MASTER on the Elecbits Sales OS — a sharp, warm daily interviewer for " + me.name + ". Today is " + todayStr() + ".",
  "YOUR JOB, in order:",
  "1. If the team-scrum question is still open (see STATE), start by asking: did the team have its scrum discussion today? If they say yes, ask them to attach the transcript with the buttons under the chat (paste / upload / Fireflies) — a yes without a transcript counts as no. If no, note it without lecturing and move on.",
  "2. Walk their companies ONE AT A TIME, worst first (overdue commitments, then no committed step). For each: ask where things stand, question the OPEN TASKS by name, and pin down the next step WITH A DATE in their words. One or two questions per message, never a wall of text.",
  "3. When they give you something concrete, confirm it in one short line and move to the next thing. Keep the whole check-in under ten minutes of chat.",
  "4. NEVER take 'done' on faith. Before emitting an activity_done action, get one line of evidence — what exactly happened, with whom, when, and where the artefact lives (document name, mail thread). If they finished a committed step, tell them to close it in the Deal Room, where the AI checks the evidence (they can attach the doc or pull the mail chain there). A bare 'yes, done' gets a follow-up question, not an action.",
  "THEIR BOOK TODAY:\n" + ctx,
  "ACTING ON WHAT THEY SAY — end your reply with ONE line when (and only when) something concrete was agreed:",
  "SM_ACT_JSON {\"actions\":[{\"type\":\"team_scrum\",\"answer\":\"yes|no\"} | {\"type\":\"next_step\",\"company\":\"exact company name\",\"what\":\"...\",\"due\":\"YYYY-MM-DD\"} | {\"type\":\"task_done\",\"company\":\"exact company name\",\"task\":\"the open task's title, close to verbatim\"} | {\"type\":\"task_due\",\"company\":\"exact company name\",\"task\":\"the open task's title\",\"due\":\"YYYY-MM-DD\"} | {\"type\":\"task\",\"company\":\"exact company name\",\"title\":\"...\",\"due\":\"YYYY-MM-DD or empty\"}]}",
  "Dates: 'tomorrow' = " + localISO(new Date(Date.now() + 86400000)) + ". Never invent a date they did not say — ask for it instead. Never show the SM_ACT_JSON line's contents in prose.",
].join("\n");

function ScrumMasterPanel({ me, data, saveScrums, saveTasks, saveDeals }) {
  const { users, companies, deals, tasks, scrums } = data;
  const [session, setSession] = useState(undefined);  // undefined = loading, null = none yet
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [trOpen, setTrOpen] = useState(false);
  const [tr, setTr] = useState("");
  const [ffOn, setFfOn] = useState(false);
  const [ffBusy, setFfBusy] = useState(false);
  const trFileRef = useRef(null);
  const bodyRef = useRef(null);
  const today = todayStr();

  useEffect(() => {
    let a = true;
    loadScrumSessions(today).then((list) => {
      if (a) setSession(list.find((x) => x.personId === me.id && x.date === today) || null);
    });
    fetch("/api/fireflies?action=status").then((r) => r.json()).then((j) => a && setFfOn(!!j.connected)).catch(() => {});
    return () => { a = false; };
  }, []);
  // The date option: read a previous day's check-in, read-only.
  const [histDate, setHistDate] = useState("");
  const [histSess, setHistSess] = useState(null);
  useEffect(() => {
    if (!histDate || histDate === today) { setHistSess(null); if (histDate === today) setHistDate(""); return; }
    let a = true;
    loadScrumSessions(histDate).then((list) => {
      if (a) setHistSess(list.find((x) => x.personId === me.id && x.date === histDate) || { messages: [] });
    }).catch(() => a && setHistSess({ messages: [] }));
    return () => { a = false; };
  }, [histDate]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [session, busy]);

  // ── the book the Scrum Master reads from ──
  const myBook = companies.filter((c) => c.accountOwner === me.id).map((c) => {
    const d = deals.filter((x) => x.companyId === c.id && !x.lost)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] || null;
    return { c, d };
  });
  const bookCtx = myBook.length ? myBook.map(({ c, d }) => {
    if (!d) return "• " + c.name + " — no open deal.";
    const ns = nextStepState(d);
    const pend = tasks.filter((t) => t.companyId === c.id && t.status !== "done").map((t) => t.title).slice(0, 6);
    return "• " + c.name + " — " + (d.temperature || "cold") + ", ₹" + (d.value || 0)
      + (ns.key === "overdue" ? "; COMMITTED STEP OVERDUE since " + fmtDate(d.nextStepDue) + " ('" + d.nextStep + "')"
        : ns.key === "none" ? "; no committed next step"
        : "; next: '" + d.nextStep + "'" + (d.nextStepDue ? " by " + fmtDate(d.nextStepDue) : ""))
      + (pend.length ? "; open tasks: " + pend.join(" | ") : "; no open tasks");
  }).join("\n") : "(no companies assigned)";

  const persist = (patch) => {
    const base = session || { personId: me.id, date: today, startedAt: nowTS(), onTime: istMinutesNow() <= SM_CUTOFF_MIN, messages: [], covered: [], status: "open", teamScrum: "" };
    const next = { ...base, ...patch };
    setSession(next);
    upsertScrumSession(next).then((saved) => { if (saved) setSession((cur) => (cur === next ? saved : cur)); });
    return next;
  };

  const stateNote = (sess) => "STATE: team scrum " + (sess.teamScrum ? "answered (" + sess.teamScrum + (sess.scrumNoteId ? ", transcript filed" : ", no transcript yet") + ")" : "NOT asked/answered yet") + ".";

  // ── executing what the conversation agreed ──
  const runActions = (list, sess) => {
    let nextDeals = deals, nextTasks = tasks, patch = {};
    for (const a of Array.isArray(list) ? list : []) {
      try {
        if (a.type === "team_scrum" && ["yes", "no"].includes(a.answer)) patch.teamScrum = a.answer;
        const comp = a.company ? (matchCompany(a.company, companies) || companies.find((c) => c.name === a.company)) : null;
        const deal = comp ? nextDeals.filter((x) => x.companyId === comp.id && !x.lost).sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1))[0] : null;
        if (a.type === "next_step" && deal && a.what) {
          saveNextStep(deal.id, { what: a.what, due: a.due ? a.due + "T18:30" : "", owner: me.id });
          nextDeals = nextDeals.map((x) => (x.id === deal.id ? { ...x, nextStep: a.what, nextStepDue: a.due ? a.due + "T18:30" : "", nextStepOwner: me.id, nextStepSetAt: nowTS(), nextStepDoneAt: "", updatedAt: nowTS() } : x));
          // every step carries its task
          if (!openTaskDupe(nextTasks, comp.id, a.what)) {
            nextTasks = [{ id: uid(), companyId: comp.id, dealId: deal.id, assignee: me.id, author: me.id, title: a.what,
              details: "From the committed next step — complete it in My Tasks; the AI checks the evidence there.",
              due: a.due || "", status: "open", source: "step",
              createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "", scrumNoteId: sess.scrumNoteId || "" }, ...nextTasks];
          }
        }
        if ((a.type === "task_done" || a.type === "activity_done") && comp && (a.task || a.activity)) {
          const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const want = norm(a.task || a.activity);
          let hit = false;
          nextTasks = nextTasks.map((x) => {
            if (hit || x.status === "done" || x.companyId !== comp.id) return x;
            if (norm(x.title).includes(want) || want.includes(norm(x.title))) { hit = true; return { ...x, status: "done", doneAt: nowTS() }; }
            return x;
          });
        }
        if (a.type === "task_due" && comp && a.task && a.due) {
          const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const want = norm(a.task);
          let hit = false;
          nextTasks = nextTasks.map((x) => {
            if (hit || x.status === "done" || x.companyId !== comp.id) return x;
            if (norm(x.title).includes(want) || want.includes(norm(x.title))) { hit = true; return { ...x, due: a.due }; }
            return x;
          });
        }
        if (a.type === "task" && a.title && !openTaskDupe(nextTasks, comp ? comp.id : "", a.title)) {
          nextTasks = [{ id: uid(), companyId: comp ? comp.id : "", dealId: deal ? deal.id : "", assignee: me.id, author: me.id,
            title: a.title, details: "From the Scrum Master check-in", due: a.due || today, status: "open", source: "scrum",
            createdAt: nowTS(), windowStart: "", windowEnd: "", work: {}, ai: {}, escalated: false, branchedFrom: "", scrumNoteId: sess.scrumNoteId || "" }, ...nextTasks];
        }
      } catch (e) { /* one bad action never sinks the chat */ }
    }
    if (nextDeals !== deals) saveDeals(nextDeals);
    if (nextTasks !== tasks) saveTasks(nextTasks);
    return patch;
  };

  const converse = async (sess, userText) => {
    setBusy(true); setErr("");
    const msgs = userText === null ? sess.messages : [...sess.messages, { role: "user", content: userText, at: nowTS() }];
    if (userText !== null) persist({ messages: msgs });
    try {
      const convo = msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      if (!convo.length) convo.push({ role: "user", content: "Start today's check-in." });
      const reply = await withTimeout(askClaude(smChatSystem(me, bookCtx + "\n" + stateNote(sess)), convo, { maxTokens: 700 }), 30000);
      const acts = extractMarkedJSON(reply, "SM_ACT_JSON");
      const patch = runActions(acts && acts.actions, sess);
      const shown = String(reply).replace(/SM_ACT_JSON[\s\S]*$/, "").trim() || "Noted.";
      persist({ ...patch, messages: [...msgs, { role: "assistant", content: shown, at: nowTS() }] });
    } catch (e) { setErr("The Scrum Master couldn't reply — send that again."); }
    setBusy(false);
  };

  const start = () => { const sess = persist({}); converse(sess, null); };
  const send = () => { const t = input.trim(); if (!t || busy || !session || histDate) return; setInput(""); converse(session, t); };

  const fileTranscript = (text) => {
    const clean = String(text || "").trim();
    if (!clean || !session) return;
    const noteId = uid();
    saveScrums([{ id: noteId, userId: me.id, date: today, raw: "Team scrum — transcript filed from the Scrum Master check-in.",
      tasks: [], summary: "", createdAt: nowTS(), source: "transcript", transcript: clean, link: "", attendance: {}, blockers: [], decisions: [], ignored: "", transcriptUrl: "" }, ...scrums]);
    const sess = persist({ teamScrum: "yes", scrumNoteId: noteId });
    setTr(""); setTrOpen(false);
    mineTranscript(clean, { ...sess, scrumNoteId: noteId, teamScrum: "yes" });
  };

  // A filed transcript is not just attendance proof — the decisions in it
  // belong on the deals. Mine it: next steps with dates, activities finished,
  // tasks to raise, applied through the same runActions the live chat uses,
  // so the Deal Room and My Tasks reflect the meeting immediately.
  const mineTranscript = async (clean, sess) => {
    setBusy(true); setErr("");
    const keep = (obj) => { setSession(obj); upsertScrumSession(obj).then((saved) => { if (saved) setSession((cur) => (cur === obj ? saved : cur)); }); return obj; };
    const userMsg = { role: "user", content: "(Filed the team scrum transcript — " + clean.split(/\s+/).length + " words.)", at: nowTS() };
    let cur = keep({ ...sess, messages: [...(sess.messages || []), userMsg] });
    try {
      const convo = [...cur.messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })).slice(0, -1),
        { role: "user", content: "Team scrum transcript below. Pull out ONLY what was decided about MY companies — next steps with dates, activities completed, new tasks — summarise what you found in a few short lines, and act on all of it via SM_ACT_JSON. Skip companies that are not in my book.\n\n" + clean.slice(0, 9000) }];
      const reply = await withTimeout(askClaude(smChatSystem(me, bookCtx + "\n" + stateNote(cur)), convo, { maxTokens: 800 }), 40000);
      const acts = extractMarkedJSON(reply, "SM_ACT_JSON");
      const patch = runActions(acts && acts.actions, cur);
      const shown = String(reply).replace(/SM_ACT_JSON[\s\S]*$/, "").trim() || "Transcript filed.";
      keep({ ...cur, ...patch, messages: [...cur.messages, { role: "assistant", content: shown, at: nowTS() }] });
    } catch (e) { setErr("Transcript filed, but I couldn't mine it — tell me the decisions in chat instead."); }
    setBusy(false);
  };

  const pullFireflies = async () => {
    setFfBusy(true); setErr("");
    try {
      const from = today + "T00:00:00+05:30", to = today + "T23:59:59+05:30";
      const j = await fetch("/api/fireflies?action=list&from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)).then((r) => r.json());
      const items = j.items || [];
      if (!items.length) { setErr("Fireflies has no meeting recorded today."); setFfBusy(false); return; }
      const pick = items.find((x) => /scrum|stand[- ]?up|daily/i.test(x.title || "")) || items[0];
      const t = await fetch("/api/fireflies?action=get&id=" + encodeURIComponent(pick.id)).then((r) => r.json());
      if (t.error) setErr("Fireflies: " + t.error); else fileTranscript(t.text || "");
    } catch (e) { setErr("Could not reach Fireflies."); }
    setFfBusy(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl h-full min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2.5 border-b border-slate-100 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-none"><Mic size={14} /></span>
        <div className="mr-auto min-w-0">
          <p className="text-sm font-semibold text-slate-800 leading-tight">Scrum Master</p>
          <p className="text-[11px] text-slate-400 leading-tight truncate">Talk it through — steps and tasks land on the right.</p>
        </div>
        <input type="date" value={histDate} onChange={(e) => setHistDate(e.target.value)} max={todayStr()}
          className="text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-500 bg-white flex-none" title="Read a previous day's check-in" />
        {session && session.scrumNoteId && <Chip color="green">scrum proven</Chip>}
        {session && session.teamScrum === "no" && <Chip color="red">no team scrum</Chip>}
      </div>
      {histDate && (
        <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
          <span className="text-[11px] text-amber-800 mr-auto">Check-in from {fmtDate(histDate)}</span>
          <button onClick={() => setHistDate("")} className="text-[11px] text-blue-600 hover:underline">back to today →</button>
        </div>
      )}
      {histDate ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {histSess === null && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> opening…</p>}
          {histSess && !(histSess.messages || []).length && <p className="text-sm text-slate-400">No check-in on {fmtDate(histDate)}.</p>}
          {histSess && (histSess.messages || []).map((m, i) => (
            <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cls("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                m.role === "user" ? "bg-blue-600/80 text-white rounded-br-md" : "bg-slate-100 text-slate-700 rounded-bl-md")}>{m.content}</div>
            </div>
          ))}
        </div>
      ) : (
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {session === undefined && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
          {session === null && (
            <div className="text-center py-10">
              <Mic size={28} className="mx-auto text-blue-600 mb-2" />
              <p className="text-sm font-semibold text-slate-800">Ready for today's check-in?</p>
              <p className="text-xs text-slate-400 mt-1 mb-3">{myBook.length} compan{myBook.length === 1 ? "y" : "ies"} on your book.</p>
              <Btn kind="primary" onClick={start}><Play size={14} /> Start</Btn>
            </div>
          )}
          {session && (session.messages || []).map((m, i) => (
            <div key={i} className={cls("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cls("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed",
                m.role === "user" ? "bg-blue-600 text-white rounded-br-md" : "bg-slate-100 text-slate-800 rounded-bl-md")}>
                {m.content}
              </div>
            </div>
          ))}
          {busy && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> thinking…</p>}
        </div>
      )}

        {trOpen && session && (
          <div className="border-t border-slate-100 p-3 space-y-2 bg-slate-50">
            <TA value={tr} onChange={(e) => setTr(e.target.value)} className="min-h-20" placeholder="Paste the team scrum transcript here…" />
            <div className="flex items-center gap-2">
              <Btn kind="primary" size="sm" disabled={!tr.trim()} onClick={() => fileTranscript(tr)}><Check size={12} /> File it</Btn>
              <Btn size="sm" onClick={() => setTrOpen(false)}>cancel</Btn>
            </div>
          </div>
        )}

        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-2">
            <Input value={input} onChange={(e) => setInput(e.target.value)} disabled={!session}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={session ? "Type your answer…" : "Press Start above"} />
            <Btn kind="primary" disabled={busy || !session || !input.trim()} onClick={send}><Send size={14} /></Btn>
          </div>
          {session && !session.scrumNoteId && (
            <div className="flex items-center gap-3 mt-2 text-[11.5px] text-slate-500">
              <span>Team scrum transcript:</span>
              <button onClick={() => setTrOpen(!trOpen)} className="text-blue-600 hover:underline">paste</button>
              <input ref={trFileRef} type="file" accept=".txt,.vtt,.srt,.md,.json" className="hidden"
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) f.text().then(fileTranscript); e.target.value = ""; }} />
              <button onClick={() => trFileRef.current && trFileRef.current.click()} className="text-blue-600 hover:underline">upload</button>
              {ffOn && <button onClick={pullFireflies} disabled={ffBusy} className="text-blue-600 hover:underline">{ffBusy ? "pulling…" : "pull from Fireflies"}</button>}
            </div>
          )}
          {err && <p className="text-xs text-red-600 mt-1.5">{err}</p>}
        </div>
      </div>
  );
}

function ResourcesView({ me, data, saveUsers, openCompany }) {
  const { users, companies, deals, tasks, corePeople } = data;
  const isAdmin = me.role === "admin" || me.role === "dept_head";
  const [rtab, setRtab] = useState("team");   // team | planning | efficiency
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("all");
  // Resource Planning window — defaults to the next two months.
  const [pFrom, setPFrom] = useState(todayStr());
  const [pTo, setPTo] = useState(localISO(new Date(Date.now() + 61 * 86400000)));
  const [editing, setEditing] = useState(null); // "new" | user object
  const [f, setF] = useState({ name: "", email: "", role: "agent", active: true, capacity: 3 });
  const [err, setErr] = useState("");
  const [adopted, setAdopted] = useState({});   // core ids just added, hidden from the offer list
  const setCorePeopleAdopted = (id) => setAdopted((a) => ({ ...a, [id]: true }));
  const [adoptErr, setAdoptErr] = useState("");

  const roleChip = (r) => r === "admin" ? "purple" : r === "dept_head" ? "blue" : r === "finance" ? "amber" : "green";

  const loadOf = (u) => {
    const comps = companies.filter((c) => c.accountOwner === u.id);
    const openDeals = deals.filter((d) => d.ownerId === u.id && !d.lost && d.stage !== "po");
    const openTasks = tasks.filter((t) => t.assignee === u.id && t.status !== "done");
    const overdue = openDeals.filter((d) => nextStepState(d).key === "overdue").length
      + openTasks.filter((t) => t.due && t.due < todayStr()).length;
    return { comps, openDeals: openDeals.length, openTasks: openTasks.length, overdue };
  };
  // The ODM CAP number: open deals vs. what the person can carry.
  const capOf = (u) => (Number(u.capacity) > 0 ? Number(u.capacity) : 3);
  const statusOf = (u, L) => u.active === false ? ["inactive", "slate"]
    : L.overdue > 0 ? ["Overdue work", "red"]
    : L.openDeals >= capOf(u) ? ["At Capacity", "red"]
    : L.openDeals + L.openTasks > 0 ? ["Deployed", "amber"]
    : ["Available", "green"];

  // What sits on a person inside the planning window: committed deal steps
  // due in range + tasks due in range. That IS a salesperson's deployment.
  const planOf = (u) => {
    const openDeals = deals.filter((d) => d.ownerId === u.id && !d.lost && d.stage !== "po")
      .map((d) => ({ d, comp: companies.find((c) => c.id === d.companyId) }));
    const day = (x) => String(x || "").slice(0, 10);
    const stepsIn = openDeals.filter(({ d }) => d.nextStep && !d.nextStepDoneAt && d.nextStepDue && day(d.nextStepDue) >= pFrom && day(d.nextStepDue) <= pTo);
    const tasksIn = tasks.filter((t) => t.assignee === u.id && t.status !== "done" && t.due && t.due >= pFrom && t.due <= pTo);
    const overdue = openDeals.filter(({ d }) => nextStepState(d).key === "overdue").length
      + tasks.filter((t) => t.assignee === u.id && t.status !== "done" && t.due && t.due < todayStr()).length;
    return { openDeals, stepsIn, tasksIn, load: stepsIn.length + tasksIn.length, overdue };
  };
  const planStatus = (u, P) => u.active === false ? ["inactive", "slate"]
    : P.overdue > 0 ? ["Overdue work", "red"]
    : P.openDeals.length >= capOf(u) ? ["At Capacity", "red"]
    : P.load > 0 ? ["Deployed", "amber"]
    : ["Available", "green"];

  // All-time efficiency: companies carried, deals, wins, tasks and completion.
  const effOf = (u) => {
    const comps = companies.filter((c) => c.accountOwner === u.id).length;
    const uDeals = deals.filter((d) => d.ownerId === u.id);
    const won = uDeals.filter((d) => d.stage === "po").length;
    const uTasks = tasks.filter((t) => t.assignee === u.id);
    const done = uTasks.filter((t) => t.status === "done").length;
    const overdue = uTasks.filter((t) => t.status !== "done" && t.due && t.due < todayStr()).length;
    const pct = uTasks.length ? Math.round((done / uTasks.length) * 100) : 0;
    return { comps, deals: uDeals.filter((d) => !d.lost && d.stage !== "po").length, won, tasks: uTasks.length, done, overdue, pct };
  };

  const roster = users
    .filter((u) => roleF === "all" || u.role === roleF)
    .filter((u) => !q.trim() || (u.name + " " + (u.email || "")).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const openEdit = (u) => { setEditing(u); setF({ name: u.name, email: u.email || "", role: u.role, active: u.active !== false, capacity: capOf(u) }); setErr(""); };
  const openNew = () => { setEditing("new"); setF({ name: "", email: "", role: "agent", active: true, capacity: 3 }); setErr(""); };
  const save = () => {
    if (!f.name.trim()) { setErr("Name is required."); return; }
    if (!f.email.includes("@")) { setErr("A real email is required — it is how they sign in."); return; }
    if (editing === "new") {
      if (users.some((u) => (u.email || "").toLowerCase() === f.email.trim().toLowerCase())) { setErr("That email is already on the roster."); return; }
      // Explicit, awaited, and loud: the fire-and-forget path swallowed RPC
      // failures and people silently never reached core.people.
      supabase.rpc("upsert_person", {
        p_id: null, p_name: f.name.trim(), p_email: f.email.trim().toLowerCase(),
        p_role: f.role, p_dept: "Sales", p_active: true,
      }).then(({ data: newId, error }) => {
        if (error) { setErr("Not saved: " + error.message); return; }
        const cap = Number(f.capacity) > 0 ? Number(f.capacity) : 3;
        if (newId && cap !== 3) setCapacity(newId, cap);
        saveUsers([...users, { id: newId || uid(), name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, dept: "Sales", active: true, capacity: cap }]);
        setEditing(null);
      });
      return;
    } else {
      const cap = Number(f.capacity) > 0 ? Number(f.capacity) : 3;
      if (cap !== capOf(editing)) setCapacity(editing.id, cap);
      saveUsers(users.map((u) => (u.id === editing.id ? { ...u, name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, active: f.active, capacity: cap } : u)));
    }
    setEditing(null);
  };
  const remove = async (u) => {
    const L = loadOf(u);
    const warn = L.comps.length || L.openDeals || L.openTasks
      ? "\nThey still own " + L.comps.length + " compan" + (L.comps.length === 1 ? "y" : "ies") + ", " + L.openDeals + " open deal(s) and " + L.openTasks + " open task(s) — reassign those first if they matter."
      : "";
    if (!window.confirm("Remove " + u.name + " from the sales roster? Their shared core record and history stay." + warn)) return;
    const okd = await removeFromRoster(u.id);
    if (!okd) { window.alert("Could not remove — only a sales admin can manage the roster."); return; }
    saveUsers(users.filter((x) => x.id !== u.id));
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2"><Users size={18} className="text-blue-600" /> Resources</h1>
        <p className="text-xs text-slate-500 mt-0.5">Team roster, availability &amp; load — the Sales department, from <span className="font-mono">core.people</span>.</p>
      </div>

      {/* the ODM pattern: tabs left · search, count, action right */}
      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center text-[13px] font-medium mr-auto">
          {[["team", "Team View", Users], ["planning", "Resource Planning", CalendarCheck2], ["efficiency", "Efficiency", Gauge]].map(([k, l, I]) => (
            <button key={k} onClick={() => setRtab(k)}
              className={cls("px-3 py-1.5 flex items-center gap-1.5 border-b-2 -mb-2 pb-2.5 transition-colors",
                rtab === k ? "text-blue-700 border-blue-600" : "text-slate-500 border-transparent hover:text-slate-800")}>
              <I size={14} /> {l}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="w-52 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" />
        </div>
        <span className="text-xs text-slate-400"><b className="text-slate-700 font-mono tabular-nums">{roster.length}</b> resources</span>
        {isAdmin && <Btn kind="primary" onClick={openNew}><Plus size={14} /> Add Resource</Btn>}
      </div>

      {/* planning filters — role + the period, PMS-style */}
      {rtab === "planning" && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-3 flex flex-wrap items-end gap-4">
          <Field label="Role"><Sel className="w-44" value={roleF} onChange={(e) => setRoleF(e.target.value)}>
            <option value="all">All Roles</option>
            {ROLES.filter(({ key }) => key !== "finance").map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </Sel></Field>
          <Field label="Available from"><Input type="date" className="w-40" value={pFrom} onChange={(e) => setPFrom(e.target.value)} /></Field>
          <Field label="Available to"><Input type="date" className="w-40" value={pTo} onChange={(e) => setPTo(e.target.value)} /></Field>
          <p className="text-xs text-slate-500 pb-2.5 ml-auto">Showing availability <b className="text-slate-700">{fmtDate(pFrom)} → {fmtDate(pTo)}</b></p>
        </div>
      )}
      {rtab !== "planning" && (
        <div className="flex items-center gap-2 mb-3">
          <Sel className="w-44" value={roleF} onChange={(e) => setRoleF(e.target.value)}>
            <option value="all">All roles</option>
            {ROLES.filter(({ key }) => key !== "finance").map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </Sel>
        </div>
      )}

      {/* ── RESOURCE PLANNING: who is free in the window, who is loaded ── */}
      {rtab === "planning" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10.5px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 bg-slate-50/60">
                <th className="py-2.5 px-4">Resource</th><th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Availability in period</th>
                <th className="py-2.5 px-4">Deployed on</th><th className="py-2.5 px-4">Status</th>
              </tr></thead>
              <tbody>
                {roster.map((u) => {
                  const P = planOf(u);
                  const [st, sc] = planStatus(u, P);
                  return (
                    <tr key={u.id} className={cls("border-b border-slate-100 last:border-0 hover:bg-slate-50/50 align-top", u.active === false && "opacity-50")}>
                      <td className="py-3 px-4"><span className="flex items-center gap-2.5"><Avatar name={u.name} /><span className="font-medium text-slate-900">{u.name}</span></span></td>
                      <td className="py-3 px-4"><Chip color={roleChip(u.role)}>{roleLabel(u.role)}</Chip></td>
                      <td className="py-3 px-4">
                        {P.load === 0
                          ? <span className="text-sm font-semibold text-green-700">Fully free {fmtDate(pFrom)} → {fmtDate(pTo)}</span>
                          : <span className={cls("text-sm font-semibold", P.openDeals.length >= capOf(u) ? "text-red-600" : "text-slate-800")}>
                              {P.openDeals.length >= capOf(u) ? "At capacity in this period" : P.load + " commitment" + (P.load > 1 ? "s" : "") + " in this period"}
                            </span>}
                        {(P.stepsIn.length > 0 || P.tasksIn.length > 0) && (
                          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{P.stepsIn.length} deal step{P.stepsIn.length !== 1 ? "s" : ""} · {P.tasksIn.length} task{P.tasksIn.length !== 1 ? "s" : ""} due</p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {P.openDeals.length ? (
                          <div className="space-y-1.5">
                            {P.openDeals.slice(0, 4).map(({ d, comp }) => (
                              <div key={d.id} className="leading-tight">
                                <button onClick={() => comp && openCompany(comp.id)} className="text-[13px] font-medium text-slate-800 hover:text-blue-700 hover:underline text-left">{comp ? comp.name : d.did}</button>
                                <p className="text-[11px] font-mono text-slate-400">
                                  {(d.temperature || "cold")} · {d.nextStep && !d.nextStepDoneAt && d.nextStepDue ? "step due " + fmtDate(d.nextStepDue) : "no committed step"}
                                </p>
                              </div>
                            ))}
                            {P.openDeals.length > 4 && <p className="text-[11px] text-slate-400">+{P.openDeals.length - 4} more</p>}
                          </div>
                        ) : <span className="text-slate-300 text-xs">None in range</span>}
                      </td>
                      <td className="py-3 px-4"><Chip color={sc}>{st}</Chip></td>
                    </tr>
                  );
                })}
                {roster.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">Nobody matches.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── EFFICIENCY: the numbers a person actually produced ── */}
      {rtab === "efficiency" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10.5px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 bg-slate-50/60">
                <th className="py-2.5 px-4">Name</th><th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4 text-center">Companies</th><th className="py-2.5 px-4 text-center">Open deals</th>
                <th className="py-2.5 px-4 text-center">Won</th><th className="py-2.5 px-4 text-center">Tasks</th>
                <th className="py-2.5 px-4 text-center">Done</th><th className="py-2.5 px-4 text-center">Overdue</th>
                <th className="py-2.5 px-4">Completion</th>
              </tr></thead>
              <tbody>
                {roster.map((u) => {
                  const E = effOf(u);
                  return (
                    <tr key={u.id} className={cls("border-b border-slate-100 last:border-0 hover:bg-slate-50/50", u.active === false && "opacity-50")}>
                      <td className="py-3 px-4"><span className="flex items-center gap-2.5"><Avatar name={u.name} /><span className="font-medium text-slate-900">{u.name}</span></span></td>
                      <td className="py-3 px-4"><Chip color={roleChip(u.role)}>{roleLabel(u.role)}</Chip></td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">{E.comps || <span className="text-slate-300">0</span>}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">{E.deals || <span className="text-slate-300">0</span>}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-green-700">{E.won || <span className="text-slate-300">0</span>}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">{E.tasks || <span className="text-slate-300">0</span>}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-green-700">{E.done || <span className="text-slate-300">0</span>}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">{E.overdue ? <span className="text-red-600 font-semibold">{E.overdue}</span> : <span className="text-slate-300">0</span>}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-green-500" style={{ width: E.pct + "%" }} /></div>
                          <span className="text-[11px] font-mono text-slate-500 tabular-nums">{E.pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {roster.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sm text-slate-400">Nobody matches.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rtab === "team" && (<>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10.5px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 bg-slate-50/60">
              <th className="py-2.5 px-4">Name</th><th className="py-2.5 px-4">Role</th>
              <th className="py-2.5 px-4">Companies</th><th className="py-2.5 px-4">Open deals</th>
              <th className="py-2.5 px-4">Open tasks</th><th className="py-2.5 px-4">Cap</th><th className="py-2.5 px-4">Status</th>
              {isAdmin && <th className="py-2.5 px-4 text-right">Actions</th>}
            </tr></thead>
            <tbody>
              {roster.map((u) => {
                const L = loadOf(u);
                const [st, sc] = statusOf(u, L);
                return (
                  <tr key={u.id} className={cls("border-b border-slate-100 last:border-0 hover:bg-slate-50/50", u.active === false && "opacity-50")}>
                    <td className="py-3 px-4">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={u.name} />
                        <span>
                          <span className="font-medium text-slate-900 block leading-tight">{u.name}</span>
                          <span className="font-mono text-[11px] text-slate-400">{u.email || "—"}{!u.authId && " · no login yet"}</span>
                        </span>
                      </span>
                    </td>
                    <td className="py-3 px-4"><Chip color={roleChip(u.role)}>{roleLabel(u.role)}</Chip></td>
                    <td className="py-3 px-4">
                      {L.comps.length ? (
                        <div className="space-y-0.5">
                          {L.comps.slice(0, 3).map((c) => (
                            <button key={c.id} onClick={() => openCompany(c.id)} className="block text-xs text-blue-700 hover:underline text-left leading-tight">{c.name}</button>
                          ))}
                          {L.comps.length > 3 && <span className="text-[11px] text-slate-400">+{L.comps.length - 3} more</span>}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">{L.openDeals || <span className="text-slate-300">0</span>}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">{L.openTasks || <span className="text-slate-300">0</span>}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      <span className={cls("font-semibold", L.openDeals >= capOf(u) ? "text-red-600" : L.openDeals > 0 ? "text-amber-600" : "text-green-700")}>{L.openDeals}/{capOf(u)}</span>
                    </td>
                    <td className="py-3 px-4"><Chip color={sc}>{st}</Chip></td>
                    {isAdmin && (
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button title="Edit" onClick={() => openEdit(u)} className="text-slate-400 hover:text-blue-600 p-1"><Pencil size={14} /></button>
                          {u.id !== me.id && (
                            <button title="Remove from the roster" onClick={() => remove(u)} className="text-slate-300 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {roster.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sm text-slate-400">Nobody matches.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {/* people who exist in core but are not on the sales roster yet */}
      {isAdmin && (corePeople || []).some((p) => !p.onRoster && !adopted[p.id] && !users.some((u) => u.id === p.id)) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <SectionTitle right={<span className="text-xs text-slate-400 font-mono">core.people</span>}>Exists in core, not on the sales roster</SectionTitle>
          <div className="space-y-1.5">
            {(corePeople || []).filter((p) => !p.onRoster && !adopted[p.id] && !users.some((u) => u.id === p.id)).map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 border border-slate-200 rounded-md px-3 py-2 text-sm">
                <Avatar name={p.name || "?"} size="sm" />
                <span className="font-medium text-slate-800">{p.name || "(unnamed)"}</span>
                <span className="font-mono text-xs text-slate-400 mr-auto">{p.email || "no email"}</span>
                <Btn size="sm" kind="primary" onClick={() => {
                  // Awaited and loud, like the add-new path: a silently failed
                  // RPC here left people looking adopted but off the roster.
                  setAdoptErr("");
                  supabase.rpc("upsert_person", {
                    p_id: p.id, p_name: p.name || p.email.split("@")[0], p_email: p.email || null,
                    p_role: "agent", p_dept: "Sales", p_active: true,
                  }).then(({ error }) => {
                    if (error) { setAdoptErr((p.name || p.email) + " not added: " + error.message); return; }
                    saveUsers([...users, { id: p.id, name: p.name || p.email.split("@")[0], email: p.email, role: "agent", dept: "Sales", active: true }]);
                    setCorePeopleAdopted(p.id);
                  });
                }}><Plus size={12} /> Add to sales</Btn>
              </div>
            ))}
          </div>
          {adoptErr && <p className="text-xs text-red-600 mt-2">{adoptErr}</p>}
          <p className="text-[11px] text-slate-400 mt-2">Adding links the SAME person — no duplicate is created; they keep their identity across every Elecbits tool.</p>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-2">Removing takes a person off the SALES roster only — their shared core record and everything they did stays. Login provisioning and revocation live in Admin → Users.</p>
      </>)}

      {editing && (
        <Modal title={editing === "new" ? "Add a resource" : "Edit " + editing.name} onClose={() => setEditing(null)}
          footer={<>
            <span className="mr-auto text-xs text-red-600">{err}</span>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn kind="primary" onClick={save}><Check size={14} /> {editing === "new" ? "Add to the roster" : "Save"}</Btn>
          </>}>
          <div className="space-y-3">
            <Field label="Full name" req><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email (their sign-in)" req><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@elecbits.in" /></Field>
            <Field label="Role" req>
              <Sel value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                {ROLES.filter(({ key }) => key !== "finance").map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
              </Sel>
            </Field>
            <Field label="Capacity" hint="Open deals this person can carry at once — at or over it, the roster shows At Capacity.">
              <Input type="number" min={1} max={20} className="w-24" value={f.capacity}
                onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/[^\d]/g, "") })} />
            </Field>
            {editing !== "new" && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
              </label>
            )}
            <p className="text-xs text-slate-500">If this email already belongs to someone in core.people (a PMS engineer, say), the roster adopts that person instead of duplicating them.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LLDView({ me, data, saveLlds }) {
  const { companies, llds, users } = data;
  const [editing, setEditing] = useState(null); // lld | "new"
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-lg font-semibold mr-auto">LLD Creation</h1>
        <Btn kind="primary" size="sm" onClick={() => setEditing("new")} disabled={!companies.length}><Plus size={13} /> New LLD</Btn>
      </div>
      <p className="text-sm text-slate-500 mb-4">The customer Low-Level Design — the same 30-question set the ODM PMS uses. An ODM project that gets sanctioned needs one before engineering picks it up.</p>
      {llds.length === 0 ? (
        <Empty icon={PencilRuler} title="No LLDs yet" sub="Start one for any company — usually right after ULM sanctions an ODM project." action={<Btn kind="primary" onClick={() => setEditing("new")} disabled={!companies.length}><Plus size={14} /> New LLD</Btn>} />
      ) : (
        <div className="space-y-2">
          {llds.map((l) => {
            const comp = companies.find((c) => c.id === l.companyId);
            const by = users.find((u) => u.id === l.createdBy);
            const answered = LLD_QUESTIONS.filter((q) => String(l.answers[q.id] || "").trim()).length;
            return (
              <button key={l.id} onClick={() => setEditing(l)} className="w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-blue-400 flex items-center gap-3">
                <div className="min-w-0 mr-auto">
                  <p className="font-medium text-sm text-slate-800">{l.title}</p>
                  <p className="text-xs text-slate-400">{comp ? comp.name : "?"} · {by ? by.name : ""} · {fmtDate(l.updatedAt || l.createdAt)}</p>
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">{answered}/30</span>
                <Chip color={l.status === "final" ? "green" : "amber"}>{l.status}</Chip>
              </button>
            );
          })}
        </div>
      )}
      {editing && <LldEditor me={me} data={data} lld={editing === "new" ? null : editing} onClose={() => setEditing(null)} saveLlds={saveLlds} />}
    </div>
  );
}

function LldEditor({ me, data, lld, onClose, saveLlds }) {
  const { companies, llds } = data;
  const [companyId, setCompanyId] = useState(lld ? lld.companyId : (companies[0] ? companies[0].id : ""));
  const [title, setTitle] = useState(lld ? lld.title : "");
  const [answers, setAnswers] = useState(lld ? { ...lld.answers } : {});
  const answered = LLD_QUESTIONS.filter((q) => String(answers[q.id] || "").trim()).length;
  const secs = [...new Set(LLD_QUESTIONS.map((q) => q.sec))];

  const save = (status) => {
    const comp = companies.find((c) => c.id === companyId);
    const doc = {
      id: lld ? lld.id : uid(),
      companyId, dealId: lld ? lld.dealId : "",
      title: title.trim() || ((comp ? comp.name : "LLD") + " — customer LLD"),
      answers, status, createdBy: lld ? lld.createdBy : me.id,
      createdAt: lld ? lld.createdAt : nowTS(), updatedAt: nowTS(),
    };
    saveLlds(lld ? llds.map((x) => (x.id === doc.id ? doc : x)) : [doc, ...llds]);
    onClose();
  };

  return (
    <Modal title={lld ? "Edit LLD" : "New LLD"} onClose={onClose} wide
      footer={<>
        <span className="mr-auto font-mono text-xs text-slate-400 self-center">{answered}/30 answered</span>
        <Btn onClick={() => save("draft")}>Save draft</Btn>
        <Btn kind="primary" disabled={answered < 30} title={answered < 30 ? "All 30 questions — hard gate, like the PMS" : ""} onClick={() => save("final")}><BadgeCheck size={14} /> Mark final</Btn>
      </>}>
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-2">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Company" req>
            <Sel value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={!!lld}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Sel>
          </Field>
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="auto from company" /></Field>
        </div>
        {secs.map((sec) => (
          <div key={sec}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-2">{sec}</p>
            <div className="space-y-3">
              {LLD_QUESTIONS.filter((q) => q.sec === sec).map((q) => (
                <div key={q.id}>
                  <p className="text-sm text-slate-700 mb-1"><span className="font-mono text-xs text-slate-400">Q{q.id}</span> {q.text}</p>
                  <TA value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} className="min-h-[38px]" placeholder="Answer, or leave blank for TBD" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <DesignerLld answers={answers} setAnswers={setAnswers} />
      </div>
    </Modal>
  );
}

/* Designer LLD — AI-translated from the customer answers (the PMS's second
   hard gate). Stored alongside the answers as `_designer`. */
function DesignerLld({ answers, setAnswers }) {
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try {
      const text = LLD_QUESTIONS.map((q) => q.sec + " — " + q.text + "\n→ " + (answers[q.id] || "TBD")).join("\n");
      const sys = "You are Elecbits' senior solution architect. Translate this customer LLD into a concise DESIGNER LLD: main controller choice and tier, power tree, radios + antenna/cert notes, interfaces, enclosure direction, firmware architecture (OTA/sleep), test points and compliance pre-checks. Terse engineering prose, headed sections, no fluff.";
      const reply = await askClaude(sys, [{ role: "user", content: text.slice(0, 6000) }]);
      setAnswers({ ...answers, _designer: reply });
    } catch (e) { /* leave as-is */ }
    setBusy(false);
  };
  return (
    <div className="border-t border-slate-200 pt-4 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-auto">Designer LLD — what engineering builds from</p>
        <Btn size="sm" kind="primary" disabled={busy} onClick={gen}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate from customer answers</Btn>
      </div>
      <TA value={answers._designer || ""} onChange={(e) => setAnswers({ ...answers, _designer: e.target.value })} className="min-h-40 font-mono text-xs" placeholder="Generate with AI from the 30 answers, or write/paste it manually — like the PMS, an ODM project needs both LLDs." />
    </div>
  );
}

/* ── Whether a person can actually get in ──────────────────────────────────
   Deactivating someone on the roster hides them from the UI and nothing more:
   their session stays valid, and every sales table is readable by any signed-in
   user, so a leaver marked inactive can still read the whole database. This
   column is where that is made visible and undone.

   Renders nothing at all when /api/admin-users is unconfigured — an inert
   "Revoke" button beside a leaver's name is worse than no button, because it
   looks like the job is done. */
function LoginCell({ user, me }) {
  const [cfg, setCfg] = useState({ connected: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [gone, setGone] = useState(false);

  useEffect(() => { adminUsers.status().then(setCfg).catch(() => {}); }, []);
  if (!cfg.connected) return <span className="text-xs text-slate-300">—</span>;

  // authId is null for someone rostered who has never signed in.
  const hasLogin = !!user.authId && !gone;
  const isMe = user.id === me.id;

  if (!hasLogin) {
    return <span className="text-xs text-slate-400" title="Rostered, but no account yet — they sign in once to create it.">
      {gone ? "revoked" : "never signed in"}
    </span>;
  }

  const revoke = async () => {
    setBusy(true); setMsg("");
    const r = await adminUsers.revoke(user.email);
    if (r.error) { setMsg(r.error); setBusy(false); return; }
    setGone(true); setConfirming(false); setMsg(r.note || "");
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-1 items-start">
      {!confirming ? (
        <div className="flex items-center gap-2">
          <Chip color="blue">can sign in</Chip>
          {!isMe && (
            <button onClick={() => { setConfirming(true); setMsg(""); }}
              className="text-[11px] text-slate-400 hover:text-red-600 hover:underline">revoke</button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-slate-600 max-w-[230px]">
            Delete <b>{user.email}</b>'s login? Their session ends and they lose all
            database access. The roster entry stays, so their name remains on past work.
          </p>
          <div className="flex items-center gap-2">
            <Btn size="sm" kind="danger" disabled={busy} onClick={revoke}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Revoke
            </Btn>
            <button onClick={() => setConfirming(false)} className="text-[11px] text-slate-400 hover:underline">cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="text-[11px] text-slate-500 max-w-[230px]">{msg}</p>}
    </div>
  );
}

function AdminView({ me, data, saveUsers, saveGates, saveQuestionSet }) {
  const { users, gates, questionSets } = data;
  const QSET_KEYS = ["company_card", "project_id", "boxbuild_criteria"];
  const [qsKey, setQsKey] = useState("company_card");
  const [qsText, setQsText] = useState(() => ((questionSets.company_card || {}).questions || []).join("\n"));
  const [qsSaved, setQsSaved] = useState(false);
  const pickQs = (k) => { setQsKey(k); setQsText(((questionSets[k] || {}).questions || []).join("\n")); };
  const saveQs = () => {
    const lines = qsText.split("\n").map((l) => l.trim()).filter(Boolean);
    saveQuestionSet(qsKey, (questionSets[qsKey] || {}).title || qsKey, lines);
    setQsSaved(true); setTimeout(() => setQsSaved(false), 1500);
  };
  const [editUser, setEditUser] = useState(null); // user | "new"
  const [gateStage, setGateStage] = useState("rfq");
  const [gateText, setGateText] = useState(() => ((gates["rfq"] && gates["rfq"].length ? gates["rfq"] : DEFAULT_GATES["rfq"]) || []).join("\n"));
  const [gateSaved, setGateSaved] = useState(false);
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
              <th className="py-2 pr-4 font-medium">Name</th><th className="py-2 pr-4 font-medium">Email</th><th className="py-2 pr-4 font-medium">Role</th><th className="py-2 pr-4 font-medium">Department</th><th className="py-2 pr-4 font-medium">Status</th><th className="py-2 pr-4 font-medium">Login</th><th className="py-2" />
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="py-2 pr-4"><span className="flex items-center gap-2"><Avatar name={u.name} size="sm" />{u.name}{u.id === me.id && <span className="text-xs text-slate-400">(you)</span>}</span></td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">{u.email || "—"}</td>
                  <td className="py-2 pr-4">{roleLabel(u.role)}</td>
                  <td className="py-2 pr-4">{u.dept}</td>
                  <td className="py-2 pr-4">{u.active !== false ? <Chip color="green">Active</Chip> : <Chip color="slate">Inactive</Chip>}</td>
                  <td className="py-2 pr-4"><LoginCell user={u} me={me} /></td>
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
        <SectionTitle>Trainable question sets</SectionTitle>
        <p className="text-xs text-slate-500 mb-3">One question per line. These drive the company record assistant, the Project-ID application, and the box-build acceptance gate. Requires the Phase-1 SQL (<span className="font-mono">supabase/12-phase1.sql</span>) to have run.</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {QSET_KEYS.map((k) => (
            <button key={k} onClick={() => pickQs(k)}
              className={cls("px-2.5 py-1 rounded-lg text-xs font-medium border", qsKey === k ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-100")}>
              {k === "company_card" ? "Company record" : k === "project_id" ? "Project-ID application" : "Box-build criteria"}
            </button>
          ))}
        </div>
        <TA value={qsText} onChange={(e) => setQsText(e.target.value)} className="min-h-40 font-mono text-xs" />
        <div className="flex items-center gap-2 mt-2">
          <Btn kind="primary" size="sm" onClick={saveQs}><Check size={13} /> Save</Btn>
          {qsSaved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle>Workspace data</SectionTitle>
        <p className="text-xs text-slate-500 mb-3 flex items-start gap-1.5"><FileText size={13} className="mt-0.5 flex-none" /> Shared relational workspace in eb-core-database-1 (schemas <span className="font-mono">core</span> + <span className="font-mono">sales</span>). Backups and restores live in Supabase — this copies a JSON snapshot for quick reference.</p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={backup}><Copy size={14} /> {copied ? "Copied" : "Copy backup JSON"}</Btn>
        </div>
      </div>

      {editUser && <UserModal user={editUser === "new" ? null : editUser} me={me} onClose={() => setEditUser(null)} onSave={upsertUser} />}
    </div>
  );
}

function UserModal({ user, me, onClose, onSave }) {
  const [f, setF] = useState(() => user || { id: uid(), name: "", email: "", role: "agent", dept: "Sales", active: true });
  const [err, setErr] = useState("");
  const isSelf = user && user.id === me.id;
  const isNew = !user;

  const save = () => {
    setErr("");
    const email = String(f.email || "").trim().toLowerCase();
    if (!f.name.trim()) { setErr("Name is required."); return; }
    if (!email) { setErr("Email is required — it's how they sign in."); return; }
    onSave({ ...f, email });
  };

  return (
    <Modal title={user ? "Edit " + user.name : "Add user"} onClose={onClose}
      footer={<>
        {err && <span className="mr-auto text-xs text-red-600">{err}</span>}
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" disabled={!f.name.trim()} onClick={save}><Check size={15} /> Save user</Btn>
      </>}>
      <div className="space-y-3">
        <Field label="Name" req><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" req hint="used to sign in">
          <Input type="email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@elecbits.in" />
        </Field>
        {isNew && (
          <p className="text-xs text-slate-500 bg-slate-100 rounded-lg px-3 py-2">
            No password to set here — their <span className="font-medium">first sign-in with this
            email creates the account</span>, and whatever password they type then becomes theirs.
          </p>
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
