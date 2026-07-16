// Vercel serverless function — admin user management.
// Creates / deletes / updates Supabase Auth accounts so that users added through
// the in-app "Employees" screen can actually log in. Uses the service-role key,
// which must NEVER reach the browser — this runs server-side only.
//
// Every request must carry the caller's Supabase access token as a Bearer token;
// the function verifies the caller is a "Main Admin" (from the crm-users
// collection) before doing anything.
//
// Env vars (Vercel project settings, server-only):
//   SUPABASE_URL                 (required — same project URL, no VITE_ prefix)
//   SUPABASE_SERVICE_ROLE_KEY    (required — secret; full admin access)

import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// Find a Supabase auth user id by email (used when a profile has no stored authId).
async function findAuthIdByEmail(admin, email) {
  const target = String(email || "").toLowerCase();
  let page = 1;
  // Paginate through auth users (fine for a small internal team).
  // Stops when a page returns fewer than perPage rows.
  const perPage = 200;
  for (let i = 0; i < 25; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data || !data.users || data.users.length === 0) return null;
    const match = data.users.find((u) => (u.email || "").toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const admin = getAdminClient();
  if (!admin) {
    res.status(500).json({ error: "Admin API not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." });
    return;
  }

  // --- Authenticate the caller ---
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !callerData || !callerData.user) {
    res.status(401).json({ error: "Invalid session." });
    return;
  }
  const callerEmail = (callerData.user.email || "").toLowerCase();

  // --- Authorize: caller must be a Main Admin in the crm-users collection ---
  const { data: coll, error: collErr } = await admin
    .from("collections")
    .select("data")
    .eq("key", "crm-users")
    .maybeSingle();
  if (collErr) {
    res.status(500).json({ error: "Could not verify permissions." });
    return;
  }
  const users = coll && Array.isArray(coll.data) ? coll.data : [];
  const callerProfile = users.find((u) => (u.email || "").toLowerCase() === callerEmail);
  if (!callerProfile || callerProfile.tier !== "Main Admin") {
    res.status(403).json({ error: "Only a Main Admin can manage logins." });
    return;
  }

  const { action, email, password, authId } = req.body || {};

  try {
    if (action === "create") {
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required." });
        return;
      }
      const { data, error } = await admin.auth.admin.createUser({
        email: String(email).toLowerCase(),
        password,
        email_confirm: true,
      });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(200).json({ ok: true, authId: data.user.id });
      return;
    }

    if (action === "delete") {
      let id = authId;
      if (!id && email) id = await findAuthIdByEmail(admin, email);
      if (!id) {
        // Nothing to delete on the auth side (e.g. a seeded demo user). Not an error.
        res.status(200).json({ ok: true, note: "No auth account found to remove." });
        return;
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "setPassword") {
      let id = authId;
      if (!id && email) id = await findAuthIdByEmail(admin, email);
      if (!id) {
        res.status(404).json({ error: "No auth account found for that user." });
        return;
      }
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    console.error("admin handler threw:", e);
    res.status(500).json({ error: "Admin request failed." });
  }
}
