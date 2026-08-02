import React from "react";
import { X } from "lucide-react";

/* Lightweight primitives shared by the Sales-OS feature modules. Kept separate
   from App.tsx's internal copies so each feature file is self-contained. */

export function Chip({ children, tone = "default" }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Field({ label, children, hint = null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="empty-state">
      <Icon size={28} strokeWidth={1.5} />
      <div className="empty-title">{title}</div>
      <div className="empty-body">{body}</div>
    </div>
  );
}

export function Modal({ title, icon: Icon, onClose, children, actions, wide = false }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 720 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{Icon && <Icon size={16} />} {title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
