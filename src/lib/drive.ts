/* ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────
   The one place that knows the shape of /api/drive. Nine raw fetches were
   spread through App.tsx, each rebuilding the same query string by hand and
   each with its own idea of what to do when the call failed. A change to the
   proxy's contract meant finding all nine.

   Every function here resolves rather than throws: Drive is a best-effort
   integration, and a filing failure must never take a save down with it. The
   caller checks the returned shape.

   The serverless side is api/drive.js — one folder per company under a shared
   root, service-account authenticated. Until DRIVE_ROOT_FOLDER_ID and
   GOOGLE_SERVICE_ACCOUNT_JSON are set, `status()` reports not-connected and
   the UI shows its "not connected" card.                                     */

/** A company's Drive folder name: "Eb-12-ML-0007 — Acme Ltd" (id when official). */
export const driveFolderName = (c: any): string =>
  (c?.cid ? c.cid + " — " : "") + (c?.name ?? "");

const get = async (params: Record<string, string>): Promise<any> => {
  const p = new URLSearchParams(params);
  try {
    const r = await fetch("/api/drive?" + p.toString());
    return await r.json();
  } catch {
    return { error: "Could not reach /api/drive" };
  }
};

/** Is the Drive integration configured and reachable? */
export const status = () => get({ action: "status" });

/** Top-level folders under the shared root. */
export const root = () => get({ action: "root" });

/** One folder's files and sub-folders. Find-or-create is `open`, not this. */
export const list = (name: string) => get({ action: "list", name });

/** A folder plus one level inside each of its sub-folders. */
export const deep = (name: string) => get({ action: "deep", name });

/** Find files by name anywhere under the root. */
export const search = (q: string) => get({ action: "search", q });

/** Find-or-create a company's folder; returns { id, link }. */
export const open = (name: string) => get({ action: "open", name });

/** Does `file` exist in this company's folder? Used by the task-close gate. */
export const verify = (name: string, file: string) =>
  get({ action: "verify", name, file });

/** File a note into a company's folder. Best-effort: never throws, never
    reports. The durable record is the database row; this is the copy a human
    goes looking for in Drive. */
export async function write(
  name: string, folder: string, fileName: string, content: string
): Promise<boolean> {
  try {
    const r = await fetch("/api/drive?action=write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder, fileName, content }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/* ── the AI's view of Drive ──────────────────────────────────────────────
   The assistant can ask for a listing mid-answer by emitting one DRIVE_JSON
   line. `runTool` executes that request and hands back the raw listing,
   capped so a huge folder cannot blow the next prompt's token budget. */

export async function runTool(spec: any): Promise<string> {
  const params: Record<string, string> = { action: spec?.action || "root" };
  if (spec?.name) params.name = spec.name;
  if (spec?.q) params.q = spec.q;
  const r = await get(params);
  return JSON.stringify(r).slice(0, 12000);
}

export const TOOL_PROMPT = [
  "GOOGLE DRIVE: you CAN read the sales Drive (folder and file listings — names, dates, links; not the contents of files).",
  "To look something up, reply with ONLY one line and nothing else:",
  '  DRIVE_JSON {"action":"root"}                        top-level folders',
  '  DRIVE_JSON {"action":"list","name":"<folder>"}   that folder\'s files AND sub-folders',
  '  DRIVE_JSON {"action":"deep","name":"<folder>"}   that folder PLUS what is inside each sub-folder — use this when asked what is inside a set of folders',
  '  DRIVE_JSON {"action":"search","q":"<term>"}       find files by name anywhere',
  "Reading the result: `found:false` means no folder of that name is shared with this tool — say exactly that, do not call it empty. `folders` lists sub-folders; if `files` is empty but `folders` is not, the contents are one level deeper — run `deep` before concluding anything.",
  "NEVER report a folder as empty until you have looked inside its sub-folders. Never show raw DRIVE_JSON in a final answer.",
].join("\n");
