import { expect, type Page } from "@playwright/test";
import { closeDocumentSidebar } from "./workspace";

/** Writable File System Access fixture: stable mtimes, atomic close and real
 * in-memory rename. File operations remain observable without touching disk. */
export async function openWritableLocalDirectory(page: Page, files: Record<string, string>, selected: string) {
  await closeDocumentSidebar(page);
  await page.evaluate(async initial => {
    const { setPluginsEnabled } = await import("/src/lib/plugin-system/runtime.ts");
    const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
    setPluginsEnabled(true); saveLocalFilesEnabled(true);
    const nodes = new Map<string, any>();
    let clock = Date.now();
    const missing = () => new DOMException("missing", "NotFoundError");
    function directory(name: string, parent?: any): any {
      const children = new Map<string, any>();
      const node: any = { name, kind: "directory", children,
        async *values() { yield* children.values(); },
        queryPermission: async () => "granted", requestPermission: async () => "granted",
        async getDirectoryHandle(key: string) { const result = children.get(key); if (result?.kind !== "directory") throw missing(); return result; },
        async getFileHandle(key: string) { const result = children.get(key); if (result?.kind !== "file") throw missing(); return result; },
        async move(destination: any, next: string) { parent?.children.delete(node.name); destination.children.set(next, node); node.name = next; parent = destination; },
      }; return node;
    }
    const root = directory("canonical-fixture");
    for (const [path, value] of Object.entries(initial)) {
      let text = value, modified = ++clock;
      const parts = path.split("/"); let parent = root;
      for (const part of parts.slice(0, -1)) { if (!parent.children.has(part)) parent.children.set(part, directory(part, parent)); parent = parent.children.get(part); }
      const name = parts[parts.length - 1]!;
      const node: any = { name, kind: "file", writes: 0,
        getFile: async () => new File([text], node.name, { lastModified: modified, type: node.name.endsWith(".svg") ? "image/svg+xml" : "text/plain" }),
        setText: (value: string) => { text = value; modified = ++clock; }, read: () => text,
        async createWritable() { let pending = text; return { write: async (value: string) => { pending = value; }, close: async () => { if (node.beforeClose) await node.beforeClose(); text = pending; modified = ++clock; node.writes++; }, abort: async () => {} }; },
        async move(destination: any, next?: string) { if (typeof destination === "string") { next = destination; destination = parent; } parent.children.delete(node.name); destination.children.set(next, node); node.name = next; parent = destination; },
      };
      parent.children.set(name, node); nodes.set(path, node);
    }
    (window as any).__localWorkspaceFixture = { root, nodes };
    Object.defineProperty(window, "showDirectoryPicker", { value: async () => root, configurable: true });
  }, files);
  await page.getByRole("button", { name: "本地文件", exact: true }).click();
  const tree = page.getByRole("region", { name: "本地文件树" });
  await tree.getByRole("button", { name: "选择本地目录", exact: true }).click();
  await tree.getByRole("button", { name: selected, exact: true }).click();
  const workspace = page.getByRole("region", { name: "本地文件工作区" });
  await expect(workspace.locator(".cm-content")).toBeVisible();
  return { tree, workspace };
}
