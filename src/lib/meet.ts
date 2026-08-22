/* ─── GOOGLE MEET ──────────────────────────────────────────────────────────
   Schedule a call, list what is coming, call one off. The event lives on the
   caller's own Google Calendar — nothing about it is duplicated into our
   database, because a second copy of a diary is a second copy to get out of
   date.

   Every call carries the caller's Supabase JWT: /api/meet creates the event AS
   them, so it lands in their diary and the invitees see who called it.

   Like drive.ts, nothing here throws — a failed schedule must not take the
   scrum down with it. The caller reads `ok` and `error`.                     */

import { supabase } from "./supabase";

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
  start: string; end: string; attendees: string[]; companyId: string;
};

/** Is the Meet integration configured? Needs no session. */
export async function status(): Promise<MeetStatus> {
  try {
    const r = await fetch("/api/meet?action=status");
    return await r.json();
  } catch {
    return { connected: false, reason: "Could not reach /api/meet" };
  }
}

async function post(payload: Record<string, unknown>): Promise<any> {
  let token = "";
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || "";
  } catch { /* unsigned-in is handled by the function */ }
  try {
    const r = await fetch("/api/meet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      // userJwt as well as the header: some proxies strip Authorization.
      body: JSON.stringify({ ...payload, userJwt: token || undefined }),
    });
    return await r.json();
  } catch {
    return { error: "Could not reach /api/meet" };
  }
}

/** Create the call. `recordWithFireflies` invites the notetaker. */
export function create(opts: {
  date: string; startTime: string; endTime?: string;
  title: string; description?: string;
  attendees?: string[]; companyId?: string; companyName?: string;
  recordWithFireflies?: boolean; timeZone?: string;
}): Promise<CreatedMeeting> {
  return post({ action: "create", ...opts });
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
