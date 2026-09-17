import { createContext, useContext } from "react";
import {
  editorFoldSymbol,
  outlineFoldSymbol,
  type EditorFoldIconConfig,
} from "../lib/editor-fold-icons";
import { DisclosureIcon } from "./DisclosureIcon";

export const EditorFoldIconContext =
  createContext<Partial<EditorFoldIconConfig> | null>(null);

/** Only document folding consumes this preference, never application navigation. */
export function EditorFoldIcon({ expanded, outline = false }: { expanded: boolean; outline?: boolean }) {
  const config = useContext(EditorFoldIconContext);
  const symbol = outline ? outlineFoldSymbol(config, expanded) : editorFoldSymbol(config, expanded);
  return symbol === null ? (
    <DisclosureIcon expanded={expanded} />
  ) : (
    <span
      className="editor-fold-symbol"
      aria-hidden="true"
      style={{ fontSize: `${Math.min(12, 22 / Array.from(symbol).length)}px` }}
    >
      {symbol}
    </span>
  );
}
