/* ─── FIREFLIES ────────────────────────────────────────────────────────────
   Fireflies sits in the call and writes down what was said. This is the seam
   between that and the daily scrum: ask whether it is connected, ask what
   happened on a given day, pull one transcript in.

   The API key never reaches the browser — api/fireflies.js holds it and the
   browser gets what the meeting SAID, not the key that could read every
   meeting the company has ever recorded.

   Read-only, deliberately: there is no webhook and no transcript store on this
   side yet, so a transcript exists here only for as long as the tab is open.
   (The PMS keeps them in pms.transcripts; porting that is a separate change.)  */

export type FfMeeting = { id: string; title?: string; date?: string; duration?: number };
export type FfTranscript = { text?: string; url?: string; error?: string };
/** What `status()` answers. `why` explains a false `on`. */
export type FfStatus = { on: boolean; why?: string };

const get = async (params: Record<string, string>): Promise<any> => {
  const p = new URLSearchParams(params);
  try {
    const r = await fetch("/api/fireflies?" + p.toString());
    return await r.json();
  } catch {
    return { error: "Could not reach Fireflies." };
  }
};

/** Is FIREFLIES_API_KEY set and accepted? `reason` explains a false. */
export async function status(): Promise<FfStatus> {
  const j = await get({ action: "status" });
  return { on: !!j.connected, why: j.reason };
}

/** Meetings between two ISO instants. Returns [] rather than throwing. */
export async function list(from: string, to: string): Promise<FfMeeting[]> {
  const j = await get({ action: "list", from, to });
  return j.items || [];
}

/** One transcript, by id. */
export async function get_(id: string): Promise<FfTranscript> {
  return get({ action: "get", id });
}
export { get_ as transcript };

/** A whole day's meetings, in the tool's timezone (IST). */
export function dayRange(date: string): { from: string; to: string } {
  return { from: date + "T00:00:00+05:30", to: date + "T23:59:59+05:30" };
}

/** Of a day's meetings, the one that looks like the scrum — else the first.
    Kept here rather than in the view, because "which of these is the scrum"
    is a fact about Fireflies data, not about how the page is laid out. */
export function pickScrum(items: FfMeeting[]): FfMeeting | undefined {
  return items.find((x) => /scrum|stand[- ]?up|daily/i.test(x.title || "")) || items[0];
}
