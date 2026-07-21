import { useState } from "react";
import { PlusCircle, Search, CheckCircle2, AlertTriangle, Users, X, Ban } from "lucide-react";
import { DEPARTMENTS, TIERS } from "../constants";
import { tierLabel, uid } from "../lib/helpers";
import { Chip, Field } from "../components/ui";

const EMPTY_USER_FORM = { id: null, name: "", email: "", password: "", department: "Sales", tier: "User" };

export function UserManagement({ users, currentUserId, onCreate, onSave, onDelete }) {
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
