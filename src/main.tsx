import React, { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { supabaseEnabled, supabaseInitError, supabaseConfigured, supabaseUrl } from "./lib/supabase";

/* ─── ERROR BOUNDARY ─────────────────────────────────────────────────────────
   Any render-time crash shows a readable message instead of a blank page, so a
   bad config surfaces its cause rather than a white void. Without this, every
   misconfiguration and every render bug look identical from the outside: a page
   that does not load.                                                         */
class ErrorBoundary extends Component<{ children: ReactNode }, { err: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err: any) { return { err }; }
  componentDidCatch(err: any, info: any) { console.error("App crashed:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <Diagnostic
        title="Something went wrong loading the app"
        body={
          <>
            This is almost always a bad environment variable — most often{" "}
            <code style={codeStyle}>VITE_SUPABASE_URL</code> (it must be exactly{" "}
            <code style={codeStyle}>https://&lt;ref&gt;.supabase.co</code>, with no quotes, spaces
            or trailing slash). Fix it in Vercel and redeploy.
          </>
        }
        detail={String(this.state.err?.message || this.state.err)}
      />
    );
  }
}

/* ─── CONFIG DIAGNOSTIC ──────────────────────────────────────────────────────
   Supabase could not start. supabase.ts already repaired the repairable
   (quotes, whitespace, trailing slash, a pasted dashboard URL), so whatever is
   left needs a human. Name it on screen — the alternative is a login form that
   fails silently on every attempt.                                            */
function SupabaseConfigError() {
  return (
    <Diagnostic
      title={supabaseConfigured ? "Supabase is configured, but could not start" : "Supabase is not configured"}
      body={
        supabaseConfigured ? (
          <>
            The values are present but unusable. Check them in Vercel → Settings →
            Environment Variables, then <strong>redeploy</strong> — Vite reads{" "}
            <code style={codeStyle}>VITE_*</code> at BUILD time, so changing them without a rebuild
            does nothing.
            {supabaseUrl ? (
              <> The URL this build resolved to was <code style={codeStyle}>{supabaseUrl}</code>.</>
            ) : null}
          </>
        ) : (
          <>
            Copy <code style={codeStyle}>.env.example</code> to{" "}
            <code style={codeStyle}>.env.local</code> and fill in{" "}
            <code style={codeStyle}>VITE_SUPABASE_URL</code> and{" "}
            <code style={codeStyle}>VITE_SUPABASE_ANON_KEY</code> (Supabase → Settings → API). The
            anon key is public and gated by row-level security, so it is safe in the browser.
          </>
        )
      }
      detail={supabaseInitError}
    />
  );
}

/* Shared shell for both messages. Deliberately inline-styled and dependency-
   free: this has to render when the app itself cannot, so it must not rely on
   Tailwind having loaded or on any component in App.tsx. */
const codeStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.92em",
  background: "#eef2f7",
  padding: "1px 5px",
  borderRadius: 3,
};

function Diagnostic({ title, body, detail }: { title: string; body: ReactNode; detail?: string }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, background: "#f8fafc", color: "#1e293b",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{ maxWidth: 560 }}>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "#475569", marginBottom: 14, lineHeight: 1.6 }}>{body}</div>
        {detail ? (
          <pre style={{
            fontSize: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
            padding: 12, whiteSpace: "pre-wrap", color: "#dc2626", margin: 0,
          }}>{detail}</pre>
        ) : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {supabaseEnabled ? <App /> : <SupabaseConfigError />}
    </ErrorBoundary>
  </React.StrictMode>
);
