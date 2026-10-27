import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import { useContext } from "react";
import { editorFoldSymbol, outlineFoldSymbol, scopedFoldSymbolConfig, type EditorFoldIconScope } from "../lib/editor-fold-icons";
import { DisclosureIcon } from "./DisclosureIcon";

import { EditorFoldIconContext } from "./EditorFoldIconContext";
export { EditorFoldIconContext } from "./EditorFoldIconContext";

/** Only document folding consumes this preference, never application navigation. */
export function EditorFoldIcon({
  expanded,
  outline = false,
  scope = "block",
}: {
  expanded: boolean;
  outline?: boolean;
  scope?: Exclude<EditorFoldIconScope, "outline">;
}) {
  const config = useContext(EditorFoldIconContext);
  const plugin = useNumberingDisplay().blocks;
  const symbol =
    !outline && plugin
      ? expanded
        ? plugin.foldExpanded
        : plugin.foldCollapsed
      : outline
        ? outlineFoldSymbol(config, expanded)
        : editorFoldSymbol(scopedFoldSymbolConfig(config, scope), expanded);
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
