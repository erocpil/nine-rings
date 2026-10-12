import { useEffect, useState } from "react";
import {
  imageProperties,
  type ImagePropertyRows,
} from "../lib/image-library/image-properties";
import type { ViewedImage } from "../lib/image-library/viewer-request";
import { ToolbarIcon } from "./ToolbarIcon";
export function ImagePropertiesPanel({
  image,
  pinned,
  onPin,
  onClose,
  dimensions,
  decodedDimensions,
  zoom,
  rotation,
}: {
  image: ViewedImage;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  dimensions: { width: number; height: number };
  decodedDimensions: { width: number; height: number };
  zoom: number;
  rotation: number;
}) {
  const [rows, setRows] = useState<ImagePropertyRows>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    void imageProperties(image, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setRows(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [image]);
  const content: ImagePropertyRows = [
    ...rows,
    ...(decodedDimensions.width
      ? [
          [
            "解码原图像素",
            `${decodedDimensions.width} × ${decodedDimensions.height}`,
          ] as [string, string],
        ]
      : []),
    [
      "预览像素",
      dimensions.width
        ? `${dimensions.width} × ${dimensions.height}`
        : "正在加载",
    ],
    ["查看缩放", `${Math.round(zoom * 100)}%`],
    ["预览旋转", `${rotation}°（不修改原图）`],
  ];
  return (
    <aside
      className={`image-properties-panel${pinned ? " is-pinned" : ""}`}
      role="region"
      aria-label="图片属性"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="image-properties-heading">
        <strong>图片属性</strong>
        <button
          type="button"
          className="btn-icon"
          aria-label={pinned ? "取消固定图片属性" : "固定图片属性"}
          aria-pressed={pinned}
          title={pinned ? "取消固定" : "固定到图片右侧"}
          onClick={onPin}
        >
          <ToolbarIcon name="pin" />
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-label="关闭图片属性"
          title="关闭图片属性"
          onClick={onClose}
        >
          <ToolbarIcon name="close" />
        </button>
      </div>
      <div className="image-properties-content">
        {loading && <p role="status">正在读取属性…</p>}
        {error && <p role="alert">{error}</p>}
        <dl>
          {content.map(([label, value], index) => (
            <div key={`${label}:${index}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}
