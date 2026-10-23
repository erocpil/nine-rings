import { useEffect, useState, type RefObject } from "react";

/** A cleared input can remain a draft while storage assigns a nonempty name. */
export function useDocumentTitleDraft(title: string | null | undefined, input: RefObject<HTMLInputElement>) {
  const [draft, setDraft] = useState(title ?? "");
  useEffect(() => {
    if (document.activeElement === input.current && !input.current?.value.trim()) return;
    setDraft(title ?? "");
  }, [title, input]);
  return { draft, setDraft, finish: () => setDraft(title ?? "") };
}
