import { useState, useEffect } from "react";
import { CheckCircle2, FileText } from "lucide-react";
import { uid, timeAgo } from "../lib/helpers";
import { Field, EmptyState } from "../components/ui";

export function WorkUpdates({ updates, userId, userName, department, tier, onCreate }) {
  const [summary, setSummary] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState("");
  const [justAddedId, setJustAddedId] = useState(null);

  const isMainAdmin = tier === "Main Admin";

  const visible = updates.filter((u) => {
    if (isMainAdmin) return true;
    if (tier === "Manager") return u.department === department;
    return u.userId === userId;
  });

  function submit(e) {
    e.preventDefault();
    if (!summary.trim()) return;
    const newEntry = {
      id: uid(),
      userId,
      userName,
      department,
      tier,
      date,
      hours: hours ? parseFloat(hours) : null,
      summary: summary.trim(),
      createdAt: new Date().toISOString(),
    };
    onCreate(newEntry);
    setSummary("");
    setHours("");
    setJustAddedId(newEntry.id);
  }

  useEffect(() => {
    if (!justAddedId) return;
    const el = document.getElementById(`update-${justAddedId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setJustAddedId(null), 2500);
    return () => clearTimeout(t);
  }, [justAddedId, updates]);

  const grouped = Object.values(
    visible
      .slice()
      .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
      .reduce((acc, u) => {
        if (!acc[u.date]) acc[u.date] = { date: u.date, entries: [] };
        acc[u.date].entries.push(u);
        return acc;
      }, {})
  ).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="view">
      <div className="view-header">
        <div>
          <h1>Work Updates</h1>
          <p className="view-sub">
            {isMainAdmin
              ? "Showing updates from everyone"
              : tier === "Manager"
              ? `Showing updates from your ${department} team`
              : "Showing your own updates"}
          </p>
        </div>
      </div>

      <form className="panel form-panel" onSubmit={submit}>
        <h3 className="panel-title">Log today's update</h3>
        <div className="grid-2">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Hours spent (optional)">
            <input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 6.5" />
          </Field>
        </div>
        <Field label="What did you work on?">
          <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summarize today's work…" />
        </Field>
        <div className="form-actions">
          {justAddedId && (
            <span className="inline-warning" style={{ color: "var(--green)" }}>
              <CheckCircle2 size={13} /> Update added — see it highlighted below.
            </span>
          )}
          <button className="btn btn-primary" type="submit" style={{ marginLeft: "auto" }}>
            Add update
          </button>
        </div>
      </form>

      {grouped.length === 0 ? (
        <EmptyState icon={FileText} title="No updates yet" body="Once entries are logged, they'll show up here." />
      ) : (
        grouped.map((g) => (
          <div className="panel" key={g.date}>
            <h3 className="panel-title">{new Date(g.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</h3>
            <div className="note-list">
              {g.entries.map((e) => (
                <div className={`note-card ${e.id === justAddedId ? "note-card-new" : ""}`} id={`update-${e.id}`} key={e.id}>
                  <div className="note-meta">
                    <span>
                      {e.userName}
                      {!isMainAdmin && tier !== "Manager" ? "" : ` · ${e.department}`}
                      {e.hours ? ` · ${e.hours}h` : ""}
                    </span>
                    <span>{e.id === justAddedId ? "Just now" : timeAgo(e.createdAt)}</span>
                  </div>
                  <div className="note-text">{e.summary}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
