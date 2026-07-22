import { useState } from "react";
import { PlusCircle, Building2, Cpu, Search, ChevronRight, Clock, Users, FileText, ShieldCheck, Trophy, LayoutGrid } from "lucide-react";
import { STAGES, APPROVAL_GATES, EXECUTION_DEPARTMENTS, BUDGET_VISIBLE_DEPARTMENTS, TYPES } from "../constants";
import { belongsToDept, timeAgo } from "../lib/helpers";
import { Chip, StageBadge, TypeBadge, EmptyState } from "../components/ui";

export function Dashboard({ clients, projects, users, department, tier, userName, onOpen, onNew }) {
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [quickFilter, setQuickFilter] = useState(null); // null | "awaiting" | "myapprovals" | "mine"

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

  // Can the current user approve this project at its current stage? Mirrors
  // ProjectDetail's gate rules for the PM-based chain: Dept Review = the dept
  // head; Technical Review / Quotation / Approval = the PM or the dept head;
  // Admin always.
  function canApproveProject(p) {
    const gate = APPROVAL_GATES.includes(p.stage) || p.stage === "Approval";
    if (!gate) return false;
    if (isMainAdmin) return true;
    const isDeptHead = tier === "Manager" && department === p.department;
    if (p.stage === "Dept Review") return isDeptHead;
    const pmA = (p.assignees || []).find((a) => a.roleInProject === "Project Manager");
    const isPM = !!pmA && pmA.name === userName;
    return isDeptHead || isPM;
  }
  const myApprovalCount = scoped.filter(canApproveProject).length;

  const visible = scoped.filter((p) => {
    if (quickFilter === "awaiting" && !APPROVAL_GATES.includes(p.stage)) return false;
    if (quickFilter === "myapprovals" && !canApproveProject(p)) return false;
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
        {(isMainAdmin || tier === "Manager" || myApprovalCount > 0) && (
          <button className={`quick-action ${quickFilter === "myapprovals" ? "active" : ""}`} onClick={() => setQuickFilter(quickFilter === "myapprovals" ? null : "myapprovals")}>
            <ShieldCheck size={14} /> My Approvals{myApprovalCount ? ` (${myApprovalCount})` : ""}
          </button>
        )}
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
                <div
                  className="stage-bar-row"
                  key={s.stage}
                  onClick={() => setStageFilter(stageFilter === s.stage ? "All" : s.stage)}
                  style={{ cursor: "pointer" }}
                  title={`Show ${s.stage} projects`}
                >
                  <div className="stage-bar-label">
                    <span style={{ color: stageFilter === s.stage ? "var(--blue)" : undefined, fontWeight: stageFilter === s.stage ? 700 : undefined }}>
                      {s.stage}{stageFilter === s.stage ? " ▸" : ""}
                    </span>
                    <span className="cell-sub">
                      {s.count} ({s.pct}%)
                    </span>
                  </div>
                  <div className="stage-bar-track">
                    <div className={`stage-bar-fill stage-bar-${s.color}`} style={{ width: `${s.pct}%`, opacity: stageFilter === "All" || stageFilter === s.stage ? 1 : 0.35 }} />
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
                <div
                  className="kv"
                  key={s.stage}
                  onClick={() => setStageFilter(stageFilter === s.stage ? "All" : s.stage)}
                  style={{ cursor: "pointer" }}
                  title={`Show ${s.stage} projects`}
                >
                  <span style={{ color: stageFilter === s.stage ? "var(--blue)" : undefined, fontWeight: stageFilter === s.stage ? 700 : undefined }}>
                    {s.stage}{stageFilter === s.stage ? " ▸" : ""}
                  </span>
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
