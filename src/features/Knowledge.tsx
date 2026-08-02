import React, { useState, useRef, useEffect } from "react";
import {
  Package, Send, Loader2, Bot, User as UserIcon, PlusCircle, X, FileText,
  BookOpen, Sparkles, Save, Trash2, Copy, Link as LinkIcon,
} from "lucide-react";
import { Chip, Field, Modal } from "./ui";
import { uid, timeAgo } from "../lib/helpers";
import { callClaude } from "../lib/ai";

/* ---------------------------------------------------------------------- */
/* Product / Service knowledge assistant (feature 7).                      */
/*                                                                          */
/* - A chat window anyone can ask for product/service/company info.        */
/* - Admin maintains the knowledge base (docs, notes, and Drive/file links)*/
/*   which is injected as grounding context on every question.             */
/* - Answers can be templatised: save a reusable prompt (e.g. a one-pager  */
/*   generator) that the whole team can run with a fill-in variable.        */
/* ---------------------------------------------------------------------- */

function buildContext(docs) {
  if (!docs.length) return "(No knowledge base documents have been added yet.)";
  return docs.map((d) => `### ${d.title}${d.category ? ` [${d.category}]` : ""}${d.link ? ` (source: ${d.link})` : ""}\n${d.content}`).join("\n\n");
}

async function askKnowledge(question, docs, history) {
  const convo = history.map((m) => `${m.role === "ai" ? "ASSISTANT" : "USER"}: ${m.text}`).join("\n");
  const prompt = `You are Elecbits' internal product & services knowledge assistant. Answer staff questions about the company's products, services, capabilities and processes using ONLY the knowledge base below. If the answer isn't in it, say so plainly and suggest what document should be added — do not invent capabilities.

KNOWLEDGE BASE
${buildContext(docs)}

CONVERSATION SO FAR:
${convo || "(none)"}

USER QUESTION: ${question}

Answer clearly and concisely for a salesperson who may repeat this to a client. Use short paragraphs or bullets. No markdown code fences.`;
  return callClaude(prompt, 800);
}

function DocModal({ initial, onClose, onSave }) {
  const [d, setD] = useState(initial || { title: "", category: "", content: "", link: "" });
  return (
    <Modal title={d.id ? "Edit document" : "Add knowledge document"} icon={FileText} onClose={onClose}
      actions={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => d.title.trim() && onSave(d)}><Save size={14} /> Save</button></>}>
      <div className="grid-2">
        <Field label="Title *"><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Box Build capabilities" /></Field>
        <Field label="Category"><input value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} placeholder="Products / Process / Pricing" /></Field>
      </div>
      <Field label="Source link (Drive / file / URL)" hint="Optional — paste a Google Drive or document link for reference.">
        <input value={d.link} onChange={(e) => setD({ ...d, link: e.target.value })} placeholder="https://drive.google.com/…" />
      </Field>
      <Field label="Content *" hint="Paste the key facts. This text is what the assistant is allowed to answer from.">
        <textarea rows={8} value={d.content} onChange={(e) => setD({ ...d, content: e.target.value })} />
      </Field>
    </Modal>
  );
}

function TemplateModal({ initial, onClose, onSave }) {
  const [t, setT] = useState(initial || { title: "", prompt: "" });
  return (
    <Modal title={t.id ? "Edit template" : "New answer template"} icon={Sparkles} onClose={onClose}
      actions={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => t.title.trim() && t.prompt.trim() && onSave(t)}><Save size={14} /> Save</button></>}>
      <Field label="Template name *"><input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="Client one-pager" /></Field>
      <Field label="Prompt *" hint="Use {input} where the user's input should go, e.g. 'Write a one-pager pitching our Box Build service to {input}.'">
        <textarea rows={5} value={t.prompt} onChange={(e) => setT({ ...t, prompt: e.target.value })} />
      </Field>
    </Modal>
  );
}

