import React, { useState } from "react";
import {
  Building2, PlusCircle, Search, Phone, Mail, User, Trash2, X, ChevronLeft,
  AlertTriangle, CheckCircle2, Star, Briefcase,
} from "lucide-react";
import { Chip, Field, EmptyState } from "./ui";
import { uid, timeAgo } from "../lib/helpers";
import { nextCompanyId, companyIsIncomplete } from "./salesHelpers";
import { REQUIRED_COMPANY_FIELDS } from "./salesConfig";

const EMPTY_CONTACT = () => ({ id: uid(), name: "", role: "", phone: "", email: "", primary: false });
const EMPTY_DETAIL = () => ({ id: uid(), label: "", value: "" });

function emptyCompany(ownerName, department) {
  return {
    id: null,
    name: "",
    industry: "",
    whatTheyDo: "",
    website: "",
    address: "",
    gst: "",
    source: "",
    tags: "",
    contacts: [EMPTY_CONTACT()],
    details: [],
    ownerName,
    department,
  };
}

function CompanyForm({ initial, salesTeam, onSave, onCancel }) {
  const [c, setC] = useState(initial);
  const set = (patch) => setC({ ...c, ...patch });

  function setContact(id, patch) {
    set({ contacts: c.contacts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }
  function makePrimary(id) {
    set({ contacts: c.contacts.map((p) => ({ ...p, primary: p.id === id })) });
  }
  function setDetail(id, patch) {
    set({ details: c.details.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  }

  function submit(e) {
    e.preventDefault();
    if (!c.name.trim()) return;
    const cleanContacts = c.contacts.filter((p) => p.name.trim() || p.phone.trim() || p.email.trim());
    const cleanDetails = c.details.filter((d) => d.label.trim() || d.value.trim());
    onSave({ ...c, name: c.name.trim(), contacts: cleanContacts, details: cleanDetails });
  }

  return (
    <form className="panel form-panel" onSubmit={submit}>
      <h3 className="panel-title"><Building2 size={14} /> {c.id ? `Edit ${c.id}` : "New company"}</h3>
      <p className="field-hint" style={{ marginBottom: 10 }}>
        Capture everything now — a company flagged incomplete nags its owner until every key detail is filled.
      </p>
      <div className="grid-2">
        <Field label="Company name *">
          <input value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Northwind Devices Pvt Ltd" />
        </Field>
        <Field label="Industry *" hint={REQUIRED_COMPANY_FIELDS.includes("industry") ? "Required" : ""}>
          <input value={c.industry} onChange={(e) => set({ industry: e.target.value })} placeholder="Consumer IoT" />
        </Field>
      </div>
      <Field label="What does the company do? *" hint="Their business in a few sentences — feeds AI context on every deal.">
        <textarea rows={2} value={c.whatTheyDo} onChange={(e) => set({ whatTheyDo: e.target.value })} placeholder="Designs smart home hubs; needs contract manufacturing for their v2 board…" />
      </Field>
      <div className="grid-2">
        <Field label="Website"><input value={c.website} onChange={(e) => set({ website: e.target.value })} placeholder="northwind.com" /></Field>
        <Field label="Lead source"><input value={c.source} onChange={(e) => set({ source: e.target.value })} placeholder="Referral / LinkedIn / Expo…" /></Field>
      </div>
      <div className="grid-2">
        <Field label="Address"><input value={c.address} onChange={(e) => set({ address: e.target.value })} placeholder="City, State" /></Field>
        <Field label="GST / Reg no."><input value={c.gst} onChange={(e) => set({ gst: e.target.value })} placeholder="Optional" /></Field>
      </div>
      <div className="grid-2">
        <Field label="Owner">
          <select value={c.ownerName} onChange={(e) => set({ ownerName: e.target.value })}>
            {salesTeam.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Tags"><input value={c.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="Comma,separated" /></Field>
      </div>

      <div className="subhead-row">
        <span className="subhead"><User size={13} /> Contacts</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ contacts: [...c.contacts, EMPTY_CONTACT()] })}>
          <PlusCircle size={13} /> Add contact
        </button>
      </div>
      {c.contacts.map((p) => (
        <div className="contact-row" key={p.id}>
          <div className="grid-2">
            <input placeholder="Name" value={p.name} onChange={(e) => setContact(p.id, { name: e.target.value })} />
            <input placeholder="Role / designation" value={p.role} onChange={(e) => setContact(p.id, { role: e.target.value })} />
          </div>
          <div className="grid-2">
            <input placeholder="Phone" value={p.phone} onChange={(e) => setContact(p.id, { phone: e.target.value })} />
            <input placeholder="Email" value={p.email} onChange={(e) => setContact(p.id, { email: e.target.value })} />
          </div>
          <div className="contact-row-actions">
            <button type="button" className={`chip ${p.primary ? "chip-green" : "chip-default"}`} onClick={() => makePrimary(p.id)} title="Primary contact">
              <Star size={11} /> {p.primary ? "Primary" : "Make primary"}
            </button>
            {c.contacts.length > 1 && (
              <button type="button" className="icon-btn" onClick={() => set({ contacts: c.contacts.filter((x) => x.id !== p.id) })}><X size={14} /></button>
            )}
          </div>
        </div>
      ))}

      <div className="subhead-row">
        <span className="subhead"><Briefcase size={13} /> Additional details</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ details: [...c.details, EMPTY_DETAIL()] })}>
          <PlusCircle size={13} /> Add detail
        </button>
      </div>
      <p className="field-hint">Any custom field you need — decision process, competitors, budget cycle, plant location, anything.</p>
      {c.details.map((d) => (
        <div className="grid-2" key={d.id} style={{ marginBottom: 8 }}>
          <input placeholder="Label (e.g. Competitor)" value={d.label} onChange={(e) => setDetail(d.id, { label: e.target.value })} />
          <div style={{ display: "flex", gap: 6 }}>
            <input style={{ flex: 1 }} placeholder="Value" value={d.value} onChange={(e) => setDetail(d.id, { value: e.target.value })} />
            <button type="button" className="icon-btn" onClick={() => set({ details: c.details.filter((x) => x.id !== d.id) })}><X size={14} /></button>
          </div>
        </div>
      ))}

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" type="submit">{c.id ? "Save changes" : "Create company"}</button>
      </div>
    </form>
  );
}

