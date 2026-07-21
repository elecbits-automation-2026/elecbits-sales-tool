// Auth layer for the Sales tool. Mirrors the finance tool's login UX, adapted to
// the sales backend: user profiles live in the `crm-users` collection (a JSON
// blob) rather than a `profiles` table, and there are no server-side RPCs/edge
// functions. Sign-in, change-password and forgot-password run against Supabase
// Auth directly. Self-service signup records a PENDING profile that a Main Admin
// activates from the Employees screen. Google SSO is a placeholder until the
// provider is enabled on the sales Supabase project.
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { loadList } from "./storage";
import { uid } from "./helpers";

// Isolated, non-persistent client for auth operations that must NOT touch the
// app's shared session — signup and change-password. If they run on the shared
// client, signing in fires the app's onAuthStateChange, which navigates and can
// clear the session mid-operation (causing "Auth session missing!" on
// updateUser). This client also stays authenticated in-memory so the signup can
// write its pending crm-users row under RLS.
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
function isolatedClient() {
  return createClient(SB_URL, SB_ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Find a crm-users profile by email (case-insensitive).
async function profileByEmail(email: string) {
  const users = await loadList("crm-users");
  const target = email.toLowerCase();
  return (users as any[]).find((u) => (u.email || "").toLowerCase() === target) || null;
}

// Sign in with email + password. On success, gates on the crm-users profile the
// same way finance gates on profiles.status: a missing / pending / deactivated
// account is signed straight back out with a precise message.
export async function signIn(email: string, password: string) {
  const resolved = email.trim().toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({ email: resolved, password });
  if (error) return { success: false as const, error: "Invalid email or password." };

  const profile = await profileByEmail(resolved);
  if (!profile) {
    await supabase.auth.signOut();
    return { success: false as const, error: "No employee record is linked to this email. Ask your Main Admin to add you." };
  }
  if (profile.status === "pending") {
    await supabase.auth.signOut();
    return { success: false as const, error: "Your account is awaiting admin approval." };
  }
  if (profile.active === false) {
    await supabase.auth.signOut();
    return { success: false as const, error: "Your account has been deactivated. Please contact your Main Admin." };
  }
  return { success: true as const, user: profile };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Google Workspace SSO — placeholder. The button exists to match the finance
// login, but the Google provider isn't enabled on the sales Supabase project
// yet, so we show a clear message instead of a raw OAuth error. Once the provider
// is configured, replace the body with supabase.auth.signInWithOAuth({...}).
export async function signInWithGoogle() {
  return {
    success: false as const,
    error: "Google sign-in isn't enabled yet for the Sales tool. Please sign in with your email and password.",
  };
}

// "Reset" button: change the password when the user still knows their current
// one. Verify the old password by signing in with it, set the new password, then
// sign out so they re-authenticate (which re-runs the status gate in signIn()).
export async function changePassword(email: string, oldPassword: string, newPassword: string) {
  const resolved = email.trim().toLowerCase();
  if (newPassword.length < 6) return { success: false as const, error: "New password must be at least 6 characters." };
  if (newPassword === oldPassword) return { success: false as const, error: "New password must be different from the current one." };

  // Isolated client so verifying the old password doesn't disturb the app session.
  const client = isolatedClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email: resolved, password: oldPassword });
  if (signInErr) return { success: false as const, error: "Email or current password is incorrect." };

  const { error: updErr } = await client.auth.updateUser({ password: newPassword });
  await client.auth.signOut();
  if (updErr) return { success: false as const, error: updErr.message };
  return { success: true as const };
}

// "Forgot password" button: email the user a secure reset link (Supabase's
// built-in flow). Clicking it returns them to the app with a temporary recovery
// session, where they set a new password (see completePasswordRecovery). We
// always return the same generic success so the form can't probe which emails
// have accounts. (Requires the app's URL to be in Supabase Auth's redirect URLs.)
export async function forgotPassword(email: string) {
  const resolved = email.trim().toLowerCase();
  const { error } = await supabase.auth.resetPasswordForEmail(resolved, {
    redirectTo: window.location.origin,
  });
  // A genuinely bad address can surface an error; anything else we swallow so the
  // response is indistinguishable from "unknown email".
  if (error && !/rate limit/i.test(error.message)) {
    // Still return success to avoid account enumeration, but log for debugging.
    console.warn("forgotPassword:", error.message);
  }
  return { success: true as const };
}

// Final step of the forgot-password flow: the user arrived via the reset-link
// email and is in a temporary recovery session, so updateUser sets the new
// password directly. Sign out afterward so they log in fresh with it.
export async function completePasswordRecovery(newPassword: string) {
  if (newPassword.length < 6) return { success: false as const, error: "New password must be at least 6 characters." };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    await supabase.auth.signOut();
    return { success: false as const, error: error.message };
  }
  await supabase.auth.signOut();
  return { success: true as const };
}

// Self-service signup: create the Supabase Auth account (so the user's chosen
// password works once approved) and append a PENDING profile to crm-users for a
// Main Admin to activate + assign a role from the Employees screen.
//
// NOTE: this relies on the sales Supabase project having email confirmation
// DISABLED (Auth > Providers > Email), so signUp establishes a session
// immediately — the pending crm-users write is RLS-gated to authenticated users.
export async function signUp(opts: {
  email: string;
  password: string;
  name: string;
  dept?: string;
  designation?: string;
  employeeCode?: string;
}) {
  const email = opts.email.toLowerCase().trim();
  if (!opts.dept) return { success: false as const, error: "Please select your department." };

  // Isolated client: keeps the signup session off the app's shared client (so the
  // app doesn't try to log the pending user in) while staying authenticated
  // in-memory so the pending crm-users write passes RLS.
  const client = isolatedClient();
  const { data, error } = await client.auth.signUp({ email, password: opts.password });
  if (error) return { success: false as const, error: error.message };

  // With email-confirmation off, signUp returns a session; without it we can't
  // write to the RLS-protected collection.
  if (!data.session) {
    return { success: false as const, error: "Signup needs email confirmation to be disabled on the server. Please contact your admin." };
  }

  // Read/write crm-users on the authenticated isolated client (not loadList/
  // saveList, which use the shared — here anonymous — client and would be blocked).
  const { data: coll } = await client.from("collections").select("data").eq("key", "crm-users").maybeSingle();
  const users = (coll && Array.isArray(coll.data) ? coll.data : []) as any[];
  if (users.some((u) => (u.email || "").toLowerCase() === email)) {
    await client.auth.signOut();
    return { success: false as const, error: "An account with this email already exists. Try signing in instead." };
  }
  const code = (opts.employeeCode || "").trim().toUpperCase();
  if (code && users.some((u) => (u.employeeCode || "").toUpperCase() === code)) {
    await client.auth.signOut();
    return { success: false as const, error: "This Employee Code is already in use. Please use your own assigned code." };
  }

  const newUser = {
    id: uid(),
    name: opts.name,
    email,
    password: "", // auth handled by Supabase; not stored client-side for signups
    department: opts.dept,
    additionalDepartments: [],
    designation: opts.designation || "",
    employeeCode: code || "",
    tier: "User",
    active: false,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  const { error: wErr } = await client
    .from("collections")
    .upsert({ key: "crm-users", data: [...users, newUser], updated_at: new Date().toISOString() }, { onConflict: "key" });
  // Drop the pending user's session so they can't enter before an admin approves.
  await client.auth.signOut();
  if (wErr) return { success: false as const, error: "Could not complete signup. Please try again." };
  return { success: true as const };
}
