import { useEffect, useMemo, useRef, useState } from "react";
import { useNearViewport } from "../hooks/useNearViewport";
import { imagePreview } from "../lib/image-library/preview-resource";
import type { ViewedImage } from "../lib/image-library/viewer-request";
import { ToolbarIcon } from "./ToolbarIcon";

export function ImageThumbnail({
  image,
  active = true,
}: {
  image: ViewedImage;
  active?: boolean;
}) {
  const { src, name, rootId, nodeId } = image;
  const target = useMemo(
    () => ({ src, name, rootId, nodeId }),
    [src, name, rootId, nodeId],
  );
  const host = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(host, active);
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!near) return;
    const controller = new AbortController();
    let release = () => {};
    void imagePreview(target, controller.signal, 128)
      .then((resource) => {
        release = resource.release;
        if (!controller.signal.aborted) setUrl(resource.url);
        else release();
      })
      .catch(() => {});
    return () => {
      controller.abort();
      release();
    };
  }, [near, target]);
  return (
    <span ref={host} className="image-tree-thumbnail">
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <ToolbarIcon name="image" />
      )}
    </span>
  );
}
