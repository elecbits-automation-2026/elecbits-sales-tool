import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Building2, Columns, TrendingUp, BookOpen, Receipt, Settings, Plus, X, Search,
  Mic, MicOff, Send, Check, CheckCircle2, XCircle, AlertTriangle, AlertCircle,
  Clock, Flame, LogOut, Pencil, Trash2, Sparkles, Loader2, Copy, ChevronRight,
  ArrowRight, Users, GraduationCap, ClipboardList, Phone, FileText,
  Bot, Database, CalendarCheck2, Sun, Moon, ListTodo, FolderOpen, PencilRuler,
  ExternalLink, BadgeCheck, Rocket, Gauge, Lightbulb, Paperclip, Play, GitBranch
} from "lucide-react";
import { supabase } from "./lib/supabase";
import {
  loadWorkspace, syncUsers, syncCompanies, syncDeals, syncKpis, syncTrainings,
  syncWorklogs, syncKnowledge, syncExpenses, syncScrums, syncMemory, syncGates,
  syncTasks, syncLlds, syncQuestionSet, mintClientId, submitProjectRequest,
  loadChat, loadChatDates, saveChat, saveSession, loadAllIdeas,
  loadTouches, saveTouch, loadCommitments, saveCommitments,
  deleteTask, deleteScrum,
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
import {
  STAGES, stageIdx, stageName, DEFAULT_GATES, KPI_METRICS,
  COMPANY_FIELDS, REQ_FIELDS, STALE_AMBER, STALE_RED,
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
  const data = { users, companies, deals, kpis, trainings, worklogs, knowledge, expenses, gates, scrums, memory, tasks, llds, questionSets, requests };
  const myHealth = useMemo(() => healthOf(me, data), [me, users, companies, deals, kpis, trainings, worklogs]);
  const fixNow = useMemo(() => (me ? fixNowItems(me, data) : []), [me, users, companies, deals, kpis, trainings, worklogs]);

  const logout = () => { signOut(); };

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
          {tab === "pipeline" && <PipelineView me={me} data={data} saveDeals={saveDeals} saveCompanies={saveCompanies} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "tasks" && <MyTasksView me={me} data={data} saveTasks={saveTasks} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "lld" && <LLDView me={me} data={data} saveLlds={saveLlds} />}
          {tab === "resources" && <ResourcesView me={me} data={data} saveUsers={saveUsers} openCompany={(id) => { setTab("companies"); setFocusCompanyId(id); }} />}
          {tab === "performance" && <PerformanceView me={me} data={data} saveKpis={saveKpis} saveTrainings={saveTrainings} saveWorklogs={saveWorklogs} fixNow={fixNow} goFix={goFix} />}
          {tab === "knowledge" && <KnowledgeView me={me} data={data} saveKnowledge={saveKnowledge} />}
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
    { label: "Workspace", items: [
      { key: "pipeline", label: "Pipeline", icon: Columns },
      { key: "companies", label: "Companies", icon: Building2 },
      { key: "tasks", label: "My Tasks", icon: ListTodo },
      { key: "lld", label: "LLD Creation", icon: PencilRuler },
    ] },
    { label: "Personal", items: [
      { key: "scrum", label: "Daily Scrum", icon: CalendarCheck2 },
      { key: "performance", label: "Performance", icon: TrendingUp },
    ] },
    { label: "Resources", items: [
      { key: "resources", label: "Resources", icon: Users },
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
    const next = exists ? companies.map((x) => (x.id === c.id ? c : x)) : [c, ...companies];
    saveCompanies(next);
    setEditing(null);
    setFocusCompanyId(c.id);
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
          <Btn onClick={() => setApplying(true)}><Rocket size={14} /> Apply for Project ID</Btn>
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
                {r.status === "accepted" && r.kind === "odm" && <span className="text-xs">→ sanctioned: create the LLD (menu → LLD Creation)</span>}
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
        {[["overview", "Overview", TrendingUp], ["plan", "Plan", ClipboardList], ["todos", "To-dos", ListTodo], ["comms", "Client Comms", Phone], ["files", "Files & Drive", FolderOpen], ["ask", "Ask the AI", Bot]].map(([k, l, Ic]) => (
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

      </>)}

      {ctab === "plan" && <PlanTab me={me} company={c} data={data} saveCompanies={saveCompanies} saveTasks={saveTasks} />}

      {ctab === "todos" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <SectionTitle>Open tasks on this company</SectionTitle>
          {myTasks.length === 0 ? <p className="text-sm text-slate-400">None. Create them from the chat, scrum, or My Tasks.</p> : (
            <div className="space-y-1.5">
              {myTasks.map((t) => {
                const who = users.find((u) => u.id === t.assignee);
                return (
                  <div key={t.id} className="flex items-center gap-2 text-sm border border-slate-200 rounded-md px-3 py-2">
                    <ListTodo size={13} className="text-slate-400 flex-none" />
                    <span className="mr-auto text-slate-800">{t.title}</span>
                    {t.due && <span className="text-xs text-slate-400">{fmtDate(t.due)}</span>}
                    {who && <Avatar name={who.name} size="sm" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {ctab === "comms" && <CommsTab me={me} company={c} data={data} saveTasks={saveTasks} />}

      {ctab === "files" && (
        <div className="grid lg:grid-cols-2 gap-4 mt-4 items-start">
          <DriveCard company={c} />
          <DriveIntel me={me} company={c} data={data} saveCompanies={saveCompanies} />
        </div>
      )}

      {ctab === "ask" && <div className="mt-4"><CompanyAssistant me={me} company={c} data={data} saveCompanies={saveCompanies} saveTasks={saveTasks} /></div>}

      {editing && <CompanyModal me={me} data={data} company={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={upsert} />}
      {newDeal && <NewDealModal me={me} data={data} fixedCompany={c} onClose={() => setNewDeal(false)} onCreate={createDeal} />}
      {minting && <MintIdModal company={c} data={data} onClose={() => setMinting(false)} saveCompanies={saveCompanies} me={me} />}
      {applying && <ProjectIdModal me={me} data={data} company={c} deal={myDeals.find((d) => !d.lost)} onClose={() => setApplying(false)} onSubmitted={onRequestSubmitted} />}
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
                          {c && stageIdx(d.stage) >= stageIdx("rfq") && !d.lost && (
                            <button onClick={() => openCompany(c.id)} className="text-xs text-blue-600 hover:underline flex items-center gap-0.5" title="RFQ in hand? Apply for the official Project ID — ULM sanctions it."><Rocket size={11} /> Project ID</button>
                          )}
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
  const isSelf = viewUser.id === me.id && (me.role === "agent" || me.role === "dept_head");
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
  if (!cfg.connected) return null;

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
        <Btn size="sm" onClick={() => setOpen(true)}><CalendarCheck2 size={12} /> Schedule the call</Btn>
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
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const refresh = React.useCallback(async (d) => {
    setItems(await recordings.list(d));
  }, []);

  useEffect(() => {
    let alive = true;
    recordings.available().then((ok) => {
      if (!alive) return;
      setOn(ok);
      if (ok) refresh(date);
    });
    return () => { alive = false; };
  }, [date, refresh]);

  if (on === false || on === null) return null;   // bucket not created yet

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
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />} Upload call audio
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

function MeetingsPanel({ date, onUse, usedIds }) {
  const [ff, setFf] = useState({ on: false });
  const [items, setItems] = useState(null);   // null = not looked yet
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

  if (!ff.on) return null;   // not connected — the panel would only be noise

  return (
    <div className="border border-slate-200 rounded-lg p-3 mb-3 bg-slate-50">
      <div className="flex items-center gap-2 flex-wrap">
        <Mic size={13} className="text-blue-600" />
        <span className="text-xs font-semibold text-slate-700 mr-auto">Recorded calls — {fmtDate(date)}</span>
        <Btn size="sm" disabled={busy} onClick={look}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {items === null ? "See the day's calls" : "Refresh"}
        </Btn>
      </div>
      {items !== null && items.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2">
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
      {err && <p className="text-[11px] text-amber-600 mt-1.5">{err}</p>}
      <p className="text-[11px] text-slate-400 mt-1.5">Picking a call adds it to the box below — it never replaces what is already there.</p>
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
        <ScheduleMeet date={date} users={users} present={present}
          onScheduled={(m) => {
            if (m.meetLink) setLink(m.meetLink);
            // A calendar event with no Meet link is a trap — say so rather
            // than leaving the box quietly empty.
            setErr(m.warning || (m.recording && !m.notetakerInvited
              ? "Meeting created, but the notetaker was dropped from the guest list — this Workspace may block external guests, so the call will not be transcribed."
              : ""));
          }} />
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
        <MeetingsPanel date={date} onUse={useMeeting} usedIds={fromMeetings} />
        {mode === "transcript" ? (
          <div className="space-y-2">
            <input ref={trFileRef} type="file" hidden accept=".txt,.vtt,.srt,.md,.json,.csv"
              onChange={(e) => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = () => setTr(String(r.result)); r.readAsText(f); } e.target.value = ""; }} />
            <div className="flex items-center gap-2">
              <Btn size="sm" onClick={() => trFileRef.current?.click()}><Paperclip size={12} /> Upload a file</Btn>
              {tr && <button onClick={() => setTr("")} className="text-xs text-slate-400 hover:text-red-500 ml-auto">clear</button>}
            </div>
            <UploadRecording date={date} />
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
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-sm text-slate-900">{by ? by.name : "?"}</span>
                  <span className="font-mono text-xs text-slate-400">{new Date(s.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                  {s.tasks && s.tasks.length > 0 ? <Chip color="blue">{s.tasks.length} task{s.tasks.length === 1 ? "" : "s"}</Chip> : <Chip color="slate">raw note</Chip>}
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

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
      <SectionTitle>Record assistant — chat, notes & tasks</SectionTitle>
      <p className="text-xs text-slate-500 mb-3">Talk to the record. Everything you write is filed as activity; the AI works the trained question set ({qset.length} questions, editable in Admin) and proposes tasks — accepted tasks land in <span className="font-medium">My Tasks</span> and on this company.</p>
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1 mb-3">
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

function CommsTab({ me, company: c, data, saveTasks }) {
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
      {/* ── log a touch ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <SectionTitle right={<Chip color="blue"><Phone size={11} /> said · promised · decided</Chip>}>Log a touch with {c.name}</SectionTitle>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {TOUCH_KINDS.map(([k, label, I]) => (
            <button key={k} onClick={() => setKind(k)}
              className={cls("px-2.5 py-1 rounded-lg text-xs font-medium border inline-flex items-center gap-1.5",
                kind === k ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:border-blue-400")}>
              <I size={12} /> {label}
            </button>
          ))}
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-xs ml-2">
            {[["in", "They came to us"], ["out", "We reached out"]].map(([k, l]) => (
              <button key={k} onClick={() => setDir(k)} className={cls("px-2.5 py-1 font-medium", dir === k ? "bg-slate-700 text-white" : "bg-white text-slate-600")}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          <div><p className="text-[11px] text-slate-400 mb-1">When</p><Input type="datetime-local" className="w-52" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
          <div className="flex-1 min-w-[200px]"><p className="text-[11px] text-slate-400 mb-1">Their side</p><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="who you spoke to" /></div>
        </div>
        <Input value={line} onChange={(e) => setLine(e.target.value)}
          placeholder={"What happened, in one line — “Sent the revised quote, they pushed back on tooling cost”"} />
        <button onClick={() => setMore(!more)} className="text-xs text-blue-600 hover:underline mt-2">{more ? "▾" : "▸"} Add detail, a link, or the minutes</button>
        {more && (
          <div className="space-y-2 mt-2">
            <TA value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-24"
              placeholder="Everything worth keeping. Paste a transcript here and the write-up will use all of it." />
            <div><p className="text-[11px] text-slate-400 mb-1">Link</p><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Fireflies / Meet recording / the mail thread" /></div>
            <div>
              <p className="text-[11px] text-slate-400 mb-1">Saved in Drive as</p>
              <div className="flex gap-2">
                <Input value={driveFile} onChange={(e) => setDriveFile(e.target.value)} placeholder="2026-08-14_MoM_pricing.docx" />
                <Btn size="sm" disabled={!driveFile.trim()} onClick={async () => {
                  setCheckMsg("checking…");
                  try {
                    const r = await drive.verify(driveFolderName(c), driveFile.trim());
                    setCheckMsg(r.found ? "✓ found in " + (r.matches[0] || {}).where : "✗ not in the folder — did it save?");
                  } catch (e) { setCheckMsg("could not check"); }
                }}>Check</Btn>
              </div>
              {checkMsg && <p className="text-[11px] text-slate-500 mt-1">{checkMsg}</p>}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 mt-3">
          <Btn disabled={busy || (!line.trim() && !notes.trim())} onClick={() => log(false)}>Log it</Btn>
          <Btn kind="primary" disabled={busy || (!line.trim() && !notes.trim())} onClick={() => log(true)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Log it and write it up with AI
          </Btn>
          <span className="text-xs text-slate-400 ml-auto">{touches ? touches.length + " on record" : "loading…"}</span>
        </div>
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

      {/* ── the timeline ── */}
      {(touches || []).map((t) => {
        const w = t.ai || {};
        const by = users.find((u) => u.id === t.author);
        return (
          <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 border-l-4 border-l-blue-500">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-400"><KindIcon k={t.kind} /></span>
              <span className="text-[11px] text-slate-400">{t.direction === "in" ? "↙ inbound" : "↗ outbound"}</span>
              <span className="font-mono text-xs text-slate-400">{fmtDate(t.at)} · {fmtTime(t.at)}</span>
              {by && <span className="text-xs text-slate-400">{by.name}</span>}
              {t.contactName && <span className="text-xs text-slate-500">→ {t.contactName}</span>}
              {w.temperature && <Chip color={w.temperature === "hot" ? "green" : w.temperature === "cold" ? "red" : "amber"}>{w.temperature}</Chip>}
              {t.link && <a href={t.link} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline ml-auto">source ↗</a>}
            </div>
            <p className="text-sm font-medium text-slate-800 mt-1.5">{t.subject || w.title}</p>
            {w.summary && <p className="text-xs text-slate-600 mt-1">{w.summary}</p>}
            {(w.ourCommitments || w.challenges || w.clientSaid) && (
              <button onClick={() => setOpen(open === t.id ? null : t.id)} className="text-xs text-blue-600 hover:underline mt-2">
                {open === t.id ? "▾" : "▸"} Full write-up
              </button>
            )}
            {open === t.id && (
              <div className="mt-2 space-y-2.5 border-t border-slate-100 pt-2.5">
                {(w.clientSaid || []).length > 0 && (<div><Lbl>What the client said</Lbl>{w.clientSaid.map((x, i) => <p key={i} className="text-sm text-slate-700 py-0.5">• {x}</p>)}</div>)}
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
        );
      })}
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

  const allChecked = criteria.every((_, i) => checks[i]);
  const ready = desc.trim() && spoc.trim() && (kind !== "boxbuild" || allChecked);

  const submit = async () => {
    setBusy(true); setErr("");
    const title = company.name + " — " + (kind === "boxbuild" ? "Box Build" : "ODM") + " (" + (svc === "01" ? "01 R&D" : "02 SCS") + ")";
    const summary = [
      "Priority: " + priority, "Customer SPOC: " + spoc, "Service category: " + (svc === "01" ? "01 R&D" : "02 SCS/Manufacturing"),
      "Description: " + desc.trim(), margin ? "Margin %: " + margin : "", pm ? "Proposed PM: " + pm : "",
      deal ? "Deal: " + deal.did : "",
      kind === "boxbuild" ? "Box-build acceptance criteria: ALL " + criteria.length + " passed" : "",
    ].filter(Boolean).join("\n");
    const id = await submitProjectRequest({
      companyId: company.id, title, summary, kind, targetDate: target || null,
      value: value || 0, urgency: priority === "P0" ? "high" : priority === "P3" ? "low" : "normal", by: me.id,
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
        <p className="text-xs text-slate-500">The question set below comes from the centralised project tracking sheet (editable in Admin). On sanction, ULM mints the official project ID <span className="font-mono">{c0(company)}-{svc}-…</span> and the project is allocated.</p>
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
        {kind === "odm" && <p className="text-xs text-slate-500 flex items-center gap-1.5"><PencilRuler size={13} /> ODM route: once ULM sanctions this, the deal will ask for LLD creation (menu → LLD Creation).</p>}
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
function WorkWindow({ task: t, data, saveTasks, onClose, onComplete }) {
  const { users, companies, tasks } = data;
  const comp = companies.find((c) => c.id === t.companyId);
  const who = users.find((u) => u.id === t.assignee);
  const [brief, setBrief] = useState(briefOk((t.ai || {}).brief) ? (t.ai || {}).brief : null);
  const [ans, setAns] = useState((t.work || {}).prepAnswers || {});

  useEffect(() => {
    let alive = true;
    if (!brief) getBrief(t, comp, who).then((b) => {
      if (!alive) return;
      setBrief(b);
      saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, ai: { ...(x.ai || {}), brief: b } } : x)));
    });
    return () => { alive = false; };
  }, [t.id]);

  const save = () => saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, work: { ...(x.work || {}), prepAnswers: ans } } : x)));

  return (
    <Modal title={t.title} onClose={onClose} wide
      footer={<>
        <Btn onClick={() => { save(); onClose(); }}>Save progress</Btn>
        <Btn kind="primary" onClick={() => { save(); onComplete(); }}><CheckCircle2 size={14} /> Complete Now</Btn>
      </>}>
      <p className="text-xs text-slate-400 -mt-2 mb-4">
        {[comp && comp.name, who && who.name, (t.windowStart || t.windowEnd) ? (t.windowStart || "…") + "–" + (t.windowEnd || "…") : null]
          .filter(Boolean).join(" · ")} · full scope on the left, your prep on the right
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        <TaskScopeCard task={t} comp={comp} brief={brief} companies={companies}
          onLink={(id) => saveTasks(tasks.map((x) => (x.id === t.id ? { ...x, companyId: id } : x)))} />
        <div className="space-y-3">
          {!brief ? (
            <p className="text-sm text-slate-400 flex items-center gap-2 py-4"><Loader2 size={14} className="animate-spin" /> Working out what this task needs…</p>
          ) : (<>
            <div className="flex items-center gap-2">
              <Lbl className="mr-auto">Before you start</Lbl>
              {brief.source === "fallback" && <span className="text-[10.5px] text-slate-400">offline brief</span>}
            </div>
            {brief.prep.map((q, i) => (
              <div key={i}>
                <p className="text-[12.5px] text-slate-700 mb-1.5">{q}</p>
                <Input value={ans[i] || ""} onChange={(e) => setAns({ ...ans, [i]: e.target.value })} onBlur={save} />
              </div>
            ))}
            <p className="text-[11px] text-slate-400 pt-1">
              Optional — answering now makes closing this a ten-second job.
            </p>
          </>)}
        </div>
      </div>
    </Modal>
  );
}

function MyTasksView({ me, data, saveTasks, openCompany }) {
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
    return (
      <div>
        <div className="flex items-center gap-2.5 border border-slate-200 rounded-md px-3 py-2 bg-white">
          {t.status === "open" && <span className="w-4 h-4 rounded-full border border-slate-300 flex-none" />}
          {t.status === "doing" && (
            <button title="Complete this task" onClick={() => setClosing(t)} className="w-4 h-4 rounded-full border-2 border-blue-500 flex-none hover:bg-blue-50" />
          )}
          {t.status === "done" && (
            <button title="Reopen" onClick={() => toggle(t)} className="w-4 h-4 rounded border bg-green-600 border-green-600 text-white flex-none flex items-center justify-center"><Check size={11} /></button>
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
          {t.status === "open" && <Btn size="sm" kind="primary" onClick={() => startTask(t)}><Play size={12} /> Start</Btn>}
          {t.status === "doing" && <>
            <Btn size="sm" onClick={() => setWorking(t)}><FileText size={12} /> Work window</Btn>
            <Btn size="sm" kind="primary" onClick={() => setClosing(t)}><CheckCircle2 size={12} /> Complete Now</Btn>
          </>}
          <button onClick={() => remove(t)} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto">
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
      {working && !closing && <WorkWindow task={tasks.find((x) => x.id === working.id) || working} data={data} saveTasks={saveTasks}
        onClose={() => setWorking(null)} onComplete={() => { const t = tasks.find((x) => x.id === working.id) || working; setWorking(null); setClosing(t); }} />}
      {closing && <TaskCloseFlow me={me} data={data} task={tasks.find((x) => x.id === closing.id) || closing} onClose={() => setClosing(null)} saveTasks={saveTasks} />}
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
  );
}

/* ============================================================
   RESOURCES — carried from the ODM PMS Resources module, driven
   by this tool's data: Team View · Resource Planning · Efficiency
   ============================================================ */

function ResourcesView({ me, data, saveUsers, openCompany }) {
  const { users, companies, deals, tasks, trainings, worklogs, expenses, kpis } = data;
  const isAdmin = me.role === "admin" || me.role === "dept_head";
  const [tab, setTab] = useState("team");
  const [q, setQ] = useState("");
  const [roleF, setRoleF] = useState("all");
  const [deptF, setDeptF] = useState("all");
  const [avFrom, setAvFrom] = useState(todayStr());
  const [avTo, setAvTo] = useState(() => localISO(new Date(Date.now() + 14 * 86400000)));
  const [person, setPerson] = useState(null);
  const [resModal, setResModal] = useState(null); // null | "new" | user
  const CAP = 8; // open deals one person can genuinely work

  const roles = [...new Set(users.map((u) => u.role))];
  const depts = [...new Set(users.map((u) => u.dept).filter(Boolean))];
  const needle = q.trim().toLowerCase();
  const matchesQ = (u) => !needle || [u.name, u.email, u.dept, roleLabel(u.role)].some((v) => String(v || "").toLowerCase().includes(needle));
  const filtered = users.filter((u) => (roleF === "all" || u.role === roleF) && (deptF === "all" || u.dept === deptF) && matchesQ(u));

  const openDealsOf = (id) => deals.filter((d) => d.ownerId === id && !d.lost && d.stage !== "po");
  const openTasksOf = (id) => tasks.filter((t) => t.assignee === id && t.status !== "done");
  const travelIn = (id, from, to) => (expenses || []).filter((e) => e.userId === id && e.status !== "rejected" && e.from && e.to && e.from <= to && e.to >= from);
  const tasksIn = (id, from, to) => tasks.filter((t) => t.assignee === id && t.status !== "done" && t.due && t.due >= from && t.due <= to);
  const statusOf = (u) => {
    if (u.active === false) return ["Inactive", "slate"];
    const n = openDealsOf(u.id).length;
    return n >= CAP ? ["At Capacity", "red"] : n > 0 ? ["Deployed", "amber"] : ["Available", "green"];
  };

  const upsertUser = (u) => {
    const exists = users.some((x) => x.id === u.id);
    saveUsers(exists ? users.map((x) => (x.id === u.id ? u : x)) : [...users, u]);
    setResModal(null);
  };

  /* Nobody is emailed automatically, so the admin has to tell them. Hand over
     the exact words — with the exact address — rather than leaving them to
     retype it and mistype it. (Same pattern as the ODM PMS.) */
  const InviteBtn = ({ u }) => {
    const [done, setDone] = useState(false);
    if (u.authId || !u.email) return null;
    const text =
      "You're set up on the Elecbits Sales OS as " + roleLabel(u.role) + ".\n\n" +
      "1. Open " + (typeof window !== "undefined" ? window.location.origin : "") + "\n" +
      "2. Sign in with exactly this email: " + u.email + "\n" +
      "3. Pick any password — the account is created the first time you press Sign in.\n\n" +
      "Use that email exactly, or the app won't know it's you.";
    return (
      <button title="Copy the joining instructions for this person"
        onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => {}); }}
        className={cls("inline-flex items-center gap-1 border border-slate-300 rounded-md px-2 py-1 text-xs font-medium", done ? "text-green-600" : "text-blue-600 hover:bg-slate-50")}>
        {done ? <CheckCircle2 size={12} /> : <Send size={12} />} {done ? "Copied" : "Invite"}
      </button>
    );
  };

  const NameCell = ({ u }) => (
    <button onClick={() => setPerson(u)} className="flex items-center gap-2.5 text-left">
      <Avatar name={u.name} size="sm" />
      <span className="min-w-0">
        <span className="block font-medium text-slate-800 text-sm">{u.name}{u.id === me.id && <span className="text-xs text-slate-400 font-normal"> (you)</span>}</span>
        {!u.authId && <span className="block text-[11px] text-amber-600">{u.email ? "awaiting sign-up · " + u.email : "awaiting sign-up — no email on file"}</span>}
      </span>
    </button>
  );

  const DealsCell = ({ id }) => {
    const list = openDealsOf(id);
    if (!list.length) return <span className="text-slate-300 text-sm">None</span>;
    return (
      <div className="space-y-1">
        {list.slice(0, 4).map((d) => {
          const comp = companies.find((x) => x.id === d.companyId);
          return (
            <div key={d.id} className="text-sm">
              <button onClick={() => comp && openCompany(comp.id)} className="font-medium text-slate-800 hover:text-blue-700">{comp ? comp.name : d.did}</button>
              <span className="font-mono text-[11px] text-slate-400 ml-2">{stageName(d.stage)} · {fmtINRc(d.value)}</span>
            </div>
          );
        })}
        {list.length > 4 && <p className="text-xs text-slate-400">+{list.length - 4} more</p>}
      </div>
    );
  };

  const TABS = [["team", "Team View", Users], ["planning", "Resource Planning", CalendarCheck2], ["efficiency", "Efficiency", TrendingUp]];
  const th = "text-left py-2.5 px-4 text-[10.5px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap";
  const td = "py-3 px-4 align-middle";

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* toolbar: tabs · search · count · add */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 flex items-center gap-1 flex-wrap">
        {TABS.map(([k, l, Ic]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cls("flex items-center gap-1.5 px-3.5 py-3 text-sm border-b-2 -mb-px", tab === k ? "border-blue-600 text-blue-700 font-semibold" : "border-transparent text-slate-500 font-medium hover:text-slate-700")}>
            <Ic size={15} /> {l}
          </button>
        ))}
        <div className="ml-auto relative flex items-center">
          <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
          <Input className="pl-8 w-52 my-2" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="text-xs text-slate-500 pl-2"><b className="text-slate-800">{filtered.length}</b> resource{filtered.length !== 1 ? "s" : ""}</span>
        {isAdmin && <Btn size="sm" kind="primary" className="ml-2 my-2" onClick={() => setResModal("new")}><Plus size={13} /> Add Resource</Btn>}
      </div>

      {/* filters */}
      {(tab === "team" || tab === "planning") && (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-end gap-3 flex-wrap">
          <Field label="Role"><Sel className="w-44" value={roleF} onChange={(e) => setRoleF(e.target.value)}><option value="all">All roles</option>{roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Sel></Field>
          <Field label="Department"><Sel className="w-44" value={deptF} onChange={(e) => setDeptF(e.target.value)}><option value="all">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</Sel></Field>
          {tab === "planning" && (<>
            <Field label="Available from"><Input type="date" className="w-40" value={avFrom} onChange={(e) => setAvFrom(e.target.value)} /></Field>
            <Field label="Available to"><Input type="date" className="w-40" value={avTo} onChange={(e) => setAvTo(e.target.value)} /></Field>
          </>)}
        </div>
      )}

      {/* ── TEAM VIEW ─────────────────────────────────────────── */}
      {tab === "team" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                <th className={th}>Name</th><th className={th}>Role</th><th className={th}>Dept</th>
                <th className={th}>Working on — open deals</th><th className={cls(th, "text-center")}>Open tasks</th>
                <th className={cls(th, "text-center")}>Cap</th><th className={th}>Status</th>
                {isAdmin && <th className={th}>Actions</th>}
              </tr></thead>
              <tbody>
                {filtered.map((u) => {
                  const n = openDealsOf(u.id).length; const ot = openTasksOf(u.id).length;
                  const [sl, sc] = statusOf(u);
                  return (
                    <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className={td}><NameCell u={u} /></td>
                      <td className={td}><Chip color="blue">{roleLabel(u.role)}</Chip></td>
                      <td className={cls(td, "text-sm text-slate-600")}>{u.dept}</td>
                      <td className={td}><DealsCell id={u.id} /></td>
                      <td className={cls(td, "text-center font-mono text-sm tabular-nums", ot ? "text-blue-600 font-semibold" : "text-slate-300")}>{ot}</td>
                      <td className={cls(td, "text-center font-mono text-sm font-bold tabular-nums", n >= CAP ? "text-red-600" : "text-green-600")}>{n}/{CAP}</td>
                      <td className={td}><Chip color={sc}>{sl}</Chip></td>
                      {isAdmin && <td className={cls(td, "whitespace-nowrap")}><InviteBtn u={u} /> <button title="Edit resource" onClick={(e) => { e.stopPropagation(); setResModal(u); }} className="inline-flex border border-slate-300 rounded-md p-1.5 text-blue-600 hover:bg-slate-50 align-middle"><Pencil size={13} /></button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── RESOURCE PLANNING ─────────────────────────────────── */}
      {tab === "planning" && (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-600">
            Showing availability in the period <b className="text-blue-700">{fmtDate(avFrom)}</b> → <b className="text-blue-700">{fmtDate(avTo)}</b> — travel bookings, tasks due, and deal load all count.
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className={th}>Resource</th><th className={th}>Role</th><th className={th}>Availability in period</th>
                  <th className={th}>Travel in period</th><th className={cls(th, "text-center")}>Tasks due</th><th className={th}>Status</th>
                </tr></thead>
                <tbody>
                  {filtered.map((u) => {
                    const trips = travelIn(u.id, avFrom, avTo);
                    const due = tasksIn(u.id, avFrom, avTo).length;
                    const nDeals = openDealsOf(u.id).length;
                    const busy = nDeals >= CAP; const partly = trips.length > 0 || due > 0 || nDeals > 0;
                    const label = busy ? "At capacity in this period" : trips.length ? "Travelling — check the dates" : partly ? "Partially available — check load" : "Fully free " + fmtDate(avFrom) + " → " + fmtDate(avTo);
                    return (
                      <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className={td}><NameCell u={u} /></td>
                        <td className={td}><Chip color="blue">{roleLabel(u.role)}</Chip></td>
                        <td className={cls(td, "text-sm font-semibold", busy ? "text-red-600" : partly ? "text-amber-600" : "text-green-600")}>{label}</td>
                        <td className={td}>
                          {trips.length === 0 ? <span className="text-slate-300 text-sm">None</span> : trips.map((t) => {
                            const comp = companies.find((c) => c.id === t.companyId);
                            return <div key={t.id} className="text-sm"><span className="font-medium text-slate-800">{t.city || t.purpose}</span><span className="font-mono text-[11px] text-slate-400 ml-2">{fmtDate(t.from)} – {fmtDate(t.to)}{comp ? " · " + comp.name : ""}</span></div>;
                          })}
                        </td>
                        <td className={cls(td, "text-center font-mono text-sm tabular-nums", due ? "text-blue-600 font-semibold" : "text-slate-300")}>{due}</td>
                        <td className={td}><Chip color={busy ? "red" : partly ? "amber" : "green"}>{busy ? "At Capacity" : partly ? "Partially Deployed" : "Available"}</Chip></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── EFFICIENCY ────────────────────────────────────────── */}
      {tab === "efficiency" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                <th className={th}>Name</th><th className={th}>Role</th>
                <th className={cls(th, "text-center")}>Open deals</th><th className={cls(th, "text-center")}>Won (PO)</th>
                <th className={cls(th, "text-center")}>Tasks</th><th className={cls(th, "text-center")}>Done</th><th className={cls(th, "text-center")}>Overdue</th>
                <th className={cls(th, "w-40")}>Completion</th><th className={cls(th, "text-center")}>Health</th>
              </tr></thead>
              <tbody>
                {filtered.map((u) => {
                  const mine = tasks.filter((t) => t.assignee === u.id);
                  const done = mine.filter((t) => t.status === "done").length;
                  const overdue = mine.filter((t) => t.status !== "done" && t.due && t.due < todayStr()).length;
                  const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
                  const won = deals.filter((d) => d.ownerId === u.id && d.stage === "po" && !d.lost).length;
                  const h = healthOf(u, data);
                  return (
                    <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className={td}><NameCell u={u} /></td>
                      <td className={td}><Chip color="blue">{roleLabel(u.role)}</Chip></td>
                      <td className={cls(td, "text-center font-mono text-sm tabular-nums")}>{openDealsOf(u.id).length}</td>
                      <td className={cls(td, "text-center font-mono text-sm tabular-nums text-green-600 font-semibold")}>{won}</td>
                      <td className={cls(td, "text-center font-mono text-sm tabular-nums")}>{mine.length}</td>
                      <td className={cls(td, "text-center font-mono text-sm tabular-nums text-green-600")}>{done}</td>
                      <td className={cls(td, "text-center font-mono text-sm tabular-nums", overdue ? "text-red-600 font-semibold" : "text-slate-300")}>{overdue}</td>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className={cls("h-full rounded-full", pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500")} style={{ width: pct + "%" }} /></div>
                          <span className="font-mono text-xs tabular-nums text-slate-500 w-9 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className={cls(td, "text-center")}>{h == null ? <span className="text-slate-300">—</span> : <span className={cls("font-mono text-sm tabular-nums", h < 60 ? "text-red-600" : h < 80 ? "text-amber-600" : "text-green-600")}>{h}%</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">Deployment = open deals owned (capacity {CAP}). Tasks flow in from Daily Scrum and the company chat. Health = KPI pace + training + work-update discipline.</p>

      {/* person profile — deals, tasks, trainings, recent work updates */}
      {person && (
        <Modal title={person.name + " — deployment"} onClose={() => setPerson(null)} wide>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center text-sm">
              <Chip color="blue">{roleLabel(person.role)}</Chip>
              <span className="text-slate-500">{person.dept}</span>
              <span className="font-mono text-xs text-slate-400">{person.email}</span>
              {!person.authId && <Chip color="amber">awaiting sign-up</Chip>}
              {isAdmin && <span className="ml-auto"><InviteBtn u={person} /></span>}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Working on — open deals ({openDealsOf(person.id).length}/{CAP})</p>
              {openDealsOf(person.id).length === 0 ? <p className="text-sm text-slate-400">Nothing on the board.</p> : (
                <div className="space-y-1.5">
                  {openDealsOf(person.id).map((d) => {
                    const comp = companies.find((x) => x.id === d.companyId);
                    return (
                      <button key={d.id} onClick={() => { setPerson(null); comp && openCompany(comp.id); }} className="w-full text-left flex items-center gap-2 border border-slate-200 rounded-md px-3 py-2 hover:border-blue-400">
                        <span className="font-medium text-sm text-slate-800 mr-auto">{comp ? comp.name : d.did}</span>
                        <Chip color="blue">{stageName(d.stage)}</Chip>
                        <span className="font-mono text-sm tabular-nums">{fmtINRc(d.value)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Open tasks ({openTasksOf(person.id).length})</p>
              {openTasksOf(person.id).slice(0, 10).map((t) => {
                const comp = companies.find((x) => x.id === t.companyId);
                return <p key={t.id} className="text-sm text-slate-700 py-0.5">• {t.title} {comp && <span className="text-xs text-slate-400">({comp.name})</span>} {t.due && <span className={cls("text-xs", t.due < todayStr() ? "text-red-600 font-semibold" : "text-slate-400")}>due {fmtDate(t.due)}</span>} <span className="text-[10px] uppercase text-slate-300">{t.source}</span></p>;
              })}
              {openTasksOf(person.id).length === 0 && <p className="text-sm text-slate-400">No open tasks.</p>}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Trainings</p>
                {trainings.filter((t) => t.assignedTo === person.id).map((t) => (
                  <p key={t.id} className="text-sm text-slate-700 py-0.5">• {t.title} <Chip color={t.status === "done" ? "green" : "amber"}>{t.status}</Chip></p>
                ))}
                {trainings.filter((t) => t.assignedTo === person.id).length === 0 && <p className="text-sm text-slate-400">None assigned.</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent work updates</p>
                {(worklogs || []).filter((w) => w.userId === person.id).slice(0, 3).map((w) => (
                  <p key={w.id} className="text-sm text-slate-700 py-0.5 truncate">• <span className="font-mono text-xs text-slate-400">{fmtDate(w.date)}</span> {w.progress}</p>
                ))}
                {(worklogs || []).filter((w) => w.userId === person.id).length === 0 && <p className="text-sm text-slate-400">Nothing logged.</p>}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {resModal && <UserModal user={resModal === "new" ? null : resModal} me={me} onClose={() => setResModal(null)} onSave={upsertUser} />}
    </div>
  );
}

/* ============================================================
   LLD CREATION — 30-question capture, per company/deal
   ============================================================ */

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
