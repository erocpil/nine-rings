import { useEffect, useState, type RefObject } from "react";

/** Small badges need a separate action target; never cover their content. */
export function useCompactImage(imageRef: RefObject<HTMLImageElement>, source: string | null, enabled: boolean) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const image = imageRef.current;
    if (!image || !enabled) return;
    const update = (width: number, height: number) => setCompact(width > 0 && height > 0 && (height <= 40 || width <= 64 && height <= 64));
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect;
      if (size) update(size.width, size.height);
    });
    observer.observe(image);
    return () => observer.disconnect();
  }, [imageRef, source, enabled]);
  return enabled && compact;
}
