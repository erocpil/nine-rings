import type { Node as PMNode } from "@tiptap/pm/model";
import type { HeadingSection } from "../lib/heading-fold";
import { outlineLabel } from "../lib/heading-links";
import { fencedBlockLabel } from "../lib/block-format-label";
import { BlockNumber } from "./BlockNumber";
import { EditorFoldIcon } from "./EditorFoldIcon";

/** Both database and disk readers use the same block identity and controls. */
export function ReadingBlockGutter({ node, number, displayNumber, active, showNumbers, relative, alignment, section, folded, onToggleFold, onOpen }: {
  node: PMNode;
  number: number;
  displayNumber: number;
  active: boolean;
  showNumbers: boolean;
  relative: boolean;
  alignment: "left" | "right";
  section?: HeadingSection;
  folded: boolean;
  onToggleFold: () => void;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  return <>
    {showNumbers && active && <div className="editor-block-current-band" aria-hidden="true" data-block-index={number} style={{ top: 0, bottom: 0 }} />}
    {!showNumbers && <button type="button" className="editor-block-menu-target" aria-label={`第 ${number} 块操作`} aria-haspopup="menu"
      onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); onOpen(event.currentTarget); }} />}
    <div className="vr-gutter" contentEditable={false}>
      {section && section.end > section.headingEnd && <button type="button" aria-label={`折叠切换 ${outlineLabel(section.text)}`} aria-expanded={!folded}
        title={folded ? "展开本节" : "折叠本节"} onMouseDown={event => event.preventDefault()}
        onClick={event => { event.stopPropagation(); onToggleFold(); }}>
        <EditorFoldIcon scope="heading" expanded={!folded} />
      </button>}
      {showNumbers && <BlockNumber number={number} displayNumber={displayNumber}
        className={`${active ? "active" : ""} ${relative && active ? `relative-current${alignment === "right" ? " relative-current-right" : ""}` : ""}`}
        format={node.type.name === "codeBlock" ? fencedBlockLabel(node.attrs.language) : node.type.name === "heading" ? `H${node.attrs.level}` : node.type.name}
        onOpen={onOpen} />}
    </div>
  </>;
}
