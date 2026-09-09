import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const invoke = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ notes_imported: 1, pages_imported: 0 }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { tauriAdapter } from "../../src/lib/storage/tauri";
import {
  createDocumentKey,
  encryptDocument,
} from "../../src/lib/document-crypto";

afterEach(() => vi.unstubAllGlobals());

it("redacts stale search text for both object and legacy JSON-string encrypted content before native IPC", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const content = await encryptDocument(
    { ops: [{ insert: "secret" }] },
    await createDocumentKey("test-password"),
  );
  for (const encoded of [content, JSON.stringify(content)]) {
    await tauriAdapter.importData(
      JSON.stringify({
        notes: [{ id: "protected", content: encoded, search_text: "secret" }],
      }),
    );
    const [command, args] = invoke.mock.calls.at(-1)!;
    expect(command).toBe("import_data");
    const note = JSON.parse(args.json).notes[0];
    expect(note.content).toEqual(content);
    expect(note.search_text).toBe("");
    expect(args.replace).toBe(false);
  }
});