function CompanyDetail({ company, deals, onEdit, onBack, onDelete, canEdit }) {
  const missing = companyIsIncomplete(company);
  const companyDeals = (deals || []).filter((d) => d.companyId === company.id);
  return (
    <div className="view">
      <button className="back-link" onClick={onBack}><ChevronLeft size={14} /> Companies</button>
      <div className="detail-header">
        <div>
          <div className="detail-ids">
            <span className="mono id-chip">{company.id}</span>
            {company.industry && <Chip tone="default">{company.industry}</Chip>}
            {missing.length === 0
              ? <Chip tone="green"><CheckCircle2 size={11} /> Complete</Chip>
              : <Chip tone="red"><AlertTriangle size={11} /> {missing.length} missing</Chip>}
          </div>
          <h1>{company.name}</h1>
          <p className="view-sub">Owner: {company.ownerName || "—"}</p>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" onClick={onEdit}>Edit</button>
            <button className="btn btn-danger" onClick={() => onDelete(company.id)}><Trash2 size={14} /> Delete</button>
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="save-error" style={{ position: "static", margin: "0 0 14px" }}>
          <AlertTriangle size={12} /> Missing: {missing.map((m) => (m === "contact" ? "a reachable contact" : m)).join(", ")}. Complete this record.
        </div>
      )}

      <div className="detail-grid">
        <div className="panel">
          <h3 className="panel-title">Overview</h3>
          <div className="kv"><span>What they do</span><span>{company.whatTheyDo || "—"}</span></div>
          <div className="kv"><span>Website</span><span>{company.website || "—"}</span></div>
          <div className="kv"><span>Address</span><span>{company.address || "—"}</span></div>
          <div className="kv"><span>GST / Reg</span><span className="mono">{company.gst || "—"}</span></div>
          <div className="kv"><span>Source</span><span>{company.source || "—"}</span></div>
          <div className="kv"><span>Added</span><span className="cell-sub">{company.createdAt ? timeAgo(company.createdAt) : "—"} by {company.createdBy || "—"}</span></div>
          {company.tags && <div className="employee-dept-chips" style={{ marginTop: 8 }}>{company.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => <span className="chip chip-default" key={t}>{t}</span>)}</div>}
        </div>
        <div className="panel">
          <h3 className="panel-title"><User size={14} /> Contacts</h3>
          {(company.contacts || []).length === 0 ? <p className="field-hint">No contacts — add one.</p> : (
            <ul className="stake-list">
              {company.contacts.map((p) => (
                <li key={p.id}>
                  <div className="cell-primary">{p.name} {p.primary && <Chip tone="green"><Star size={10} /> Primary</Chip>}</div>
                  <div className="cell-sub">{p.role || "—"}</div>
                  <div className="cell-sub" style={{ display: "flex", gap: 12, marginTop: 3 }}>
                    {p.phone && <span><Phone size={11} /> {p.phone}</span>}
                    {p.email && <span><Mail size={11} /> {p.email}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(company.details || []).length > 0 && (
        <div className="panel">
          <h3 className="panel-title"><Briefcase size={14} /> Additional details</h3>
          {company.details.map((d) => <div className="kv" key={d.id}><span>{d.label}</span><span>{d.value}</span></div>)}
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title">Deals ({companyDeals.length})</h3>
        {companyDeals.length === 0 ? <p className="field-hint">No deals for this company yet — open one from the Pipeline.</p> : (
          <ul className="stake-list">
            {companyDeals.map((d) => (
              <li key={d.id}><div style={{ display: "flex", justifyContent: "space-between" }}>
                <span><span className="mono id-chip subtle">{d.id}</span> {d.title}</span>
                <Chip tone={d.stage === "Won" ? "green" : d.stage === "Lost" ? "red" : "amber"}>{d.stage}</Chip>
              </div></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Companies({ companies, deals, users, userName, department, tier, onCreate, onSave, onDelete }) {
  const [mode, setMode] = useState("list"); // list | form | detail
  const [editing, setEditing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const isMainAdmin = tier === "Main Admin";
  const canManage = isMainAdmin || department === "Sales";
  const salesTeam = (users || []).filter((u) => u.department === "Sales" || (u.additionalDepartments || []).includes("Sales"));

  // Scope: admin sees all; Sales Manager sees all Sales companies; User sees own.
  const scoped = (companies || []).filter((c) => {
    if (isMainAdmin) return true;
    if (department === "Sales") return tier === "Manager" ? true : (c.ownerName === userName || c.createdBy === userName);
    return true; // other depts read-only
  });

  const visible = scoped.filter((c) => {
    if (onlyIncomplete && companyIsIncomplete(c).length === 0) return false;
    if (!q) return true;
    const hay = `${c.id} ${c.name} ${c.industry} ${c.whatTheyDo} ${(c.contacts || []).map((p) => p.name).join(" ")}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const selected = companies.find((c) => c.id === selectedId);
  const incompleteCount = scoped.filter((c) => companyIsIncomplete(c).length > 0).length;

  function handleSave(data) {
    if (data.id) {
      onSave({ ...data, updatedAt: new Date().toISOString() });
    } else {
      const now = new Date().toISOString();
      onCreate({ ...data, id: nextCompanyId(companies), createdBy: userName, createdAt: now, updatedAt: now });
    }
    setMode("list");
    setEditing(null);
  }

  if (mode === "form") {
    return (
      <div className="view">
        <div className="view-header"><div><h1>{editing ? "Edit company" : "New company"}</h1></div></div>
        <CompanyForm initial={editing || emptyCompany(userName, department)} salesTeam={salesTeam.length ? salesTeam : [{ id: "self", name: userName }]} onSave={handleSave} onCancel={() => { setMode(selected ? "detail" : "list"); setEditing(null); }} />
      </div>
    );
  }

  if (mode === "detail" && selected) {
    return <CompanyDetail company={selected} deals={deals} canEdit={canManage} onEdit={() => { setEditing(selected); setMode("form"); }} onBack={() => setMode("list")} onDelete={(id) => { onDelete(id); setMode("list"); }} />;
  }

  return (
    <div className="view">
      <div className="view-header">
        <div><h1>Companies</h1><p className="view-sub">{scoped.length} companies · {incompleteCount} need attention</p></div>
        {canManage && <button className="btn btn-primary" onClick={() => { setEditing(null); setMode("form"); }}><PlusCircle size={16} /> New company</button>}
      </div>

      <div className="toolbar">
        <div className="search-box"><Search size={14} /><input placeholder="Search name, industry, contact…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className={`quick-action ${onlyIncomplete ? "active" : ""}`} onClick={() => setOnlyIncomplete(!onlyIncomplete)}>
          <AlertTriangle size={14} /> Incomplete only
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Building2} title="No companies yet" body={canManage ? "Add your first company — capture every detail." : "No companies to show."} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Company</th><th>Industry</th><th>Primary contact</th><th>Owner</th><th>Status</th></tr></thead>
            <tbody>
              {visible.map((c) => {
                const missing = companyIsIncomplete(c);
                const primary = (c.contacts || []).find((p) => p.primary) || (c.contacts || [])[0];
                return (
                  <tr key={c.id} onClick={() => { setSelectedId(c.id); setMode("detail"); }}>
                    <td className="mono">{c.id}</td>
                    <td><div className="cell-primary">{c.name}</div><div className="cell-sub">{(c.whatTheyDo || "").slice(0, 40)}{(c.whatTheyDo || "").length > 40 ? "…" : ""}</div></td>
                    <td>{c.industry || "—"}</td>
                    <td>{primary ? <><div className="cell-primary">{primary.name}</div><div className="cell-sub">{primary.phone || primary.email || ""}</div></> : "—"}</td>
                    <td className="cell-sub">{c.ownerName || "—"}</td>
                    <td>{missing.length === 0 ? <Chip tone="green"><CheckCircle2 size={11} /> Complete</Chip> : <Chip tone="red"><AlertTriangle size={11} /> {missing.length}</Chip>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
