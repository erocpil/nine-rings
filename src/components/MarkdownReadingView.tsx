import { useCallback, useEffect, useMemo } from "react";
import { DocumentReadingView, DOCUMENT_READING_NAVIGATE_EVENT, type DocumentReadingSession, type DocumentReadingViewProps } from "./DocumentReadingView";
import { markdownContentFingerprint } from "../lib/external-markdown-source";
import { patchReadingState, readReadingState } from "../lib/reading-state";
import { sessionHeadingFoldStore } from "../lib/heading-fold";

export const MARKDOWN_READING_NAVIGATE_EVENT = DOCUMENT_READING_NAVIGATE_EVENT;
let projectionSequence = 0;
/** Only the local adapter knows the file identity, revision and device store. */
export interface MarkdownReadingSession extends DocumentReadingSession {
  readonly identity: string;
  readonly source: string;
  hydrated?: boolean;
}
export function MarkdownReadingView(props: Omit<DocumentReadingViewProps, "session" | "onStateChange"> & { session: MarkdownReadingSession }) {
  const { session, source } = props;
  const key = `local-file:${session.identity}`;
  const revision = useMemo(() => markdownContentFingerprint(source), [source]);
  // Resolving local resource URLs may replace a projection without changing
  // its raw source. Remount that view while keeping the same reading session.
  const projection = useMemo(() => ({ doc: props.doc, id: ++projectionSequence }), [props.doc]);
  useMemo(() => {
    if (session.hydrated) return;
    const saved = readReadingState(key);
    if (saved.blocks?.revision === revision) {
      for (const [at, state] of saved.blocks.entries) session.states.set(at, state);
      session.scrollTop = saved.rendered?.scrollTop ?? session.scrollTop;
    }
    session.hydrated = true;
  }, [session, key, revision]);
  const persist = useCallback(() => {
    patchReadingState(key, { rendered: { scrollTop: session.scrollTop }, blocks: { revision, entries: [...session.states] } });
    sessionHeadingFoldStore.save(key, { version: 1, collapsedKeys: [...session.foldedHeadings] });
  }, [key, session, revision]);
  useEffect(() => {
    window.addEventListener("pagehide", persist);
    return () => { window.removeEventListener("pagehide", persist); persist(); };
  }, [persist]);
  return <DocumentReadingView key={`${session.identity}:${revision}:${projection.id}`} {...props} sourceCopyLabel="复制 Markdown 原文" label="Markdown 渲染" className={`markdown-reading-view ${props.className ?? ""}`} onStateChange={persist} />;
}
