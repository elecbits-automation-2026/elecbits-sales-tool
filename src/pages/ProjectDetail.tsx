import { useState } from "react";
import { Building2, Cpu, Sparkles, CheckCircle2, XCircle, Clock, ArrowRight, AlertTriangle, Loader2, Users, FileText, ShieldCheck, History, X, ChevronLeft, Trophy, Ban, RefreshCw } from "lucide-react";
import { STAGES, APPROVAL_GATES, EXECUTION_DEPARTMENTS, BUDGET_VISIBLE_DEPARTMENTS } from "../constants";
import { roleLabel, belongsToDept, nextProjectId, uid, timeAgo } from "../lib/helpers";
import { callClaude } from "../lib/ai";
import { StageBadge, TypeBadge, Field, StageStepper } from "../components/ui";

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

// Log a call against the RFQ, capturing enough to justify/act on it later.
function CallModal({ onClose, onSave, userName }) {
  const [contact, setContact] = useState("");
  const [direction, setDirection] = useState("Outbound");
  const [outcome, setOutcome] = useState("Connected");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [error, setError] = useState("");

  function save() {
    if (!summary.trim()) { setError("Add a short summary of what was discussed."); return; }
    onSave({
      id: uid(),
      by: userName,
      at: new Date().toISOString(),
      contact: contact.trim(),
      direction,
      outcome,
      summary: summary.trim(),
      followUp: followUp || null,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Clock size={16} /> Log a call</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            <Field label="Contact person">
              <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Who you spoke with at the client" />
            </Field>
            <Field label="Direction">
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option>Outbound</option>
                <option>Inbound</option>
              </select>
            </Field>
          </div>
          <Field label="Outcome">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option>Connected</option>
              <option>No answer</option>
              <option>Left voicemail</option>
              <option>Follow-up scheduled</option>
              <option>Not interested</option>
            </select>
          </Field>
          <Field label="Summary">
            <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed — decisions, objections, requirements…" />
          </Field>
          <Field label="Next follow-up (optional)">
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </Field>
          {error && <div className="inline-warning"><AlertTriangle size={13} /> {error}</div>}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><Clock size={15} /> Save call</button>
        </div>
      </div>
    </div>
  );
}

export function ProjectDetail({ project, client, users, projects, department, tier, userName, onUpdate, onBack }) {
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
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
  // Project Manager: the assignee the dept head marks "Project Manager". After
  // Dept Review, the PM (with the dept head) owns the project's approvals.
  const pm = (project.assignees || []).find((a) => a.roleInProject === "Project Manager") || null;
  const isPM = !!pm && pm.name === userName;
  const isDeptHead = tier === "Manager" && department === project.department;
  // Dept Review is approved by the receiving dept head (or Admin) — but only once a
  // PM has been assigned (enforced on the button below). Every later gate
  // (Technical Review / Quotation / Approval) is approved by the PM or the dept
  // head (Admin always).
  const canApproveGate =
    project.stage === "Dept Review"
      ? isMainAdmin || isDeptHead
      : isMainAdmin || isPM || isDeptHead;
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
    // Only one Project Manager per project.
    if (assigneeForm.roleInProject === "Project Manager" && (project.assignees || []).some((a) => a.roleInProject === "Project Manager")) return;
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

  function saveCall(record) {
    patch({ callLogs: [...(project.callLogs || []), record] });
    setShowCallModal(false);
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
              project.stage === "Dept Review" && !pm ? (
                <div className="finance-note">
                  Assign a <strong>Project Manager</strong> to the team below before approving Dept Review — the PM takes over the project's approvals from here.
                </div>
              ) : (
                <button className="btn btn-secondary" onClick={() => setShowApprovalModal(true)}>
                  <ShieldCheck size={15} /> {project.stage === "Dept Review" ? `Review as ${department} head` : "Request approval to advance"}
                </button>
              )
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
                      {a.roleInProject === "Project Manager" ? (
                        <span className="chip chip-green" style={{ marginLeft: 6 }}>PM</span>
                      ) : (
                        a.roleInProject && <span className="cell-sub"> · {a.roleInProject}</span>
                      )}
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
              <select
                value={assigneeForm.roleInProject}
                onChange={(e) => setAssigneeForm({ ...assigneeForm, roleInProject: e.target.value })}
              >
                <option value="">Role in project…</option>
                <option value="Project Manager">Project Manager</option>
                <option value="Engineer">Engineer</option>
                <option value="Designer">Designer</option>
                <option value="QA">QA</option>
                <option value="Coordinator">Coordinator</option>
              </select>
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
                <button className="btn btn-secondary btn-sm" onClick={() => setShowCallModal(true)}>
                  <Clock size={12} /> Log a call
                </button>
              </span>
            </div>
          )}
        </div>

        {canLogCalls && (project.callLogs || []).length > 0 && (
          <div className="panel">
            <h3 className="panel-title">
              <Clock size={14} /> Call log
            </h3>
            <ul className="approval-list">
              {(project.callLogs || []).slice().reverse().map((c) => (
                <li key={c.id}>
                  <span className={`chip chip-${c.outcome === "Connected" ? "green" : c.outcome === "Not interested" ? "red" : "amber"}`}>
                    {c.outcome || "Logged"}
                  </span>
                  <span className="cell-sub">
                    {c.direction || "Call"}{c.contact ? ` · ${c.contact}` : ""} · {c.by} · {timeAgo(c.at)}
                  </span>
                  {c.summary && <div className="approval-comment">{c.summary}</div>}
                  {c.followUp && <div className="approval-comment">Follow-up: {c.followUp}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

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
      {showCallModal && (
        <CallModal userName={userName} onClose={() => setShowCallModal(false)} onSave={saveCall} />
      )}
    </div>
  );
}
