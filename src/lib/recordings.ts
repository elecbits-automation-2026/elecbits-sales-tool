/* ─── RECORDINGS ───────────────────────────────────────────────────────────
   Some calls happen where the notetaker cannot go: a client dials a phone, a
   meeting is captured on someone's laptop, a site visit on a handset. The
   audio exists; the transcript does not.

   The file goes into the private `sales-recordings` bucket
   (supabase/21-recordings-bucket.sql). It is NOT public: reading it back needs
   a signed URL that expires, so a leaked path is not a leaked recording.

   Transcription is a separate step and deliberately not automatic — Fireflies
   fetches audio from a URL, which means handing a third party a signed link to
   a client call. That should be a decision someone makes, not a side effect of
   dragging a file in.                                                        */

import { supabase } from "./supabase";

const BUCKET = "sales-recordings";

export type Recording = {
  name: string; path: string; size: number; createdAt: string;
};

/** Is the bucket there? False simply means 21-recordings-bucket.sql has not
    been run — the UI should say so rather than showing a broken control. */
export async function available(): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from(BUCKET).list("", { limit: 1 });
    return !error;
  } catch {
    return false;
  }
}

/* Files are filed under the day they belong to, not the day they were
   uploaded: someone uploading Friday's call on Monday still wants it to sit
   with Friday. The random suffix keeps two uploads of "call.m4a" apart. */
const pathFor = (date: string, fileName: string) => {
  const safe = String(fileName || "recording")
    .replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(-80);
  return `${date}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
};

export async function upload(
  file: File, date: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const path = pathFor(date, file.name);
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) {
      // The most common cause by far, and the one worth naming.
      if (/bucket not found/i.test(error.message)) {
        return { ok: false, error: "The recordings bucket does not exist yet — run supabase/21-recordings-bucket.sql." };
      }
      if (/mime|content type/i.test(error.message)) {
        return { ok: false, error: "That file type is not accepted. Use mp3, m4a, wav, webm, ogg or mp4." };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, path };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** What is filed under a given day. */
export async function list(date: string): Promise<Recording[]> {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(date, {
      limit: 100, sortBy: { column: "created_at", order: "desc" },
    });
    if (error || !data) return [];
    return data
      .filter((f: any) => f.id)                     // folders have no id
      .map((f: any) => ({
        name: f.name,
        path: `${date}/${f.name}`,
        size: f.metadata?.size || 0,
        createdAt: f.created_at || "",
      }));
  } catch {
    return [];
  }
}

/** A link that works for `seconds` and then does not. */
export async function signedUrl(path: string, seconds = 3600): Promise<string> {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
    return error ? "" : (data?.signedUrl || "");
  } catch {
    return "";
  }
}

export async function remove(path: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}

export const humanSize = (n: number): string =>
  n > 1048576 ? (n / 1048576).toFixed(1) + " MB"
    : Math.max(1, Math.round(n / 1024)) + " KB";
