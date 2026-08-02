import React from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Target, Trophy } from "lucide-react";
import { Chip } from "./ui";
import { KPI_METRICS } from "./salesConfig";
import { computeActuals, scoreKpi, periodKey, periodLabel, monthProgress } from "./salesHelpers";

/* Performance — directly linked to the KPIs. An agent sees their own scorecard;
   a Department Head sees the same for themselves PLUS their whole team; Main
   Admin sees every department head. When someone is behind pace, their card
   goes red — the "firing tool". */

const METRIC_LABEL = Object.fromEntries(KPI_METRICS.map((m) => [m.key, m]));

function StatusPill({ status }) {
  if (status === "behind") return <Chip tone="red"><TrendingDown size={11} /> Behind</Chip>;
  if (status === "ahead") return <Chip tone="green"><TrendingUp size={11} /> Ahead</Chip>;
  if (status === "onTrack") return <Chip tone="amber"><Minus size={11} /> On track</Chip>;
  return <Chip tone="default">No KPI</Chip>;
}

function Scorecard({ title, subtitle, actuals, score, big }) {
  const behind = score.status === "behind";
  return (
    <div className={`panel scorecard ${behind ? "scorecard-danger" : ""}`}>
      <div className="panel-title-row">
        <h3 className="panel-title">{behind && <AlertTriangle size={14} />} {title}</h3>
        <StatusPill status={score.status} />
      </div>
      {subtitle && <p className="field-hint" style={{ marginTop: -6, marginBottom: 10 }}>{subtitle}</p>}
      {score.status === "none" ? (
        <p className="field-hint">No KPI targets set for this period yet.</p>
      ) : (
        <>
          {big && (
            <div className="attainment-hero">
              <div className="attainment-num" style={{ color: behind ? "var(--red)" : "var(--green)" }}>{Math.round((score.attainment || 0) * 100)}%</div>
              <div className="cell-sub">overall attainment · {Math.round(monthProgress() * 100)}% through the month</div>
            </div>
          )}
          <div className="kpi-bars">
            {score.rows.map((r) => {
              const m = METRIC_LABEL[r.key];
              const pct = Math.min(100, Math.round((r.pct || 0) * 100));
              return (
                <div className="kpi-bar-row" key={r.key}>
                  <div className="kpi-bar-label">
                    <span>{m?.label || r.key}</span>
                    <span className={`cell-sub ${r.behind ? "text-danger" : ""}`}>
                      {m?.money ? `₹${Number(r.actual).toLocaleString()}` : r.actual} / {m?.money ? `₹${Number(r.target).toLocaleString()}` : r.target}
                    </span>
                  </div>
                  <div className="kpi-bar-track"><div className={`kpi-bar-fill ${r.behind ? "kpi-bar-danger" : "kpi-bar-ok"}`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function Performance({ kpis, companies, deals, users, userName, userId, department, tier }) {
  const period = periodKey();
  const isMainAdmin = tier === "Main Admin";
  const isManager = tier === "Manager";

  const myKpi = (kpis || []).find((k) => k.userId === userId && k.period === period);
  const myActuals = computeActuals({ userName, companies, deals, period });
  const myScore = scoreKpi({ kpi: myKpi, actuals: myActuals });

  // Team rows for a manager: their department Users. For admin: all Managers.
  const teamMembers = (users || []).filter((u) => {
    if (u.active === false) return false;
    if (isMainAdmin) return u.tier === "Manager";
    if (isManager) return (u.department === department || (u.additionalDepartments || []).includes(department)) && u.tier === "User" && u.id !== userId;
    return false;
  });

  const teamRows = teamMembers.map((u) => {
    const kpi = (kpis || []).find((k) => k.userId === u.id && k.period === period);
    const actuals = computeActuals({ userName: u.name, companies, deals, period });
    const score = scoreKpi({ kpi, actuals });
    return { user: u, kpi, actuals, score };
  });

  const behindCount = teamRows.filter((r) => r.score.status === "behind").length;

  return (
    <div className="view">
      <div className="view-header">
        <div><h1>Performance</h1><p className="view-sub">{periodLabel(period)} · measured live from your pipeline activity</p></div>
      </div>

      {tier !== "Main Admin" && (
        <Scorecard title={`My scorecard — ${userName}`} subtitle="Set by your manager. This is what you're held to." actuals={myActuals} score={myScore} big />
      )}

      {(isManager || isMainAdmin) && (
        <>
          <div className="view-header" style={{ marginTop: 8 }}>
            <div>
              <h2 style={{ margin: 0 }}>{isMainAdmin ? "Department heads" : `${department} team`}</h2>
              <p className="view-sub" style={{ marginTop: 2 }}>
                {behindCount > 0
                  ? <span className="text-danger"><AlertTriangle size={12} /> {behindCount} {behindCount === 1 ? "person is" : "people are"} behind pace — follow up now.</span>
                  : "Everyone is on or ahead of pace."}
              </p>
            </div>
          </div>

          {teamRows.length === 0 ? (
            <div className="panel"><p className="field-hint">No team members in scope yet.</p></div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Person</th><th>Status</th><th>Attainment</th><th>Deals won</th><th>Revenue</th><th>Meetings</th><th>Companies</th></tr></thead>
                <tbody>
                  {teamRows.map((r) => (
                    <tr key={r.user.id} className={r.score.status === "behind" ? "row-danger" : ""}>
                      <td><div className="cell-primary">{r.user.name}</div><div className="cell-sub">{r.user.department} · {r.user.tier === "Manager" ? "Head" : "Member"}</div></td>
                      <td><StatusPill status={r.score.status} /></td>
                      <td className="mono">{r.score.attainment == null ? "—" : `${Math.round(r.score.attainment * 100)}%`}</td>
                      <td className="mono">{r.actuals.dealsWon}</td>
                      <td className="mono">₹{Number(r.actuals.revenueWon).toLocaleString()}</td>
                      <td className="mono">{r.actuals.meetingsHeld}</td>
                      <td className="mono">{r.actuals.companiesAdded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isMainAdmin && (
            <div className="stat-row" style={{ marginTop: 16 }}>
              <div className="stat-card"><div className="stat-card-top"><span className="stat-icon-badge stat-icon-green"><Trophy size={15} /></span></div><div className="stat-label">Total revenue won</div><div className="stat-value">₹{teamRows.reduce((s, r) => s + r.actuals.revenueWon, 0).toLocaleString()}</div></div>
              <div className="stat-card"><div className="stat-card-top"><span className="stat-icon-badge stat-icon-purple"><Target size={15} /></span></div><div className="stat-label">Heads behind pace</div><div className="stat-value" style={{ color: behindCount ? "var(--red)" : undefined }}>{behindCount}</div></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
