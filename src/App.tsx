import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  PlusCircle, Building2, Cpu, Search, ChevronRight,
  Sparkles, CheckCircle2, XCircle, Clock, ArrowRight, AlertTriangle,
  Loader2, Users, FileText, ShieldCheck, History, X, ChevronLeft,
  Trophy, Ban, RefreshCw, Lock, Mail, LogOut, Bell, LayoutGrid, Zap,
  TrendingUp, Landmark, Megaphone, Package
} from "lucide-react";
import { APP_STYLES } from "./styles/appStyles";
import {
  STAGES, APPROVAL_GATES, DEPARTMENTS, EXECUTION_DEPARTMENTS,
  BUDGET_VISIBLE_DEPARTMENTS, TIERS, TYPES, SEED_USERS, daysAgo,
} from "./constants";
import {
  SAMPLE_CLIENTS, SAMPLE_LEADS, SAMPLE_PROJECTS, SAMPLE_TASKS, SAMPLE_WORK_UPDATES,
} from "./data/sampleData";
import {
  roleTone, tierLabel, roleLabel, belongsToDept, departmentIcon, pad,
  nextClientId, nextRfqId, nextProjectId, findMatchingClient, uid, timeAgo,
} from "./lib/helpers";
import { callClaude } from "./lib/ai";
import { loadList, saveList } from "./lib/storage";
import { supabase } from "./lib/supabase";
import { signIn } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
/* ---------------------------------------------------------------------- */
/* Small UI primitives                                                     */
/* ---------------------------------------------------------------------- */

