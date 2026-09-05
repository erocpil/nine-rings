import { uuid, now, blobToBase64 } from "./core";
import { withDB, getOne, putRecord } from "./db";

export async function storeImage(blob: Blob): Promise<string> {
  const id = uuid();
  await withDB(async (db) =>
    putRecord(db.transaction("images", "readwrite").objectStore("images"), {
      id,
      blob,
      stored_at: now(),
    }),
  );
  return `nr-image://${id}`;
}

async function getImageBlob(ref: string): Promise<Blob | null> {
  return withDB(
    async (db) =>
      (
        await getOne<{ blob: Blob }>(
          db.transaction("images").objectStore("images"),
          ref.slice("nr-image://".length),
        )
      )?.blob ?? null,
  );
}

export async function getImageUrl(ref: string): Promise<string | null> {
  const blob = await getImageBlob(ref);
  return blob ? URL.createObjectURL(blob) : null;
}

/** Resolve Delta, nested tables and ProseMirror images on both backends.
 * Read transactions finish before FileReader runs. Convert one unique image at a time.
 * Missing resources fail explicitly instead of producing an incomplete backup.
 */
export async function resolveImageRefs<T>(value: T): Promise<T> {
  const copy = structuredClone(value);
  const locations = new Map<
    string,
    { object: Record<string, any>; key: string }[]
  >();
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (
        ["src", "image", "resizableImage"].includes(key) &&
        typeof child === "string" &&
        child.startsWith("nr-image://")
      ) {
        const items = locations.get(child) ?? [];
        items.push({ object: node as Record<string, any>, key });
        locations.set(child, items);
      } else visit(child);
    }
  }
  visit(copy);
  for (const [ref, items] of locations) {
    const blob = await getImageBlob(ref);
    if (!blob) throw new Error(`备份缺少本地图片：${ref}；请恢复图片后重试`);
    const encoded = await blobToBase64(blob);
    for (const { object, key } of items) object[key] = encoded;
  }
  return copy;
}
