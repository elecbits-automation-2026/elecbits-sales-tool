/* ─── THE SALES BRAIN ──────────────────────────────────────────────────────
   The one place that knows the shape of /api/memory — the Drive corpus the
   assistant answers out of.

   Every call carries the signed-in person's Supabase JWT, and that is not
   ceremony: the endpoint resolves the caller's sales role from it and
   filters retrieval to the tiers that role may see. Finance, commercial and
   HR folders are classified closed, so an agent's search simply never
   returns them. Drop the token and the call is refused rather than
   answered narrowly — a retrieval layer that degrades to "no results" when
   auth breaks would look exactly like an empty knowledge base.

   Same contract as lib/drive.ts and lib/register.ts: every function
   resolves rather than throws. A knowledge lookup that fails must leave the
   chat working and unhelpful, never broken.                               */

import { supabase } from "./supabase";

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const t = data?.session?.access_token;
    return t ? { Authorization: "Bearer " + t } : {};
  } catch { return {}; }
}

const call = async (qs: string, init: RequestInit = {}): Promise<any> => {
  try {
    const r = await fetch("/api/memory?" + qs, { ...init, headers: { ...(await authHeaders()), ...(init.headers || {}) } });
    return await r.json();
  } catch { return { error: "Could not reach /api/memory" }; }
};

/* WHY A QUESTION IS NOT A QUERY. The Deal Copilot sent whole sentences to
   full-text search, and `websearch_to_tsquery` ANDs bare words — so "what
   is our standard PCBA turnaround?" compiled to a query requiring all six
   words in one 1600-character chunk, and matched nothing. It looked like an
   empty brain; it was a malformed query.

   Stopwords out, short words out, the rest joined with the literal word
   "or", which websearch_to_tsquery maps to `|`. Eight terms is enough —
   past that the ranking stops meaning anything. */
const STOP = new Set(("a an and are as at be but by can could do does for from had has have how i if in is it its me my of on or our "
  + "please should so some tell that the their them then there these they this to us was we were what when where which who why will "
  + "with would you your").split(" "));

export function brainQuery(text: string): string {
  const words = String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8).join(" or ");
}

export type BrainHit = {
  fileId: string; fileName: string; folder: string; link: string;
  content: string; kind: "text" | "file"; similarity?: number;
};
export type BrainResult = { mode: string; hits: BrainHit[]; files: BrainHit[]; error?: string };

const EMPTY: BrainResult = { mode: "none", hits: [], files: [] };

const shape = (h: any): BrainHit => ({
  fileId: h.file_id || "", fileName: h.file_name || "", folder: h.folder_path || "",
  link: h.link || (h.file_id ? "https://drive.google.com/open?id=" + h.file_id : ""),
  content: h.content || "", kind: h.kind === "file" ? "file" : "text", similarity: h.similarity,
});

/* Two result sets, deliberately kept apart.

   `hits` are passages we have actually read and can quote. `files` are
   things we know exist by name only — a .pptx, a PDF — matched on their
   filename and folder. Merging them would let an answer imply it had read
   a deck it cannot open, which is the one dishonesty worth engineering
   against here. The prompt is told which is which.

   /api/memory already sorts them, and strips the content off a file row so
   there is nothing to quote even by accident. The sorting below is kept
   anyway: this is a correctness property of the answer, not of the
   transport, and it should not depend on which version of the endpoint
   happens to be deployed. */
export async function searchBrain(question: string, n = 6): Promise<BrainResult> {
  const q = brainQuery(question);
  if (!q) return EMPTY;
  const j = await call("action=search&q=" + encodeURIComponent(q) + "&n=" + n);
  if (!j || j.error) return { ...EMPTY, error: j && j.error };
  const seen = new Set<string>();
  // One passage per file: a verbose SOP should not take every slot.
  const hits: BrainHit[] = [];
  for (const h of (j.hits || []).map(shape)) {
    if (h.kind === "file") continue;          // link-only rows belong in `files`
    if (seen.has(h.fileId)) continue;
    seen.add(h.fileId); hits.push(h);
  }
  const files: BrainHit[] = [];
  const fseen = new Set<string>();
  for (const f of [...(j.files || []).map(shape), ...(j.hits || []).map(shape).filter((h: BrainHit) => h.kind === "file")]) {
    if (!f.fileId || fseen.has(f.fileId)) continue;
    fseen.add(f.fileId); files.push(f);
  }
  return { mode: j.mode || "text", hits, files };
}

/** The corpus, as a block of prompt text. Empty string when nothing matched. */
export function brainContext(r: BrainResult): string {
  const lines: string[] = [];
  if (r.hits.length) {
    lines.push("PASSAGES FROM THE DRIVE — you have read these, you may quote them. Cite the file by name:");
    r.hits.forEach((h) => lines.push("[" + (h.folder ? h.folder + "/" : "") + h.fileName + "]\n" + h.content));
  }
  if (r.files.length) {
    lines.push("FILES MATCHED BY NAME ONLY — these are real files you can point someone to, but their CONTENTS ARE UNREAD."
      + " Offer them as 'this looks like the right file'. Never state or imply what is inside one:");
    r.files.forEach((f) => lines.push("- " + (f.folder ? f.folder + "/" : "") + f.fileName));
  }
  return lines.join("\n\n");
}

/** Admin: the folder→tier map, with how much has been indexed from each. */
export const brainFolders = () => call("action=folders");

/** Admin: reclassify one folder. Rewrites the tier on its chunks too. */
export const setBrainFolder = (folder: string, tier?: string, indexed?: boolean) =>
  call("action=folder&folder=" + encodeURIComponent(folder)
    + (tier ? "&tier=" + encodeURIComponent(tier) : "")
    + (indexed === undefined ? "" : "&indexed=" + (indexed ? "true" : "false")),
    { method: "POST" });

export const brainStatus = () => call("action=status");
export const brainLearn = () => call("action=learn", { method: "POST" });