function Chip({ children, tone = "default" }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

function StageBadge({ stage }) {
  const tone =
    stage === "Won" ? "green" : stage === "Lost" ? "red" : "amber";
  return <Chip tone={tone}>{stage}</Chip>;
}

function TypeBadge({ type }) {
  return (
    <span className="type-badge">
      {type === "Box Build" ? <Building2 size={12} /> : <Cpu size={12} />}
      {type}
    </span>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="empty-state">
      <Icon size={28} strokeWidth={1.5} />
      <div className="empty-title">{title}</div>
      <div className="empty-body">{body}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Stage stepper — the signature element                                   */
/* ---------------------------------------------------------------------- */

function StageStepper({ stage }) {
  const activeIndex = STAGES.indexOf(stage === "Lost" ? "Approval" : stage);
  const isLost = stage === "Lost";
  const visibleStages = STAGES.filter((s) => s !== "Lost");

  return (
    <div className="stepper">
      {visibleStages.map((s, i) => {
        const idx = STAGES.indexOf(s);
        const done = !isLost && idx < activeIndex;
        const current = !isLost && idx === activeIndex;
        const gate = APPROVAL_GATES.includes(s);
        return (
          <React.Fragment key={s}>
            <div
              className={`step-node ${done ? "done" : ""} ${
                current ? "current" : ""
              } ${isLost && s === "Approval" ? "lost" : ""}`}
              title={gate ? `${s} (approval required to advance)` : s}
            >
              <span className="step-dot">
                {done ? (
                  <CheckCircle2 size={13} />
                ) : isLost && s === "Approval" ? (
                  <Ban size={13} />
                ) : (
                  i + 1
                )}
              </span>
              <span className="step-label">
                {s}
                {gate && <span className="step-gate-mark">⚡</span>}
              </span>
            </div>
            {i < visibleStages.length - 1 && (
              <div className={`step-trace ${done ? "done" : ""}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                                */
/* ---------------------------------------------------------------------- */

function Dashboard({ clients, projects, users, department, tier, userName, onOpen, onNew }) {
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [quickFilter, setQuickFilter] = useState(null); // null | "awaiting" | "mine"

  const isMainAdmin = tier === "Main Admin";
  const isExecDept = EXECUTION_DEPARTMENTS.includes(department);
  const canCreateRFQ = isMainAdmin || department === "Sales";
  const budgetVisible = isMainAdmin || BUDGET_VISIBLE_DEPARTMENTS.includes(department);

  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));

  // Scoped to what this department/tier is allowed to see at all (before search/quick filters).
  const scoped = projects.filter((p) => {
    if (isMainAdmin) return true;
    if (department === "Sales") {
      if (tier === "User") return p.createdBy === userName || p.assignedTo === userName;
      return true; // Managers see the whole Sales pipeline.
    }
    if (isExecDept) {
      if (p.department !== department) return false; // department is set automatically from RFQ type at submission
      if (tier === "User") return (p.assignees || []).some((a) => a.name === userName);
      return true; // Managers (department heads) see the whole department queue.
    }
    return true; // Finance / HR / Product / Marketing see everything, read-only.
  });

  const visible = scoped.filter((p) => {
    if (quickFilter === "awaiting" && !APPROVAL_GATES.includes(p.stage)) return false;
    if (quickFilter === "mine" && p.createdBy !== userName && p.assignedTo !== userName) return false;
    if (stageFilter !== "All" && p.stage !== stageFilter) return false;
    if (typeFilter !== "All" && p.type !== typeFilter) return false;
    if (q) {
      const client = clientById[p.clientId];
      const hay = `${p.id} ${client?.name || ""} ${client?.company || ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const totalBudget = scoped.reduce((sum, p) => sum + (parseFloat(p.budget) || 0), 0);
  const activeClients = new Set(scoped.map((p) => p.clientId)).size;

  const stageCounts = STAGES.map((s) => ({ stage: s, count: scoped.filter((p) => p.stage === s).length })).filter(
    (s) => s.count > 0
  );
  const clientCounts = Object.values(
    scoped.reduce((acc, p) => {
      const c = clientById[p.clientId];
      const key = c?.id || p.clientId;
      if (!acc[key]) acc[key] = { name: c?.name || "Unknown", company: c?.company || "", count: 0 };
      acc[key].count += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.count - a.count);

  // Sales-only "Admin Overview"-style summary.
  const isSalesView = department === "Sales";
  const salesTeam = (users || []).filter((u) => belongsToDept(u, "Sales"));
  const pipelineValue = scoped
    .filter((p) => !["Won", "Lost"].includes(p.stage))
    .reduce((sum, p) => sum + (parseFloat(p.budget) || 0), 0);
  const wonValue = scoped.filter((p) => p.stage === "Won").reduce((sum, p) => sum + (parseFloat(p.budget) || 0), 0);
  const avgDealSize = scoped.length ? Math.round(totalBudget / scoped.length) : 0;
  const STAGE_COLORS = { Inquiry: "blue", "RFQ Submitted": "purple", "Technical Review": "amber", Quotation: "orange", Approval: "cyan", Won: "green", Lost: "red" };
  const stageBars = STAGES.filter((s) => s !== "Lost").map((s) => {
    const count = scoped.filter((p) => p.stage === s).length;
    const pct = scoped.length ? Math.round((count / scoped.length) * 100) : 0;
    return { stage: s, count, pct, color: STAGE_COLORS[s] || "blue" };
  });

  function clearFilters() {
    setQuickFilter(null);
    setStageFilter("All");
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Dashboard</h1>
          <p className="view-sub">
            {isMainAdmin
              ? "Showing all projects — Main Admin view"
              : department === "Sales" && tier === "User"
              ? `Showing projects assigned to ${userName}`
              : isExecDept
              ? `Showing ${department} projects assigned by PM`
              : `Showing all projects — ${department} view`}
          </p>
        </div>
        {canCreateRFQ && (
          <button className="btn btn-primary" onClick={onNew}>
            <PlusCircle size={16} /> New RFQ
          </button>
        )}
      </div>

      <div className="quick-actions">
        <button className={`quick-action ${quickFilter === "awaiting" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "awaiting" ? null : "awaiting")}>
          <Clock size={14} /> Action – Need to do
        </button>
        {department === "Sales" && (
          <button className={`quick-action ${quickFilter === "mine" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "mine" ? null : "mine")}>
            <FileText size={14} /> My Requests
          </button>
        )}
        {(department === "Sales" && tier === "Manager") || isMainAdmin ? (
          <button className={`quick-action ${quickFilter === "awaiting" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "awaiting" ? null : "awaiting")}>
            <ShieldCheck size={14} /> My Approvals
          </button>
        ) : null}
        <button className="quick-action" onClick={clearFilters}>
          <LayoutGrid size={14} /> All Projects
        </button>
      </div>

      {isSalesView ? (
        <>
          <h2 style={{ marginTop: 4 }}>Sales Overview</h2>
          <p className="view-sub" style={{ marginTop: -14 }}>
            {tier === "User" ? "Your assigned pipeline" : "Full pipeline view across your team"}
          </p>
          <div className="stat-grid">
            <div className="stat-card-v2" onClick={clearFilters}>
              <div className="stat-card-v2-top">
                <span className="stat-v2-label">Team Members</span>
                <span className="stat-icon-badge stat-icon-purple"><Users size={15} /></span>
              </div>
              <div className="stat-value">{salesTeam.length}</div>
            </div>
            <div className="stat-card-v2" onClick={clearFilters}>
              <div className="stat-card-v2-top">
                <span className="stat-v2-label">Total Leads</span>
                <span className="stat-icon-badge stat-icon-blue"><FileText size={15} /></span>
              </div>
              <div className="stat-value">{scoped.length}</div>
            </div>
            <div className="stat-card-v2" onClick={clearFilters}>
              <div className="stat-card-v2-top">
                <span className="stat-v2-label">Pipeline Value</span>
                <span className="stat-icon-badge stat-icon-green"><Cpu size={15} /></span>
              </div>
              <div className="stat-value">₹{pipelineValue.toLocaleString()}</div>
            </div>
            <div className="stat-card-v2" onClick={() => setStageFilter("Won")}>
              <div className="stat-card-v2-top">
                <span className="stat-v2-label">Won Value</span>
                <span className="stat-icon-badge stat-icon-green"><Trophy size={15} /></span>
              </div>
              <div className="stat-value">₹{wonValue.toLocaleString()}</div>
            </div>
            <div className="stat-card-v2" onClick={clearFilters}>
              <div className="stat-card-v2-top">
                <span className="stat-v2-label">Avg Deal Size</span>
                <span className="stat-icon-badge stat-icon-amber"><ShieldCheck size={15} /></span>
              </div>
              <div className="stat-value">₹{avgDealSize.toLocaleString()}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="stat-row">
          <div className="stat-card" onClick={clearFilters}>
            <div className="stat-card-top">
              <span className="stat-icon-badge"><FileText size={15} /></span>
            </div>
            <div className="stat-label">Total RFQs</div>
            <div className="stat-value">{scoped.length}</div>
            <span className="stat-link">Click to view <ChevronRight size={12} /></span>
          </div>
          <div className="stat-card stat-green" onClick={() => setStageFilter("Won")}>
            <div className="stat-card-top">
              <span className="stat-icon-badge"><Trophy size={15} /></span>
            </div>
            <div className="stat-label">Won</div>
            <div className="stat-value">{scoped.filter((p) => p.stage === "Won").length}</div>
            <span className="stat-link">Click to view <ChevronRight size={12} /></span>
          </div>
          <div className="stat-card stat-amber" onClick={() => setQuickFilter("awaiting")}>
            <div className="stat-card-top">
              <span className="stat-icon-badge"><Clock size={15} /></span>
            </div>
            <div className="stat-label">Awaiting Approval</div>
            <div className="stat-value">{scoped.filter((p) => APPROVAL_GATES.includes(p.stage)).length}</div>
            <span className="stat-link">Click to view <ChevronRight size={12} /></span>
          </div>
          <div className="stat-card" onClick={clearFilters}>
            <div className="stat-card-top">
              <span className="stat-icon-badge">{budgetVisible ? <ShieldCheck size={15} /> : <Building2 size={15} />}</span>
            </div>
            <div className="stat-label">{budgetVisible ? "Total Budget" : "Active Clients"}</div>
            <div className="stat-value">{budgetVisible ? `₹${totalBudget.toLocaleString()}` : activeClients}</div>
            <span className="stat-link">Click to view <ChevronRight size={12} /></span>
          </div>
        </div>
      )}

      {isSalesView && (
        <div className="detail-grid">
          <div className="panel">
            <div className="panel-title-row">
              <h3 className="panel-title">Sales Team</h3>
              <Chip>{salesTeam.length} users</Chip>
            </div>
            {salesTeam.length === 0 ? (
              <p className="field-hint">No Sales users yet — add some from the Users page.</p>
            ) : (
              <ul className="team-list">
                {salesTeam.map((m) => {
                  const count = scoped.filter((p) => p.createdBy === m.name).length;
                  const initials = m.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <li key={m.id}>
                      <span className="team-avatar">{initials}</span>
                      <div className="team-info">
                        <div className="cell-primary">{m.name}</div>
                        <div className="cell-sub">{m.tier}</div>
                      </div>
                      <Chip>{count} leads</Chip>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="panel">
            <h3 className="panel-title">Leads by Stage</h3>
            <div className="stage-bars">
              {stageBars.map((s) => (
                <div className="stage-bar-row" key={s.stage}>
                  <div className="stage-bar-label">
                    <span>{s.stage}</span>
                    <span className="cell-sub">
                      {s.count} ({s.pct}%)
                    </span>
                  </div>
                  <div className="stage-bar-track">
                    <div className={`stage-bar-fill stage-bar-${s.color}`} style={{ width: `${s.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}


      <div className="toolbar">
        <div className="search-box">
          <Search size={14} />
          <input
            placeholder="Search client, company, or project ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option>All</option>
          {STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option>All</option>
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No projects match yet"
          body={
            projects.length === 0
              ? "Create the first RFQ to get this pipeline moving."
              : "Try clearing filters, or create a new RFQ."
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>RFQ / Project ID</th>
                <th>Client</th>
                <th>Type</th>
                <th>Stage</th>
                {budgetVisible && <th>Budget</th>}
                <th>Owner</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible
                .slice()
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                .map((p) => {
                  const client = clientById[p.clientId];
                  return (
                    <tr key={p.id} onClick={() => onOpen(p.id)}>
                      <td className="mono">
                        {p.id}
                        {p.projectId && <div className="cell-sub mono">{p.projectId}</div>}
                      </td>
                      <td>
                        <div className="cell-primary">{client?.name || "—"}</div>
                        <div className="cell-sub">{client?.company || ""}</div>
                      </td>
                      <td>
                        <TypeBadge type={p.type} />
                      </td>
                      <td>
                        <StageBadge stage={p.stage} />
                      </td>
                      {budgetVisible && (
                        <td className="mono">{p.budget ? `₹${p.budget}` : "—"}</td>
                      )}
                      <td>{p.createdBy}</td>
                      <td className="cell-sub">{timeAgo(p.updatedAt)}</td>
                      <td>
                        <ChevronRight size={16} className="row-arrow" />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {!isSalesView && (
        <div className="detail-grid">
          <div className="panel">
            <h3 className="panel-title">Projects by Stage</h3>
            <p className="field-hint" style={{ marginBottom: 10 }}>
              Breakdown of {isMainAdmin ? "every" : "your visible"} project by pipeline stage.
            </p>
            {stageCounts.length === 0 ? (
              <p className="field-hint">No projects yet.</p>
            ) : (
              stageCounts.map((s) => (
                <div className="kv" key={s.stage}>
                  <span>{s.stage}</span>
                  <span className="mono">{s.count}</span>
                </div>
              ))
            )}
          </div>

          <div className="panel">
            <h3 className="panel-title">Projects by Client</h3>
            <p className="field-hint" style={{ marginBottom: 10 }}>
              Which clients account for the most active work.
            </p>
            {clientCounts.length === 0 ? (
              <p className="field-hint">None yet.</p>
            ) : (
              clientCounts.slice(0, 6).map((c) => (
                <div className="kv" key={c.name + c.company}>
                  <span>
                    {c.name}
                    {c.company ? <span className="cell-sub"> · {c.company}</span> : null}
                  </span>
                  <span className="mono">{c.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* New RFQ flow                                                            */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/* Leads (Sales intake → Manager approval → Client)                        */
/* ---------------------------------------------------------------------- */

const EMPTY_LEAD_FORM = { name: "", company: "", email: "", phone: "", notes: "" };

function Leads({ leads, clients, userName, tier, onSubmitLead, onApproveLead, onRejectLead }) {
  const [form, setForm] = useState(EMPTY_LEAD_FORM);
  const [rejecting, setRejecting] = useState(null); // lead id currently showing a reject reason field
  const [rejectReason, setRejectReason] = useState("");

  const canApprove = tier === "Manager" || tier === "Main Admin";
  const pending = leads.filter((l) => l.status === "Pending");
  const mine = leads.filter((l) => l.submittedBy === userName);

  function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    onSubmitLead({ ...form }, canApprove); // Managers/Admin auto-approve their own submissions
    setForm(EMPTY_LEAD_FORM);
  }

  function reject(lead) {
    onRejectLead(lead, rejectReason);
    setRejecting(null);
    setRejectReason("");
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Leads</h1>
          <p className="view-sub">
            {canApprove ? "Review incoming leads, or add one directly (auto-approved)." : "Submit a lead for your manager to review."}
          </p>
        </div>
      </div>

      <form className="panel form-panel" onSubmit={submit}>
        <h3 className="panel-title">{canApprove ? "Add a lead (auto-approved)" : "Submit a new lead"}</h3>
        <p className="field-hint" style={{ marginBottom: 10 }}>
          Required fields are a placeholder set — swap these out once the final field list is provided.
        </p>
        <div className="grid-2">
          <Field label="Contact name">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jordan Rivera" />
          </Field>
          <Field label="Company">
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Northwind Devices Inc." />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Email">
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jordan@northwind.com" />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 0100" />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="How this lead came in, what they need…" />
        </Field>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" style={{ marginLeft: "auto" }}>
            {canApprove ? "Add lead" : "Submit for approval"}
          </button>
        </div>
      </form>

      {canApprove && (
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">Pending approval</h3>
            <Chip tone="amber">{pending.length}</Chip>
          </div>
          {pending.length === 0 ? (
            <p className="field-hint">Nothing waiting on you right now.</p>
          ) : (
            <ul className="stake-list">
              {pending.map((l) => {
                const match = findMatchingClient(clients, l.email);
                return (
                  <li key={l.id}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div className="cell-primary">{l.name} {l.company ? `· ${l.company}` : ""}</div>
                        <div className="cell-sub">{l.email} {l.phone ? `· ${l.phone}` : ""}</div>
                        {l.notes && <div className="cell-sub" style={{ marginTop: 4 }}>{l.notes}</div>}
                        <div className="cell-sub" style={{ marginTop: 4 }}>
                          Submitted by {l.submittedBy} · {timeAgo(l.createdAt)}
                          {match ? ` · Matches existing client ${match.id}` : " · Will create a new client"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => onApproveLead(l)}>
                          <CheckCircle2 size={13} /> Approve
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => setRejecting(rejecting === l.id ? null : l.id)}>
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    </div>
                    {rejecting === l.id && (
                      <div className="inline-form" style={{ marginTop: 8 }}>
                        <input placeholder="Reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                        <button className="btn btn-danger btn-sm" onClick={() => reject(l)}>Confirm reject</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">{canApprove ? "All leads" : "Your submitted leads"}</h3>
        {(canApprove ? leads : mine).length === 0 ? (
          <p className="field-hint">Nothing here yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Submitted by</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {(canApprove ? leads : mine)
                  .slice()
                  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                  .map((l) => (
                    <tr key={l.id} style={{ cursor: "default" }}>
                      <td className="cell-primary">{l.name}</td>
                      <td className="cell-sub">{l.company || "—"}</td>
                      <td>
                        <Chip tone={l.status === "Approved" ? "green" : l.status === "Rejected" ? "red" : "amber"}>{l.status}</Chip>
                      </td>
                      <td className="cell-sub">{l.submittedBy}</td>
                      <td className="cell-sub">{timeAgo(l.reviewedAt || l.createdAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* New RFQ flow                                                            */
/* ---------------------------------------------------------------------- */

function NewRFQ({ clients, projects, userName, onCreateProject, onDone, onCancel }) {
  const [step, setStep] = useState(1);
  const [existingClientId, setExistingClientId] = useState("");
  const [createdClient, setCreatedClient] = useState(null);

  const [rfq, setRfq] = useState({
    type: "Box Build",
    technicalScope: "",
    budget: "",
    timeline: "",
  });
  const [createdProject, setCreatedProject] = useState(null);

  function selectClient(e) {
    e.preventDefault();
    const c = clients.find((c) => c.id === existingClientId);
    if (!c) return;
    setCreatedClient(c);
    setStep(2);
  }

  function submitRfq(e) {
    e.preventDefault();
    const now = new Date().toISOString();
    const newProject = {
      id: nextRfqId(projects), // stable RFQ reference — the formal Project ID comes later
      projectId: null,
      clientId: createdClient.id,
      type: rfq.type,
      stage: "Dept Review",
      technicalScope: rfq.technicalScope,
      budget: rfq.budget,
      timeline: rfq.timeline,
      notes: [],
      architectureSummary: "",
      stakeholders: [],
      approvals: [],
      history: [{ id: uid(), from: null, to: "Dept Review", by: userName, at: now }],
      createdBy: userName,
      assignedTo: userName, // Sales lead owner — reassignable by a Sales Manager
      department: rfq.type, // routes straight to the matching department head for review
      assignees: [], // execution team assigned by the receiving department's Manager, after approval
      callLogs: [],
      createdAt: now,
      updatedAt: now,
    };
    onCreateProject(newProject);
    setCreatedProject(newProject);
    setStep(3);
  }

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>New RFQ</h1>
          <p className="view-sub">Step {step} of 3</p>
        </div>
        <button className="btn btn-ghost" onClick={onCancel}>
          <X size={16} /> Cancel
        </button>
      </div>

      <div className="wizard-progress">
        {["Client", "RFQ details", "Done"].map((label, i) => (
          <div key={label} className={`wizard-step ${step === i + 1 ? "active" : ""} ${step > i + 1 ? "past" : ""}`}>
            <span className="wizard-dot">{step > i + 1 ? <CheckCircle2 size={12} /> : i + 1}</span>
            {label}
          </div>
        ))}
      </div>

      {step === 1 && (
        <form className="panel form-panel" onSubmit={selectClient}>
          {clients.length === 0 ? (
            <p className="field-hint">
              No approved clients yet. Submit and approve a lead on the Leads tab first — a Client ID is generated
              there once a lead is approved.
            </p>
          ) : (
            <Field label="Select client">
              <select required value={existingClientId} onChange={(e) => setExistingClientId(e.target.value)}>
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.name} ({c.company || "no company"})
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={clients.length === 0} style={{ marginLeft: "auto" }}>
              Continue <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}

      {step === 2 && createdClient && (
        <>
          <div className="id-callout">
            <ShieldCheck size={16} />
            Client ID <span className="mono">{createdClient.id}</span> — {createdClient.name}
          </div>
          <form className="panel form-panel" onSubmit={submitRfq}>
            <Field label="Project type" hint="This determines which department head reviews the RFQ.">
              <div className="segmented">
                {TYPES.map((t) => (
                  <button
                    type="button"
                    key={t}
                    className={rfq.type === t ? "active" : ""}
                    onClick={() => setRfq({ ...rfq, type: t })}
                  >
                    {t === "Box Build" ? <Building2 size={14} /> : <Cpu size={14} />}
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Technical scope" hint="What needs to be built — this feeds the AI architecture summary later.">
              <textarea
                rows={4}
                value={rfq.technicalScope}
                onChange={(e) => setRfq({ ...rfq, technicalScope: e.target.value })}
                placeholder="e.g. Custom enclosure with 4-layer PCB, requires thermal management, target volume 5,000 units/quarter…"
              />
            </Field>
            <div className="grid-2">
              <Field label="Budget (INR)">
                <input value={rfq.budget} onChange={(e) => setRfq({ ...rfq, budget: e.target.value })} placeholder="50000" />
              </Field>
              <Field label="Timeline">
                <input value={rfq.timeline} onChange={(e) => setRfq({ ...rfq, timeline: e.target.value })} placeholder="8 weeks" />
              </Field>
            </div>
            <p className="field-hint">
              These questions are a placeholder set — swap in the real project questionnaire once it's provided.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                <ChevronLeft size={15} /> Back
              </button>
              <button className="btn btn-primary" type="submit">
                Submit to {rfq.type} <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </>
      )}

      {step === 3 && createdProject && (
        <div className="panel done-panel">
          <CheckCircle2 size={32} className="done-icon" />
          <h2>RFQ submitted</h2>
          <p className="field-hint">Sent to the {createdProject.type} head for review. The formal Project ID is assigned once they approve.</p>
          <div className="id-row">
            <div>
              <div className="field-label">Client ID</div>
              <div className="mono big">{createdClient.id}</div>
            </div>
            <div>
              <div className="field-label">RFQ ID</div>
              <div className="mono big">{createdProject.id}</div>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => onDone(null)}>
              Back to dashboard
            </button>
            <button className="btn btn-primary" onClick={() => onDone(createdProject.id)}>
              Open project <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Guided AI note modal                                                    */
/* ---------------------------------------------------------------------- */

function NoteModal({ onClose, onSave, userName }) {
  const [answers, setAnswers] = useState({
    need: "",
    budget: "",
    timeline: "",
    scope: "",
    risks: "",
  });
  const [compiled, setCompiled] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const questions = [
    { key: "need", label: "What does the client actually need?" },
    { key: "budget", label: "What's their budget signal or constraint?" },
    { key: "timeline", label: "What timeline are they working to?" },
    { key: "scope", label: "Any technical scope details discussed?" },
    { key: "risks", label: "Any risks, blockers, or open questions?" },
  ];

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const prompt = `You are compiling a sales call note for an internal CRM. Turn these raw answers into a tight, well-structured note (use short headers and bullet points, no preamble, no markdown code fences). Omit any field that was left blank instead of noting it's missing.\n\nClient need: ${answers.need || "(not provided)"}\nBudget signal: ${answers.budget || "(not provided)"}\nTimeline: ${answers.timeline || "(not provided)"}\nTechnical scope: ${answers.scope || "(not provided)"}\nRisks / open questions: ${answers.risks || "(not provided)"}`;
      const text = await callClaude(prompt, 500);
      setCompiled(text);
    } catch (e) {
      setError("Couldn't reach the AI service. You can still save your raw answers below.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    onSave({
      id: uid(),
      questions: answers,
      compiled: compiled || Object.entries(answers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n"),
      author: userName,
      createdAt: new Date().toISOString(),
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <Sparkles size={16} /> Guided note
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {questions.map((q) => (
            <Field key={q.key} label={q.label}>
              <textarea
                rows={2}
                value={answers[q.key]}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
              />
            </Field>
          ))}

          <button className="btn btn-secondary" onClick={generate} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {busy ? "Compiling…" : "Compile with AI"}
          </button>
          {error && (
            <div className="inline-warning">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          {compiled && (
            <div className="ai-result">
              <div className="ai-result-label">Compiled note</div>
              <textarea rows={6} value={compiled} onChange={(e) => setCompiled(e.target.value)} />
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Approval modal                                                          */
/* ---------------------------------------------------------------------- */

function ApprovalModal({ stage, onClose, onSubmit, userName }) {
  const [approver, setApprover] = useState(userName);
  const [comment, setComment] = useState("");
  // Stage-specific fields.
  const [feasibility, setFeasibility] = useState("Feasible");
  const [techNotes, setTechNotes] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [validity, setValidity] = useState("");
  const [error, setError] = useState("");

  const isTech = stage === "Technical Review";
  const isQuote = stage === "Quotation";

  function decide(decision) {
    if (decision === "Approved" && isQuote && !String(quoteAmount).trim()) {
      setError("Enter the quoted amount before approving the quotation.");
      return;
    }
    const record = {
      id: uid(),
      stage,
      approver,
      decision,
      comment,
      createdAt: new Date().toISOString(),
    };
    if (isTech) {
      record.feasibility = feasibility;
      record.techNotes = techNotes;
      record.leadTime = leadTime;
    }
    if (isQuote) {
      record.quoteAmount = quoteAmount;
      record.validity = validity;
    }
    onSubmit(record);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <ShieldCheck size={16} /> Approval — {stage}
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <Field label="Approver">
            <input value={approver} onChange={(e) => setApprover(e.target.value)} />
          </Field>

          {isTech && (
            <>
              <Field label="Feasibility">
                <select value={feasibility} onChange={(e) => setFeasibility(e.target.value)}>
                  <option>Feasible</option>
                  <option>Needs clarification</option>
                  <option>Not viable</option>
                </select>
              </Field>
              <Field label="Technical notes / risks">
                <textarea rows={3} value={techNotes} onChange={(e) => setTechNotes(e.target.value)} placeholder="Design constraints, risks, assumptions, specs still needed…" />
              </Field>
              <Field label="Estimated lead time">
                <input value={leadTime} onChange={(e) => setLeadTime(e.target.value)} placeholder="e.g. 6–8 weeks" />
              </Field>
            </>
          )}

          {isQuote && (
            <>
              <Field label="Quoted amount">
                <input type="number" value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} placeholder="e.g. 250000" />
              </Field>
              <Field label="Validity / terms">
                <input value={validity} onChange={(e) => setValidity(e.target.value)} placeholder="e.g. valid 30 days, 50% advance" />
              </Field>
            </>
          )}

          <Field label="Comment">
            <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Reasoning, conditions, or notes for the record…" />
          </Field>

          {error && (
            <div className="inline-warning">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-danger" onClick={() => decide("Rejected")}>
            <XCircle size={15} /> Reject
          </button>
          <button className="btn btn-primary" onClick={() => decide("Approved")}>
            <CheckCircle2 size={15} /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Project detail                                                          */
/* ---------------------------------------------------------------------- */

function ProjectDetail({ project, client, users, projects, department, tier, userName, onUpdate, onBack }) {
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [archBusy, setArchBusy] = useState(false);
  const [archError, setArchError] = useState("");
  const [stakeForm, setStakeForm] = useState({ name: "", role: "", department: "" });
  const [assigneeForm, setAssigneeForm] = useState({ name: "", roleInProject: "" });

  const isMainAdmin = tier === "Main Admin";
  const isExecDept = EXECUTION_DEPARTMENTS.includes(department);
  const isAssignedToMe = (project.assignees || []).some((a) => a.name === userName);
  const canEdit =
    isMainAdmin ||
    department === "Sales" ||
    (isExecDept && project.department === department && (tier === "Manager" || isAssignedToMe));
  const canManageAssignees = isMainAdmin || (isExecDept && tier === "Manager" && project.department === department);
  const canReassignLead = isMainAdmin || (department === "Sales" && tier === "Manager");
  const canLogCalls = isMainAdmin || department === "Sales";
  const budgetVisible = isMainAdmin || BUDGET_VISIBLE_DEPARTMENTS.includes(department);
  const nextGate = APPROVAL_GATES.includes(project.stage);
  // Dept Review can only be approved by the receiving department's Manager (or Main Admin) — everyone else's
  // gate approvals (Technical Review, Quotation) stay with whoever can edit the project (Sales side).
  const canApproveGate =
    project.stage === "Dept Review"
      ? isMainAdmin || (tier === "Manager" && department === project.department)
      : canEdit;
  const salesTeam = (users || []).filter((u) => belongsToDept(u, "Sales"));
  const deptTeam = project.department ? (users || []).filter((u) => belongsToDept(u, project.department)) : [];


  function patch(updates) {
    onUpdate({ ...project, ...updates, updatedAt: new Date().toISOString() });
  }

  function advanceStage() {
    const idx = STAGES.indexOf(project.stage);
    const nextStage = STAGES[idx + 1];
    if (!nextStage || nextStage === "Won" || nextStage === "Lost") return;
    patch({
      stage: nextStage,
      history: [...project.history, { id: uid(), from: project.stage, to: nextStage, by: userName, at: new Date().toISOString() }],
    });
  }

  function decideOutcome(outcome) {
    patch({
      stage: outcome,
      history: [...project.history, { id: uid(), from: project.stage, to: outcome, by: userName, at: new Date().toISOString() }],
    });
  }

  function submitApproval(record) {
    const idx = STAGES.indexOf(project.stage);
    const nextStage = record.decision === "Approved" ? STAGES[idx + 1] : "Lost";
    const patchData = {
      approvals: [...project.approvals, record],
      stage: nextStage,
      history: [
        ...project.history,
        { id: uid(), from: project.stage, to: nextStage, by: record.approver, at: record.createdAt, note: `${record.decision} at ${project.stage}` },
      ],
    };
    if (project.stage === "Dept Review" && record.decision === "Approved" && !project.projectId) {
      const newProjectId = nextProjectId(projects || [], project.type);
      patchData.projectId = newProjectId;
      patchData.history.push({
        id: uid(),
        label: `Project ID ${newProjectId} assigned`,
        by: record.approver,
        at: new Date().toISOString(),
      });
    }
    // Approving the quotation records the quoted amount on the project itself.
    if (project.stage === "Quotation" && record.decision === "Approved" && record.quoteAmount) {
      patchData.quotedAmount = record.quoteAmount;
    }
    patch(patchData);
    setShowApprovalModal(false);
  }

  function saveNote(note) {
    patch({ notes: [...project.notes, note] });
    setShowNoteModal(false);
  }

  function reassignLead(newOwner) {
    if (!newOwner || newOwner === project.assignedTo) return;
    patch({
      assignedTo: newOwner,
      history: [
        ...project.history,
        { id: uid(), label: `Lead owner reassigned to ${newOwner}`, by: userName, at: new Date().toISOString() },
      ],
    });
  }

  function addAssignee(e) {
    e.preventDefault();
    if (!assigneeForm.name.trim()) return;
    if ((project.assignees || []).some((a) => a.name === assigneeForm.name)) return;
    patch({
      assignees: [...(project.assignees || []), { id: uid(), name: assigneeForm.name, roleInProject: assigneeForm.roleInProject }],
      history: [
        ...project.history,
        { id: uid(), label: `${assigneeForm.name} assigned to project${assigneeForm.roleInProject ? ` as ${assigneeForm.roleInProject}` : ""}`, by: userName, at: new Date().toISOString() },
      ],
    });
    setAssigneeForm({ name: "", roleInProject: "" });
  }

  function removeAssignee(id) {
    const removed = (project.assignees || []).find((a) => a.id === id);
    patch({
      assignees: (project.assignees || []).filter((a) => a.id !== id),
      history: removed
        ? [...project.history, { id: uid(), label: `${removed.name} removed from project`, by: userName, at: new Date().toISOString() }]
        : project.history,
    });
  }

  function logCall() {
    patch({ callLogs: [...(project.callLogs || []), { id: uid(), by: userName, at: new Date().toISOString() }] });
  }

  async function generateArchitecture() {
    setArchBusy(true);
    setArchError("");
    try {
      const prompt = `Write a concise draft system architecture summary for an internal engineering/sales handoff document. Project type: ${project.type}. Technical scope as described by sales: ${project.technicalScope || "(not specified)"}. Timeline: ${project.timeline || "(not specified)"}. Structure it with short headers (Overview, Key components, Considerations). Keep it under 200 words. No markdown code fences, no preamble.`;
      const text = await callClaude(prompt, 500);
      patch({ architectureSummary: text });
    } catch (e) {
      setArchError("Couldn't reach the AI service — try again in a moment.");
    } finally {
      setArchBusy(false);
    }
  }

  function addStakeholder(e) {
    e.preventDefault();
    if (!stakeForm.name.trim()) return;
    patch({ stakeholders: [...project.stakeholders, { id: uid(), ...stakeForm }] });
    setStakeForm({ name: "", role: "", department: "" });
  }

  return (
    <div className="view">
      <button className="back-link" onClick={onBack}>
        <ChevronLeft size={14} /> Dashboard
      </button>

      <div className="detail-header">
        <div>
          <div className="detail-ids">
            <span className="mono id-chip">{project.id}</span>
            {project.projectId && <span className="mono id-chip">{project.projectId}</span>}
            <span className="mono id-chip subtle">{client?.id}</span>
            <TypeBadge type={project.type} />
          </div>
          <h1>{client?.name || "Unknown client"}</h1>
          <p className="view-sub">{client?.company}</p>
        </div>
        <StageBadge stage={project.stage} />
      </div>

      <div className="panel stepper-panel">
        <StageStepper stage={project.stage} />
        {canApproveGate && !["Won", "Lost"].includes(project.stage) && (
          <div className="stage-controls">
            {project.stage === "Approval" ? (
              <>
                <button className="btn btn-primary" onClick={() => decideOutcome("Won")}>
                  <Trophy size={15} /> Mark Won
                </button>
                <button className="btn btn-danger" onClick={() => decideOutcome("Lost")}>
                  <Ban size={15} /> Mark Lost
                </button>
              </>
            ) : nextGate ? (
              <button className="btn btn-secondary" onClick={() => setShowApprovalModal(true)}>
                <ShieldCheck size={15} /> {project.stage === "Dept Review" ? `Review as ${department} head` : "Request approval to advance"}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={advanceStage}>
                Advance to {STAGES[STAGES.indexOf(project.stage) + 1]} <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}
        {project.stage === "Dept Review" && !canApproveGate && (
          <div className="finance-note">
            Waiting on the {project.department} head to review this RFQ before a Project ID is assigned.
          </div>
        )}
        {!canEdit && project.stage !== "Dept Review" && (
          <div className="finance-note">
            {roleLabel(department, tier)} view — read only.
            {isExecDept && project.department !== department
              ? ` This project isn't assigned to ${department}.`
              : isExecDept && !isAssignedToMe
              ? " You're not personally assigned to this project yet."
              : budgetVisible
              ? " Budget and stage history are visible below."
              : " Stage history is visible below."}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">
          <Building2 size={14} /> Routing
        </h3>
        <div className="kv">
          <span>Department</span>
          <span>{project.department || "—"}</span>
        </div>
        <div className="kv">
          <span>Project ID</span>
          <span className="mono">{project.projectId || "Assigned once the department head approves"}</span>
        </div>
      </div>

      {project.department && (
        <div className="panel">
          <div className="panel-title-row">
            <h3 className="panel-title">
              <Users size={14} /> Assigned people ({project.department})
            </h3>
            <span className="field-hint">Only assigned people (and the {project.department} Manager) can see this project.</span>
          </div>
          {(project.assignees || []).length === 0 ? (
            <p className="field-hint">No one assigned yet{canManageAssignees ? " — assign from your team below." : "."}</p>
          ) : (
            <ul className="stake-list">
              {(project.assignees || []).map((a) => (
                <li key={a.id}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>
                      <span className="cell-primary">{a.name}</span>
                      {a.roleInProject && <span className="cell-sub"> · {a.roleInProject}</span>}
                    </span>
                    {canManageAssignees && (
                      <button className="icon-btn" onClick={() => removeAssignee(a.id)} title="Remove">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canManageAssignees && (
            <form className="inline-form" onSubmit={addAssignee}>
              <select value={assigneeForm.name} onChange={(e) => setAssigneeForm({ ...assigneeForm, name: e.target.value })}>
                <option value="">Choose team member…</option>
                {deptTeam.map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.name} ({u.tier})
                  </option>
                ))}
              </select>
              <input
                placeholder="Role in project (optional — TBD list)"
                value={assigneeForm.roleInProject}
                onChange={(e) => setAssigneeForm({ ...assigneeForm, roleInProject: e.target.value })}
              />
              <button className="btn btn-secondary btn-sm" type="submit">Assign</button>
            </form>
          )}
        </div>
      )}

      <div className="detail-grid">
        <div className="panel">
          <h3 className="panel-title">Overview</h3>
          {department === "Sales" || isMainAdmin ? (
            <div className="kv">
              <span>Lead owner</span>
              {canReassignLead ? (
                <select
                  value={project.assignedTo || ""}
                  onChange={(e) => reassignLead(e.target.value)}
                  style={{ width: "auto", padding: "4px 8px", fontSize: 12.5 }}
                >
                  {salesTeam.map((u) => (
                    <option key={u.id} value={u.name}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{project.assignedTo || "—"}</span>
              )}
            </div>
          ) : null}
          {canEdit ? (
            <>
              <Field label="Technical scope">
                <textarea rows={3} value={project.technicalScope} onChange={(e) => patch({ technicalScope: e.target.value })} />
              </Field>
              <div className="grid-2">
                <Field label="Budget (INR)">
                  <input value={project.budget} onChange={(e) => patch({ budget: e.target.value })} />
                </Field>
                <Field label="Timeline">
                  <input value={project.timeline} onChange={(e) => patch({ timeline: e.target.value })} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="kv"><span>Scope</span><span>{project.technicalScope || "—"}</span></div>
              {budgetVisible && (
                <div className="kv"><span>Budget</span><span className="mono">{project.budget ? `₹${project.budget}` : "—"}</span></div>
              )}
              <div className="kv"><span>Timeline</span><span>{project.timeline || "—"}</span></div>
            </>
          )}
          {canLogCalls && (
            <div className="kv">
              <span>Calls logged</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="mono">{(project.callLogs || []).length}</span>
                <button className="btn btn-secondary btn-sm" onClick={logCall}>
                  <Clock size={12} /> Log a call
                </button>
              </span>
            </div>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-title">
            <Cpu size={14} /> AI architecture summary
          </h3>
          {project.architectureSummary ? (
            <p className="arch-text">{project.architectureSummary}</p>
          ) : (
            <p className="field-hint">Generate a draft architecture summary from the technical scope above.</p>
          )}
          {canEdit && (
            <button className="btn btn-secondary" onClick={generateArchitecture} disabled={archBusy}>
              {archBusy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              {archBusy ? "Generating…" : project.architectureSummary ? "Regenerate" : "Generate summary"}
            </button>
          )}
          {archError && (
            <div className="inline-warning">
              <AlertTriangle size={13} /> {archError}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title-row">
          <h3 className="panel-title">
            <FileText size={14} /> Notes
          </h3>
          {canEdit && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowNoteModal(true)}>
              <Sparkles size={13} /> Add guided note
            </button>
          )}
        </div>
        {project.notes.length === 0 ? (
          <p className="field-hint">No notes yet.</p>
        ) : (
          <div className="note-list">
            {project.notes
              .slice()
              .reverse()
              .map((n) => (
                <div key={n.id} className="note-card">
                  <div className="note-meta">
                    <span>{n.author}</span>
                    <span>{timeAgo(n.createdAt)}</span>
                  </div>
                  <div className="note-text">{n.compiled}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="detail-grid">
        <div className="panel">
          <h3 className="panel-title">
            <Users size={14} /> Stakeholders
          </h3>
          {project.stakeholders.length === 0 ? (
            <p className="field-hint">None added yet.</p>
          ) : (
            <ul className="stake-list">
              {project.stakeholders.map((s) => (
                <li key={s.id}>
                  <span className="cell-primary">{s.name}</span>
                  <span className="cell-sub">{s.role} · {s.department}</span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form className="inline-form" onSubmit={addStakeholder}>
              <input placeholder="Name" value={stakeForm.name} onChange={(e) => setStakeForm({ ...stakeForm, name: e.target.value })} />
              <input placeholder="Role" value={stakeForm.role} onChange={(e) => setStakeForm({ ...stakeForm, role: e.target.value })} />
              <input placeholder="Department" value={stakeForm.department} onChange={(e) => setStakeForm({ ...stakeForm, department: e.target.value })} />
              <button className="btn btn-secondary btn-sm" type="submit">Add</button>
            </form>
          )}
        </div>

        <div className="panel">
          <h3 className="panel-title">
            <ShieldCheck size={14} /> Approvals
          </h3>
          {project.approvals.length === 0 ? (
            <p className="field-hint">No approvals logged yet.</p>
          ) : (
            <ul className="approval-list">
              {project.approvals.map((a) => (
                <li key={a.id}>
                  <span className={`chip chip-${a.decision === "Approved" ? "green" : "red"}`}>{a.decision}</span>
                  <span className="cell-sub">{a.stage} · {a.approver} · {timeAgo(a.createdAt)}</span>
                  {a.feasibility && (
                    <div className="approval-comment">
                      Feasibility: {a.feasibility}{a.leadTime ? ` · Lead time: ${a.leadTime}` : ""}
                    </div>
                  )}
                  {a.quoteAmount && (
                    <div className="approval-comment">
                      Quoted: {a.quoteAmount}{a.validity ? ` · ${a.validity}` : ""}
                    </div>
                  )}
                  {a.techNotes && <div className="approval-comment">{a.techNotes}</div>}
                  {a.comment && <div className="approval-comment">{a.comment}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">
          <History size={14} /> History
        </h3>
        <ul className="history-list">
          {project.history
            .slice()
            .reverse()
            .map((h) => (
              <li key={h.id}>
                <Clock size={12} />
                <span>
                  {h.label ? h.label : h.from ? `${h.from} → ${h.to}` : `Created at ${h.to}`} by {h.by}
                </span>
                <span className="cell-sub">{timeAgo(h.at)}</span>
              </li>
            ))}
        </ul>
      </div>

      {showNoteModal && (
        <NoteModal userName={userName} onClose={() => setShowNoteModal(false)} onSave={saveNote} />
      )}
      {showApprovalModal && (
        <ApprovalModal stage={project.stage} userName={userName} onClose={() => setShowApprovalModal(false)} onSubmit={submitApproval} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sign-in gate                                                            */
/* ---------------------------------------------------------------------- */

function LoginScreen({ users }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Authenticates against Supabase Auth. On success the session is established
  // and App's onAuthStateChange listener takes over (loads data, resolves the
  // profile, shows the department picker) — so there's nothing to return here.
  async function attemptSignIn(loginEmail, loginPassword) {
    setError("");
    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim().toLowerCase(),
      password: loginPassword,
    });
    setBusy(false);
    if (authError) {
      setError("Invalid credentials. Use one of the test accounts on the right, or your exact email + password.");
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError("Enter your organization email and password to continue.");
      return;
    }
    attemptSignIn(email, password);
  }

  function quickFill(user) {
    setEmail(user.email);
    setPassword(user.password);
    setError("");
    attemptSignIn(user.email, user.password);
  }

  // Quick-login test panel is dev-only and can only sign in users whose password
  // is stored in the crm-users blob (dynamically-created users). The bootstrap
  // admin has no client-side password, so it's intentionally excluded.
  const showTestPanel = import.meta.env.DEV;
  const mainAdmins = users.filter((u) => u.tier === "Main Admin" && u.active !== false && u.password);
  const byDept = DEPARTMENTS.map((d) => ({
    department: d,
    users: users.filter((u) => u.department === d && u.active !== false && u.password),
  }));

  return (
    <div className="login-screen">
      <div className="login-layout">
        <div className="login-card">
          <div className="login-brand">
            <Zap size={24} className="brand-bolt" fill="currentColor" />
            <span className="brand-text">Elecbits</span>
          </div>
          <div className="login-product">Sales OS</div>
          <div className="login-tagline">RFQ · Approvals · Pipeline</div>

          <div className="login-divider" />

          <h1 className="login-heading">Welcome back</h1>
          <p className="login-sub">Sign in with your @elecbits.in email</p>

          <form onSubmit={handleSubmit}>
            <Field label="Organization Email">
              <div className="input-icon-wrap">
                <Mail size={15} />
                <input
                  type="email"
                  placeholder="your.name@elecbits.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </Field>
            <Field label="Password">
              <div className="input-icon-wrap">
                <Lock size={15} />
                <input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </Field>

            {error && (
              <div className="inline-warning">
                <AlertTriangle size={13} /> {error}
              </div>
            )}

            <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
              {busy ? (<><Loader2 size={15} className="spin" /> Signing in…</>) : "Sign In"}
            </button>
          </form>

          <div className="login-footer">
            <a href="#" onClick={(e) => e.preventDefault()}>Reset password</a>
            <span className="login-footer-dot">·</span>
            <a href="#" onClick={(e) => e.preventDefault()}>Forgot password?</a>
          </div>
          <div className="login-footer-secondary">
            New here? <a href="#" onClick={(e) => e.preventDefault()}>Create an account</a>
          </div>
        </div>

        {showTestPanel && (
        <div className="test-users-panel">
          <div className="test-users-title">
            <ShieldCheck size={14} /> Test accounts
          </div>
          <p className="test-users-hint">For trying out the prototype — click one to sign in instantly.</p>

          {mainAdmins.map((u) => (
            <button key={u.email} className="test-user-card" onClick={() => quickFill(u)}>
              <div className="test-user-row">
                <span className="test-user-name">{u.name}</span>
                <Chip tone={roleTone(u.department, u.tier)}>{tierLabel(u.tier)}</Chip>
              </div>
              <div className="test-user-email mono">{u.email}</div>
              <div className="test-user-pw mono">pw: {u.password}</div>
            </button>
          ))}

          {byDept.map(
            (group) =>
              group.users.length > 0 && (
                <div key={group.department} className="test-user-group">
                  <div className="test-user-group-label">{group.department}</div>
                  {group.users.map((u) => (
                    <button key={u.email} className="test-user-card" onClick={() => quickFill(u)}>
                      <div className="test-user-row">
                        <span className="test-user-name">{u.name}</span>
                        <Chip tone={roleTone(u.department, u.tier)}>{tierLabel(u.tier)}</Chip>
                      </div>
                      <div className="test-user-email mono">{u.email}</div>
                      <div className="test-user-pw mono">pw: {u.password}</div>
                    </button>
                  ))}
                </div>
              )
          )}
        </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Department picker — shown right after login                            */
/* ---------------------------------------------------------------------- */

function DepartmentSelect({ user, onSelect, onBack }) {
  const isMainAdmin = user.tier === "Main Admin";
  // Access is assigned by Main Admin on the Users page (department + additional departments).
  // Main Admin has standing access to every department, so all are offered.
  const myDepartments = isMainAdmin
    ? DEPARTMENTS
    : [user.department, ...(user.additionalDepartments || [])].filter(Boolean);

  return (
    <div className="login-screen">
      <div className="dept-select-card">
        <div className="login-brand" style={{ justifyContent: "center" }}>
          <Zap size={22} className="brand-bolt" fill="currentColor" />
          <span className="brand-text">Elecbits</span>
        </div>
        <p className="dept-select-sub">
          Signed in as <strong>{user.name}</strong> · {tierLabel(user.tier)}
        </p>
        <h1 className="login-heading" style={{ textAlign: "center" }}>Choose a department</h1>
        <p className="login-sub" style={{ textAlign: "center" }}>
          You'll only see departments you've been given access to — Main Admin assigns this on the Users page.
        </p>

        <div className="dept-select-grid">
          {isMainAdmin && (
            <button className="dept-select-btn dept-select-btn-admin" onClick={() => onSelect(null)}>
              <ShieldCheck size={22} />
              <span>All Departments</span>
              <span className="dept-select-btn-sub">Main Admin view</span>
            </button>
          )}
          {myDepartments.map((d) => {
            const Icon = departmentIcon(d);
            return (
              <button className="dept-select-btn" key={d} onClick={() => onSelect(d)}>
                <Icon size={22} />
                <span>{d}</span>
                <span className="dept-select-btn-sub">
                  {isMainAdmin ? "Full access" : d === user.department ? "Primary" : "Additional access"}
                </span>
              </button>
            );
          })}
        </div>

        {myDepartments.length === 0 && !isMainAdmin && (
          <p className="field-hint" style={{ textAlign: "center" }}>
            You don't have any department access yet — contact your Main Admin.
          </p>
        )}

        <button className="back-link" style={{ margin: "18px auto 0", justifyContent: "center" }} onClick={onBack}>
          <ChevronLeft size={14} /> Sign in as someone else
        </button>
      </div>
    </div>
  );
}


/* ---------------------------------------------------------------------- */
/* User management (Main Admin only)                                       */
/* ---------------------------------------------------------------------- */

const EMPTY_USER_FORM = { id: null, name: "", email: "", password: "", department: "Sales", tier: "User" };

/* ---------------------------------------------------------------------- */
/* Task Manager                                                            */
/* ---------------------------------------------------------------------- */

const TASK_STATUSES = ["To Do", "In Progress", "Done"];

function TaskManager({ tasks, projects, clients, users, workUpdates, userId, userName, department, tier, onCreate, onUpdate }) {
  const [showForm, setShowForm] = useState(false);
  const [quickFilter, setQuickFilter] = useState("relevant"); // relevant | mine | created | team
  const [form, setForm] = useState({ title: "", description: "", assignedTo: userName, projectId: "", dueDate: "" });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [suggestions, setSuggestions] = useState(null); // null = not generated yet, [] = generated but empty
  const [selected, setSelected] = useState({}); // index -> boolean

  const isMainAdmin = tier === "Main Admin";
  const deptTeam = (users || []).filter((u) => belongsToDept(u, department));
  const clientById = Object.fromEntries((clients || []).map((c) => [c.id, c]));

  // Same scoping rules as tasks/work updates elsewhere: Main Admin sees everything, a Manager
  // sees their department, a User sees only their own.
  const relevantUpdates = (workUpdates || [])
    .filter((u) => {
      if (isMainAdmin) return true;
      if (tier === "Manager") return u.department === department;
      return u.userId === userId;
    })
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15);

  async function generateSuggestions() {
    if (relevantUpdates.length === 0) return;
    setAiBusy(true);
    setAiError("");
    setSuggestions(null);
    try {
      const teamNames = deptTeam.map((u) => u.name).join(", ");
      const updatesText = relevantUpdates
        .map((u) => `- ${u.userName} (${u.department}), ${u.date}: ${u.summary}`)
        .join("\n");
      const prompt = `You review recent work-log entries from a sales/operations team and suggest concrete follow-up tasks based on what people said they worked on. Only suggest a task when the log entry clearly implies unfinished work or a natural next step — do not invent work that wasn't mentioned.

Team members available to assign to: ${teamNames || "(none listed)"}

Recent work updates:
${updatesText}

Respond with ONLY a JSON array (no markdown fences, no preamble), 2-5 items, each shaped exactly like:
{"title": "short task title, under 10 words", "description": "one sentence of context", "assignee": "a name from the team list above, or empty string if unclear"}`;
      const text = await callClaude(prompt, 600);
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const list = Array.isArray(parsed) ? parsed : [];
      setSuggestions(list);
      setSelected(Object.fromEntries(list.map((_, i) => [i, true])));
    } catch (e) {
      setAiError("Couldn't generate suggestions — try again in a moment.");
    } finally {
      setAiBusy(false);
    }
  }

  function updateSuggestion(i, changes) {
    setSuggestions((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...changes } : s)));
  }

  function addSelectedSuggestions() {
    const now = new Date().toISOString();
    suggestions.forEach((s, i) => {
      if (!selected[i]) return;
      const assignee = deptTeam.some((u) => u.name === s.assignee) ? s.assignee : userName;
      onCreate({
        id: uid(),
        title: s.title,
        description: s.description || "",
        projectId: null,
        assignedTo: assignee,
        createdBy: userName,
        department,
        status: "To Do",
        dueDate: null,
        history: [{ id: uid(), from: null, to: "To Do", by: userName, at: now, note: "Created from AI work-update suggestion" }],
        createdAt: now,
        updatedAt: now,
      });
    });
    setSuggestions(null);
    setSelected({});
  }

  // Base scope: what this person is allowed to see at all.
  const scoped = tasks.filter((t) => {
    if (isMainAdmin) return true;
    if (tier === "Manager") return t.department === department;
    return t.assignedTo === userName || t.createdBy === userName;
  });

  const visible = scoped.filter((t) => {
    if (quickFilter === "mine") return t.assignedTo === userName;
    if (quickFilter === "created") return t.createdBy === userName;
    return true; // "relevant" / "team" both just show the full scoped set
  });

  function submit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.assignedTo) return;
    const now = new Date().toISOString();
    onCreate({
      id: uid(),
      title: form.title.trim(),
      description: form.description.trim(),
      projectId: form.projectId || null,
      assignedTo: form.assignedTo,
      createdBy: userName,
      department,
      status: "To Do",
      dueDate: form.dueDate || null,
      history: [{ id: uid(), from: null, to: "To Do", by: userName, at: now }],
      createdAt: now,
      updatedAt: now,
    });
    setForm({ title: "", description: "", assignedTo: userName, projectId: "", dueDate: "" });
    setShowForm(false);
  }

  function moveStatus(task, newStatus) {
    onUpdate({
      ...task,
      status: newStatus,
      history: [...task.history, { id: uid(), from: task.status, to: newStatus, by: userName, at: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    });
  }

  const columns = TASK_STATUSES.map((s) => ({ status: s, items: visible.filter((t) => t.status === s) }));

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Tasks</h1>
          <p className="view-sub">
            {isMainAdmin ? "Every task across the company" : tier === "Manager" ? `Every task in ${department}` : "Tasks assigned to or created by you"}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          <PlusCircle size={16} /> {showForm ? "Cancel" : "New Task"}
        </button>
      </div>

      {showForm && (
        <form className="panel form-panel" onSubmit={submit}>
          <div className="grid-2">
            <Field label="Title">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Follow up on quote" />
            </Field>
            <Field label="Assign to">
              <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
                {deptTeam.map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.name}
                    {u.name === userName ? " (me)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Link to project (optional)">
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} — {clientById[p.clientId]?.name || "Unknown"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date (optional)">
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Description (optional)">
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" style={{ marginLeft: "auto" }}>
              Create task
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        <div className="panel-title-row">
          <h3 className="panel-title">
            <Sparkles size={14} /> AI task suggestions from Work Updates
          </h3>
          <button className="btn btn-secondary btn-sm" onClick={generateSuggestions} disabled={aiBusy || relevantUpdates.length === 0}>
            {aiBusy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {aiBusy ? "Reading updates…" : "Generate suggestions"}
          </button>
        </div>
        {relevantUpdates.length === 0 ? (
          <p className="field-hint">No work updates in scope yet — suggestions need some entries on the Work Updates tab first.</p>
        ) : (
          <p className="field-hint">Reads the {relevantUpdates.length} most recent work updates you can see and proposes follow-up tasks.</p>
        )}
        {aiError && (
          <div className="inline-warning">
            <AlertTriangle size={13} /> {aiError}
          </div>
        )}
        {suggestions && (
          suggestions.length === 0 ? (
            <p className="field-hint">No clear follow-up tasks found in those updates.</p>
          ) : (
            <>
              <div className="ai-suggestion-list">
                {suggestions.map((s, i) => (
                  <div className="ai-suggestion-card" key={i}>
                    <label className="ai-suggestion-check">
                      <input type="checkbox" checked={!!selected[i]} onChange={(e) => setSelected({ ...selected, [i]: e.target.checked })} />
                    </label>
                    <div className="ai-suggestion-body">
                      <input
                        className="ai-suggestion-title"
                        value={s.title}
                        onChange={(e) => updateSuggestion(i, { title: e.target.value })}
                      />
                      <textarea
                        className="ai-suggestion-desc"
                        rows={2}
                        value={s.description || ""}
                        onChange={(e) => updateSuggestion(i, { description: e.target.value })}
                      />
                      <select value={s.assignee || ""} onChange={(e) => updateSuggestion(i, { assignee: e.target.value })}>
                        <option value="">Assign to me ({userName})</option>
                        {deptTeam.map((u) => (
                          <option key={u.id} value={u.name}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
              <div className="form-actions">
                <button className="btn btn-ghost" onClick={() => setSuggestions(null)}>
                  Discard
                </button>
                <button className="btn btn-primary" onClick={addSelectedSuggestions} disabled={!Object.values(selected).some(Boolean)}>
                  Add {Object.values(selected).filter(Boolean).length} selected task{Object.values(selected).filter(Boolean).length === 1 ? "" : "s"}
                </button>
              </div>
            </>
          )
        )}
      </div>

      <div className="quick-actions">
        <button className={`quick-action ${quickFilter === "relevant" ? "active" : ""}`} onClick={() => setQuickFilter("relevant")}>
          <LayoutGrid size={14} /> {isMainAdmin ? "All Tasks" : tier === "Manager" ? "Team Tasks" : "My Scope"}
        </button>
        <button className={`quick-action ${quickFilter === "mine" ? "active" : ""}`} onClick={() => setQuickFilter("mine")}>
          <FileText size={14} /> Assigned to Me
        </button>
        <button className={`quick-action ${quickFilter === "created" ? "active" : ""}`} onClick={() => setQuickFilter("created")}>
          <Sparkles size={14} /> Created by Me
        </button>
      </div>

      <div className="kanban">
        {columns.map((col) => (
          <div className="kanban-col" key={col.status}>
            <div className="kanban-col-header">
              <span>{col.status}</span>
              <Chip>{col.items.length}</Chip>
            </div>
            <div className="kanban-col-body">
              {col.items.length === 0 ? (
                <p className="field-hint" style={{ padding: "0 4px" }}>No tasks.</p>
              ) : (
                col.items.map((t) => {
                  const project = projects.find((p) => p.id === t.projectId);
                  const nextIdx = TASK_STATUSES.indexOf(t.status) + 1;
                  const prevIdx = TASK_STATUSES.indexOf(t.status) - 1;
                  return (
                    <div className="task-card" key={t.id}>
                      <div className="task-card-title">{t.title}</div>
                      {t.description && <div className="task-card-desc">{t.description}</div>}
                      <div className="task-card-meta">
                        <span className="cell-sub">{t.assignedTo}</span>
                        {t.dueDate && <span className="cell-sub">Due {t.dueDate}</span>}
                      </div>
                      {project && (
                        <div className="task-card-meta">
                          <span className="mono id-chip subtle" style={{ fontSize: 10.5 }}>{project.id}</span>
                        </div>
                      )}
                      <div className="task-card-actions">
                        {prevIdx >= 0 && (
                          <button className="btn btn-ghost btn-sm" onClick={() => moveStatus(t, TASK_STATUSES[prevIdx])}>
                            <ChevronLeft size={12} /> {TASK_STATUSES[prevIdx]}
                          </button>
                        )}
                        {nextIdx < TASK_STATUSES.length && (
                          <button className="btn btn-secondary btn-sm" onClick={() => moveStatus(t, TASK_STATUSES[nextIdx])}>
                            {TASK_STATUSES[nextIdx]} <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Work Updates (visible to all — scoped by role)                          */
/* ---------------------------------------------------------------------- */

function WorkUpdates({ updates, userId, userName, department, tier, onCreate }) {
  const [summary, setSummary] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState("");
  const [justAddedId, setJustAddedId] = useState(null);

  const isMainAdmin = tier === "Main Admin";

  const visible = updates.filter((u) => {
    if (isMainAdmin) return true;
    if (tier === "Manager") return u.department === department;
    return u.userId === userId;
  });

  function submit(e) {
    e.preventDefault();
    if (!summary.trim()) return;
    const newEntry = {
      id: uid(),
      userId,
      userName,
      department,
      tier,
      date,
      hours: hours ? parseFloat(hours) : null,
      summary: summary.trim(),
      createdAt: new Date().toISOString(),
    };
    onCreate(newEntry);
    setSummary("");
    setHours("");
    setJustAddedId(newEntry.id);
  }

  useEffect(() => {
    if (!justAddedId) return;
    const el = document.getElementById(`update-${justAddedId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setJustAddedId(null), 2500);
    return () => clearTimeout(t);
  }, [justAddedId, updates]);

  const grouped = Object.values(
    visible
      .slice()
      .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
      .reduce((acc, u) => {
        if (!acc[u.date]) acc[u.date] = { date: u.date, entries: [] };
        acc[u.date].entries.push(u);
        return acc;
      }, {})
  ).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Work Updates</h1>
          <p className="view-sub">
            {isMainAdmin
              ? "Showing updates from everyone"
              : tier === "Manager"
              ? `Showing updates from your ${department} team`
              : "Showing your own updates"}
          </p>
        </div>
      </div>

      <form className="panel form-panel" onSubmit={submit}>
        <h3 className="panel-title">Log today's update</h3>
        <div className="grid-2">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Hours spent (optional)">
            <input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 6.5" />
          </Field>
        </div>
        <Field label="What did you work on?">
          <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summarize today's work…" />
        </Field>
        <div className="form-actions">
          {justAddedId && (
            <span className="inline-warning" style={{ color: "var(--green)" }}>
              <CheckCircle2 size={13} /> Update added — see it highlighted below.
            </span>
          )}
          <button className="btn btn-primary" type="submit" style={{ marginLeft: "auto" }}>
            Add update
          </button>
        </div>
      </form>

      {grouped.length === 0 ? (
        <EmptyState icon={FileText} title="No updates yet" body="Once entries are logged, they'll show up here." />
      ) : (
        grouped.map((g) => (
          <div className="panel" key={g.date}>
            <h3 className="panel-title">{new Date(g.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h3>
            <div className="note-list">
              {g.entries.map((e) => (
                <div className={`note-card ${e.id === justAddedId ? "note-card-new" : ""}`} id={`update-${e.id}`} key={e.id}>
                  <div className="note-meta">
                    <span>
                      {e.userName}
                      {!isMainAdmin && tier !== "Manager" ? "" : ` · ${e.department}`}
                      {e.hours ? ` · ${e.hours}h` : ""}
                    </span>
                    <span>{e.id === justAddedId ? "Just now" : timeAgo(e.createdAt)}</span>
                  </div>
                  <div className="note-text">{e.summary}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Finance (visible to everyone — integration pending)                     */
/* ---------------------------------------------------------------------- */

function FinancePlaceholder() {
  const previewCards = [
    { label: "Total Payment Reqs", icon: FileText },
    { label: "Paid", icon: CheckCircle2 },
    { label: "Pending", icon: Clock },
    { label: "Active Budgets", icon: ShieldCheck },
  ];

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Finance</h1>
          <p className="view-sub">Budget · PO · Payment Management</p>
        </div>
      </div>

      <div className="panel not-connected-panel">
        <span className="stat-icon-badge stat-icon-amber" style={{ width: 40, height: 40 }}>
          <AlertTriangle size={18} />
        </span>
        <h3 style={{ margin: "10px 0 4px" }}>Not connected yet</h3>
        <p className="field-hint" style={{ maxWidth: 480, margin: "0 auto" }}>
          This tab is visible to everyone so the Finance module is easy to find once it's wired up. It isn't
          connected to live data yet — budgets, POs, and payments will appear here once that integration is in
          place.
        </p>
      </div>

      <div className="stat-row">
        {previewCards.map((c) => (
          <div className="stat-card" key={c.label} style={{ cursor: "default" }}>
            <div className="stat-card-top">
              <span className="stat-icon-badge"><c.icon size={15} /></span>
            </div>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value" style={{ color: "var(--text-faint)" }}>—</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Profile (visible to everyone — will link to the HR employee portal)     */
/* ---------------------------------------------------------------------- */

function Profile({ users, userId, userName, department, tier }) {
  const me = (users || []).find((u) => u.id === userId);
  const initials = (userName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const documents = [
    { label: "Offer Letter" },
    { label: "ID Proof" },
    { label: "Tax Documents" },
    { label: "Payslips" },
  ];

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>My Profile</h1>
          <p className="view-sub">Personal details and documents</p>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="topbar-avatar" style={{ width: 52, height: 52, fontSize: 18 }}>{initials}</div>
          <div>
            <h2 style={{ margin: 0 }}>{userName}</h2>
            <Chip tone={roleTone(department, tier)}>{roleLabel(department, tier)}</Chip>
          </div>
        </div>
        <div className="kv" style={{ marginTop: 16 }}>
          <span>Email</span>
          <span className="mono">{me?.email || "—"}</span>
        </div>
        <div className="kv">
          <span>Department</span>
          <span>{department || "—"}</span>
        </div>
        <div className="kv">
          <span>Tier</span>
          <span>{tierLabel(tier)}</span>
        </div>
        <p className="field-hint" style={{ marginTop: 10 }}>
          To update these details, contact your Main Admin on the Users page.
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">Documents</h3>
        <p className="field-hint" style={{ marginBottom: 10 }}>
          This section will link to the HR Employee Data Portal — not connected yet.
        </p>
        <ul className="stake-list">
          {documents.map((d) => (
            <li key={d.label}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="cell-primary">{d.label}</span>
                <Chip>Not available yet</Chip>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Reports (Sales Manager / Main Admin)                                    */
/* ---------------------------------------------------------------------- */

function Reports({ clients, projects, users }) {
  const salesTeam = (users || []).filter((u) => belongsToDept(u, "Sales"));

  const rows = salesTeam.map((m) => {
    const clientsAdded = clients.filter((c) => c.createdBy === m.name).length;
    const leadsCreated = projects.filter((p) => p.createdBy === m.name).length;
    const callsMade = projects.reduce((sum, p) => sum + (p.callLogs || []).filter((c) => c.by === m.name).length, 0);
    const stageChanges = projects.reduce((sum, p) => sum + (p.history || []).filter((h) => h.by === m.name).length, 0);
    return { ...m, clientsAdded, leadsCreated, callsMade, stageChanges };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      clientsAdded: acc.clientsAdded + r.clientsAdded,
      leadsCreated: acc.leadsCreated + r.leadsCreated,
      callsMade: acc.callsMade + r.callsMade,
      stageChanges: acc.stageChanges + r.stageChanges,
    }),
    { clientsAdded: 0, leadsCreated: 0, callsMade: 0, stageChanges: 0 }
  );

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Reports</h1>
          <p className="view-sub">Per-rep activity across the Sales team.</p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-blue"><Building2 size={15} /></span></div>
          <div className="stat-label">Clients Added</div>
          <div className="stat-value">{totals.clientsAdded}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-purple"><FileText size={15} /></span></div>
          <div className="stat-label">Leads Created</div>
          <div className="stat-value">{totals.leadsCreated}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-amber"><Clock size={15} /></span></div>
          <div className="stat-label">Calls Made</div>
          <div className="stat-value">{totals.callsMade}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-green"><RefreshCw size={15} /></span></div>
          <div className="stat-label">Stage Changes</div>
          <div className="stat-value">{totals.stageChanges}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Tier</th>
              <th>Clients Added</th>
              <th>Leads Created</th>
              <th>Calls Made</th>
              <th>Stage Changes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="field-hint" style={{ padding: 16 }}>
                  No Sales team members yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary">{r.name}</td>
                  <td><Chip tone={roleTone(r.department, r.tier)}>{tierLabel(r.tier)}</Chip></td>
                  <td className="mono">{r.clientsAdded}</td>
                  <td className="mono">{r.leadsCreated}</td>
                  <td className="mono">{r.callsMade}</td>
                  <td className="mono">{r.stageChanges}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* User management (Main Admin only)                                       */
/* ---------------------------------------------------------------------- */

function UserManagement({ users, currentUserId, onCreate, onSave, onDelete }) {
  const [form, setForm] = useState(EMPTY_USER_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const activeCount = users.filter((u) => u.active !== false).length;

  const visible = users.filter((u) => {
    if (!query) return true;
    const hay = `${u.name} ${u.email} ${u.department || ""}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  });

  function resetForm() {
    setForm(EMPTY_USER_FORM);
    setError("");
    setShowForm(false);
  }

  function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setError("Name, email, and password are all required.");
      return;
    }
    const duplicate = users.find((u) => u.email.toLowerCase() === form.email.trim().toLowerCase());
    if (duplicate) {
      setError("Another user already has that email.");
      return;
    }
    onCreate({
      id: uid(),
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      department: form.tier === "Main Admin" ? null : form.department,
      additionalDepartments: [],
      tier: form.tier,
      active: true,
      createdAt: new Date().toISOString(),
    });
    resetForm();
  }

  function updateUser(u, changes) {
    onSave({ ...u, ...changes });
  }

  function addAdditionalDept(u, dept) {
    if (!dept || dept === u.department || (u.additionalDepartments || []).includes(dept)) return;
    updateUser(u, { additionalDepartments: [...(u.additionalDepartments || []), dept] });
  }

  function removeAdditionalDept(u, dept) {
    updateUser(u, { additionalDepartments: (u.additionalDepartments || []).filter((d) => d !== dept) });
  }

  return (
    <div className="view">
      <div className="view-header">
        <div className="admin-console-title">
          <span className="stat-icon-badge stat-icon-purple"><Users size={16} /></span>
          <div>
            <h1 style={{ margin: 0 }}>Employees</h1>
            <p className="view-sub">
              {users.length} total · <span style={{ color: "var(--green)", fontWeight: 600 }}>{activeCount} active</span>
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div className="search-box" style={{ width: 220 }}>
            <Search size={14} />
            <input placeholder="Search name, email, dept…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <button className="btn btn-secondary" onClick={() => setShowForm(!showForm)}>
            <PlusCircle size={15} /> Add user
          </button>
        </div>
      </div>
      <p className="field-hint" style={{ marginTop: -14 }}>
        Assign each employee a role and department — they can belong to more than one. Role and status changes save immediately.
      </p>

      {showForm && (
        <form className="panel form-panel" onSubmit={submit}>
          <h3 className="panel-title">Add employee</h3>
          <div className="grid-2">
            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jordan Rivera" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jordan.rivera@elecbits.in" />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Password">
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Set a password" />
            </Field>
            <Field label="Role">
              <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>{tierLabel(t)}</option>
                ))}
              </select>
            </Field>
          </div>
          {form.tier !== "Main Admin" && (
            <Field label="Department">
              <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>
          )}
          {error && (
            <div className="inline-warning">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit">
              Add user
            </button>
          </div>
        </form>
      )}

      <div className="employee-list">
        {visible.map((u) => {
          const extraOptions = DEPARTMENTS.filter((d) => d !== u.department && !(u.additionalDepartments || []).includes(d));
          const isInactive = u.active === false;
          const isPending = u.status === "pending";
          return (
            <div className={`employee-card ${isInactive ? "inactive" : ""}`} key={u.id}>
              <div className="employee-card-top">
                <div>
                  <div className="employee-name-row">
                    <span className="cell-primary" style={{ fontSize: 15 }}>{u.name}</span>
                    <Chip tone={isPending ? "amber" : isInactive ? "default" : "green"}>{isPending ? "PENDING" : isInactive ? "INACTIVE" : "ACTIVE"}</Chip>
                  </div>
                  <div className="cell-sub">
                    {u.email}
                    {u.department ? ` · ${u.department}` : ""}
                    {u.createdAt ? ` · Joined ${new Date(u.createdAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
              </div>

              <div className="employee-card-controls">
                <Field label="Role">
                  <select value={u.tier} onChange={(e) => updateUser(u, { tier: e.target.value, department: e.target.value === "Main Admin" ? null : u.department || "Sales" })}>
                    {TIERS.map((t) => (
                      <option key={t} value={t}>{tierLabel(t)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Department">
                  <select
                    value={u.department || ""}
                    disabled={u.tier === "Main Admin"}
                    onChange={(e) => updateUser(u, { department: e.target.value })}
                  >
                    {u.tier === "Main Admin" ? (
                      <option value="">—</option>
                    ) : (
                      DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))
                    )}
                  </select>
                </Field>
                <Field label="Additional departments">
                  <select value="" disabled={u.tier === "Main Admin"} onChange={(e) => addAdditionalDept(u, e.target.value)}>
                    <option value="">+ Add…</option>
                    {extraOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </Field>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => updateUser(u, isInactive ? { active: true, status: "active" } : { active: false })}>
                    {isInactive ? <CheckCircle2 size={13} /> : <Ban size={13} />} {isPending ? "Approve" : isInactive ? "Activate" : "Deactivate"}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={u.id === currentUserId}
                    title={u.id === currentUserId ? "You can't remove your own account" : "Delete"}
                    onClick={() => u.id !== currentUserId && onDelete(u.id)}
                  >
                    <X size={13} /> Delete
                  </button>
                </div>
              </div>

              {(u.additionalDepartments || []).length > 0 && (
                <div className="employee-dept-chips">
                  {u.additionalDepartments.map((d) => (
                    <span className="chip chip-default" key={d}>
                      {d}
                      <button className="chip-remove" onClick={() => removeAdditionalDept(u, d)} title="Remove">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App shell                                                               */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/* Auth splash + account-notice screens                                    */
/* ---------------------------------------------------------------------- */

function AuthSplash({ message = "Loading…" }) {
  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>
      <div className="login-screen">
        <div className="dept-select-card" style={{ textAlign: "center" }}>
          <div className="login-brand" style={{ justifyContent: "center" }}>
            <Zap size={22} className="brand-bolt" fill="currentColor" />
            <span className="brand-text">Elecbits</span>
          </div>
          <p className="login-sub" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 18 }}>
            <Loader2 size={16} className="spin" /> {message}
          </p>
        </div>
      </div>
    </div>
  );
}

function AccountNotice({ title, body, onSignOut }) {
  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>
      <div className="login-screen">
        <div className="dept-select-card" style={{ textAlign: "center" }}>
          <div className="login-brand" style={{ justifyContent: "center" }}>
            <Zap size={22} className="brand-bolt" fill="currentColor" />
            <span className="brand-text">Elecbits</span>
          </div>
          <h1 className="login-heading" style={{ textAlign: "center", marginTop: 16 }}>{title}</h1>
          <p className="login-sub" style={{ textAlign: "center" }}>{body}</p>
          <button className="btn btn-secondary" style={{ margin: "18px auto 0" }} onClick={onSignOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// True when the page was opened from a password-reset email link, which carries
// `type=recovery` in the URL hash (e.g. #access_token=…&type=recovery).
function isRecoveryUrl() {
  try {
    return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type") === "recovery";
  } catch {
    return false;
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [workUpdates, setWorkUpdates] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [leads, setLeads] = useState([]);
  const [view, setView] = useState("dashboard"); // dashboard | new | detail | users
  const [selectedId, setSelectedId] = useState(null);
  const [department, setDepartment] = useState(null);
  const [tier, setTier] = useState(null);
  const [userName, setUserName] = useState("");
  const [userId, setUserId] = useState(null);
  const [saveError, setSaveError] = useState("");

  // --- Supabase Auth session ---
  const [session, setSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [deptChosen, setDeptChosen] = useState(false);
  // A "forgot password" reset link lands on #...&type=recovery. Detect it
  // synchronously on first render — Supabase strips the hash asynchronously as it
  // establishes the recovery session, so reading it now (not relying solely on the
  // async PASSWORD_RECOVERY event) reliably wins that race.
  const [recovery, setRecovery] = useState(isRecoveryUrl);

  // Track the session on mount and whenever it changes (sign in / out / refresh).
  // Skip the initial session read when arriving via a recovery link, or we'd route
  // that temporary session into the app instead of the set-new-password screen.
  useEffect(() => {
    let active = true;
    if (recovery) {
      setAuthChecking(false);
    } else {
      supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setAuthChecking(false);
      });
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthChecking(false); return; }
      setSession(s);
      if (!s) {
        // Signed out — clear everything so the next login re-loads fresh.
        setDataLoaded(false);
        setDeptChosen(false);
        setDepartment(null);
        setUserName("");
        setTier(null);
        setUserId(null);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load (and, on first run, seed) the collections once we have a session.
  // RLS only permits reads/writes for authenticated users, so this must run
  // after sign-in — not on mount.
  useEffect(() => {
    if (!session || dataLoaded) return;
    let active = true;
    (async () => {
      setLoading(true);
      const [c, p, u, w, t, l] = await Promise.all([
        loadList("crm-clients"),
        loadList("crm-projects"),
        loadList("crm-users"),
        loadList("crm-work-updates"),
        loadList("crm-tasks"),
        loadList("crm-leads"),
      ]);
      if (!active) return;
      if (u.length === 0) {
        // First run — seed only the bootstrap admin (from env). Everyone else is
        // created dynamically via the Employees screen. If no bootstrap admin is
        // configured, seed nothing (SEED_USERS is empty).
        setUsers(SEED_USERS);
        if (SEED_USERS.length) saveList("crm-users", SEED_USERS);
      } else {
        setUsers(u);
      }
      if (c.length === 0 && p.length === 0 && l.length === 0) {
        // First run — seed the linked sample dataset (leads -> clients -> RFQs -> dept review -> project IDs).
        setClients(SAMPLE_CLIENTS);
        saveList("crm-clients", SAMPLE_CLIENTS);
        setProjects(SAMPLE_PROJECTS);
        saveList("crm-projects", SAMPLE_PROJECTS);
        setLeads(SAMPLE_LEADS);
        saveList("crm-leads", SAMPLE_LEADS);
      } else {
        setClients(c);
        setProjects(p);
        setLeads(l);
      }
      if (t.length === 0) {
        setTasks(SAMPLE_TASKS);
        saveList("crm-tasks", SAMPLE_TASKS);
      } else {
        setTasks(t);
      }
      if (w.length === 0) {
        setWorkUpdates(SAMPLE_WORK_UPDATES);
        saveList("crm-work-updates", SAMPLE_WORK_UPDATES);
      } else {
        setWorkUpdates(w);
      }
      setDataLoaded(true);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [session, dataLoaded]);

  const persistClients = useCallback(async (list) => {
    setClients(list);
    const ok = await saveList("crm-clients", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  const persistProjects = useCallback(async (list) => {
    setProjects(list);
    const ok = await saveList("crm-projects", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  const persistUsers = useCallback(async (list) => {
    setUsers(list);
    const ok = await saveList("crm-users", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  const persistWorkUpdates = useCallback(async (list) => {
    setWorkUpdates(list);
    const ok = await saveList("crm-work-updates", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  function handleCreateWorkUpdate(entry) {
    persistWorkUpdates([...workUpdates, entry]);
  }

  const persistTasks = useCallback(async (list) => {
    setTasks(list);
    const ok = await saveList("crm-tasks", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  function handleCreateTask(newTask) {
    persistTasks([...tasks, newTask]);
  }

  function handleUpdateTask(updated) {
    persistTasks(tasks.map((t) => (t.id === updated.id ? updated : t)));
  }

  function handleCreateClient(newClient) {
    persistClients([...clients, newClient]);
  }

  const persistLeads = useCallback(async (list) => {
    setLeads(list);
    const ok = await saveList("crm-leads", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  function approveLeadRecord(lead, approverName) {
    const match = findMatchingClient(clients, lead.email);
    let clientId = match?.id;
    if (!match) {
      const newClient = {
        id: nextClientId(clients),
        name: lead.name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        createdBy: lead.submittedBy,
        createdAt: new Date().toISOString(),
      };
      persistClients([...clients, newClient]);
      clientId = newClient.id;
    }
    const now = new Date().toISOString();
    persistLeads(
      leads.some((l) => l.id === lead.id)
        ? leads.map((l) => (l.id === lead.id ? { ...l, status: "Approved", reviewedBy: approverName, reviewedAt: now, clientId } : l))
        : [...leads, { ...lead, status: "Approved", reviewedBy: approverName, reviewedAt: now, clientId }]
    );
  }

  function handleSubmitLead(leadForm, autoApprove) {
    const now = new Date().toISOString();
    const newLead = {
      id: uid(),
      ...leadForm,
      submittedBy: userName,
      status: "Pending",
      reviewedBy: null,
      reviewedAt: null,
      clientId: null,
      createdAt: now,
    };
    if (autoApprove) {
      approveLeadRecord(newLead, userName);
    } else {
      persistLeads([...leads, newLead]);
    }
  }

  function handleApproveLead(lead) {
    approveLeadRecord(lead, userName);
  }

  function handleRejectLead(lead, reason) {
    persistLeads(
      leads.map((l) =>
        l.id === lead.id ? { ...l, status: "Rejected", reviewedBy: userName, reviewedAt: new Date().toISOString(), rejectionReason: reason } : l
      )
    );
  }

  function handleCreateProject(newProject) {
    persistProjects([...projects, newProject]);
  }

  function handleUpdateProject(updated) {
    persistProjects(projects.map((p) => (p.id === updated.id ? updated : p)));
  }

  // Calls the admin serverless function with the caller's access token.
  async function callAdmin(payload) {
    const token = session?.access_token;
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed.");
    return json;
  }

  // Creating a user also provisions a Supabase Auth login so they can sign in.
  async function handleCreateUser(newUser) {
    setSaveError("");
    try {
      const { authId } = await callAdmin({
        action: "create",
        email: newUser.email,
        password: newUser.password,
      });
      persistUsers([...users, { ...newUser, authId }]);
    } catch (e) {
      setSaveError(e.message || "Couldn't create a login for this user.");
    }
  }

  function handleSaveUser(updated) {
    persistUsers(users.map((u) => (u.id === updated.id ? updated : u)));
  }

  // Removing a user also deletes their Supabase Auth login (best effort).
  async function handleDeleteUser(id) {
    const target = users.find((u) => u.id === id);
    persistUsers(users.filter((u) => u.id !== id));
    if (target) {
      try {
        await callAdmin({ action: "delete", authId: target.authId, email: target.email });
      } catch (e) {
        setSaveError(e.message || "User removed, but their login could not be deleted.");
      }
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedId);
  const selectedClient = selectedProject && clients.find((c) => c.id === selectedProject.clientId);
  const isMainAdmin = tier === "Main Admin";
  const canCreateRFQ = isMainAdmin || department === "Sales";

  async function handleSignOut() {
    await supabase.auth.signOut();
    // onAuthStateChange clears the rest of the state.
  }

  // Called by the LoginPage's "Sign In" button. signIn() authenticates and gates
  // on the crm-users profile (missing / pending / deactivated → signed back out
  // with a precise message). On success the onAuthStateChange listener above sets
  // the session and the normal load → department-picker flow takes over.
  async function handleLogin(email, password) {
    const res = await signIn(email, password);
    if (res.success) return { success: true };
    return { success: false, error: res.error };
  }

  // The signed-in user's app profile (tier / department / name) comes from the
  // crm-users collection, matched by their auth email.
  const me =
    session && users.find((u) => (u.email || "").toLowerCase() === (session.user.email || "").toLowerCase());

  // 0. Arrived from a password-reset email link → set-new-password screen. This
  // takes priority over any session the link also established.
  if (recovery) {
    return (
      <ResetPasswordPage
        onDone={() => {
          window.location.hash = "";
          setRecovery(false);
          setSession(null);
          setDataLoaded(false);
        }}
      />
    );
  }

  // 1. Still checking for an existing session.
  if (authChecking) {
    return <AuthSplash />;
  }

  // 2. Not signed in → login screen.
  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // 3. Signed in, but collections still loading.
  if (loading || !dataLoaded) {
    return <AuthSplash message="Loading your workspace…" />;
  }

  // 4. Authenticated, but no matching app profile / pending / deactivated.
  if (!me) {
    return <AccountNotice title="No profile found" body={`No employee record is linked to ${session.user.email}. Ask your Main Admin to add you on the Employees page.`} onSignOut={handleSignOut} />;
  }
  if (me.status === "pending") {
    return <AccountNotice title="Awaiting approval" body="Your account is awaiting admin approval. You'll be able to sign in once a Main Admin activates it." onSignOut={handleSignOut} />;
  }
  if (me.active === false) {
    return <AccountNotice title="Account deactivated" body="This account has been deactivated. Contact your Main Admin." onSignOut={handleSignOut} />;
  }

  // 5. Pick a department before entering the app.
  if (!deptChosen) {
    return (
      <div className="app-shell">
        <style>{APP_STYLES}</style>
        <DepartmentSelect
          user={me}
          onSelect={(dept) => {
            setUserName(me.name);
            setTier(me.tier);
            setUserId(me.id);
            setDepartment(dept);
            setDeptChosen(true);
          }}
          onBack={handleSignOut}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>

      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <Zap size={20} className="brand-bolt" fill="currentColor" />
            <span className="brand-text">Elecbits</span>
          </div>
          <div className="topbar-divider" />
          <div className="topbar-product">
            <span className="topbar-product-name">Sales OS</span>
            <span className="topbar-product-tag">RFQ · Approvals · Pipeline</span>
          </div>
        </div>
        <div className="topbar-right">
          <button className="topbar-bell" title="Notifications">
            <Bell size={18} />
          </button>
          <div className="topbar-user">
            <div className="topbar-user-info">
              <div className="topbar-user-name">{userName}</div>
              <div className="topbar-user-role">{tierLabel(tier)}</div>
            </div>
            <div className="topbar-avatar">{userName ? userName[0].toUpperCase() : "?"}</div>
          </div>
          <button className="topbar-signout" title="Sign out" onClick={handleSignOut}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="role-banner">
        <ShieldCheck size={15} />
        <strong>
          {tier}
          {tier === "Main Admin" ? " (Special Access)" : tier === "Manager" ? " (Department Head)" : ""}
        </strong>
        <span className="role-banner-dept">· Dept: {department || "All"}</span>
      </div>

      <nav className="nav-tabs-bar">
        <span className="nav-tabs-label">MENU</span>
        <button className={`nav-tab ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}>
          Dashboard
        </button>
        {(isMainAdmin || department === "Sales") && (
          <button className={`nav-tab ${view === "leads" ? "active" : ""}`} onClick={() => setView("leads")}>
            Leads
          </button>
        )}
        {canCreateRFQ && (
          <button className={`nav-tab ${view === "new" ? "active" : ""}`} onClick={() => setView("new")}>
            New RFQ
          </button>
        )}
        {(isMainAdmin || (department === "Sales" && tier === "Manager")) && (
          <button className={`nav-tab ${view === "reports" ? "active" : ""}`} onClick={() => setView("reports")}>
            Reports
          </button>
        )}
        {isMainAdmin && (
          <button className={`nav-tab ${view === "users" ? "active" : ""}`} onClick={() => setView("users")}>
            Users
          </button>
        )}
        <button className={`nav-tab ${view === "tasks" ? "active" : ""}`} onClick={() => setView("tasks")}>
          Tasks
        </button>
        <button className={`nav-tab ${view === "workupdates" ? "active" : ""}`} onClick={() => setView("workupdates")}>
          Work Updates
        </button>
        <button className={`nav-tab ${view === "finance" ? "active" : ""}`} onClick={() => setView("finance")}>
          Finance
        </button>
        <button className={`nav-tab ${view === "profile" ? "active" : ""}`} onClick={() => setView("profile")}>
          Profile
        </button>
      </nav>

      {saveError && (
        <div className="save-error">
          <AlertTriangle size={12} /> {saveError}
        </div>
      )}

      <main className="main">
        {loading ? (
          <div className="empty-state">
            <Loader2 size={22} className="spin" />
            <div className="empty-title">Loading pipeline…</div>
          </div>
        ) : view === "dashboard" ? (
          <Dashboard
            clients={clients}
            projects={projects}
            users={users}
            department={department}
            tier={tier}
            userName={userName}
            onOpen={(id) => {
              setSelectedId(id);
              setView("detail");
            }}
            onNew={() => setView("new")}
          />
        ) : view === "leads" ? (
          <Leads
            leads={leads}
            clients={clients}
            userName={userName}
            tier={tier}
            onSubmitLead={handleSubmitLead}
            onApproveLead={handleApproveLead}
            onRejectLead={handleRejectLead}
          />
        ) : view === "new" ? (
          <NewRFQ
            clients={clients}
            projects={projects}
            userName={userName}
            onCreateProject={handleCreateProject}
            onCancel={() => setView("dashboard")}
            onDone={(projectId) => {
              if (projectId) {
                setSelectedId(projectId);
                setView("detail");
              } else {
                setView("dashboard");
              }
            }}
          />
        ) : view === "reports" ? (
          <Reports clients={clients} projects={projects} users={users} />
        ) : view === "users" ? (
          <UserManagement
            users={users}
            currentUserId={userId}
            onCreate={handleCreateUser}
            onSave={handleSaveUser}
            onDelete={handleDeleteUser}
          />
        ) : view === "finance" ? (
          <FinancePlaceholder />
        ) : view === "tasks" ? (
          <TaskManager
            tasks={tasks}
            projects={projects}
            clients={clients}
            users={users}
            workUpdates={workUpdates}
            userId={userId}
            userName={userName}
            department={department}
            tier={tier}
            onCreate={handleCreateTask}
            onUpdate={handleUpdateTask}
          />
        ) : view === "workupdates" ? (
          <WorkUpdates
            updates={workUpdates}
            userId={userId}
            userName={userName}
            department={department}
            tier={tier}
            onCreate={handleCreateWorkUpdate}
          />
        ) : view === "profile" ? (
          <Profile users={users} userId={userId} userName={userName} department={department} tier={tier} />
        ) : selectedProject ? (
          <ProjectDetail
            project={selectedProject}
            client={selectedClient}
            users={users}
            projects={projects}
            department={department}
            tier={tier}
            userName={userName}
            onUpdate={handleUpdateProject}
            onBack={() => setView("dashboard")}
          />
        ) : (
          <EmptyState icon={FileText} title="Project not found" body="It may have been removed." />
        )}
      </main>
    </div>
  );
}
