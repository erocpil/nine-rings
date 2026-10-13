# Global stylesheet boundaries

`../styles.css` is the ordered entry point. Vite resolves these imports into the
same global stylesheet; they are not component-scoped or lazy-loaded styles.

The first extraction preserves the original rule order, including repeated
selectors and late overrides. Do not alphabetize imports or move a responsive
override next to an earlier base rule without a separate cascade review.

| Module | Existing rule group |
| --- | --- |
| `foundation.css` | Theme tokens, shell, navigation, search, sidebar |
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
new source-based checks should not inspect only the entry file.

## Later modules

The entry also imports `edge-scrollbars.css`, `sidebar-presentation.css` and
`document-panels.css` for shared scrollbars and navigation panels; the
`interface-style.css`, `calm-*.css`, `additional-interface-styles.css`,
`literary-interface-styles.css` and `nine-rings-interface-style.css` modules
provide style-specific surfaces. `shared-reading-typography.css` follows them
and supplies the common reading typography contract. Finally,
`flow-presentation.css` and `flow-block.css` provide flow presentation and blocks.
These are ordered layers, not duplicate stylesheets to concatenate or remove.

`image-library.css` supplies the contributed image tree, document image viewer entry and themed modal viewer. It uses shared semantic tokens and keeps viewer content scrolling independent of fixed controls.

The image viewer content supports both a modal dialog and a host-owned main-area view. Native workspace content remains mounted in a display-contents underlay; the home PDF selector explicitly supports that wrapper.

`editor-toolbar-scroll.css` follows the style and image modules to unify rendered/source toolbar surfaces and preserve a single horizontally scrollable row across themes. Dropdowns retain toolbar DOM ownership but use fixed positioning outside its clipping area.
