/* ─── THE MASTER REGISTER ──────────────────────────────────────────────────
   The one place that knows the shape of /api/register — the Eb-Master_Register
   Google Sheet (Clients + Deals tabs) plus the client/deal Drive folders,
   filed in SOP order: register row BEFORE folder (Law 6), append → verify →
   repair, folder link written back into the row.

   Same contract as lib/drive.ts: every function resolves rather than throws.
   The durable record is the database row; the register and the folders are
   the company-wide paperwork, and a paperwork failure must never take a
   client save down with it. Callers read `warnings` and surface them.     */

const post = async (action: string, body: any): Promise<any> => {
  try {
    const r = await fetch("/api/register?action=" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return { ok: false, warnings: ["Could not reach /api/register"] };
  }
};

/** Is the register configured, and was the sheet found? */
export const registerStatus = async (): Promise<any> => {
  try { return await fetch("/api/register?action=status").then((r) => r.json()); }
  catch { return { connected: false }; }
};

/** The highest EB-C serial the register already holds this year — the floor
    the SOP mint must clear. 0 when the sheet is unreachable (the DB counter
    then stands alone, which is safe: it only ever moves up). */
export async function registerPeek(family = "EB-C"): Promise<number> {
  try {
    const j = await fetch("/api/register?action=peek&family=" + encodeURIComponent(family)).then((r) => r.json());
    return Number(j?.max) || 0;
  } catch { return 0; }
}

/** Client born: Clients-tab row, then the "<clientId> — <name>" folder,
    then the folder link back into the row. */
export const registerClient = (p: {
  clientId: string; legacyId?: string; name: string; sector?: string;
  orgSize?: string; status?: string; addedBy?: string; poc?: string; notes?: string;
}) => post("client", p);

/** Deal born: Deals-tab row, then the deal folder inside the client folder
    (seeded with the brief), then the link back into the row. */
export const registerDeal = (p: {
  dealId: string; clientId?: string; clientName?: string; dealName?: string;
  status?: string; value?: number | string; currency?: string; owner?: string;
  dateOpened?: string; notes?: string; brief?: string;
}) => post("deal", p);
