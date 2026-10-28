import type { CSSProperties } from "react";
import { panelDisplayStyle } from "../lib/panel-display-view";
import type { PanelDisplayContribution } from "../lib/plugin-system/panel-display";
import {
  groupSourceWordMatchesByLine,
  type SourceWordMatch,
} from "../lib/source-word-occurrences";

/** Same rows and plugin presentation in every host; jumping and panel placement
 * are capabilities supplied by the source adapter. One row per physical line. */
export function SourceWordMatchList({
  groups,
  word,
  activeFrom,
  display,
  onJump,
  emptyLabel = "当前文档没有其它全词匹配",
}: {
  groups: ReturnType<typeof groupSourceWordMatchesByLine>;
  word?: string;
  activeFrom?: number;
  display?: PanelDisplayContribution | null;
  onJump: (match: SourceWordMatch) => void;
  emptyLabel?: string;
}) {
  return (
    <div
      className="document-source-matches-list"
      data-panel-display={display ? "plugin" : undefined}
      style={panelDisplayStyle(display ?? null) as CSSProperties}
    >
      {groups.length ? (
        groups.map((group) => {
          const active = group.matches.find(
              (match) => match.from === activeFrom,
            ),
            target = active ?? group.matches[0]!;
          return (
            <button
              key={group.line}
              type="button"
              className="document-source-match-row"
              aria-current={active ? "location" : undefined}
              aria-label={`第 ${group.line} 行${group.matches.length > 1 ? `，${group.matches.length} 处匹配` : ""}`}
              onClick={() => onJump(target)}
              title={`${group.line}: ${group.text}${group.matches.length > 1 ? ` · ${group.matches.length} 处匹配` : ""}`}
            >
              <span
                className={`document-source-match-line${group.matches.length > 1 ? " is-repeated" : ""}`}
              >
                {group.matches.length > 1 ? (
                  <strong>{group.line}</strong>
                ) : (
                  group.line
                )}
              </span>
              <code>{group.text || word}</code>
            </button>
          );
        })
      ) : (
        <div className="document-bookmark-empty">
          {word ? emptyLabel : "单击源码中的单词以查找相同词"}
        </div>
      )}
    </div>
  );
}
