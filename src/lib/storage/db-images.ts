import { uuid, now, blobToBase64 } from "./core";
import { withDB, getOne, putRecord } from "./db";
import { isTauriRuntime } from "../runtime";

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

type NoteContext = {
  id?: string;
  title?: string;
  storagePath?: string;
};

type ImageRefLocation = {
  object: Record<string, unknown>;
  key: string;
  note: NoteContext | null;
};

function noteContextOf(node: unknown): NoteContext | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const candidate = node as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id : undefined;
  if (!id) return null;
  const hasNoteContent = candidate.content !== undefined || candidate.date !== undefined;
  const title =
    typeof candidate.title === "string" ? candidate.title : undefined;
  const storagePath =
    typeof candidate.storagePath === "string" ? candidate.storagePath : undefined;
  if (!hasNoteContent) return null;
  return { id, title, storagePath };
}

function formatNoteLabel(note: NoteContext): string {
  const name = note.title?.trim() || "(无标题)";
  const suffix = note.storagePath ? ` · ${note.storagePath}` : "";
  const id = note.id ? ` · ${note.id}` : "";
  return `${name}${suffix}${id}`;
}

function formatDeviceLabel(): string {
  const platform =
    typeof navigator === "undefined" ? "未知平台" : navigator.platform || "未知平台";
  const mode = isTauriRuntime() ? "Tauri" : "Web";
  return `${mode} / ${platform}`;
}

function buildMissingImageError(
  missingRefs: Map<string, Set<NoteContext>>,
): string {
  const parts = [...missingRefs.entries()]
    .map(([ref, notes]) => {
      const linkedNotes = [...notes]
        .map((note) => formatNoteLabel(note))
        .join("；");
      return `  ${ref} ← ${linkedNotes || "未定位到文档"}`;
    })
    .join("\n");
  const device = formatDeviceLabel();
  return `备份缺少本地图片（设备：${device}）：\n${parts}\n请恢复对应图片后重试`;
}

/** Resolve Delta, nested tables and ProseMirror images on both backends.
 * Read transactions finish before FileReader runs. Convert one unique image at a time.
 * Missing resources fail explicitly instead of producing an incomplete backup.
 */
export async function resolveImageRefs<T>(value: T): Promise<T> {
  const copy = structuredClone(value);
  const locations = new Map<string, ImageRefLocation[]>();
  function visit(node: unknown, currentNote: NoteContext | null = null): void {
    if (!node || typeof node !== "object") return;
    const nextNote = noteContextOf(node) ?? currentNote;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, nextNote);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (
        ["src", "image", "resizableImage"].includes(key) &&
        typeof child === "string" &&
        child.startsWith("nr-image://")
      ) {
        const items = locations.get(child) ?? [];
        items.push({ object: node as Record<string, unknown>, key, note: nextNote });
        locations.set(child, items);
      } else visit(child, nextNote);
    }
  }
  visit(copy);
  const missing = new Map<string, Set<NoteContext>>();
  for (const [ref, items] of locations) {
    const blob = await getImageBlob(ref);
    if (!blob) {
      const refs = new Set<NoteContext>();
      for (const { note } of items) {
        if (note) refs.add(note);
      }
      if (refs.size === 0) refs.add({});
      missing.set(ref, refs);
      continue;
    }
    const encoded = await blobToBase64(blob);
    for (const { object, key } of items) object[key] = encoded;
  }
  if (missing.size > 0) throw new Error(buildMissingImageError(missing));
  return copy;
}
