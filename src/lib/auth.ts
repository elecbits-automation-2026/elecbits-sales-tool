/* ─── AUTH ─────────────────────────────────────────────────────────────────
   Thin wrapper over Supabase Auth, lifted out of data.ts so the data layer is
   about data and this is about who is asking. Every call is a no-op or a
   readable failure when Supabase is unconfigured, so nothing here can be the
   reason the app shows a blank page.                                         */

import { supabase, supabaseEnabled } from "./supabase";
import { RPC } from "./tables";

export type AuthResult = { ok: boolean; error: string };

/** Current session, or null. Never throws. */
export async function getSession() {
  if (!supabaseEnabled) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

/** Subscribe to sign-in / sign-out. Returns something with .unsubscribe(). */
export function onAuthChange(cb: (session: any, event?: string) => void) {
  if (!supabaseEnabled) return { unsubscribe() {} };
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(session, event));
  return data.subscription;
}

// Onboarding pattern shared with the PMS: sign in; if the account does not
// exist yet, the first sign-in creates it, and the DB trigger adopts the
// person's roster row by email (an email nobody rostered authenticates into
// a fresh engineer row and sees NoProfile).
export async function signInOrUp(email: string, password: string): Promise<AuthResult> {
  if (!supabaseEnabled) return { ok: false, error: "Supabase is not configured." };
  const em = email.trim().toLowerCase();
  const s1 = await supabase.auth.signInWithPassword({ email: em, password });
  if (!s1.error) return { ok: true, error: "" };
  const msg = (s1.error.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) {
    const s2 = await supabase.auth.signUp({ email: em, password });
    if (!s2.error) {
      if (s2.data.session) return { ok: true, error: "" };
      return { ok: false, error: "Account created but email confirmation is on. In Supabase: Authentication → Providers → Email → turn off 'Confirm email', then sign in again." };
    }
    const m2 = (s2.error.message || "").toLowerCase();
    if (m2.includes("already registered"))
      return { ok: false, error: "Wrong password for this email." };
    return { ok: false, error: s2.error.message };
  }
  if (msg.includes("email not confirmed"))
    return { ok: false, error: "This account needs email confirmation turned off. In Supabase: Authentication → Providers → Email → 'Confirm email' → off." };
  return { ok: false, error: s1.error.message };
}

export async function signOut(): Promise<void> {
  try { await supabase.auth.signOut(); } catch { /* ignore */ }
}

export async function currentAuthEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.email?.toLowerCase() || null;
  } catch {
    return null;
  }
}

// First signed-in user on an empty sales roster enrols themself as admin —
// the RPC allows exactly that one case without a sales admin behind it.
export async function bootstrapFirstAdmin(name?: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    if (!u?.email) return;
    await supabase.rpc(RPC.upsertPerson, {
      p_id: null,
      p_name: name || u.email.split("@")[0],
      p_email: u.email.toLowerCase(),
      p_role: "admin",
      p_dept: "Management",
      p_active: true,
    });
  } catch { /* ignore */ }
}
