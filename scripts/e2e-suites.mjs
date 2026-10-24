export const productionOnlyFiles = [
  "pwa-offline",
  "pwa-update",
  "settings-search-production",
  "toolbar-overflow-production",
  "search-production",
  "source-formatting-production",
].map((name) => `${name}.spec.ts`);

/** Conservative CI ownership: unfamiliar/shared changes always select the full suite. */
export const readingFiles = [
  "document-fold-session",
  "reading-state-persistence",
  "sidebar-presentation",
  "edge-scrollbars",
  "markdown-view-position",
  "markdown-nested-position",
  "readonly-rendering",
].map((name) => `${name}.spec.ts`);

export const coreFiles = [
  "create-edit-save",
  "document-save-revisions",
  "document-history",
  "document-memory",
  "session-restore",
  "quit-confirmation",
  "data-safety",
  "multi-tab",
  "document-management-barrier",
  "markdown-source-editor",
  "markdown-view-handoff",
  "clipboard-paste",
  "mobile-fold",
  "mobile-heading-cross-selection",
  "editor-insert-dialogs",
  "document-tags-properties",
  "search-navigation",
  "recycle-bin",
  "builtin-plugin-pilots",
  "plugin-editor-intents",
  "reader-sidebar-resize",
  "local-file-operations",
  "local-file-position",
].map((name) => `${name}.spec.ts`);

const rules = [
  {
    name: "reading",
    source:
      /^(src\/hooks\/useEditorScrollPersistence\.ts|src\/lib\/(editor-reading-position|reading-state)\.ts)$/,
    tests:
      /reading|readonly|fold|session-restore|font-reading|markdown-.*position|document-history|document-memory/,
  },
  {
    name: "search",
    source: /^src\/lib\/(search[^/]*|web-search[^/]*|quick-switcher)\.ts$/,
    tests:
      /search|filtered|quick-switcher|internal-note-links|document-path-filter|workspace-summary/,
  },
  {
    name: "plugins",
    source:
      /^(src\/lib\/plugin-system\/(date-formats|command-arguments|command-parameters|result-presentation|builtin-tool-preferences|builtin-plugin-catalog|builtin-image-viewer|image-command|local-image|panel-display|builtin-tree-display)\.ts$|plugins\/|src\/components\/Plugin)/,
    tests: /plugin|image|panel-display|notes-panel|reference-copy/,
  },
  {
    name: "readers",
    source:
      /^(src\/components\/(Pdf|Epub)|src\/lib\/(pdf|epub|reading-library))/,
    tests:
      /pdf|epub|reader|reading-library|desktop-reader|mobile-reader|image-main-area/,
  },
  {
    name: "style",
    source:
      /^src\/lib\/(interface-style|editor-appearance|block-display-settings|document-panel-appearance|theme|hierarchy-colors)\.ts$/,
    tests:
      /style|theme|appearance|typography|settings|heading|spacing|calm|sidebar|code|mermaid|flow|exhibition|workspace|panel|toolbar|layout/,
  },
  {
    name: "tree",
    source:
      /^src\/components\/(DocTree|DocumentBrowser|DocumentPathPicker|FolderView)/,
    tests:
      /doc-tree|document-browser|document-path|path-|import-path|notes-panel|mobile-sidebar|panel-display|workspace-navigation|session-restore/,
  },
];

export function selectE2E(
  allFiles,
  changedPaths,
  { full = false, excludeReading = true } = {},
) {
  const available = [...new Set(allFiles)].sort();
  const selected = new Set(
    coreFiles.filter((file) => available.includes(file)),
  );
  const reasons = [];
  let complete = full || !changedPaths?.length;
  if (complete)
    reasons.push(
      full ? "Explicit full suite" : "No reliable changed-path range",
    );
  for (const original of changedPaths ?? []) {
    const path = original.replaceAll("\\", "/");
    if (path.startsWith("e2e/") && path.endsWith(".spec.ts")) {
      const file = path.slice("e2e/".length);
      // Production specs have an independent workflow gate; deleted specs
      // do not produce nonexistent default-suite targets.
      if (productionOnlyFiles.includes(file))
        reasons.push(`Production/PWA owner: ${path}`);
      else {
        if (available.includes(file)) selected.add(file);
        reasons.push(`Changed spec: ${path}`);
      }
    } else if (
      /^(docs\/|tests\/|README(?:\.|$))/.test(path) ||
      path === "src/lib/app-changelog.ts"
    ) {
      reasons.push(`Unit/documentation-only: ${path}`);
    } else {
      const matched = rules.filter((rule) => rule.source.test(path));
      if (!matched.length) {
        complete = true;
        reasons.push(`Shared or unclassified path: ${path}`);
      }
      for (const rule of matched) {
        available
          .filter((file) => rule.tests.test(file))
          .forEach((file) => selected.add(file));
        reasons.push(`${rule.name}: ${path}`);
      }
    }
  }
  const files = (complete ? available : [...selected].sort()).filter(
    (file) => !excludeReading || !readingFiles.includes(file),
  );
  return { mode: complete ? "full" : "affected", reasons, files };
}

// One Playwright invocation for the existing WebKit risk gates. Each file has
// one owner, so readers already covered by the Reading workspace job are omitted.
export const webkitGates = [
  { name: "local-files", files: ["local-files", "local-file-operations", "local-file-position"] },
  {
    name: "folding",
    files: [
      "folded-tail-gutter",
      "heading-fold",
      "readonly-heading-fold",
      "mobile-fold",
      "source-fold-cursor",
    ],
  },
  {
    name: "data-safety",
    files: [
      "data-safety",
      "hook-lifecycle",
      "multi-tab",
      "image-readonly",
      "recycle-bin",
    ],
  },
  {
    name: "mobile-input",
    files: ["block-gutter-edit", "mobile-interaction-recovery"],
  },
  { name: "block-jump", files: ["line-numbers"], grep: "Alt-G|输入后立即确认" },
  {
    name: "clipboard",
    files: ["clipboard-paste"],
    grep: "代码块内原生粘贴|Windows 风格段内|Windows Office|HTML 表格粘贴为|同时携带 HTML 的 Markdown 仍完整|引用段落之间",
  },
  {
    name: "epub",
    files: ["epub-reader"],
    grep: "计时器|兼容 click|本地 EPUB 可导入",
  },
  {
    name: "touch-tree",
    files: ["doc-tree-batch", "context-menu", "search-navigation"],
    grep: "宽屏触控|长按文档|触控图片|显式状态类|虚拟键盘",
  },
  {
    name: "edge-ui",
    files: ["pwa-layout", "toolbar-responsive"],
    grep: "宽屏触控|长按文档|触控图片|显式状态类|虚拟键盘|边缘|侧栏.*同宽|点击目录书签|非专注模式书签与目录弹层|目录快速滚动按钮显隐|手机目录长标题|同一可视视口|更多菜单|更多弹层|再次点按更多|手机端可从更多|选择文字后工具栏|待办输入框与|手机向上拖动 splitter|专注模式.*待办|响应式编辑器工具栏",
  },
];
