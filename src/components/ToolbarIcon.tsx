import type { ReactNode } from "react";

const paths = {
  undo: <><path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12" /></>,
  redo: <><path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12" /></>,
  quote: <><path d="M4 6h6v7H5c0 3-1 4-2 5M14 6h6v7h-5c0 3-1 4-2 5" /></>,
  bullet: <><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></>,
  ordered: <><path d="M10 6h10M10 12h10M10 18h10M3 4h1v5M2 9h4M2 14c0-3 4-3 4 0 0 2-4 2-4 5h4" /></>,
  indent: <><path d="M10 5h10M10 12h10M10 19h10m-17-10 3 3-3 3" /></>,
  outdent: <><path d="M10 5h10M10 12h10M10 19h10m-4-10-3 3 3 3" /></>,
  code: <><path d="m7 6-5 6 5 6m10-12 5 6-5 6M14 3l-4 18" /></>,
  table: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18M3 15h18" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  cut: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="m8 8 12 12M8 16 20 4" /></>,
  paste: <><path d="M8 5H4v16h16V5h-4" /><rect x="8" y="3" width="8" height="4" rx="1" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>,
  link: <><path d="m10 13 4-4M9 15l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  saving: <path d="M20 12a8 8 0 1 1-8-8" />,
  warning: <><path d="m12 3 10 18H2ZM12 9v5M12 17h.01" /></>,
} satisfies Record<string, ReactNode>;

export function ToolbarIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
