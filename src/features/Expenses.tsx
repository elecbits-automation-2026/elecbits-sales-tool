import React, { useState } from "react";
import {
  Wallet, PlusCircle, CheckCircle2, XCircle, Clock, Plane, X, BadgeCheck,
} from "lucide-react";
import { Chip, Field, EmptyState } from "./ui";
import { timeAgo } from "../lib/helpers";
import { nextExpenseId } from "./salesHelpers";
import { EXPENSE_CATEGORIES } from "./salesConfig";

/* Expenses (feature 8). Sales staff / department heads raise travel & client
   expense requests; Main Admin and Finance approve, reject, and mark paid. */

const STATUS_TONE = { Pending: "amber", Approved: "green", Rejected: "red", Paid: "green" };

function RequestForm({ deals, companies, userName, department, onCancel, onSubmit }) {
  const [f, setF] = useState({
    category: EXPENSE_CATEGORIES[0], amount: "", purpose: "", dealId: "",
    travelFrom: "", travelTo: "", fromDate: "", toDate: "",
  });
  function submit(e) {
    e.preventDefault();
    if (!f.amount || !f.purpose.trim()) return;
    onSubmit(f);
  }
  return (
    <form className="panel form-panel" onSubmit={submit}>
      <h3 className="panel-title"><Plane size={14} /> New expense / travel request</h3>
      <div className="grid-2">
        <Field label="Category">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Amount (INR) *"><input type="number" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="12000" /></Field>
      </div>
      <Field label="Purpose *" hint="Why this spend is needed — tie it to a client / outcome."><textarea rows={2} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Visit Northwind plant in Pune to close the LLD sign-off." /></Field>
      <Field label="Related deal (optional)">
        <select value={f.dealId} onChange={(e) => setF({ ...f, dealId: e.target.value })}>
          <option value="">None</option>
          {(deals || []).map((d) => <option key={d.id} value={d.id}>{d.id} — {d.title}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Travel from"><input value={f.travelFrom} onChange={(e) => setF({ ...f, travelFrom: e.target.value })} placeholder="Bengaluru" /></Field>
        <Field label="Travel to"><input value={f.travelTo} onChange={(e) => setF({ ...f, travelTo: e.target.value })} placeholder="Pune" /></Field>
      </div>
      <div className="grid-2">
        <Field label="From date"><input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
        <Field label="To date"><input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" type="submit">Submit for approval</button>
      </div>
    </form>
  );
}

export function Expenses({ expenses, deals, companies, userName, userId, department, tier, onCreate, onUpdate }) {
  const [showForm, setShowForm] = useState(false);
  const [rejectId, setRejectId] = useState(null);
  const [rejectNote, setRejectNote] = useState("");

  const isMainAdmin = tier === "Main Admin";
  const isFinance = department === "Finance" || (isMainAdmin);
  const canApprove = isMainAdmin || department === "Finance";
  const dealById = Object.fromEntries((deals || []).map((d) => [d.id, d]));

  const mine = (expenses || []).filter((e) => e.requesterId === userId);
  const pending = (expenses || []).filter((e) => e.status === "Pending");
  const all = (expenses || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  function submit(f) {
    const now = new Date().toISOString();
    onCreate({
      id: nextExpenseId(expenses),
      requesterId: userId, requesterName: userName, department,
      category: f.category, amount: f.amount, purpose: f.purpose.trim(),
      dealId: f.dealId || null, travelFrom: f.travelFrom, travelTo: f.travelTo,
      fromDate: f.fromDate || null, toDate: f.toDate || null,
      status: "Pending", approver: null, decisionNote: "", createdAt: now, decidedAt: null,
    });
    setShowForm(false);
  }

  function decide(exp, status, note) {
    onUpdate({ ...exp, status, approver: userName, decisionNote: note || exp.decisionNote || "", decidedAt: new Date().toISOString() });
    setRejectId(null); setRejectNote("");
  }

  function ExpenseCard({ e, showActions }) {
    const deal = dealById[e.dealId];
    return (
      <li key={e.id}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div className="cell-primary"><span className="mono id-chip subtle">{e.id}</span> {e.category} · <span className="mono">₹{Number(e.amount).toLocaleString()}</span></div>
            <div className="cell-sub" style={{ marginTop: 3 }}>{e.purpose}</div>
            <div className="cell-sub" style={{ marginTop: 3 }}>
              {e.requesterName} · {e.department}
              {(e.travelFrom || e.travelTo) ? ` · ${e.travelFrom || "?"} → ${e.travelTo || "?"}` : ""}
              {e.fromDate ? ` · ${e.fromDate}${e.toDate ? `–${e.toDate}` : ""}` : ""}
              {deal ? ` · ${deal.id}` : ""} · {timeAgo(e.createdAt)}
            </div>
            {e.decisionNote && <div className="cell-sub" style={{ marginTop: 3 }}>Note: {e.decisionNote}</div>}
            {e.approver && <div className="cell-sub">By {e.approver} · {timeAgo(e.decidedAt)}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
            <Chip tone={STATUS_TONE[e.status]}>{e.status}</Chip>
            {showActions && e.status === "Pending" && (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={() => decide(e, "Approved")}><CheckCircle2 size={12} /> Approve</button>
                <button className="btn btn-danger btn-sm" onClick={() => setRejectId(rejectId === e.id ? null : e.id)}><XCircle size={12} /> Reject</button>
              </div>
            )}
            {showActions && e.status === "Approved" && (department === "Finance" || isMainAdmin) && (
              <button className="btn btn-secondary btn-sm" onClick={() => decide(e, "Paid")}><BadgeCheck size={12} /> Mark paid</button>
            )}
          </div>
        </div>
        {rejectId === e.id && (
          <div className="inline-form" style={{ marginTop: 8 }}>
            <input placeholder="Reason for rejection" value={rejectNote} onChange={(ev) => setRejectNote(ev.target.value)} />
            <button className="btn btn-danger btn-sm" onClick={() => decide(e, "Rejected", rejectNote)}>Confirm reject</button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="view">
      <div className="view-header">
        <div><h1>Expenses</h1><p className="view-sub">{canApprove ? "Approve travel & client expense requests" : "Raise travel & client expense requests for approval"}</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}><PlusCircle size={16} /> {showForm ? "Cancel" : "New request"}</button>
      </div>

      {showForm && <RequestForm deals={deals} companies={companies} userName={userName} department={department} onCancel={() => setShowForm(false)} onSubmit={submit} />}

      {canApprove && (
        <div className="panel">
          <div className="panel-title-row"><h3 className="panel-title"><Clock size={14} /> Pending approval</h3><Chip tone="amber">{pending.length}</Chip></div>
          {pending.length === 0 ? <p className="field-hint">Nothing waiting.</p> : <ul className="stake-list">{pending.map((e) => <ExpenseCard key={e.id} e={e} showActions />)}</ul>}
        </div>
      )}

      <div className="panel">
        <h3 className="panel-title"><Wallet size={14} /> {canApprove ? "All requests" : "My requests"}</h3>
        {(canApprove ? all : mine).length === 0 ? (
          <EmptyState icon={Wallet} title="No expense requests" body="Raise one when you need to travel or spend on a client." />
        ) : (
          <ul className="stake-list">{(canApprove ? all : mine).map((e) => <ExpenseCard key={e.id} e={e} showActions={canApprove} />)}</ul>
        )}
      </div>
    </div>
  );
}
