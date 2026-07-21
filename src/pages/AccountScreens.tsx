import { Loader2, LogOut, Zap } from "lucide-react";
import { APP_STYLES } from "../styles/appStyles";

export function AuthSplash({ message = "Loading…" }) {
  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>
      <div className="login-screen">
        <div className="dept-select-card" style={{ textAlign: "center" }}>
          <div className="login-brand" style={{ justifyContent: "center" }}>
            <Zap size={22} className="brand-bolt" fill="currentColor" />
            <span className="brand-text">Elecbits</span>
          </div>
          <p className="login-sub" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 18 }}>
            <Loader2 size={16} className="spin" /> {message}
          </p>
        </div>
      </div>
    </div>
  );
}

export function AccountNotice({ title, body, onSignOut }) {
  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>
      <div className="login-screen">
        <div className="dept-select-card" style={{ textAlign: "center" }}>
          <div className="login-brand" style={{ justifyContent: "center" }}>
            <Zap size={22} className="brand-bolt" fill="currentColor" />
            <span className="brand-text">Elecbits</span>
          </div>
          <h1 className="login-heading" style={{ textAlign: "center", marginTop: 16 }}>{title}</h1>
          <p className="login-sub" style={{ textAlign: "center" }}>{body}</p>
          <button className="btn btn-secondary" style={{ margin: "18px auto 0" }} onClick={onSignOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
