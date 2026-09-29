export interface LinkDocument {
  id: string;
  title: string | null;
  storagePath?: string;
  originalFileName?: string;
}

export interface RelativeDocumentTarget {
  folder: string;
  fileName: string;
  exact: LinkDocument | null;
  suggestions: LinkDocument[];
}

/** Only Markdown files imported into the document tree can be opened locally. */
export function isRelativeMarkdownLink(href: string): boolean {
  return !/^(?:[a-z][a-z\d+.-]*:|\/|#|\\)/i.test(href)
    && /\.(?:md|markdown)(?:[?#].*)?$/i.test(href);
}

export function resolveRelativeDocumentLink(
  source: LinkDocument,
  href: string,
  label: string,
  documents: readonly LinkDocument[],
): RelativeDocumentTarget | null {
  if (!isRelativeMarkdownLink(href) || !source.storagePath) return null;
  let path: string;
  try { path = decodeURIComponent(href.split(/[?#]/, 1)[0]).replace(/\\/g, "/"); }
  catch { return null; }
  const parts = source.storagePath.split("/").filter(Boolean);
  const segments = path.split("/");
  const fileName = segments.pop() ?? "";
  if (!fileName || !/\.(?:md|markdown)$/i.test(fileName)) return null;
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // Keep relative links inside the imported top-level document area.
      if (parts.length <= 1) return null;
      parts.pop();
    } else parts.push(segment);
  }
  const folder = parts.join("/");
  const sameFolder = documents.filter(document => document.id !== source.id && document.storagePath === folder);
  const folded = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const exact = sameFolder.filter(document => folded(document.originalFileName ?? "") === folded(fileName));
  if (exact.length === 1) return { folder, fileName, exact: exact[0], suggestions: [] };
  if (exact.length > 1) return { folder, fileName, exact: null, suggestions: exact };

  // Older imports lack the source filename. Match only inside the resolved
  // folder, and let the user choose when the title is merely a likely match.
  const stem = fileName.replace(/\.(?:md|markdown)$/i, "");
  const titleEqualsStem = sameFolder.filter(document => folded(document.title ?? "") === folded(stem));
  if (titleEqualsStem.length === 1) return { folder, fileName, exact: titleEqualsStem[0], suggestions: [] };
  const text = folded(label);
  const suggestions = sameFolder.filter(document =>
    titleEqualsStem.includes(document)
    || (text.length >= 2 && folded(document.title ?? "").includes(text)),
  );
  return { folder, fileName, exact: null, suggestions };
}
