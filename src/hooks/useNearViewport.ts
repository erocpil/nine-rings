import { useEffect, useState, type RefObject } from "react";

// One observer for the whole application rather than one per code block.
// Keep editable DOM mounted; defer only derived, expensive presentation work.
const listeners = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;
export function useNearViewport(ref: RefObject<HTMLElement>, enabled = true): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    observer ??= new IntersectionObserver(entries => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    }, { rootMargin: "800px 0px" });
    listeners.set(element, setNear);
    observer.observe(element);
    return () => {
      observer?.unobserve(element);
      listeners.delete(element);
      if (!listeners.size) { observer?.disconnect(); observer = undefined; }
    };
  }, [ref, enabled]);
  return near;
}
