import React, { useState } from "react";
import {
  PlusCircle, Search, X, ChevronLeft, AlertTriangle, Clock, Trophy, Ban,
  Building2, Sparkles, History as HistoryIcon, GripVertical, ArrowRight,
} from "lucide-react";
import { Chip, Field, EmptyState, Modal } from "./ui";
import { uid, timeAgo } from "../lib/helpers";
import { StageTransitionChat } from "./StageTransitionChat";
import {
  PIPELINE_STAGES, OUTCOME_STAGES, ALL_STAGES, STAGE_COLOR, STAGE_CAPTURES,
} from "./salesConfig";
import { nextDealId, dealIsStale, daysSince } from "./salesHelpers";

function NewDealModal({ companies, salesTeam, userName, onClose, onCreate }) {
  const [form, setForm] = useState({ companyId: "", title: "", value: "", ownerName: userName });
  function submit(e) {
    e.preventDefault();
    if (!form.companyId || !form.title.trim()) return;
    onCreate(form);
  }
  return (
    <Modal title="New deal" icon={PlusCircle} onClose={onClose}
      actions={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={submit}>Create deal</button></>}>
      <form onSubmit={submit}>
        <Field label="Company *" hint={companies.length === 0 ? "Add a company first on the Companies tab." : ""}>
          <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            <option value="">Choose a company…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
          </select>
        </Field>
        <Field label="Deal title *"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="v2 board — contract manufacturing" /></Field>
        <div className="grid-2">
          <Field label="Estimated value (INR)"><input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="500000" /></Field>
          <Field label="Owner">
            <select value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })}>
              {salesTeam.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="field-hint">New deals start in <strong>Lead</strong>. Every move after that runs a guided AI intake so nothing is missed.</p>
      </form>
    </Modal>
  );
}

function CaptureModal({ stage, onClose, onSubmit }) {
  const cap = STAGE_CAPTURES[stage];
  const [val, setVal] = useState("");
  return (
    <Modal title={`Capture ${cap.label}`} onClose={onClose}
      actions={<><button className="btn btn-ghost" onClick={onClose}>Skip</button><button className="btn btn-primary" onClick={() => onSubmit(val)}>Save & move</button></>}>
      <Field label={`${cap.label} *`}><input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={cap.placeholder} /></Field>
    </Modal>
  );
}

