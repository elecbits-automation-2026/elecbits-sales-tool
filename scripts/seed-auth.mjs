// Seed the Supabase Auth accounts for the demo/test users.
//
// The app resolves each user's profile (name, role, department) from the
// sales:users collection, which it seeds on first login. But those users can
// only log in if a matching Supabase Auth account exists — and creating auth
// accounts needs the service-role key, which must stay server-side. So this
// one-time script creates them.
//
// The emails below must match the `email` values in seedData().users in
// src/App.tsx, so the app can map a signed-in email to its profile.
//
// Run once, after creating the Supabase project and running supabase/schema.sql:
//
//   node --env-file=.env.local scripts/seed-auth.mjs
//
// Requires in .env.local (or the environment):
//   SUPABASE_URL                = https://YOUR-PROJECT.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = <service role key — secret>
//
// Idempotent: re-running skips users that already exist.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with:  node --env-file=.env.local scripts/seed-auth.mjs"
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// Must match the emails in seedData().users (src/App.tsx). These are demo
// passwords — change them (or reset via Admin → Edit user) before real use.
const USERS = [
  { email: "admin@elecbits.in", password: "admin123" },
  { email: "saurav@elecbits.in", password: "saurav123" },
  { email: "ankit@elecbits.in", password: "ankit123" },
  { email: "akash@elecbits.in", password: "akash123" },
  { email: "finance@elecbits.in", password: "finance123" },
];

let created = 0;
let skipped = 0;
let failed = 0;

for (const u of USERS) {
  const { error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
  });
  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      console.log(`• skip   ${u.email} (already exists)`);
      skipped += 1;
    } else {
      console.error(`✗ fail   ${u.email}: ${error.message}`);
      failed += 1;
    }
  } else {
    console.log(`✓ create ${u.email}`);
    created += 1;
  }
}

console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
