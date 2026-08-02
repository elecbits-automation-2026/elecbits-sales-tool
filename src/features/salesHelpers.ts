/* ---------------------------------------------------------------------- */
/* Sales OS — derived metrics, IDs, and the "firing tool" health logic.     */
/*                                                                          */
/* Everything here is pure: it takes the raw collections and returns the    */
/* numbers the Performance / Dashboard / KPI views render. Because KPI      */
/* attainment is derived from real captured data (deals, stage history,     */
/* companies) rather than self-reported, the tool can hold people to it.    */
/* ---------------------------------------------------------------------- */
import { pad, uid } from "../lib/helpers";
import {
  KPI_METRIC_KEYS, STALE_DEAL_DAYS, REQUIRED_COMPANY_FIELDS, PIPELINE_STAGES,
} from "./salesConfig";

export function nextCompanyId(companies) {
  const max = (companies || []).reduce((m, c) => {
    const n = parseInt((c.id || "").split("-")[1] || "0", 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `COM-${pad(max + 1, 4)}`;
}

export function nextDealId(deals) {
  const max = (deals || []).reduce((m, d) => {
    const n = parseInt((d.id || "").split("-")[1] || "0", 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `DEA-${pad(max + 1, 4)}`;
}

export function nextExpenseId(expenses) {
  const max = (expenses || []).reduce((m, e) => {
    const n = parseInt((e.id || "").split("-")[1] || "0", 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `EXP-${pad(max + 1, 4)}`;
}

export { uid };

// Current period key, e.g. "2026-08". KPIs are set and measured per calendar month.
export function periodKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
}

export function periodLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function inPeriod(iso, period) {
  if (!iso) return false;
  return periodKey(new Date(iso)) === period;
}

/* ---------------------------------------------------------------------- */
/* Derive one user's actual metric values for a given month.               */
/* Matches the KPI_METRICS keys in salesConfig.                            */
/* ---------------------------------------------------------------------- */
export function computeActuals({ userName, companies, deals, period }) {
  const myCompanies = (companies || []).filter((c) => c.ownerName === userName || c.createdBy === userName);
  const myDeals = (deals || []).filter((d) => d.ownerName === userName);

  const companiesAdded = myCompanies.filter((c) => inPeriod(c.createdAt, period)).length;
  const dealsCreated = myDeals.filter((d) => inPeriod(d.createdAt, period)).length;

  let meetingsHeld = 0;
  let stageAdvances = 0;
  let dealsWon = 0;
  let revenueWon = 0;
  let activityLogs = 0;

  myDeals.forEach((d) => {
    (d.stageLogs || []).forEach((log) => {
      if (!inPeriod(log.at, period)) return;
      activityLogs += 1;
      const fromIdx = PIPELINE_STAGES.indexOf(log.from);
      const toIdx = PIPELINE_STAGES.indexOf(log.to);
      if (toIdx > fromIdx && toIdx !== -1) stageAdvances += 1;
      if (log.to === "First Meeting" || log.to === "Physical Meeting") meetingsHeld += 1;
      if (log.to === "Won") {
        dealsWon += 1;
        revenueWon += parseFloat(d.value) || 0;
      }
    });
  });

  return { companiesAdded, dealsCreated, meetingsHeld, stageAdvances, dealsWon, revenueWon, activityLogs };
}

// How far through the month are we (0..1)? Used to judge whether attainment is
// "on pace" — being at 20% on day 28 is a red flag; on day 3 it isn't.
export function monthProgress(d = new Date()) {
  const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.min(1, d.getDate() / total);
}

// Score a user against their KPI record. Returns per-metric rows + an overall
// status: "none" (no KPI set), "ahead", "onTrack", or "behind" (the red state).
export function scoreKpi({ kpi, actuals }) {
  if (!kpi || !kpi.targets) return { status: "none", rows: [], attainment: null };
  const pace = monthProgress();
  const rows = KPI_METRIC_KEYS.map((key) => {
    const target = parseFloat(kpi.targets[key]) || 0;
    const actual = actuals[key] || 0;
    const pct = target > 0 ? actual / target : null; // null = no target set for this metric
    const expected = target * pace;
    const behind = target > 0 && actual < expected * 0.75; // >25% behind pace
    return { key, target, actual, pct, behind };
  }).filter((r) => r.target > 0);

  if (rows.length === 0) return { status: "none", rows: [], attainment: null };

  const attainment = rows.reduce((s, r) => s + Math.min(1, r.pct || 0), 0) / rows.length;
  const anyBehind = rows.some((r) => r.behind);
  const status = anyBehind ? "behind" : attainment >= pace ? "ahead" : "onTrack";
  return { status, rows, attainment };
}

/* ---------------------------------------------------------------------- */
/* Data-hygiene flags — "no information is missed".                        */
/* ---------------------------------------------------------------------- */
export function companyIsIncomplete(c) {
  const missing = [];
  REQUIRED_COMPANY_FIELDS.forEach((f) => {
    if (!c[f] || !String(c[f]).trim()) missing.push(f);
  });
  const hasContact = (c.contacts || []).some((p) => p.name && (p.phone || p.email));
  if (!hasContact) missing.push("contact");
  return missing;
}

export function dealIsStale(d) {
  if (["Won", "Lost"].includes(d.stage)) return false;
  const last = new Date(d.updatedAt || d.createdAt).getTime();
  const days = (Date.now() - last) / 86400000;
  return days > STALE_DEAL_DAYS;
}

export function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// The dashboard "health" summary for one signed-in user — this is what turns
// the workspace red and nags them to fill data / work the pipeline.
export function buildHealthAlerts({ userName, companies, deals, kpi }) {
  const alerts = [];
  const myCompanies = (companies || []).filter((c) => c.ownerName === userName || c.createdBy === userName);
  const myDeals = (deals || []).filter((d) => d.ownerName === userName);

  const incomplete = myCompanies.filter((c) => companyIsIncomplete(c).length > 0);
  if (incomplete.length) {
    alerts.push({
      level: "warn",
      text: `${incomplete.length} of your compan${incomplete.length === 1 ? "y is" : "ies are"} missing key details — fill them in.`,
      tag: "data",
    });
  }

  const stale = myDeals.filter(dealIsStale);
  if (stale.length) {
    alerts.push({
      level: "danger",
      text: `${stale.length} deal${stale.length === 1 ? "" : "s"} haven't moved in over ${STALE_DEAL_DAYS} days — work them or update the stage.`,
      tag: "stale",
    });
  }

  const period = periodKey();
  const actuals = computeActuals({ userName, companies, deals, period });
  const score = scoreKpi({ kpi, actuals });
  if (score.status === "behind") {
    const worst = score.rows.filter((r) => r.behind).map((r) => r.key);
    alerts.push({
      level: "danger",
      text: `You are behind pace on your KPI this month (${worst.length} metric${worst.length === 1 ? "" : "s"}). Push your pipeline now.`,
      tag: "kpi",
    });
  } else if (score.status === "none") {
    // no-op: not everyone has a KPI; absence isn't an alert.
  }

  return { alerts, score, actuals };
}
