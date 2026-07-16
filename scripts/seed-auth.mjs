// Seed the Supabase Auth accounts for the demo/test users.
//
// The app resolves each user's profile (name, tier, department) from the
// crm-users collection, which it seeds on first login. But those users can only
// log in if a matching Supabase Auth account exists — and creating auth accounts
// needs the service-role key, which must stay server-side. So this one-time
// script creates them.
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

// Must match the emails + passwords in src/constants.ts → DEFAULT_USERS.
const USERS = [
  { email: "sam.okafor@elecbits.in", password: "admin123" },
  { email: "alex.rao@elecbits.in", password: "sales123" },
  { email: "jamie.lin@elecbits.in", password: "salesuser123" },
  { email: "priya.menon@elecbits.in", password: "finance123" },
  { email: "omar.siddiqui@elecbits.in", password: "financeuser123" },
  { email: "dana.fox@elecbits.in", password: "boxbuild123" },
  { email: "ravi.chandran@elecbits.in", password: "boxbuilduser123" },
  { email: "leo.tanaka@elecbits.in", password: "odm123" },
  { email: "yuki.sato@elecbits.in", password: "odmuser123" },
  { email: "mira.hassan@elecbits.in", password: "hr123" },
  { email: "grace.lin@elecbits.in", password: "hruser123" },
  { email: "theo.brandt@elecbits.in", password: "product123" },
  { email: "isla.wong@elecbits.in", password: "productuser123" },
  { email: "nina.osei@elecbits.in", password: "marketing123" },
  { email: "marco.diaz@elecbits.in", password: "marketinguser123" },
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
