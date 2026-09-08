import { useEffect, useRef, useState } from "react";
import { registerPasswordPrompt, type PendingPasswordPrompt } from "../lib/password-request";
import { useDialogFocus } from "../hooks/useDialogFocus";
import "./DocumentSecurity.css";

export function PasswordDialogHost() {
  const [prompt, setPrompt] = useState<PendingPasswordPrompt | null>(null);
  useEffect(() => registerPasswordPrompt(setPrompt), []);
  return prompt ? <PasswordDialog key={prompt.title} prompt={prompt} /> : null;
}
function PasswordDialog({ prompt }: { prompt: PendingPasswordPrompt }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useDialogFocus(root, true, input);
  return <div className="dialog-overlay protection-overlay" onClick={() => { if (!busyRef.current) prompt.cancel(); }}>
    <div ref={root} className="dialog protection-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title"
      onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!busyRef.current) prompt.cancel(); } }}>
      <div className="dialog-header"><h3 id="password-title">{prompt.title}</h3><button type="button" className="dialog-close" aria-label="关闭密码对话框" disabled={busy} onClick={prompt.cancel}>×</button></div>
      <form className="dialog-body" onSubmit={async e => {
        e.preventDefault();
        if (busyRef.current) return;
        if (prompt.newPassword && (password.length < 8 || password !== repeat)) { setError(password.length < 8 ? "密码至少需要 8 个字符" : "两次密码不一致"); return; }
        busyRef.current = true; setBusy(true); setError("");
        try { await prompt.submit(password); setPassword(""); setRepeat(""); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { busyRef.current = false; setBusy(false); }
      }}>
        <p className="protection-description">{prompt.description}</p>
        <label>密码<input ref={input} type="password" autoComplete={prompt.newPassword ? "new-password" : "current-password"} value={password} maxLength={1024} disabled={busy} onChange={e => setPassword(e.target.value)} required /></label>
        {prompt.newPassword && <label>确认密码<input type="password" autoComplete="new-password" value={repeat} maxLength={1024} disabled={busy} onChange={e => setRepeat(e.target.value)} required /></label>}
        {error && <p role="alert">{error}</p>}
        <div className="protection-actions"><button type="button" disabled={busy} onClick={prompt.cancel}>取消</button><button type="submit" disabled={busy}>{busy ? "正在处理…" : prompt.newPassword ? "设置密码" : "验证密码"}</button></div>
      </form>
    </div>
  </div>;
}
