/* ─── THE AI LAYER ─────────────────────────────────────────────────────────
   Everything that talks to Claude. Routes through our own serverless proxy
   (/api/claude), which holds ANTHROPIC_API_KEY server-side and picks the
   model — the browser never sees the key. The proxy accepts
   { system, messages, maxTokens }.

   This is the file api/claude.js has been pointing at all along; its header
   said "see src/lib/ai.ts" while the code lived inline in App.tsx.

   System memory rides on EVERY AI call (gates, scrum, plans, scorers, chats)
   — the PMS pattern. The workspace loader sets it; memory edits refresh it. */

import * as drive from "./drive";

/* ── system memory ───────────────────────────────────────────────────────
   Module state rather than a parameter, because every one of the ~20 call
   sites would otherwise have to thread it through, and forgetting it at one
   of them is a silent loss of company context rather than an error. */
let MEMORY_TEXT = "";

/** Replace the durable company facts injected into every call. */
export function setMemoryText(text: string): void {
  MEMORY_TEXT = text || "";
}

/** Build the memory block from the memory collection. */
export function memoryTextFrom(memory: any[]): string {
  return (memory || []).map((m) => "• " + m.title + ": " + m.text).join("\n");
}

export function getMemoryText(): string {
  return MEMORY_TEXT;
}

/* ── the call ────────────────────────────────────────────────────────────── */

export async function askClaude(
  system: string, messages: any[], opts: { maxTokens?: number } = {}
): Promise<string> {
  const sys = MEMORY_TEXT
    ? system + "\n\nSYSTEM MEMORY (durable company facts & rules — always respect these):\n" + MEMORY_TEXT
    : system;
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: sys, messages, maxTokens: opts.maxTokens || 1000 }),
  });
  if (!res.ok) throw new Error("AI request failed (" + res.status + ")");
  const data = await res.json();
  return (data && data.text) || "";
}

/* ── attachments ─────────────────────────────────────────────────────────
   A pasted screenshot or attached file becomes an Anthropic content block.
   Images are downscaled to a 1568px long edge before upload — a raw retina
   screenshot is several MB of base64, which blows the serverless body limit
   and returns an empty answer. 1568px is the size the vision model resizes to
   anyway, so nothing legible is lost and the call is far cheaper. */

export const IMG_MAX_EDGE = 1568;

export const fileToBlock = (file: File): Promise<any> => new Promise((resolve) => {
  if (file.type === "application/pdf") {
    if (file.size > 4 * 1024 * 1024) return resolve(null); // too big to post
    const r = new FileReader();
    r.onload = () => resolve({ type: "document", source: { type: "base64", media_type: "application/pdf", data: String(r.result).split(",")[1] }, _name: file.name || "document.pdf" });
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
    return;
  }
  if (!file.type || !file.type.startsWith("image/")) return resolve(null);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const scale = Math.min(1, IMG_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // flatten transparency for JPEG
      ctx.drawImage(img, 0, 0, w, h);
      const data = cv.toDataURL("image/jpeg", 0.85).split(",")[1];
      URL.revokeObjectURL(url);
      resolve(data ? { type: "image", source: { type: "base64", media_type: "image/jpeg", data }, _name: file.name || "pasted image" } : null);
    } catch (e) { URL.revokeObjectURL(url); resolve(null); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  img.src = url;
});

export const contentText = (c: any): string =>
  typeof c === "string" ? c : (c || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");

/** Tool protocol lines must never reach the user's eyes. */
export const stripToolLines = (t: any): string =>
  String(t || "").replace(/(DRIVE_JSON|ACTIONS_JSON|TASKS_JSON)[\s\S]*$/, "").trim();

/* Reads the JSON that follows a marker. Handles BOTH object and array
   payloads — taking only {…} silently mangled every array contract
   (`[{a},{b}]` sliced to `{a},{b}` → parse error → feature looked broken). */
export function extractMarkedJSON(text: any, marker: string): any {
  const i = String(text || "").indexOf(marker);
  if (i < 0) return null;
  const rest = String(text).slice(i + marker.length);
  const oS = rest.indexOf("{"), aS = rest.indexOf("[");
  const useArr = aS >= 0 && (oS < 0 || aS < oS);
  const s = useArr ? aS : oS;
  const e = useArr ? rest.lastIndexOf("]") : rest.lastIndexOf("}");
  if (s < 0 || e < 0 || e < s) return null;
  try { return JSON.parse(rest.slice(s, e + 1)); } catch (err) { return null; }
}

/* askClaude has no timeout of its own; a hung call must never strand a user
   inside a modal. */
export const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => Promise.race([
  p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
]);

/* ── the Drive tool loop ─────────────────────────────────────────────────
   Runs a chat turn with the Drive tool available: feeds listings back until
   the model answers. Returns { reply, notes } — notes describe what was
   checked, so the UI can show its working. */

export const DRIVE_TOOL_PROMPT = drive.TOOL_PROMPT;

export async function askWithDrive(
  system: string, convo: any[], maxHops = 4
): Promise<{ reply: string; notes: string[] }> {
  let reply = await askClaude(system, convo);
  const notes: string[] = [];
  for (let hop = 0; hop < maxHops; hop++) {
    const spec = extractMarkedJSON(reply, "DRIVE_JSON");
    if (!spec) break;
    notes.push(spec.action === "search" ? "searched Drive for “" + spec.q + "”"
      : spec.action === "deep" ? "read inside " + spec.name
      : "checked Drive: " + (spec.name || "top-level folders"));
    const result = await drive.runTool(spec);
    convo.push({ role: "assistant", content: reply });
    convo.push({ role: "user", content: "DRIVE_RESULT " + result + "\n\nAnswer the original question from this listing (or make one more DRIVE_JSON request if you must drill deeper). Never show raw DRIVE_JSON in the final answer." });
    reply = await askClaude(system, convo);
  }
  return { reply, notes };
}
