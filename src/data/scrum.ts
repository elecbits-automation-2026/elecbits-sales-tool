/* ─── THE DAILY SCRUM ──────────────────────────────────────────────────────
   What the organiser is told, and what happens when it cannot be reached.

   Ported from the ODM PMS, mapped onto sales entities: the PMS matches people
   to a PROJECT's team, this matches them to a COMPANY's account owner. The
   shape of what comes back is deliberately identical, so the preview, the
   condition rail and the task writer are the same code in both tools.        */

export const SCRUM_PLACEHOLDER =
  `e.g. — Sunrise Retail quote goes out by 2pm, Akash. Ankit calls Nevon about the pilot PO 12 to 1.
If Greenline shares the BOM today, price it by evening; if not, chase their SPOC in an hour.
I'll do the Escorts follow-up mail before lunch. Tomorrow 3 to 4, Priya walks Medtech through the LLD.`;

/** A YYYY-MM-DD string, or "" if it is not one. Guards against a model
    answering "tomorrow" in a field the date input has to parse. */
export const isoDay = (v: any): string => {
  const s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) return s;
  return "";
};

/** Day arithmetic on a YYYY-MM-DD string, local-time safe. */
export const addDays = (date: string, n: number): string => {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/* The day a sentence is talking about. "tomorrow" is tomorrow, a weekday name
   is the next such day on or after the note's date, anything else is the
   note's own day. The AI does this properly; this is the offline floor. */
export function dayFor(sentence: string, noteDate: string): string {
  const s = String(sentence || "").toLowerCase();
  if (/\btomorrow\b/.test(s)) return addDays(noteDate, 1);
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(s)) {
      const from = new Date(noteDate + "T00:00:00").getDay();
      const delta = (i - from + 7) % 7;
      return addDays(noteDate, delta === 0 ? 7 : delta);
    }
  }
  return noteDate;
}

/* ─── THE OFFLINE PARSER ───────────────────────────────────────────────────
   When Claude is unreachable the scrum must still produce something. This is
   crude on purpose — one sentence per task, a name match, clock times, and a
   single if/else — and it is labelled `engine: "offline"` so the preview can
   warn that it needs a careful read.

   The alternative, which is what this tool did before, is to fail the save
   and lose the note: the person has just typed the day's plan, the network
   blinked, and the work is gone. A rough parse the human then corrects is
   strictly better than that.                                                */

export type OrganisedTask = {
  owner: string; task: string; company: string;
  date: string; start: string; end: string;
  steps: string[];
  conditions: { if: string; then: string; timeboxMinutes?: number }[];
  said?: string; agreed?: boolean;
};

export function fallbackScrum(
  raw: string, noteDate: string, users: any[], companies: any[]
): { summary: string; tasks: OrganisedTask[]; engine: "offline" } {
  const sentences = String(raw || "")
    .split(/(?<=[.;\n])\s+/).map((s) => s.trim()).filter(Boolean);

  const hhmm = (h: number, min: string) =>
    String(h).padStart(2, "0") + ":" + (min || "00");
  const to24 = (h12: number, mer: string) => (h12 % 12) + (mer === "pm" ? 12 : 0);

  /* A window like "12 to 1pm" writes the meridiem ONCE, at the end. Reading
     each time in isolation misses the "12" entirely and turns a midday hour
     into a start of 13:00 with no end — which is how "12 to 1pm" became a
     one-sided task. So ranges are matched as ranges, and a bare first number
     takes whichever meridiem puts it before the second time. */
  const RANGE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|till|until|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

  const clockTimes = (str: string): string[] => {
    const r = str.match(RANGE);
    if (r) {
      const [, h1, m1, mer1, h2, m2, mer2] = r;
      const a = +h1, b = +h2;
      const lower = (mer1 || "").toLowerCase(), upper = (mer2 || "").toLowerCase();
      if (lower && upper) return [hhmm(to24(a, lower), m1), hhmm(to24(b, upper), m2)];
      if (!lower && upper) {
        // Pick the reading that lands before the end and nearest to it:
        // "12 to 1pm" → 12:00 (not 00:00); "11 to 1pm" → 11:00 (not 23:00).
        const end = to24(b, upper);
        const cands = [to24(a, "am"), to24(a, "pm")].filter((x) => x < end);
        const start = cands.length ? Math.max(...cands) : to24(a, "am");
        return [hhmm(start, m1), hhmm(end, m2)];
      }
      if (lower && !upper) {
        const start = to24(a, lower);
        let end = to24(b, lower);
        if (end <= start) end = (end + 12) % 24;   // "3pm to 4" means 16:00
        return [hhmm(start, m1), hhmm(end, m2)];
      }
      // Neither said am/pm. A sales day runs 08:00–20:00, so a bare hour under
      // 8 is an afternoon one: "3 to 4" is 15:00–16:00, "9 to 10" is morning.
      const fix = (h: number) => (h < 8 ? h + 12 : h);
      return [hhmm(fix(a) % 24, m1), hhmm(fix(b) % 24, m2)];
    }
    return [...str.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi)].map((m) =>
      hhmm(to24(+m[1], m[3].toLowerCase()), m[2]));
  };

  const firstNameOf = (n: string) => String(n || "").trim().split(" ")[0];

  const tasks: OrganisedTask[] = [];
  for (const s of sentences) {
    const person = users.find(
      (u) => u.active !== false && firstNameOf(u.name) &&
        new RegExp(`\\b${firstNameOf(u.name)}\\b`, "i").test(s)
    );
    if (!person) continue;                      // no owner named → not a task
    const company = companies.find(
      (c) => c.name && s.toLowerCase().includes(String(c.name).toLowerCase().split(" ")[0])
    );
    const times = clockTimes(s);
    const hasIf = /\bif\b/i.test(s);
    tasks.push({
      owner: person.name,
      task: s.slice(0, 90),
      company: company ? company.name : "",
      date: dayFor(s, noteDate),
      // "by 2pm" is an end, not a start — one time on its own after "by"
      // is a deadline, and treating it as a start time is worse than useless.
      start: times.length > 1 ? times[0] : (/\bby\b/i.test(s) ? "" : times[0] || ""),
      end: times.length > 1 ? times[1] : (/\bby\b/i.test(s) ? times[0] || "" : ""),
      steps: [s.slice(0, 140)],
      conditions: hasIf
        ? [{
            if: s.split(/\bif\b/i)[1]?.slice(0, 80) || "condition in the note",
            then: "follow the contingency written in the note",
            timeboxMinutes: 60,
          }]
        : [],
    });
  }

  // Nothing matched a name — keep the whole note as one unassigned task rather
  // than returning an empty preview that looks like "there was no work here".
  if (!tasks.length) {
    tasks.push({
      owner: "", task: String(raw).slice(0, 90), company: "",
      date: dayFor(raw, noteDate), start: "", end: "",
      steps: [String(raw).slice(0, 160)], conditions: [],
    });
  }

  return {
    summary: "Offline basic parse — the AI was unreachable. Read every row before saving.",
    tasks,
    engine: "offline",
  };
}
