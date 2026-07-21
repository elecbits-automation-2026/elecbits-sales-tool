import { CheckCircle2, Clock, AlertTriangle, FileText, ShieldCheck } from "lucide-react";

export function FinancePlaceholder() {
  const previewCards = [
    { label: "Total Payment Reqs", icon: FileText },
    { label: "Paid", icon: CheckCircle2 },
    { label: "Pending", icon: Clock },
    { label: "Active Budgets", icon: ShieldCheck },
  ];

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Finance</h1>
          <p className="view-sub">Budget · PO · Payment Management</p>
        </div>
      </div>

      <div className="panel not-connected-panel">
        <span className="stat-icon-badge stat-icon-amber" style={{ width: 40, height: 40 }}>
          <AlertTriangle size={18} />
        </span>
        <h3 style={{ margin: "10px 0 4px" }}>Not connected yet</h3>
        <p className="field-hint" style={{ maxWidth: 480, margin: "0 auto" }}>
          This tab is visible to everyone so the Finance module is easy to find once it's wired up. It isn't
          connected to live data yet — budgets, POs, and payments will appear here once that integration is in
          place.
        </p>
      </div>

      <div className="stat-row">
        {previewCards.map((c) => (
          <div className="stat-card" key={c.label} style={{ cursor: "default" }}>
            <div className="stat-card-top">
              <span className="stat-icon-badge"><c.icon size={15} /></span>
            </div>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value" style={{ color: "var(--text-faint)" }}>—</div>
          </div>
        ))}
      </div>
    </div>
  );
}
