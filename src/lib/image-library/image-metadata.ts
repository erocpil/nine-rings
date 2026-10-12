export interface ImageMetadata {
  format?: string;
  width?: number;
  height?: number;
  rows: [string, string][];
}
/** Bounded header/EXIF reader. Offsets are checked; metadata is text, never HTML. */
export function parseImageMetadata(buffer: ArrayBuffer): ImageMetadata {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const result: ImageMetadata = { rows: [] };
  const has = (offset: number, length: number) =>
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    length >= 0 &&
    offset + length <= bytes.length;
  const text = (offset: number, length: number) =>
    new TextDecoder()
      .decode(bytes.subarray(offset, offset + length))
      .replace(/\0.*$/s, "")
      .trim();
  const exif = (base: number, length: number) => {
    if (!has(base, length) || length < 8) return;
    const little = text(base, 2) === "II";
    if (!little && text(base, 2) !== "MM") return;
    const u16 = (offset: number) => view.getUint16(base + offset, little);
    const u32 = (offset: number) => view.getUint32(base + offset, little);
    const inside = (offset: number, size: number) =>
      offset >= 0 && offset + size <= length;
    if (u16(2) !== 42) return;
    const labels: Record<number, string> = {
      0x10f: "相机品牌",
      0x110: "相机型号",
      0x112: "EXIF 方向",
      0x11a: "水平分辨率",
      0x11b: "垂直分辨率",
      0x128: "分辨率单位",
      0x131: "软件",
      0x132: "图像时间",
      0x8298: "版权",
      0x829a: "曝光时间（秒）",
      0x829d: "光圈 F",
      0x8827: "ISO",
      0x9003: "拍摄时间",
      0x9004: "数字化时间",
      0x9204: "曝光补偿",
      0x9209: "闪光灯标记",
      0x920a: "焦距（mm）",
      0xa001: "EXIF 色彩空间",
      0xa002: "EXIF 宽度",
      0xa003: "EXIF 高度",
      0xa405: "等效焦距（mm）",
      0xa434: "镜头型号",
    };
    const pending = [u32(4)];
    const seen = new Set<number>();
    let entries = 0;
    while (pending.length && entries < 256 && seen.size < 4) {
      const offset = pending.shift()!;
      if (seen.has(offset) || !inside(offset, 2)) continue;
      seen.add(offset);
      const count = Math.min(u16(offset), 128);
      for (let i = 0; i < count && entries++ < 256; i++) {
        const at = offset + 2 + i * 12;
        if (!inside(at, 12)) break;
        const tag = u16(at),
          type = u16(at + 2),
          count = u32(at + 4);
        if (tag === 0x8769) {
          pending.push(u32(at + 8));
          continue;
        }
        if (tag === 0x8825) {
          result.rows.push(["GPS 信息", "包含 GPS 标签"]);
          continue;
        }
        if (!labels[tag]) continue;
        const sizes: Record<number, number> = {
          1: 1,
          2: 1,
          3: 2,
          4: 4,
          5: 8,
          9: 4,
          10: 8,
        };
        const size = sizes[type] * count;
        if (!size || size > 4096) continue;
        const location = size <= 4 ? at + 8 : u32(at + 8);
        if (!inside(location, size)) continue;
        let value: string;
        if (type === 2) value = text(base + location, size);
        else if (type === 3) value = String(u16(location));
        else if (type === 4) value = String(u32(location));
        else if (type === 5 || type === 10) {
          const numerator =
            type === 10
              ? view.getInt32(base + location, little)
              : u32(location);
          const denominator =
            type === 10
              ? view.getInt32(base + location + 4, little)
              : u32(location + 4);
          if (!denominator) continue;
          value = Number((numerator / denominator).toFixed(5)).toString();
          if (tag === 0x829a && numerator > 0 && denominator > numerator)
            value = `${numerator}/${denominator}`;
        } else continue;
        if (tag === 0x112)
          value =
            (
              {
                1: "1 · 正常",
                2: "2 · 水平镜像",
                3: "3 · 旋转 180°",
                4: "4 · 垂直镜像",
                5: "5 · 转置",
                6: "6 · 顺时针 90°",
                7: "7 · 转置镜像",
                8: "8 · 逆时针 90°",
              } as Record<string, string>
            )[value] ?? value;
        if (tag === 0x128)
          value =
            ({ 2: "英寸", 3: "厘米" } as Record<string, string>)[value] ??
            value;
        if (tag === 0xa001)
          value =
            ({ 1: "sRGB", 65535: "未校准" } as Record<string, string>)[value] ??
            value;
        if (value) result.rows.push([labels[tag], value]);
      }
    }
  };
  try {
    if (has(0, 26) && bytes[0] === 137 && text(1, 3) === "PNG") {
      result.format = "PNG";
      result.width = view.getUint32(16);
      result.height = view.getUint32(20);
      result.rows.push(
        ["每通道位深", String(bytes[24])],
        [
          "颜色类型",
          (
            {
              0: "灰度",
              2: "RGB",
              3: "索引色",
              4: "灰度 + Alpha",
              6: "RGBA",
            } as Record<number, string>
          )[bytes[25]] ?? String(bytes[25]),
        ],
      );
      let at = 8,
        chunks = 0;
      while (has(at, 12) && chunks++ < 256) {
        const size = view.getUint32(at);
        if (!has(at + 8, size + 4)) break;
        const kind = text(at + 4, 4);
        if (kind === "pHYs" && size >= 9)
          result.rows.push([
            "像素密度",
            `${view.getUint32(at + 8)} × ${view.getUint32(at + 12)} ${bytes[at + 16] === 1 ? "像素/米" : "（相对）"}`,
          ]);
        if (kind === "sRGB") result.rows.push(["色彩空间", "sRGB"]);
        if (kind === "iCCP")
          result.rows.push(["ICC 配置", text(at + 8, Math.min(size, 80))]);
        if (kind === "acTL" && size >= 8)
          result.rows.push(["动画帧数", String(view.getUint32(at + 8))]);
        if (kind === "eXIf") exif(at + 8, size);
        at += size + 12;
      }
    } else if (has(0, 10) && /^GIF8[79]a$/.test(text(0, 6))) {
      result.format = text(0, 6);
      result.width = view.getUint16(6, true);
      result.height = view.getUint16(8, true);
    } else if (has(0, 26) && text(0, 2) === "BM") {
      result.format = "BMP";
      result.width = Math.abs(view.getInt32(18, true));
      result.height = Math.abs(view.getInt32(22, true));
      if (has(28, 2))
        result.rows.push(["每像素位深", String(view.getUint16(28, true))]);
    } else if (has(0, 16) && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
      result.format = "WebP";
      if (text(12, 4) === "VP8X" && has(20, 10)) {
        result.width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
        result.height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
        result.rows.push(
          ["透明通道", bytes[20] & 16 ? "有" : "无"],
          ["动画", bytes[20] & 2 ? "有" : "无"],
        );
      }
    } else if (has(0, 2) && bytes[0] === 255 && bytes[1] === 216) {
      result.format = "JPEG";
      let at = 2,
        markers = 0;
      while (has(at, 4) && markers++ < 256) {
        if (bytes[at] !== 255) break;
        const marker = bytes[at + 1];
        if (marker === 218 || marker === 217) break;
        const size = view.getUint16(at + 2);
        if (size < 2 || !has(at + 2, size)) break;
        if (
          [
            192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
          ].includes(marker) &&
          size >= 8
        ) {
          result.height = view.getUint16(at + 5);
          result.width = view.getUint16(at + 7);
          result.rows.push(
            ["每通道位深", String(bytes[at + 4])],
            ["编码", marker === 194 ? "渐进式 JPEG" : "JPEG"],
          );
        }
        if (marker === 225 && text(at + 4, 6) === "Exif")
          exif(at + 10, size - 8);
        if (marker === 226 && text(at + 4, 12) === "ICC_PROFILE")
          result.rows.push(["ICC 配置", "内嵌配置文件"]);
        at += size + 2;
      }
    }
  } catch {
    /* Corrupt metadata never prevents viewing the image. */
  }
  return result;
}
