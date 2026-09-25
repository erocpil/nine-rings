import { useEffect, useRef, useState } from "react";
import { getImageUrl } from "../lib/storage/db-images";
import { useNearViewport } from "../hooks/useNearViewport";

export function ReadonlyImage({
  src,
  alt,
  title,
}: {
  src: string;
  alt?: string;
  title?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(host);
  const [resolved, setResolved] = useState("");
  useEffect(() => {
    if (!near) return;
    if (!src.startsWith("nr-image://")) {
      setResolved(/^(https?:|data:image\/|blob:)/i.test(src) ? src : "");
      return;
    }
    let cancelled = false,
      url: string | null = null;
    void getImageUrl(src)
      .then((value) => {
        if (cancelled) {
          if (value) URL.revokeObjectURL(value);
          return;
        }
        url = value;
        setResolved(value ?? "");
      })
      .catch(() => {
        if (!cancelled) setResolved("");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, near]);
  return (
    <span ref={host}>
      {resolved ? (
        <img
          src={resolved}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          decoding="async"
          style={{ maxWidth: "100%" }}
        />
      ) : (
        <span>{alt || "图片"}</span>
      )}
    </span>
  );
}
