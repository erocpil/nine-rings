import { isCertifiedHTMLSource } from "./html-body-policy";
import { isCertifiedInlineAtomAttributes } from "./inline-atom-policy";
import { isCertifiedImageSource } from "./image-source-policy";
import { imageDimensionPixels } from "../markdown-image-dimensions";
export { isCertifiedImageSource } from "./image-source-policy";

export function isCertifiedBlockImage(
  source: unknown,
  attrs: Record<string, unknown>,
): boolean {
  if (!isCertifiedImageSource(source)) return false;
  return Object.entries(attrs).every(([key, value]) => {
    if (key === "indent")
      return (
        Number.isInteger(value) &&
        (value as number) >= 1 &&
        (value as number) <= 8
      );
    if (key === "indent-explicit") return value === true;
    if (key === "imageAlt" || key === "imageTitle")
      return isCertifiedHTMLSource(value) && value.length > 0;
    if (key === "imageHeight")
      return typeof value === "number" && imageDimensionPixels(value) !== undefined;
    if (key === "imageWidth")
      return (
        (Number.isSafeInteger(value) && (value as number) > 0) ||
        (typeof value === "string" &&
          /^[1-9]\d*px$/.test(value) &&
          Number.isSafeInteger(Number(value.slice(0, -2))))
      );
    return false;
  });
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Inline atoms retain their marks and their exact position in the paragraph. */
export function isCertifiedInlineImage(
  value: unknown,
  attrs: Record<string, unknown>,
): boolean {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["src", "alt", "title", "width", "height"].includes(key),
    ) ||
    !isCertifiedImageSource(value.src) ||
    !isCertifiedHTMLSource(value.alt) ||
    !(
      value.title === null ||
      (isCertifiedHTMLSource(value.title) && value.title.length > 0)
    ) ||
    (value.width !== undefined &&
      !isCertifiedBlockImage(value.src, { imageWidth: value.width })) ||
    (value.height !== undefined &&
      !isCertifiedBlockImage(value.src, { imageHeight: value.height }))
  )
    return false;
  return isCertifiedInlineAtomAttributes(attrs);
}