function DealDetail({ deal, company, onBack }) {
  return (
    <div className="view">
      <button className="back-link" onClick={onBack}><ChevronLeft size={14} /> Pipeline</button>
      <div className="detail-header">
        <div>
          <div className="detail-ids">
            <span className="mono id-chip">{deal.id}</span>
            {deal.projectId && <span className="mono id-chip">{deal.projectId}</span>}
            {company && <span className="mono id-chip subtle">{company.id}</span>}
          </div>
          <h1>{deal.title}</h1>
          <p className="view-sub">{company?.name || "—"} · Owner {deal.ownerName}</p>
        </div>
        <Chip tone={deal.stage === "Won" ? "green" : deal.stage === "Lost" ? "red" : "amber"}>{deal.stage}</Chip>
      </div>

      <div className="detail-grid">
        <div className="panel">
          <h3 className="panel-title">Overview</h3>
          <div className="kv"><span>Value</span><span className="mono">{deal.value ? `₹${Number(deal.value).toLocaleString()}` : "—"}</span></div>
          <div className="kv"><span>Project ID</span><span className="mono">{deal.projectId || "—"}</span></div>
          <div className="kv"><span>Project Manager</span><span>{deal.pmName || "—"}</span></div>
          <div className="kv"><span>Opened</span><span className="cell-sub">{timeAgo(deal.createdAt)}</span></div>
          <div className="kv"><span>Last activity</span><span className="cell-sub">{timeAgo(deal.updatedAt)}</span></div>
          {deal.lostReason && <div className="kv"><span>Lost reason</span><span>{deal.lostReason}</span></div>}
        </div>
        <div className="panel">
          <h3 className="panel-title"><HistoryIcon size={14} /> Stage history</h3>
          <ul className="history-list">
            {(deal.history || []).slice().reverse().map((h) => (
              <li key={h.id}><Clock size={12} /><span>{h.from ? `${h.from} → ${h.to}` : `Opened at ${h.to}`} by {h.by}</span><span className="cell-sub">{timeAgo(h.at)}</span></li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title"><Sparkles size={14} /> Guided intake log</h3>
        {(deal.stageLogs || []).length === 0 ? <p className="field-hint">No intake notes yet.</p> : (
          <div className="note-list">
            {deal.stageLogs.slice().reverse().map((log) => (
              <div className="note-card" key={log.id}>
                <div className="note-meta"><span>{log.from || "New"} → {log.to} · {log.by}</span><span>{timeAgo(log.at)}</span></div>
                <div className="note-text" style={{ whiteSpace: "pre-wrap" }}>{log.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Pipeline({ deals, companies, users, userName, department, tier, stageForms, onCreate, onUpdate }) {
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState("");
  const [chat, setChat] = useState(null);       // { deal, toStage }
  const [capture, setCapture] = useState(null);  // { deal, toStage, log }
  const [dragId, setDragId] = useState(null);

  const isMainAdmin = tier === "Main Admin";
  const canManage = isMainAdmin || department === "Sales";
  const salesTeam = (users || []).filter((u) => u.department === "Sales" || (u.additionalDepartments || []).includes("Sales"));
  const companyById = Object.fromEntries((companies || []).map((c) => [c.id, c]));

  const scoped = (deals || []).filter((d) => {
    if (isMainAdmin) return true;
    if (department === "Sales") return tier === "Manager" ? true : d.ownerName === userName;
    return true;
  });
  const visible = scoped.filter((d) => {
    if (!q) return true;
    const c = companyById[d.companyId];
    return `${d.id} ${d.title} ${c?.name || ""}`.toLowerCase().includes(q.toLowerCase());
  });

  const selected = deals.find((d) => d.id === selectedId);
  const accountMemoryFor = (companyId) => {
    const c = companyById[companyId];
    if (!c) return "";
    const details = (c.details || []).map((x) => `${x.label}: ${x.value}`).join("; ");
    return [c.whatTheyDo, details].filter(Boolean).join(" | ");
  };

  function handleCreate(form) {
    const now = new Date().toISOString();
    onCreate({
      id: nextDealId(deals),
      companyId: form.companyId,
      title: form.title.trim(),
      value: form.value,
      currency: "INR",
      stage: "Lead",
      ownerName: form.ownerName,
      department: "Sales",
      projectId: null,
      pmName: null,
      stageLogs: [],
      history: [{ id: uid(), from: null, to: "Lead", by: userName, at: now }],
      createdBy: userName,
      createdAt: now,
      updatedAt: now,
    });
    setShowNew(false);
  }

  // Begin a move: opens the AI intake chat for from→to.
  function beginMove(deal, toStage) {
    if (deal.stage === toStage) return;
    setChat({ deal, toStage });
  }

  // Chat finished → build the stage log, then either capture a value or finalize.
  function onChatComplete({ transcript, summary }) {
    const { deal, toStage } = chat;
    const now = new Date().toISOString();
    const log = { id: uid(), from: deal.stage, to: toStage, by: userName, at: now, summary, transcript };
    setChat(null);
    if (STAGE_CAPTURES[toStage] && !deal[STAGE_CAPTURES[toStage].field]) {
      setCapture({ deal, toStage, log });
    } else {
      finalizeMove(deal, toStage, log, {});
    }
  }

  function finalizeMove(deal, toStage, log, extra) {
    const now = new Date().toISOString();
    onUpdate({
      ...deal,
      ...extra,
      stage: toStage,
      lostReason: toStage === "Lost" ? (log.summary || "").slice(0, 200) : deal.lostReason,
      stageLogs: [...(deal.stageLogs || []), log],
      history: [...(deal.history || []), { id: uid(), from: deal.stage, to: toStage, by: userName, at: now }],
      updatedAt: now,
    });
  }

  if (selected) return <DealDetail deal={selected} company={companyById[selected.companyId]} onBack={() => setSelectedId(null)} />;

  const columns = ALL_STAGES.map((s) => ({ stage: s, items: visible.filter((d) => d.stage === s) }));

  return (
    <div className="view">
      <div className="view-header">
        <div><h1>Pipeline</h1><p className="view-sub">{scoped.length} deals · drag a card to move it — every move runs a guided AI intake</p></div>
        {canManage && <button className="btn btn-primary" onClick={() => setShowNew(true)} disabled={companies.length === 0}><PlusCircle size={16} /> New deal</button>}
      </div>

      {companies.length === 0 && (
        <div className="save-error" style={{ position: "static", margin: "0 0 14px" }}>
          <AlertTriangle size={12} /> Add a company on the Companies tab before opening a deal.
        </div>
      )}

      <div className="toolbar">
        <div className="search-box"><Search size={14} /><input placeholder="Search deal, company…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Building2} title="No deals yet" body={canManage ? "Open your first deal to start the pipeline." : "No deals to show."} />
      ) : (
        <div className="pipeline-board">
          {columns.map((col) => (
            <div
              className={`pipe-col pipe-${STAGE_COLOR[col.stage] || "slate"} ${OUTCOME_STAGES.includes(col.stage) ? "pipe-outcome" : ""}`}
              key={col.stage}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }}
              onDrop={() => { if (dragId) { const d = deals.find((x) => x.id === dragId); if (d) beginMove(d, col.stage); setDragId(null); } }}
            >
              <div className="pipe-col-head">
                <span className="pipe-col-name">
                  {col.stage === "Won" && <Trophy size={12} />}
                  {col.stage === "Lost" && <Ban size={12} />}
                  {col.stage}
                </span>
                <Chip>{col.items.length}</Chip>
              </div>
              <div className="pipe-col-body">
                {col.items.length === 0 ? <p className="field-hint" style={{ padding: "2px 4px" }}>—</p> : col.items.map((d) => {
                  const c = companyById[d.companyId];
                  const stale = dealIsStale(d);
                  const stageIdx = PIPELINE_STAGES.indexOf(d.stage);
                  const nextStage = stageIdx >= 0 && stageIdx < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[stageIdx + 1] : null;
                  return (
                    <div
                      className={`pipe-card ${stale ? "stale" : ""}`}
                      key={d.id}
                      draggable={canManage}
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => setDragId(null)}
                    >
                      <div className="pipe-card-top" onClick={() => setSelectedId(d.id)}>
                        {canManage && <GripVertical size={13} className="pipe-grip" />}
                        <span className="pipe-card-title">{d.title}</span>
                      </div>
                      <div className="pipe-card-company" onClick={() => setSelectedId(d.id)}>{c?.name || "—"}</div>
                      <div className="pipe-card-meta">
                        {d.value ? <span className="mono">₹{Number(d.value).toLocaleString()}</span> : <span className="cell-sub">no value</span>}
                        <span className="cell-sub">{d.ownerName}</span>
                      </div>
                      {stale && <div className="pipe-stale-flag"><Clock size={10} /> {daysSince(d.updatedAt)}d idle</div>}
                      {canManage && !OUTCOME_STAGES.includes(d.stage) && (
                        <div className="pipe-card-actions">
                          {nextStage && <button className="btn btn-secondary btn-sm" onClick={() => beginMove(d, nextStage)}>{nextStage.split(" ")[0]} <ArrowRight size={11} /></button>}
                          <button className="btn btn-ghost btn-sm" onClick={() => beginMove(d, "Won")} title="Mark won"><Trophy size={12} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => beginMove(d, "Lost")} title="Mark lost"><Ban size={12} /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewDealModal companies={companies} salesTeam={salesTeam.length ? salesTeam : [{ id: "self", name: userName }]} userName={userName} onClose={() => setShowNew(false)} onCreate={handleCreate} />}
      {chat && (
        <StageTransitionChat
          deal={chat.deal}
          company={companyById[chat.deal.companyId]}
          fromStage={chat.deal.stage}
          toStage={chat.toStage}
          stageForms={stageForms}
          accountMemory={accountMemoryFor(chat.deal.companyId)}
          userName={userName}
          onComplete={onChatComplete}
          onClose={() => setChat(null)}
        />
      )}
      {capture && (
        <CaptureModal
          stage={capture.toStage}
          onClose={() => { finalizeMove(capture.deal, capture.toStage, capture.log, {}); setCapture(null); }}
          onSubmit={(val) => { finalizeMove(capture.deal, capture.toStage, capture.log, { [STAGE_CAPTURES[capture.toStage].field]: val }); setCapture(null); }}
        />
      )}
    </div>
  );
}
