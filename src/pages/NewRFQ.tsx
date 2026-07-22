import { useState } from "react";
import { X, CheckCircle2, ArrowRight, ShieldCheck, Building2, Cpu, ChevronLeft, Loader2, FileText, AlertTriangle } from "lucide-react";
import { TYPES } from "../constants";
import { nextRfqId, uid } from "../lib/helpers";
import { uploadAttachment, removeAttachmentFile, formatSize } from "../lib/files";
import { Field } from "../components/ui";

/* New RFQ flow — Sales raises a Request for Quote against an approved client. */
export function NewRFQ({ clients, projects, userName, onCreateProject, onDone, onCancel }) {
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
  const [links, setLinks] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploadErr("");
    setUploading(true);
    const res = await uploadAttachment(file);
    setUploading(false);
    if (res.error) { setUploadErr(res.error); return; }
    setLinks((prev) => [...prev, { id: uid(), ...res.file, by: userName, at: new Date().toISOString() }]);
  }

  function removeLink(l) {
    setLinks(links.filter((x) => x.id !== l.id));
    removeAttachmentFile(l.path);
  }

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
      attachments: links, // link-only attachments added during creation
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

            <div className="field">
              <span className="field-label">Attachments</span>
              <span className="field-hint">Upload spec sheets, drawings, BOMs, or quotes — files go to Supabase Storage; the RFQ keeps the link.</span>
              {links.length > 0 && (
                <ul className="stake-list" style={{ margin: "6px 0" }}>
                  {links.map((l) => (
                    <li key={l.id}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="cell-primary" style={{ wordBreak: "break-all" }}>{l.name}</a>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                          <span className="cell-sub">{formatSize(l.size)}</span>
                          <button type="button" className="icon-btn" onClick={() => removeLink(l)} title="Remove"><X size={14} /></button>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <label className="btn btn-secondary btn-sm" style={{ cursor: uploading ? "default" : "pointer", width: "fit-content" }}>
                {uploading ? <Loader2 size={13} className="spin" /> : <FileText size={13} />}
                {uploading ? " Uploading…" : " Upload file"}
                <input type="file" style={{ display: "none" }} onChange={handleFile} disabled={uploading} />
              </label>
              {uploadErr && <div className="inline-warning" style={{ marginTop: 8 }}><AlertTriangle size={13} /> {uploadErr}</div>}
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
