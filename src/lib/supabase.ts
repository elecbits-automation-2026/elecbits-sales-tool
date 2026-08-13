// Single shared Supabase client for the whole app (auth + data).
// Reads the project URL and anon key from Vite env vars (VITE_* → exposed to the
// browser; the anon key is public and gated by RLS via core.can()).
//
// Data lives in two Postgres schemas (both must be listed in Supabase →
// Settings → API → Exposed schemas):
//   sales — the tool's own tables (default schema for this client)
//   core  — the shared spine (people, orgs, memory, numbering)
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loud in dev/build rather than silently returning empty data at runtime.
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in."
  );
}

export const supabase = createClient(url, anonKey, {
  db: { schema: "sales" },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// The shared spine. Same client, same session — different schema.
export const core = supabase.schema("core");
