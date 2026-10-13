import { MAX_LIBRARY_IMAGE_BYTES, imageDirectoryService } from "./directory-service";
import { getImageBlob } from "../storage/db-images";
import { readonlyImageSource } from "../readonly-image-source";
import { parseImageMetadata } from "./image-metadata";
import type { ViewedImage } from "./viewer-request";
export type ImagePropertyRows = [string, string][];
export async function imageProperties(
  image: ViewedImage,
  signal: AbortSignal,
): Promise<ImagePropertyRows> {
  const rows: ImagePropertyRows = [["名称", image.name || "图片"]];
  let blob: Blob | null = null;
  if (image.rootId && image.nodeId) {
    const root = (await imageDirectoryService.roots()).find(
      (root) => root.id === image.rootId,
    );
    rows.push(
      ["来源", root?.transient ? "临时选择文件" : "本机授权目录"],
      ["根目录", root?.name ?? "未知"],
      ["相对路径", image.nodeId],
    );
    const stat = await imageDirectoryService.stat(image.rootId, image.nodeId);
    if (stat.modified)
      rows.push(["修改时间", new Date(stat.modified).toLocaleString()]);
    if (stat.created)
      rows.push(["创建时间", new Date(stat.created).toLocaleString()]);
    blob = await imageDirectoryService.read(image.rootId, image.nodeId);
  } else if (image.src.startsWith("nr-image://")) {
    rows.push(["来源", "文档附件"], ["资源 ID", image.src.slice(11)]);
    blob = await getImageBlob(image.src);
  } else {
    const src = readonlyImageSource(image.src, document.baseURI);
    if (!src) throw new Error("无效的图片地址");
    const url = new URL(src, document.baseURI);
    rows.push([
      "来源",
      url.protocol === "data:"
        ? "文档内嵌图片"
        : url.protocol === new URL(document.baseURI).protocol &&
            url.host === new URL(document.baseURI).host
          ? "应用资源"
          : "网络图片",
    ]);
    if (url.protocol !== "data:") rows.push(["地址", url.href]);
    if (
      (url.protocol === new URL(document.baseURI).protocol &&
        url.host === new URL(document.baseURI).host) ||
      url.protocol === "data:"
    ) {
      const response = await fetch(url.href, { signal });
      if (!response.ok)
        throw new Error(`图片属性读取失败（${response.status}）`);
      if (Number(response.headers.get("content-length")) > MAX_LIBRARY_IMAGE_BYTES)
        throw new Error("图片超过 256 MB，未读取元信息");
      blob = await response.blob();
    } else rows.push(["文件元信息", "跨域图片未额外读取"]);
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (!blob) return rows;
  rows.push(
    [
      "文件大小",
      `${new Intl.NumberFormat().format(blob.size)} 字节（${(blob.size / 1024).toFixed(2)} KiB）`,
    ],
    ["MIME 类型", blob.type || "未提供"],
  );
  const metadata = parseImageMetadata(
    await blob.slice(0, 2 * 1024 * 1024).arrayBuffer(),
  );
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const format = metadata.format || blob.type.split("/")[1]?.toUpperCase();
  if (format) rows.push(["格式", format]);
  if (metadata.width && metadata.height)
    rows.push(
      ["原图像素", `${metadata.width} × ${metadata.height}`],
      [
        "像素数",
        `${((metadata.width * metadata.height) / 1_000_000).toFixed(3)} MP`,
      ],
      ["宽高比", (metadata.width / metadata.height).toFixed(3)],
      [
        "方向",
        metadata.width === metadata.height
          ? "正方形"
          : metadata.width > metadata.height
            ? "横向"
            : "纵向",
      ],
    );
  rows.push(...metadata.rows);
  return rows;
}
