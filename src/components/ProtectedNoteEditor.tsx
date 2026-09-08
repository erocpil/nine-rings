import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NoteEditorProps } from "./NoteEditor";
import type { DeltaOps } from "../types/models";
import { isEncrypted, openDocumentSession, unlockDocument } from "../lib/document-crypto";
import { requestPassword } from "../lib/password-request";
import { setDocumentPassword } from "../lib/document-protection";
import { blockEditorSessionCache } from "../lib/editor-session-cache";
import { sessionHeadingFoldStore } from "../lib/heading-fold";
import "./DocumentSecurity.css";

export function ProtectedNoteEditor({ props, render }: { props: NoteEditorProps; render: (props: NoteEditorProps) => ReactNode }) {
  const encrypted = isEncrypted(props.content);
  const [plain, setPlain] = useState<DeltaOps | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const flush = useRef(props.onFlush);
  flush.current = props.onFlush;
  if (encrypted) blockEditorSessionCache(props.noteId);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const close = release.current;
      release.current = null;
      // App's layout effect snapshots and queues the old document first. Never
      // drop its key before that queue has durably stored the ciphertext.
      void Promise.resolve().then(() => flush.current?.()).then(() => close?.()).catch(() => {
        // Keep the key only for retry/emergency encrypted export of failed saves.
      });
      sessionHeadingFoldStore.clear(props.noteId);
    };
  }, [props.noteId]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      props.onSecurityError?.(message);
      if (mounted.current) setError(message);
    }
    finally { if (mounted.current) setBusy(false); }
  };
  const lock = async () => {
    await props.onFlush?.();
    release.current?.(); release.current = null;
    setPlain(null); sessionHeadingFoldStore.clear(props.noteId);
    props.onOutlineAvailabilityChange?.(false);
  };
  const manage = (remove = false) => run(async () => {
    props.onProtectionBusy?.(true);
    try {
    await props.onFlush?.();
    await setDocumentPassword(props.noteId, remove);
    release.current?.(); release.current = null; setPlain(null);
    } finally {
      try { await props.onSecurityChanged?.(); }
      finally { props.onProtectionBusy?.(false); }
    }
  });
  if (encrypted && !plain) return <section className="protected-document" aria-label="加密文档">
    <h2>🔒 {props.title || "加密文档"}</h2>
    <p>输入密码后才能查看正文。搜索不会显示正文内容。</p>
    <button type="button" disabled={busy} onClick={() => void run(async () => {
      const opened = await requestPassword({ title: "打开加密文档", description: `${props.title || "文档"}\n离开后再次打开需要重新输入密码。` }, password => unlockDocument(props.content, password));
      if (!mounted.current) return;
      release.current?.(); release.current = openDocumentSession(props.noteId, opened.key);
      setPlain(opened.content);
    })}>输入密码打开</button>
    {error && <p role="alert">{error}</p>}
  </section>;
  const content = encrypted ? plain! : props.content;
  return <div className="protected-editor">
    {props.onSecurityChanged && <div className="document-security-bar">
      {encrypted && <span>🔒 正文已加密</span>}
      {encrypted && <button type="button" disabled={busy} onClick={() => void run(lock)}>锁定文档</button>}
      {!props.hideDocumentPasswordControls && <button type="button" disabled={busy || props.securityDisabled} onClick={() => void manage()}>{encrypted ? "更改文档密码" : "设置文档密码"}</button>}
      {!props.hideDocumentPasswordControls && encrypted && <button type="button" disabled={busy || props.securityDisabled} onClick={() => void manage(true)}>解除文档加密</button>}
      {error && <span role="alert">{error}</span>}
    </div>}
    {render({ ...props, readonly: props.readonly || busy, content, sensitive: encrypted, pdfExcerptSource: content.metadata?.pdfExcerpt, epubExcerptSource: content.metadata?.epubExcerpt,
      onContentChange: read => props.onContentChange(() => {
        const next = read();
        if (encrypted && mounted.current) setPlain(next);
        return next;
      }), searchTarget: encrypted ? null : props.searchTarget })}
  </div>;
}
