import { Users } from "lucide-react";
import { roleTone, tierLabel, roleLabel } from "../lib/helpers";
import { Chip } from "../components/ui";

export function Profile({ users, userId, userName, department, tier }) {
  const me = (users || []).find((u) => u.id === userId);
  const initials = (userName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const documents = [
    { label: "Offer Letter" },
    { label: "ID Proof" },
    { label: "Tax Documents" },
    { label: "Payslips" },
  ];

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>My Profile</h1>
          <p className="view-sub">Personal details and documents</p>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="topbar-avatar" style={{ width: 52, height: 52, fontSize: 18 }}>{initials}</div>
          <div>
            <h2 style={{ margin: 0 }}>{userName}</h2>
            <Chip tone={roleTone(department, tier)}>{roleLabel(department, tier)}</Chip>
          </div>
        </div>
        <div className="kv" style={{ marginTop: 16 }}>
          <span>Email</span>
          <span className="mono">{me?.email || "—"}</span>
        </div>
        <div className="kv">
          <span>Department</span>
          <span>{department || "—"}</span>
        </div>
        <div className="kv">
          <span>Tier</span>
          <span>{tierLabel(tier)}</span>
        </div>
        <p className="field-hint" style={{ marginTop: 10 }}>
          To update these details, contact your Main Admin on the Users page.
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">Documents</h3>
        <p className="field-hint" style={{ marginBottom: 10 }}>
          This section will link to the HR Employee Data Portal — not connected yet.
        </p>
        <ul className="stake-list">
          {documents.map((d) => (
            <li key={d.label}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="cell-primary">{d.label}</span>
                <Chip>Not available yet</Chip>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
