// Shared UI primitives used across every page. Extracted from App.tsx so pages
// can live in their own files without importing back from App (which would be
// circular). Plain JS-in-TSX to match the rest of the codebase.
import React from "react";
import { Building2, Cpu, CheckCircle2, Ban } from "lucide-react";
import { STAGES, APPROVAL_GATES } from "../constants";

export function Chip({ children, tone = "default" }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function StageBadge({ stage }) {
  const tone = stage === "Won" ? "green" : stage === "Lost" ? "red" : "amber";
  return <Chip tone={tone}>{stage}</Chip>;
}

export function TypeBadge({ type }) {
  return (
    <span className="type-badge">
      {type === "Box Build" ? <Building2 size={12} /> : <Cpu size={12} />}
      {type}
    </span>
  );
}

export function Field({ label, children, hint }) {
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

// Stage stepper — the signature pipeline element.
export function StageStepper({ stage }) {
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
