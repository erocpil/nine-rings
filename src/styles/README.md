# Global stylesheet boundaries

`../styles.css` is the ordered entry point. Vite resolves these imports into the
same global stylesheet; they are not component-scoped or lazy-loaded styles.

The first extraction preserves the original rule order, including repeated
selectors and late overrides. Do not alphabetize imports or move a responsive
override next to an earlier base rule without a separate cascade review.

| Module | Existing rule group |
| --- | --- |
| `foundation.css` | Theme tokens, shell, navigation, search, sidebar and todos |
| `editor-controls.css` | Editor toolbar, menus, status, images and drawers |
| `workspace-surfaces.css` | Empty/search states, settings shell, outline, bookmarks and splitters |
| `editor-content.css` | Active-line feedback, Vim and ProseMirror typography |
| `workspace-panels.css` | History, settings sections, document tree and property/dialog surfaces |
| `editor-lists.css` | Shared document/appearance list markers, numbering columns, nesting, task controls and spacing; imported after panels to retain the former override order |
| `structured-blocks-and-desktop.css` | Code/quote blocks, desktop title bar and hotkeys |
| `responsive.css` | Safe areas and the existing tablet/mobile overrides |
| `readers-and-templates.css` | PDF/EPUB surfaces, subsequent mobile overrides and templates |
| `shared-chrome.css` | Late shared-surface and document-title overrides |
| `markdown-document.css` | Markdown view/source controls and escape-repair preview; extracted from the former tail without reordering |

Some files still contain several related surfaces: this is a conservative first
pass, not a claim that every component's CSS is isolated. Further moves must
preserve cascade order or explicitly test the intended change.

Theme and platform contracts use `tests/css-source.ts` to follow local imports;
new source-based checks should not inspect only the ten-line entry file.
