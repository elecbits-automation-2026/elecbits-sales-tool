/* ─── LOGINS ───────────────────────────────────────────────────────────────
   Creating, resetting and revoking a teammate's access. Everything here goes
   through /api/admin-users, which holds the service-role key — the key that
   bypasses every row-level policy in the database and must never reach a
   browser.

   The distinction that matters, and the reason `revoke` exists:

     deactivate   a roster flag. They vanish from the UI and `me` resolves to
                  null, so they see NoProfile. Their SESSION is still valid,
                  and every sales table is readable by any authenticated user
                  — so they can still read the whole database directly.
     revoke       the login is deleted. The session dies with it. This is the
                  one that actually removes access.

   Deactivate for someone on leave or moved to another team. Revoke for
   someone who has left. The roster row survives either way, because their
   name is on deals, tasks and scrum notes.                                  */

import { supabase } from "./supabase";

export type ProvisionResult = { ok?: boolean; created?: boolean; error?: string };
export type RevokeResult = { ok?: boolean; deleted?: boolean; note?: string; error?: string };

/** Is login management configured? Needs no session. */
export async function status(): Promise<{ connected: boolean; reason?: string }> {
  try {
    const r = await fetch("/api/admin-users?action=status");
    return await r.json();
  } catch {
    return { connected: false, reason: "Could not reach /api/admin-users" };
  }
}

async function post(payload: Record<string, unknown>): Promise<any> {
  let token = "";
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || "";
  } catch { /* the function rejects an unsigned caller itself */ }
  try {
    const r = await fetch("/api/admin-users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch {
    return { error: "Could not reach /api/admin-users" };
  }
}

/** Create a login, or reset an existing one to this password. */
export function provision(email: string, password: string, name?: string): Promise<ProvisionResult> {
  return post({ action: "create", email, password, name });
}

/** Delete the login outright. The roster entry is kept and unlinked.
    Refused for your own account, and for the last admin who can sign in. */
export function revoke(email: string): Promise<RevokeResult> {
  return post({ action: "delete", email });
}

/** A password that satisfies the 8-character minimum and is awkward to guess.
    Shown once, to be handed over — never stored anywhere by this app. */
export function suggestPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}
