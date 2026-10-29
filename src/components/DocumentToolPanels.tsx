import { useId, useLayoutEffect, type RefObject } from "react";
import type { SearchOptions } from "../lib/search-matching";

interface ReplaceCapability {
  open: boolean;
  onToggle: () => void;
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  onReplace: (all: boolean) => void;
  onUndo: () => void;
  message: string;
}
export function DocumentFindPanel({
  inputRef,
  query,
  onQueryChange,
  options,
  onOptionsChange,
  count,
  activeIndex,
  error,
  onNavigate,
  onClose,
  replace,
}: {
  inputRef: RefObject<HTMLInputElement>;
  query: string;
  onQueryChange: (value: string) => void;
  options: SearchOptions;
  onOptionsChange: (options: SearchOptions) => void;
  count: number;
  activeIndex: number;
  error?: string;
  onNavigate: (direction: number) => void;
  onClose: () => void;
  replace?: ReplaceCapability;
}) {
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [inputRef]);
  return (
    <div
      className={`editor-find-bar${replace?.open ? " editor-find-bar-replace" : ""}`}
      role="search"
      aria-label="文档查找"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="editor-find-header">
        <span>{replace ? "查找与替换" : "文档查找"}</span>
        <button
          type="button"
          className="editor-find-close"
          onClick={onClose}
          title="关闭查找"
          aria-label="关闭查找"
        >
          ×
        </button>
      </div>
      <div className="editor-find-row">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="在当前文档中查找"
          aria-label="在当前文档中查找"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              onNavigate(event.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="editor-find-count" role="status" aria-live="polite">
          {query ? `${count ? Math.max(0, activeIndex + 1) : 0}/${count}` : ""}
        </span>
        <button
          type="button"
          onClick={() => onNavigate(-1)}
          disabled={!count}
          title="上一处匹配"
          aria-label="上一处匹配"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onNavigate(1)}
          disabled={!count}
          title="下一处匹配"
          aria-label="下一处匹配"
        >
          ↓
        </button>
        {replace && (
          <button
            type="button"
            className="editor-find-replace-toggle"
            onClick={replace.onToggle}
            aria-expanded={replace.open}
            aria-label="显示替换"
          >
            替换
          </button>
        )}
      </div>
      <div className="editor-find-options">
        <span className="search-scope-label">当前文档</span>
        {(["caseSensitive", "wholeWord", "regex"] as const).map(
          (key, index) => (
            <label
              key={key}
              title={
                key === "wholeWord"
                  ? "匹配完整单词，不匹配单词中的一部分"
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={options[key] === true}
                onChange={(event) =>
                  onOptionsChange({ ...options, [key]: event.target.checked })
                }
              />
              {["区分大小写", "全词匹配", "正则表达式（Perl）"][index]}
            </label>
          ),
        )}
      </div>
      {error && (
        <p className="search-pattern-error" role="alert">
          {error}
        </p>
      )}
      {options.regex && (
        <small className="search-pattern-help">
          ^word 行首 · word$ 行尾 · foo|bar 任一
          {replace ? " · 替换支持 $1、${name}、$&" : ""}
        </small>
      )}
      {replace?.open && (
        <>
          <div className="editor-find-row">
            <input
              ref={replace.inputRef}
              aria-label="替换为"
              placeholder="替换为（留空则删除）"
              value={replace.value}
              onChange={(event) => replace.onChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  replace.onReplace(false);
                }
              }}
            />
            <button
              type="button"
              className="editor-replace-action"
              disabled={!count || !!error}
              onClick={() => replace.onReplace(false)}
            >
              替换当前
            </button>
            <button
              type="button"
              className="editor-replace-action"
              disabled={!count || !!error}
              onClick={() => replace.onReplace(true)}
            >
              全部替换
            </button>
          </div>
          <div className="editor-replace-status" role="status">
            <span>
              {replace.message ||
                (options.regex
                  ? "Perl 正则匹配；仅替换当前正文"
                  : "普通文本匹配；仅替换当前正文")}
            </span>
            {replace.message.startsWith("已替换") && (
              <button
                type="button"
                className="editor-replace-action"
                onClick={replace.onUndo}
              >
                撤销替换
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function DocumentBlockJumpPanel({
  inputRef,
  value,
  onChange,
  count,
  error,
  onSubmit,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  count: number;
  error?: string | null;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const id = useId();
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [inputRef]);
  return (
    <form
      noValidate
      className="editor-line-jump"
      role="dialog"
      aria-label="跳转块"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <label htmlFor={id}>块号</label>
      <input
        ref={inputRef}
        id={id}
        value={value}
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="跳转到块号"
        aria-invalid={!!error}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      <span
        className={error ? "editor-line-jump-error" : "editor-line-jump-range"}
        role="status"
      >
        {error || `/ ${count}`}
      </span>
      <button type="submit" title="跳转" aria-label="跳转">
        ↵
      </button>
      <button
        type="button"
        title="关闭跳转"
        aria-label="关闭跳转"
        onClick={onClose}
      >
        ×
      </button>
    </form>
  );
}
