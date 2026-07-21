import { useState } from "react";
import { XCircle, CheckCircle } from "lucide-react";
import { completePasswordRecovery } from "../lib/auth";
import { ElecbitsLogo } from "../components/ElecbitsLogo";

// Shown when the user arrives from a "forgot password" reset-link email. Supabase
// has placed them in a temporary recovery session; here they choose a new password.
export function ResetPasswordPage({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setNotice("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("The two passwords don't match"); return; }
    setBusy(true);
    const r = await completePasswordRecovery(password);
    setBusy(false);
    if (!r.success) { setError(r.error); return; }
    setNotice("Password updated — sign in with your new password.");
    setTimeout(onDone, 1500);
  }

  return (
    <div className="tw-scope min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <div className="mb-6 pb-4 border-b border-slate-100">
            <ElecbitsLogo size="lg" showTagline />
            <p className="text-xs text-slate-500 mt-2">RFQ · Approvals · Pipeline</p>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Set a new password</h2>
          <p className="text-sm text-slate-600 mb-6">Choose a new password for your account, then sign in with it.</p>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="At least 6 characters" className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Confirm New Password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Re-enter the new password" className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 flex items-center gap-2"><XCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
            {notice && <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 flex items-center gap-2"><CheckCircle className="w-4 h-4 flex-shrink-0" />{notice}</div>}
            <button onClick={submit} disabled={busy} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-60">{busy ? "Updating…" : "Update Password"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
