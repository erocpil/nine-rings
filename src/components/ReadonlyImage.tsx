import { useEffect, useRef, useState } from "react";
import { getImageUrl } from "../lib/storage/db-images";
import { useNearViewport } from "../hooks/useNearViewport";
import { readonlyImageSource } from "../lib/readonly-image-source";

export function ReadonlyImage({
  src,
  alt,
  title,
  width,
}: {
  src: string;
  alt?: string;
  title?: string;
  width?: string | null;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(host);
  const [resolved, setResolved] = useState("");
  useEffect(() => {
    if (!near) return;
    if (!src.startsWith("nr-image://")) {
      setResolved(readonlyImageSource(src, document.baseURI));
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
          style={{ maxWidth: "100%", width: width || undefined }}
        />
      ) : (
        <span>{alt || "图片"}</span>
      )}
    </span>
  );
}
