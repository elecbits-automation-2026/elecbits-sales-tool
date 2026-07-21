// Seed the Supabase Auth account for the ONE bootstrap Main Admin.
//
// All other users are created dynamically in-app (Employees screen -> /api/admin
// provisions their Supabase Auth login). But the very first admin has to exist
// before anyone can log in, and creating an auth account needs the service-role
// key (server-side only). So this one-time script creates that bootstrap admin.
//
// The app seeds the matching crm-users profile (Main Admin) on first run from
// VITE_BOOTSTRAP_ADMIN_EMAIL, so the email here MUST match that.
//
// Run once, after creating the Supabase project and running supabase/schema.sql:
//
//   node --env-file=.env.local scripts/seed-auth.mjs
//
// Requires in .env.local (or the environment):
//   SUPABASE_URL                = https://YOUR-PROJECT.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = <service role key — secret>
//   BOOTSTRAP_ADMIN_EMAIL       = admin's @elecbits.in email (matches VITE_BOOTSTRAP_ADMIN_EMAIL)
//   BOOTSTRAP_ADMIN_PASSWORD    = the admin's initial password
//
// Idempotent: re-running skips the admin if it already exists.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!url || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with:  node --env-file=.env.local scripts/seed-auth.mjs"
  );
  process.exit(1);
}

if (!adminEmail || !adminPassword) {
  console.error(
    "Missing BOOTSTRAP_ADMIN_EMAIL and/or BOOTSTRAP_ADMIN_PASSWORD in .env.local.\n" +
      "These define the single bootstrap Main Admin. The email must match\n" +
      "VITE_BOOTSTRAP_ADMIN_EMAIL so the in-app profile lines up."
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { error } = await admin.auth.admin.createUser({
  email: adminEmail,
  password: adminPassword,
  email_confirm: true,
});

if (error) {
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
    console.log(`• skip   ${adminEmail} (already exists)`);
    console.log("\nDone. Bootstrap admin already present.");
    process.exit(0);
  }
  console.error(`✗ fail   ${adminEmail}: ${error.message}`);
  process.exit(1);
}

console.log(`✓ create ${adminEmail} (bootstrap Main Admin)`);
console.log("\nDone. Log in as this admin, then add everyone else from the Employees screen.");
process.exit(0);
