import { DocumentResourceContext } from "./DocumentResourceContext";
import { requestImageView } from "../lib/image-library/viewer-request";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { ToolbarIcon } from "./ToolbarIcon";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getImageUrl } from "../lib/storage/db-images";
import { useNearViewport } from "../hooks/useNearViewport";
import { readonlyImageSource } from "../lib/readonly-image-source";
import { useCompactImage } from "../hooks/useCompactImage";

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
  const resolveResource = useContext(DocumentResourceContext);
  const imagePanels = useSyncExternalStore(workspacePanels.subscribe, workspacePanels.getSnapshot);
  const host = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(host);
  const [resolved, setResolved] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const compact = useCompactImage(imageRef, resolved, imagePanels.length > 0);
  useEffect(() => {
    if (!near) return;
    if (!src.startsWith("nr-image://")) {
      if (!resolveResource) { setResolved(readonlyImageSource(src, document.baseURI)); return; }
      let cancelled = false;
      void resolveResource(src).then(uri => { if (!cancelled) setResolved(uri ?? readonlyImageSource(src, document.baseURI)); }, () => { if (!cancelled) setResolved(readonlyImageSource(src, document.baseURI)); });
      return () => { cancelled = true; };
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
  }, [src, near, resolveResource]);
  return (
    <span ref={host} className="document-image-view-host" data-image-compact={compact || undefined}>
      {resolved ? (
        <img
          ref={imageRef}
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
      {resolved && imagePanels.length > 0 && <button type="button" className="btn-icon document-image-view-button" aria-label="查看图片" title="查看图片" onClick={event => {event.preventDefault();event.stopPropagation();requestImageView({src:resolveResource ? resolved : src,name:alt||title||"文档图片"});}}><ToolbarIcon name="image" /></button>}
    </span>
  );
}
