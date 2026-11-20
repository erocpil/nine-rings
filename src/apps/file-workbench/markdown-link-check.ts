import type { BrowserDirectoryProvider } from "../../lib/local-files/browser-contract";
import type { LocalFileSnapshot } from "../../lib/local-files/file-model";
import { markdownAnchorOffsets } from "../../lib/local-files/markdown-link-anchors";
import { canFollowMarkdownLink, localMarkdownLink } from "../../lib/local-files/markdown-links";
import { markdownLinkDestinations, type MarkdownLinkDestination } from "../../lib/local-files/markdown-link-repair";

export interface LinkIssue { link: MarkdownLinkDestination; message: string; missingNode?: string }
export async function checkMarkdownLinks(
  node: string, source: string, read: (node: string) => Promise<LocalFileSnapshot>,
  signal: AbortSignal, limit = 200,
): Promise<{ issues: LinkIssue[]; limited: boolean }> {
  const links = markdownLinkDestinations(source).filter(link => canFollowMarkdownLink(link.href));
  const issues: LinkIssue[] = [];
  const targets = new Map<string, { content: string; anchors?: Map<string, number> }>();
  let bytes = 0;
  const failures = new Map<string, string>();
  targets.set(node, { content: source });
  for (const link of links.slice(0, limit)) {
    signal.throwIfAborted();
    let missingNode: string | undefined;
    try {
      const target = localMarkdownLink(node, link.href);
      let document = targets.get(target.node);
      if (!document) {
        missingNode = target.node;
        const failure = failures.get(target.node);
        if (failure) throw new Error(failure);
        try {
          const snapshot = await read(target.node);
          bytes += snapshot.size;
          if (bytes > 32 * 1024 * 1024) return { issues, limited: true };
          document = { content: snapshot.source };
          targets.set(target.node, document);
        } catch (error) {
          const message = `目标文件不可用：${String(error)}`;
          failures.set(target.node, message);
          throw new Error(message);
        }
      }
      missingNode = undefined;
      if (target.fragment) {
        document.anchors ??= markdownAnchorOffsets(document.content);
        if (!document.anchors.has(target.fragment)) throw new Error(`目标中找不到标题或锚点“${target.fragment}”`);
      }
    } catch (error) {
      issues.push({ link, message: error instanceof Error ? error.message : String(error), missingNode });
    }
  }
  signal.throwIfAborted();
  return { issues, limited: links.length > limit };
}

/** Bounded authorized directory walk, shared by candidate lookup and repair preview. */
export async function scanMarkdownFiles(provider: BrowserDirectoryProvider, rootId: string, signal: AbortSignal, visit: (node: string, size: number) => Promise<boolean | void>) {
  const stack = [{ node: "", offset: 0 }];
  let entries = 0;
  const skipped: string[] = [];
  while (stack.length) {
    signal.throwIfAborted();
    const current = stack.pop()!;
    let page;
    try { page = await provider.page(rootId, current.node, current.offset, { sort: "name", showHidden: true, query: "" }, signal); }
    catch (error) { signal.throwIfAborted(); skipped.push(`${current.node || "/"}：${String(error)}`); continue; }
    if (page.next !== null) stack.push({ node: current.node, offset: page.next });
    for (const item of page.nodes) {
      signal.throwIfAborted();
      if (++entries > 10000) return { limited: true, skipped };
      if (item.directory) stack.push({ node: item.id, offset: 0 });
      else if (/\.(?:md|markdown)$/i.test(item.name) && await visit(item.id, item.size) === false) return { limited: true, skipped };
    }
  }
  return { limited: false, skipped };
}
