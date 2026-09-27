import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { EDITOR_SESSION_SAVED } from "../lib/editor-session-cache";
import { subscribeToDataChanges } from "../lib/tab-coordination";
import { createPortal } from "react-dom";

const ActiveDocument = createContext(true);
export const useDocumentActive = () => useContext(ActiveDocument);

type Session = { key: string; node: ReactNode; sensitive: boolean; revision: string; generation: number };

/** Three live sessions, oldest unused first. Park DOM outside the document so
 * cached editors cannot participate in focus, hit testing or document queries. */
export function RetainedDocument({ sessionKey, revision, ready = true, sensitive = false, children }: {
  sessionKey: string | null; revision: string; ready?: boolean; sensitive?: boolean; children: ReactNode;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [previousKey, setPreviousKey] = useState<string | null>(null);
  const generation = useRef(0);
  const host = useRef<HTMLDivElement>(null);
  let visibleSessions = sessions;
  if (previousKey !== sessionKey) {
    visibleSessions = sessions.filter(entry => !entry.sensitive && entry.key !== sessionKey);
    const existing = sessions.find(entry => entry.key === sessionKey && entry.revision === revision);
    if (sessionKey) visibleSessions = [...visibleSessions, existing ?? { key: sessionKey, node: children, sensitive, revision, generation: ++generation.current }].slice(-3);
    setPreviousKey(sessionKey);
    setSessions(visibleSessions);
  }
  useEffect(() => {
    const saved = (event: Event) => {
      const { noteId, revision: next } = (event as CustomEvent<{ noteId: string; revision: string }>).detail;
      setSessions(current => current.map(entry => entry.key.split(":")[0] === noteId ? { ...entry, revision: next } : entry));
    };
    window.addEventListener(EDITOR_SESSION_SAVED, saved);
    return () => window.removeEventListener(EDITOR_SESSION_SAVED, saved);
  }, []);
  useEffect(() => subscribeToDataChanges(event => {
    setSessions(current => current.filter(entry => entry.key === sessionKey
      || (event.type !== "data-imported" && entry.key.split(":")[0] !== event.noteId)));
  }), [sessionKey]);
  useLayoutEffect(() => {
    const entry = sessions.find(item => item.key === sessionKey);
    if (entry && ready) { entry.node = children; entry.sensitive = sensitive; entry.revision = revision; }
  }, [children, sensitive, sessionKey, sessions, revision, ready]);
  return <div ref={host} className="retained-document-host">
    {sessionKey === null ? children : null}
    {visibleSessions.map(entry => <ParkedDocument key={`${entry.key}:${entry.generation}`} active={entry.key === sessionKey} host={host}>
      {entry.key === sessionKey && ready ? children : entry.node}
    </ParkedDocument>)}
  </div>;
}

function ParkedDocument({ active, host, children }: {
  active: boolean; host: React.RefObject<HTMLDivElement>; children: ReactNode;
}) {
  const [container] = useState(() => {
    const node = document.createElement("div");
    node.className = "retained-document-session";
    return node;
  });
  const scroll = useRef<Array<{ node: Element; top: number; left: number }>>([]);
  useLayoutEffect(() => {
    container.toggleAttribute("inert", !active);
    if (active && host.current) {
      host.current.append(container);
      for (const position of scroll.current) {
        position.node.scrollTop = position.top;
        position.node.scrollLeft = position.left;
      }
    }
    return () => {
      if (!container.isConnected) return;
      scroll.current = [...container.querySelectorAll("*")]
        .filter(node => node.scrollTop || node.scrollLeft)
        .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
      container.setAttribute("inert", "");
      container.remove();
    };
  }, [active, container, host]);
  return createPortal(<ActiveDocument.Provider value={active}>{children}</ActiveDocument.Provider>, container);
}
