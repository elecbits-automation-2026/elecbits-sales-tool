import { Building2, Clock, FileText, RefreshCw } from "lucide-react";
import { roleTone, tierLabel, belongsToDept } from "../lib/helpers";
import { Chip } from "../components/ui";

export function Reports({ clients, projects, users }) {
  const salesTeam = (users || []).filter((u) => belongsToDept(u, "Sales"));

  const rows = salesTeam.map((m) => {
    const clientsAdded = clients.filter((c) => c.createdBy === m.name).length;
    const leadsCreated = projects.filter((p) => p.createdBy === m.name).length;
    const callsMade = projects.reduce((sum, p) => sum + (p.callLogs || []).filter((c) => c.by === m.name).length, 0);
    const stageChanges = projects.reduce((sum, p) => sum + (p.history || []).filter((h) => h.by === m.name).length, 0);
    return { ...m, clientsAdded, leadsCreated, callsMade, stageChanges };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      clientsAdded: acc.clientsAdded + r.clientsAdded,
      leadsCreated: acc.leadsCreated + r.leadsCreated,
      callsMade: acc.callsMade + r.callsMade,
      stageChanges: acc.stageChanges + r.stageChanges,
    }),
    { clientsAdded: 0, leadsCreated: 0, callsMade: 0, stageChanges: 0 }
  );

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Reports</h1>
          <p className="view-sub">Per-rep activity across the Sales team.</p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-blue"><Building2 size={15} /></span></div>
          <div className="stat-label">Clients Added</div>
          <div className="stat-value">{totals.clientsAdded}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-purple"><FileText size={15} /></span></div>
          <div className="stat-label">Leads Created</div>
          <div className="stat-value">{totals.leadsCreated}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-amber"><Clock size={15} /></span></div>
          <div className="stat-label">Calls Made</div>
          <div className="stat-value">{totals.callsMade}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><span className="stat-icon-badge stat-icon-green"><RefreshCw size={15} /></span></div>
          <div className="stat-label">Stage Changes</div>
          <div className="stat-value">{totals.stageChanges}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Tier</th>
              <th>Clients Added</th>
              <th>Leads Created</th>
              <th>Calls Made</th>
              <th>Stage Changes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="field-hint" style={{ padding: 16 }}>
                  No Sales team members yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="cell-primary">{r.name}</td>
                  <td><Chip tone={roleTone(r.department, r.tier)}>{tierLabel(r.tier)}</Chip></td>
                  <td className="mono">{r.clientsAdded}</td>
                  <td className="mono">{r.leadsCreated}</td>
                  <td className="mono">{r.callsMade}</td>
                  <td className="mono">{r.stageChanges}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
