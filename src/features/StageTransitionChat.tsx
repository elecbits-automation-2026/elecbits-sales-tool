import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Mic, MicOff, Loader2, CheckCircle2, X, Bot, User as UserIcon } from "lucide-react";
import { callClaude } from "../lib/ai";
import { DEFAULT_STAGE_FORMS, GENERIC_STAGE_FORM } from "./salesConfig";

/* ---------------------------------------------------------------------- */
/* AI stage-transition intake.                                             */
/*                                                                          */
/* Every move between pipeline stages runs through this guided chat so no   */
/* information is missed. The AI asks stage-specific questions (from the    */
/* editable stage-form config), then probes on weak or negative answers —   */
/* e.g. "not interested" pulls "what did you pitch, what was the exact      */
/* objection?". The agent can type or dictate (voice → text). When the AI   */
/* has enough, it compiles a structured summary the agent confirms, and     */
/* the deal only then advances.                                            */
/* ---------------------------------------------------------------------- */

function getBaseQuestions(toStage, overrides) {
  if (overrides && Array.isArray(overrides[toStage]) && overrides[toStage].length) return overrides[toStage];
  return DEFAULT_STAGE_FORMS[toStage] || GENERIC_STAGE_FORM;
}

// Build the single-prompt conversation and ask Claude for the next turn as JSON.
async function askStageAI({ deal, company, fromStage, toStage, baseQuestions, accountMemory, history }) {
  const convo = history.map((m) => `${m.role === "ai" ? "INTERVIEWER" : "AGENT"}: ${m.text}`).join("\n");
  const prompt = `You are the sales-intake interviewer inside Elecbits' internal Sales OS. A sales agent is moving a deal from "${fromStage || "start"}" to "${toStage}". Your job is to make sure NO important information about this client interaction is missed, and to push back when answers are vague, generic, or reveal a problem.

CONTEXT
- Company: ${company?.name || "Unknown"} — ${company?.whatTheyDo || "no description"} (industry: ${company?.industry || "?"})
- Deal: ${deal?.title || "Untitled"} · value ${deal?.value ? `₹${deal.value}` : "unknown"}
- Moving into stage: ${toStage}
${accountMemory ? `- Company playbook / memory the org wants applied:\n${accountMemory}\n` : ""}

QUESTIONS TO COVER for the "${toStage}" stage (adapt wording, ask ONE at a time, follow up where the answer is thin):
${baseQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

RULES
- Ask ONE focused question per turn. Keep it short and human.
- If the agent's answer is vague ("went ok", "not interested", "they'll think about it"), DIG: ask what was actually pitched, the exact objection, the competitor, the number, the next step and date. Do not accept hand-waving.
- Do not repeat a question already answered. Move through the checklist.
- When you have solid answers covering the checklist, set done=true and write a tight structured summary (short headers + bullets, plain text, no markdown fences) capturing what happened, sentiment, risks, and the concrete next step + date.

CONVERSATION SO FAR:
${convo || "(none yet — ask your first question)"}

Respond with ONLY a JSON object, no markdown, shaped exactly:
{"done": false, "message": "your next question"}
or when finished:
{"done": true, "message": "one-line closing to the agent", "summary": "the compiled note"}`;

  const raw = await callClaude(prompt, 700);
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return { done: !!obj.done, message: obj.message || "", summary: obj.summary || "" };
  } catch {
    // If the model didn't return clean JSON, treat the whole thing as a question.
    return { done: false, message: cleaned || "Tell me what happened in this stage." };
  }
}

// Minimal Web Speech API wrapper for dictation. Returns null if unsupported.
function getRecognition() {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = "en-IN";
  return r;
}

export function StageTransitionChat({ deal, company, fromStage, toStage, stageForms, accountMemory, userName, onComplete, onClose }) {
  const baseQuestions = getBaseQuestions(toStage, stageForms);
  const [history, setHistory] = useState([]); // {role:'ai'|'agent', text}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState("");
  const [listening, setListening] = useState(false);
  const [micSupported] = useState(() => !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
  const recRef = useRef(null);
  const baseInputRef = useRef("");
  const scrollRef = useRef(null);

  // Kick off with the AI's first question.
  useEffect(() => { void turn([]); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [history, busy]);

  async function turn(hist) {
    setBusy(true);
    try {
      const res = await askStageAI({ deal, company, fromStage, toStage, baseQuestions, accountMemory, history: hist });
      setHistory([...hist, { role: "ai", text: res.message }]);
      if (res.done) { setDone(true); setSummary(res.summary || res.message); }
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy || done) return;
    stopListening();
    const next = [...history, { role: "agent", text }];
    setHistory(next);
    setInput("");
    baseInputRef.current = "";
    void turn(next);
  }

  function toggleMic() {
    if (listening) return stopListening();
    const rec = getRecognition();
    if (!rec) return;
    baseInputRef.current = input ? input + " " : "";
    rec.onresult = (e) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      setInput(baseInputRef.current + t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }
  function stopListening() {
    if (recRef.current) { try { recRef.current.stop(); } catch {} recRef.current = null; }
    setListening(false);
  }
  useEffect(() => () => stopListening(), []);

  function finish() {
    onComplete({
      transcript: history,
      summary: summary || history.filter((m) => m.role === "agent").map((m) => m.text).join("\n"),
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Sparkles size={16} /> Stage intake · <span className="mono" style={{ fontSize: 12 }}>{fromStage || "New"} → {toStage}</span></h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-intro">
            <Bot size={14} /> Answer honestly — this becomes the permanent record for {company?.name || "this deal"}. I'll ask follow-ups until the picture is complete.
          </div>
          {history.map((m, i) => (
            <div className={`chat-msg chat-${m.role}`} key={i}>
              <span className="chat-avatar">{m.role === "ai" ? <Bot size={13} /> : <UserIcon size={13} />}</span>
              <div className="chat-bubble">{m.text}</div>
            </div>
          ))}
          {busy && <div className="chat-msg chat-ai"><span className="chat-avatar"><Bot size={13} /></span><div className="chat-bubble"><Loader2 size={14} className="spin" /></div></div>}
        </div>

        {done ? (
          <div className="chat-summary">
            <div className="ai-result-label"><CheckCircle2 size={12} /> Compiled note — edit if needed, then confirm to move the deal</div>
            <textarea rows={7} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="modal-actions" style={{ padding: "12px 0 0" }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={finish}><CheckCircle2 size={15} /> Confirm & move to {toStage}</button>
            </div>
          </div>
        ) : (
          <div className="chat-input-row">
            {micSupported && (
              <button className={`chat-mic ${listening ? "recording" : ""}`} onClick={toggleMic} title={listening ? "Stop recording" : "Dictate answer"} disabled={busy}>
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
            )}
            <textarea
              rows={2}
              placeholder={listening ? "Listening… speak your answer" : "Type your answer, or use the mic…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={busy}
            />
            <button className="btn btn-primary chat-send" onClick={send} disabled={busy || !input.trim()}><Send size={15} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
