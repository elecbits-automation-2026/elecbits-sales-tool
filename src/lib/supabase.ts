// Single shared Supabase client for the whole app (auth + data).
//
// Robust init, in the ODM PMS pattern: auto-repair the most common env-var
// mistakes (surrounding quotes, whitespace, a trailing slash, the dashboard URL
// pasted instead of the API URL, a missing protocol). If the client still
// cannot start we do NOT throw at module scope — a throw here happens before
// React mounts and the user gets a white page with nothing to read. Instead we
// record why, and main.tsx renders an on-screen diagnostic naming the problem.
//
// Data lives in two Postgres schemas (both must be listed in Supabase →
// Settings → API → Exposed schemas):
//   sales — the tool's own tables (default schema for this client)
//   core  — the shared spine (people, orgs, memory, numbering)
import { createClient } from "@supabase/supabase-js";

/* createClient with `db.schema` returns a client whose schema is baked into
   its type, which is NOT assignable to a bare SupabaseClient. Infer the real
   type from the factory rather than widening it away — widening is what makes
   a schema typo compile. */
function makeClient(u: string, k: string) {
  return createClient(u, k, {
    db: { schema: "sales" },
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
export type Client = ReturnType<typeof makeClient>;

/* ── env repair ──────────────────────────────────────────────────────────── */

function stripWrap(v: unknown): string {
  return String(v || "").trim().replace(/^["']+|["']+$/g, "").trim();
}

/** Turn whatever was pasted into the env var into a usable API URL. */
export function sanitizeUrl(raw: unknown): string {
  let u = stripWrap(raw);
  if (!u) return "";
  // Someone pasted the dashboard link → derive the API URL from the ref.
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1]}.supabase.co`;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u; // add missing protocol
  return u.replace(/\/+$/, "");                     // strip trailing slash(es)
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const url = sanitizeUrl(rawUrl);
const anonKey = stripWrap(rawKey);

/** True when the operator intended to configure Supabase at all. */
export const supabaseConfigured = Boolean(stripWrap(rawUrl) || stripWrap(rawKey));
export const supabaseUrl = url;

let client: Client | null = null;
let initError = "";

if (url && anonKey) {
  try {
    client = makeClient(url, anonKey);
  } catch (e: any) {
    initError = e?.message || String(e);
    console.error("[Supabase] Could not initialise:", initError, "(URL used:", url + ")");
  }
} else {
  const missing: string[] = [];
  if (!url) missing.push("VITE_SUPABASE_URL");
  if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  initError = `Missing or empty: ${missing.join(" and ")}`;
  console.error(
    "[Supabase] " + initError + ". Copy .env.example to .env.local and fill them in."
  );
}

/** Whether a usable client exists. Guard anything that touches the network. */
export const supabaseEnabled = Boolean(client);
/** Human-readable reason the client could not start (""; when it did). */
export const supabaseInitError = initError;

/* A client is exported unconditionally so the ~60 call sites in data.ts keep
   their existing shape. When init failed this is a stub whose every call
   rejects with the real reason, rather than a null that throws
   "cannot read property from of null" three frames away from the cause. */
function deadClient(reason: string): Client {
  const fail = () => Promise.reject(new Error("Supabase is not configured: " + reason));
  const chain: any = new Proxy(function () {} as any, {
    get: (_t, prop) => {
      if (prop === "then") return undefined;          // not a thenable
      if (prop === "select" || prop === "insert" || prop === "upsert" ||
          prop === "update" || prop === "delete" || prop === "rpc") return () => chain;
      return () => chain;
    },
    apply: () => chain,
  });
  // Await-ing any query resolves to a normal PostgrestError shape.
  chain.then = (res: any) => res({ data: null, error: { message: reason } });
  return {
    from: () => chain,
    rpc: () => chain,
    schema: () => ({ from: () => chain }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: fail,
      signUp: fail,
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  } as unknown as Client;
}

export const supabase: Client = client ?? deadClient(initError);

// The shared spine. Same client, same session — different schema.
export const core = supabase.schema("core");
