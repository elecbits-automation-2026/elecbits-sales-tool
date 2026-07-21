import { useState } from "react";
import { PlusCircle, Sparkles, ArrowRight, AlertTriangle, Loader2, FileText, ChevronLeft, LayoutGrid } from "lucide-react";
import { belongsToDept, uid } from "../lib/helpers";
import { callClaude } from "../lib/ai";
import { Chip, Field } from "../components/ui";

const TASK_STATUSES = ["To Do", "In Progress", "Done"];

export function TaskManager({ tasks, projects, clients, users, workUpdates, userId, userName, department, tier, onCreate, onUpdate }) {
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
