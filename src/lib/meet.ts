/* ─── GOOGLE MEET ──────────────────────────────────────────────────────────
   Schedule a call, list what is coming, call one off.

   THIS TALKS TO THE PMS'S EDGE FUNCTION, NOT TO api/meet.js.

   Both tools live on the same Supabase project, and the PMS already has a
   deployed `meet` function there with its Google service account, its
   domain-wide delegation and its Calendar scope all configured. Standing up a
   second copy would mean a second set of the same secrets in Vercel and a
   second delegation entry in the Google admin console, for no gain.

   So this points at theirs. Sales holds NO Google credentials for Meet.

   `api/meet.js` is kept in the repo, unused, as the fallback: if the shared
   function is ever changed in a way that breaks us, set VITE_MEET_URL to
   "/api/meet" and Sales is independent again the moment its own secrets are
   added.

   THE COUPLING THIS CREATES, stated plainly: the function belongs to the
   elecbits-pms-odm2 repo. Someone editing it for the PMS can break Sales
   without knowing Sales exists. That repo should carry a note saying so.

   Contract differences from api/meet.js, handled below: the PMS function
   takes `projectIds` and stamps an `elecbitsProjectId` on the event. Sales has
   companies, not projects, so the account name rides in the description
   instead — the one field both agree on.                                     */

import { supabase, supabaseUrl } from "./supabase";

/* Where the function lives. Derived from the Supabase project so it needs no
   configuration: `https://<ref>.supabase.co` → `https://<ref>.functions.supabase.co/meet`.
   VITE_MEET_URL overrides it — set it to "/api/meet" to use our own copy. */
function resolveUrl(): string {
  const override = String(import.meta.env.VITE_MEET_URL || "").trim();
  if (override) return override.replace(/\/+$/, "");
  const m = String(supabaseUrl || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i);
  return m ? `https://${m[1]}.functions.supabase.co/meet` : "";
}

const MEET_URL = resolveUrl();

export type MeetStatus = {
  connected: boolean; reason?: string;
  notetaker?: string; organiserFallback?: string | null;
};

export type CreatedMeeting = {
  ok?: boolean; error?: string; warning?: string;
  eventId?: string; meetLink?: string; htmlLink?: string;
  title?: string; start?: string; end?: string; organizer?: string;
  attendees?: string[];
  recording?: boolean; notetaker?: string; notetakerInvited?: boolean;
};

export type UpcomingMeeting = {
  eventId: string; title: string; meetLink: string; htmlLink: string;
  start: string; end: string; attendees: string[]; companyId?: string;
};

async function post(payload: Record<string, unknown>): Promise<any> {
  if (!MEET_URL) return { error: "No Meet endpoint — VITE_SUPABASE_URL is not a recognisable project URL." };
  let token = "";
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || "";
  } catch { /* the function rejects an unsigned caller itself */ }
  try {
    const r = await fetch(MEET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      // userJwt as well as the header: the PMS function accepts either, and
      // some proxies strip Authorization on a cross-origin POST.
      body: JSON.stringify({ ...payload, userJwt: token || undefined }),
    });
    return await r.json();
  } catch {
    return { error: "Could not reach the Meet service." };
  }
}

/* Is it usable BY THIS PERSON, right now? The PMS function has no status
   endpoint — the PMS decides by "is VITE_MEET_URL set", which only proves
   somebody typed a URL. Asking for the caller's upcoming calls is a real
   answer: it exercises the session, the delegation and the Calendar scope,
   and any failure comes back as the function's own sentence, which is what
   the disabled notice then shows. */
export async function status(): Promise<MeetStatus> {
  if (!MEET_URL) return { connected: false, reason: "no Meet endpoint could be resolved" };
  const r = await post({ action: "upcoming" });
  if (r?.ok) return { connected: true, notetaker: r.notetaker, organiserFallback: r.organizer || null };
  // Not signed in yet is not a misconfiguration — the panel is only rendered
  // to signed-in people, so treat it as "ask again later" rather than broken.
  const why = String(r?.error || "unavailable");
  return { connected: false, reason: why };
}

/** Create the call. `recordWithFireflies` invites the notetaker. */
export function create(opts: {
  date: string; startTime: string; endTime?: string;
  title: string; description?: string;
  attendees?: string[]; companyId?: string; companyName?: string;
  recordWithFireflies?: boolean; timeZone?: string;
}): Promise<CreatedMeeting> {
  const { companyId, companyName, description, ...rest } = opts;
  return post({
    action: "create",
    ...rest,
    // The PMS function has no notion of a company. Its `description` is the
    // one field that survives to the calendar invite, so the account goes
    // there rather than being silently dropped.
    description: [description, companyName ? "Account: " + companyName : ""]
      .filter(Boolean).join("\n\n") || undefined,
  });
}

/** The caller's next calls that have a Meet link. */
export async function upcoming(): Promise<UpcomingMeeting[]> {
  const r = await post({ action: "upcoming" });
  return r?.events || [];
}

/** Call it off, and tell the invitees. */
export function cancel(eventId: string): Promise<{ ok?: boolean; error?: string }> {
  return post({ action: "cancel", eventId });
}

/** For diagnostics — which endpoint this build is talking to. */
export const endpoint = MEET_URL;
