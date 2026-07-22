// RFQ attachments: the file is uploaded to the Supabase Storage bucket
// `rfq-files`; only its link/path is stored in the project record (never the
// bytes in the JSON blob). Bucket is public, so getPublicUrl returns a stable
// link. Requires the storage policies in supabase/schema.sql to be applied.
import { supabase } from "./supabase";

const BUCKET = "rfq-files";

// Uploads a File and returns { file: { name, url, path, size } } or { error }.
export async function uploadAttachment(file: File) {
  const safe = (file.name || "file").replace(/[^\w.\-]+/g, "_");
  const path = `rfq/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) return { error: error.message };
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { file: { name: file.name, url: data.publicUrl, path, size: file.size } };
}

// Best-effort delete of the stored file when an attachment is removed.
export async function removeAttachmentFile(path?: string) {
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* best effort — the DB reference is already gone */
  }
}

export function formatSize(bytes?: number) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
