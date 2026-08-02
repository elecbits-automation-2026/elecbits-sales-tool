import React, { useState } from "react";
import { Target, Save, Sparkles, ChevronDown, ChevronRight, Brain } from "lucide-react";
import { Chip, Field } from "./ui";
import { uid } from "../lib/helpers";
import { KPI_METRICS, PIPELINE_STAGES, OUTCOME_STAGES, DEFAULT_STAGE_FORMS, GENERIC_STAGE_FORM } from "./salesConfig";
import { periodKey, periodLabel } from "./salesHelpers";

/* KPI setting: Main Admin sets targets for Department Heads (Managers); a
   Department Head sets targets for their team (Users). Plus, for admins, the
   AI Playbook editor that "trains" the stage-transition intake questions. */

export function KPIManager({ kpis, users, userName, userId, department, tier, config, onSaveKpi, onSaveConfig }) {
  const period = periodKey();
  const isMainAdmin = tier === "Main Admin";
  const isManager = tier === "Manager";

  // Whom can I set KPIs for?
  const targets = (users || []).filter((u) => {
    if (u.active === false) return false;
    if (isMainAdmin) return u.tier === "Manager"; // admin → dept heads
    if (isManager) return (u.department === department || (u.additionalDepartments || []).includes(department)) && u.tier === "User" && u.id !== userId; // head → team
    return false;
  });

  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({});

  function kpiFor(u) {
    return (kpis || []).find((k) => k.userId === u.id && k.period === period);
  }
  function startEdit(u) {
    const existing = kpiFor(u);
    setDraft(existing ? { ...existing.targets } : {});
    setOpenId(openId === u.id ? null : u.id);
  }
  function saveFor(u) {
    const existing = kpiFor(u);
    const record = {
      id: existing?.id || uid(),
      userId: u.id, userName: u.name, department: u.department, period,
      targets: draft, setBy: userName, setByTier: tier, updatedAt: new Date().toISOString(),
    };
    onSaveKpi(record);
    setOpenId(null);
  }

  return (
    <div className="view">
      <div className="view-header">
        <div><h1>KPI Targets</h1><p className="view-sub">{periodLabel(period)} · {isMainAdmin ? "Set targets for department heads" : isManager ? `Set targets for your ${department} team` : "View mode"}</p></div>
      </div>

      {targets.length === 0 ? (
        <div className="panel"><p className="field-hint">{isMainAdmin || isManager ? "No one to set targets for yet." : "Only Main Admin and Department Heads set KPI targets. See your own targets on the Performance tab."}</p></div>
      ) : (
        <div className="panel">
          <div className="panel-title-row"><h3 className="panel-title"><Target size={14} /> {isMainAdmin ? "Department heads" : "Team members"}</h3><Chip>{targets.length}</Chip></div>
          <div className="kpi-set-list">
            {targets.map((u) => {
              const k = kpiFor(u);
              const setCount = k ? Object.values(k.targets || {}).filter((v) => parseFloat(v) > 0).length : 0;
              const open = openId === u.id;
              return (
                <div className="kpi-set-row" key={u.id}>
                  <button className="kpi-set-head" onClick={() => startEdit(u)}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="cell-primary">{u.name}</span>
                    <span className="cell-sub">{u.department} · {u.tier === "Manager" ? "Head" : "Member"}</span>
                    {setCount > 0 ? <Chip tone="green">{setCount} targets set</Chip> : <Chip tone="amber">No targets</Chip>}
                  </button>
                  {open && (
                    <div className="kpi-set-body">
                      {KPI_METRICS.map((m) => (
                        <Field key={m.key} label={`${m.label}${m.money ? " (₹)" : ""}`}>
                          <input type="number" min="0" value={draft[m.key] ?? ""} placeholder="0"
                            onChange={(e) => setDraft({ ...draft, [m.key]: e.target.value })} />
                        </Field>
                      ))}
                      <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
                        <button className="btn btn-primary" onClick={() => saveFor(u)}><Save size={14} /> Save {periodLabel(period)} targets</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isMainAdmin && <AIPlaybookEditor config={config} onSaveConfig={onSaveConfig} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* AI Playbook editor (Main Admin) — feature 4's "training". Edits the      */
/* per-stage intake questions the AI asks, plus a global playbook memory    */
/* string injected into every intake so the AI applies the org's approach.  */
/* ---------------------------------------------------------------------- */
function AIPlaybookEditor({ config, onSaveConfig }) {
  const [forms, setForms] = useState(() => {
    const base = {};
    [...PIPELINE_STAGES, ...OUTCOME_STAGES].forEach((s) => {
      const existing = config?.stageForms?.[s];
      base[s] = (existing && existing.length ? existing : (DEFAULT_STAGE_FORMS[s] || GENERIC_STAGE_FORM)).join("\n");
    });
    return base;
  });
  const [playbook, setPlaybook] = useState(config?.playbook || "");
  const [saved, setSaved] = useState(false);

  function save() {
    const stageForms = {};
    Object.entries(forms).forEach(([stage, text]) => {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length) stageForms[stage] = lines;
    });
    onSaveConfig({ ...(config || {}), stageForms, playbook });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="panel">
      <div className="panel-title-row"><h3 className="panel-title"><Brain size={14} /> AI Intake Playbook</h3>{saved && <Chip tone="green">Saved</Chip>}</div>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        Train what the AI asks when a deal moves into each stage — one question per line. The playbook memory below is injected into every intake so the AI enforces your sales approach. This is how "knowledge is power" gets standardised.
      </p>
      <Field label="Playbook memory (applied to every intake)" hint="e.g. Always confirm decision maker + budget authority; never advance past RFQ without a written scope.">
        <textarea rows={3} value={playbook} onChange={(e) => setPlaybook(e.target.value)} />
      </Field>
      <div className="playbook-grid">
        {[...PIPELINE_STAGES, ...OUTCOME_STAGES].map((s) => (
          <Field key={s} label={`When moving into "${s}"`}>
            <textarea rows={4} value={forms[s]} onChange={(e) => setForms({ ...forms, [s]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="form-actions"><button className="btn btn-primary" onClick={save}><Sparkles size={14} /> Save playbook</button></div>
    </div>
  );
}
