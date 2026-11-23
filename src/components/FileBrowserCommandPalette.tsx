import { useId, useRef, useState } from "react";
import { WorkspaceDialog } from "./WorkspaceDialog";

export interface FileBrowserCommand {
  id: string;
  label: string;
  detail: string;
  shortcut?: string;
  unavailable?: string;
  run: () => void;
}

export function FileBrowserCommandPalette({ commands, onClose }: { commands: FileBrowserCommand[]; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const terms = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/);
  const matches = commands.filter(command => {
    const text = [command.label, command.detail, command.shortcut].join(" ").normalize("NFKC").toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
  const enabled = matches.filter(command => !command.unavailable);
  const current = enabled.find(command => command.id === selected) ?? enabled[0];
  const run = (command: FileBrowserCommand | undefined) => {
    if (!command || command.unavailable) return;
    onClose();
    command.run();
  };
  return <WorkspaceDialog title="命令面板" onClose={onClose} initialFocusRef={input} previewBackdrop>
    <div className="file-browser-command-palette">
      <input ref={input} className="settings-input" aria-label="查找命令或目录" aria-controls={listId}
        placeholder="查找命令、目录或工具" value={query}
        onChange={event => { setQuery(event.target.value); setSelected(undefined); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); run(current); }
          if (!enabled.length || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const index = enabled.indexOf(current);
          const next = enabled[(index + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length];
          setSelected(next.id);
          Array.from(list.current?.querySelectorAll("button") ?? []).find(button => button.dataset.command === next.id)?.scrollIntoView({ block: "nearest" });
        }} />
      {!matches.length && <p role="status">没有匹配的命令或目录。</p>}
      <div ref={list} id={listId} className="file-browser-command-results" role="group" aria-label="匹配结果">
        {matches.map(command => <button key={command.id} type="button" data-command={command.id}
          data-current={command.id === current?.id} aria-disabled={Boolean(command.unavailable)} onClick={() => run(command)}>
          <span>{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}
          <small>{command.detail}{command.unavailable && ` · ${command.unavailable}`}</small>
        </button>)}
      </div>
    </div>
  </WorkspaceDialog>;
}
