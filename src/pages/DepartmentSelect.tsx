import { Users, ShieldCheck, ChevronLeft, Zap } from "lucide-react";
import { DEPARTMENTS } from "../constants";
import { tierLabel, departmentIcon } from "../lib/helpers";

export function DepartmentSelect({ user, onSelect, onBack }) {
  const isMainAdmin = user.tier === "Main Admin";
  // Access is assigned by Main Admin on the Users page (department + additional departments).
  // Main Admin has standing access to every department, so all are offered.
  const myDepartments = isMainAdmin
    ? DEPARTMENTS
    : [user.department, ...(user.additionalDepartments || [])].filter(Boolean);

  return (
    <div className="login-screen">
      <div className="dept-select-card">
        <div className="login-brand" style={{ justifyContent: "center" }}>
          <Zap size={22} className="brand-bolt" fill="currentColor" />
          <span className="brand-text">Elecbits</span>
        </div>
        <p className="dept-select-sub">
          Signed in as <strong>{user.name}</strong> · {tierLabel(user.tier)}
        </p>
        <h1 className="login-heading" style={{ textAlign: "center" }}>Choose a department</h1>
        <p className="login-sub" style={{ textAlign: "center" }}>
          You'll only see departments you've been given access to — Main Admin assigns this on the Users page.
        </p>

        <div className="dept-select-grid">
          {isMainAdmin && (
            <button className="dept-select-btn dept-select-btn-admin" onClick={() => onSelect(null)}>
              <ShieldCheck size={22} />
              <span>All Departments</span>
              <span className="dept-select-btn-sub">Main Admin view</span>
            </button>
          )}
          {myDepartments.map((d) => {
            const Icon = departmentIcon(d);
            return (
              <button className="dept-select-btn" key={d} onClick={() => onSelect(d)}>
                <Icon size={22} />
                <span>{d}</span>
                <span className="dept-select-btn-sub">
                  {isMainAdmin ? "Full access" : d === user.department ? "Primary" : "Additional access"}
                </span>
              </button>
            );
          })}
        </div>

        {myDepartments.length === 0 && !isMainAdmin && (
          <p className="field-hint" style={{ textAlign: "center" }}>
            You don't have any department access yet — contact your Main Admin.
          </p>
        )}

        <button className="back-link" style={{ margin: "18px auto 0", justifyContent: "center" }} onClick={onBack}>
          <ChevronLeft size={14} /> Sign in as someone else
        </button>
      </div>
    </div>
  );
}
