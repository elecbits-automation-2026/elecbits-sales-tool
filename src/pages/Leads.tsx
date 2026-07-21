import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { findMatchingClient, timeAgo } from "../lib/helpers";
import { Chip, Field } from "../components/ui";

const EMPTY_LEAD_FORM = { name: "", company: "", email: "", phone: "", notes: "" };

export function Leads({ leads, clients, userName, tier, onSubmitLead, onApproveLead, onRejectLead }) {
  const [form, setForm] = useState(EMPTY_LEAD_FORM);
  const [rejecting, setRejecting] = useState(null); // lead id currently showing a reject reason field
  const [rejectReason, setRejectReason] = useState("");

  // Before an RFQ reaches Dept Review, lead approval is open: whoever creates a
  // lead approves it (auto-approved on submit), and anyone here can clear a
  // pending one. The real gating starts at Dept Review.
  const canApprove = true;
  const pending = leads.filter((l) => l.status === "Pending");
  const mine = leads.filter((l) => l.submittedBy === userName);

  function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    onSubmitLead({ ...form }, true); // whoever creates the lead approves it
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
