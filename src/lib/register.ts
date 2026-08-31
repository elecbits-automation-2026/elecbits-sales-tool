/* ─── THE MASTER REGISTER ──────────────────────────────────────────────────
   The one place that knows the shape of /api/register — the Eb-Master_Register
   Google Sheet (Clients + Deals tabs) plus the client/deal Drive folders,
   filed in SOP order: register row BEFORE folder (Law 6), append → verify →
   repair, folder link written back into the row.

   Every call carries the signed-in person's Supabase JWT: /api/register
   refuses anonymous callers, because the register is the company-wide ID
   authority and even the peek feeds the mint's floor.

   Same contract as lib/drive.ts: every function resolves rather than throws.
   The durable record is the database row; the register and the folders are
   the company-wide paperwork, and a paperwork failure must never take a
   client save down with it. Callers read `warnings` and surface them.     */

import { supabase } from "./supabase";

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const t = data?.session?.access_token;
    return t ? { Authorization: "Bearer " + t } : {};
  } catch { return {}; }
}

const post = async (action: string, body: any): Promise<any> => {
  try {
    const r = await fetch("/api/register?action=" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch {
    return { ok: false, warnings: ["Could not reach /api/register"] };
  }
};

/** Is the register configured, and was the sheet found? */
export const registerStatus = async (): Promise<any> => {
  try {
    return await fetch("/api/register?action=status", { headers: await authHeaders() }).then((r) => r.json());
  } catch { return { connected: false }; }
};

/** The highest serial the register already holds this year — the floor the
    SOP mint must clear. Returns NULL when the sheet could not actually be
    read (network down, register not found): the caller must then refuse to
    mint blind rather than treat "couldn't look" as "sheet says zero" —
    that confusion is exactly how two tools issue the same serial. */
export async function registerPeek(family = "EB-C"): Promise<number | null> {
  try {
    const j = await fetch("/api/register?action=peek&family=" + encodeURIComponent(family),
      { headers: await authHeaders() }).then((r) => r.json());
    return j?.register === true ? (Number(j.max) || 0) : null;
  } catch { return null; }
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