export function Knowledge({ docs, templates, userName, tier, department, onSaveDoc, onDeleteDoc, onSaveTemplate, onDeleteTemplate }) {
  const [tab, setTab] = useState("chat"); // chat | library
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [docModal, setDocModal] = useState(null);
  const [tplModal, setTplModal] = useState(null);
  const [runTpl, setRunTpl] = useState(null);
  const scrollRef = useRef(null);

  const canManage = tier === "Main Admin" || department === "Product" || (tier === "Manager");
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [history, busy]);

  async function ask(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...history, { role: "user", text: q }];
    setHistory(next);
    setInput("");
    setBusy(true);
    try {
      const answer = await askKnowledge(q, docs || [], history);
      setHistory([...next, { role: "ai", text: answer }]);
    } finally {
      setBusy(false);
    }
  }

  function runTemplate(tpl, value) {
    const filled = tpl.prompt.replace(/\{input\}/g, value || "");
    setRunTpl(null);
    setTab("chat");
    ask(filled);
  }

  return (
    <div className="view">
      <div className="view-header">
        <div><h1>Product & Services</h1><p className="view-sub">Ask anything about what we offer — grounded in the company knowledge base.</p></div>
      </div>

      <div className="quick-actions">
        <button className={`quick-action ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}><Bot size={14} /> Ask assistant</button>
        <button className={`quick-action ${tab === "library" ? "active" : ""}`} onClick={() => setTab("library")}><BookOpen size={14} /> Knowledge library ({(docs || []).length})</button>
      </div>

      {tab === "chat" ? (
        <>
          {(templates || []).length > 0 && (
            <div className="tpl-chips">
              <span className="cell-sub">Templates:</span>
              {templates.map((t) => <button key={t.id} className="chip chip-default tpl-chip" onClick={() => setRunTpl(t)}><Sparkles size={11} /> {t.title}</button>)}
            </div>
          )}
          <div className="panel chat-panel">
            <div className="chat-scroll knowledge-scroll" ref={scrollRef}>
              {history.length === 0 && <div className="chat-intro"><Bot size={14} /> Ask me about our products, services, capabilities, lead times, or process. I answer from the knowledge base — so if something's missing, tell an admin to add it.</div>}
              {history.map((m, i) => (
                <div className={`chat-msg chat-${m.role === "user" ? "agent" : "ai"}`} key={i}>
                  <span className="chat-avatar">{m.role === "ai" ? <Bot size={13} /> : <UserIcon size={13} />}</span>
                  <div className="chat-bubble" style={{ whiteSpace: "pre-wrap" }}>{m.text}
                    {m.role === "ai" && <button className="copy-btn" title="Copy" onClick={() => navigator.clipboard?.writeText(m.text)}><Copy size={12} /></button>}
                  </div>
                </div>
              ))}
              {busy && <div className="chat-msg chat-ai"><span className="chat-avatar"><Bot size={13} /></span><div className="chat-bubble"><Loader2 size={14} className="spin" /></div></div>}
            </div>
            <div className="chat-input-row">
              <textarea rows={2} placeholder="Ask about a product or service…" value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} disabled={busy} />
              <button className="btn btn-primary chat-send" onClick={() => ask()} disabled={busy || !input.trim()}><Send size={15} /></button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="panel">
            <div className="panel-title-row">
              <h3 className="panel-title"><FileText size={14} /> Knowledge documents</h3>
              {canManage && <button className="btn btn-secondary btn-sm" onClick={() => setDocModal({})}><PlusCircle size={13} /> Add document</button>}
            </div>
            {(docs || []).length === 0 ? <p className="field-hint">No documents yet.{canManage ? " Add the first — the assistant only answers from these." : " Ask an admin to add product info."}</p> : (
              <ul className="stake-list">
                {docs.map((d) => (
                  <li key={d.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div className="cell-primary">{d.title} {d.category && <Chip tone="default">{d.category}</Chip>}</div>
                        <div className="cell-sub" style={{ marginTop: 3 }}>{(d.content || "").slice(0, 120)}{(d.content || "").length > 120 ? "…" : ""}</div>
                        {d.link && <a className="cell-sub kb-link" href={d.link} target="_blank" rel="noreferrer"><LinkIcon size={11} /> source</a>}
                        <div className="cell-sub" style={{ marginTop: 3 }}>by {d.createdBy} · {timeAgo(d.createdAt)}</div>
                      </div>
                      {canManage && (
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button className="icon-btn" onClick={() => setDocModal(d)}><FileText size={14} /></button>
                          <button className="icon-btn" onClick={() => onDeleteDoc(d.id)}><Trash2 size={14} /></button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="panel-title-row">
              <h3 className="panel-title"><Sparkles size={14} /> Answer templates</h3>
              {canManage && <button className="btn btn-secondary btn-sm" onClick={() => setTplModal({})}><PlusCircle size={13} /> New template</button>}
            </div>
            {(templates || []).length === 0 ? <p className="field-hint">No templates yet. Templatise common asks (pitch drafts, one-pagers, spec summaries).</p> : (
              <ul className="stake-list">
                {templates.map((t) => (
                  <li key={t.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div><div className="cell-primary">{t.title}</div><div className="cell-sub">{t.prompt.slice(0, 90)}{t.prompt.length > 90 ? "…" : ""}</div></div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setRunTpl(t)}>Run</button>
                        {canManage && <><button className="icon-btn" onClick={() => setTplModal(t)}><FileText size={14} /></button><button className="icon-btn" onClick={() => onDeleteTemplate(t.id)}><Trash2 size={14} /></button></>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {docModal && <DocModal initial={docModal.id ? docModal : null} onClose={() => setDocModal(null)} onSave={(d) => { onSaveDoc(d); setDocModal(null); }} />}
      {tplModal && <TemplateModal initial={tplModal.id ? tplModal : null} onClose={() => setTplModal(null)} onSave={(t) => { onSaveTemplate(t); setTplModal(null); }} />}
      {runTpl && <RunTemplateModal tpl={runTpl} onClose={() => setRunTpl(null)} onRun={runTemplate} />}
    </div>
  );
}

function RunTemplateModal({ tpl, onClose, onRun }) {
  const [val, setVal] = useState("");
  const needsInput = tpl.prompt.includes("{input}");
  return (
    <Modal title={tpl.title} icon={Sparkles} onClose={onClose}
      actions={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onRun(tpl, val)}><Send size={14} /> Run</button></>}>
      {needsInput ? (
        <Field label="Fill in the blank" hint="Replaces {input} in the template.">
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. a fintech startup needing a POS device" />
        </Field>
      ) : <p className="field-hint">This template takes no input — run it as-is.</p>}
    </Modal>
  );
}
