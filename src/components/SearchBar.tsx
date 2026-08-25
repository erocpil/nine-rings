import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../lib/api";
import type { DocType } from "../types/models";

interface SearchBarProps {
  onSearch: (query: string) => void;
  onDocSearch?: (query: { text: string; storagePath?: string; docType?: DocType; concept?: string }) => void;
  onInputBlur?: () => void;
  onEscape?: () => void;
}

const PATH_FILTERS = [
  { value: "", label: "全部目录" },
  { value: "projects", label: "📁 Projects" },
  { value: "areas", label: "🗂 Areas" },
  { value: "references", label: "📚 References" },
  { value: "ideas", label: "💡 Ideas" },
  { value: "archives", label: "📦 Archives" },
];

const TYPE_FILTERS: { value: DocType | ""; label: string }[] = [
  { value: "", label: "全部类型" },
  { value: "explanation", label: "📖 解释" },
  { value: "how-to", label: "🔧 指南" },
  { value: "reference", label: "📋 参考" },
  { value: "tutorial", label: "🎓 教程" },
];

export function SearchBar({ onSearch, onDocSearch, onInputBlur, onEscape }: SearchBarProps) {
  const [value, setValue] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [pathFilter, setPathFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocType | "">("");
  const [conceptInput, setConceptInput] = useState("");
  const [conceptFilter, setConceptFilter] = useState("");
  const [conceptSuggestions, setConceptSuggestions] = useState<string[]>([]);
  const [existingConcepts, setExistingConcepts] = useState<string[]>([]);
  const filterRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilters = pathFilter || typeFilter || conceptFilter;

  useEffect(() => {
    api.docs.allConcepts().then(setExistingConcepts);
  }, []);

  // 点击外部关闭筛选面板
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  const fireSearch = useCallback((text: string, path: string, type: DocType | "", concept: string) => {
    if (text || path || type || concept) {
      if (onDocSearch) {
        onDocSearch({
          text,
          storagePath: path || undefined,
          docType: type || undefined,
          concept: concept || undefined,
        });
      } else {
        onSearch(text);
      }
    } else {
      // 全部条件清空时，两条搜索路径都要复位。App 同时提供
      // onDocSearch 时，仅调用 onSearch 会留下旧的文档结果页。
      onDocSearch?.({ text: "" });
      onSearch("");
    }
  }, [onSearch, onDocSearch]);

  const scheduleSearch = useCallback((text: string, path: string, type: DocType | "", concept: string) => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    searchTimerRef.current = setTimeout(() => {
      fireSearch(text, path, type, concept);
      searchTimerRef.current = null;
    }, 180);
  }, [fireSearch]);

  const handleChange = useCallback((v: string) => {
    setValue(v);
    scheduleSearch(v, pathFilter, typeFilter, conceptFilter);
  }, [pathFilter, typeFilter, conceptFilter, scheduleSearch]);

  const handlePathChange = (p: string) => {
    setPathFilter(p);
    scheduleSearch(value, p, typeFilter, conceptFilter);
  };

  const handleTypeChange = (t: DocType | "") => {
    setTypeFilter(t);
    scheduleSearch(value, pathFilter, t, conceptFilter);
  };

  const handleConceptChange = (v: string) => {
    setConceptInput(v);
    if (v.trim()) {
      setConceptSuggestions(
        existingConcepts.filter((c) => c.includes(v.trim()) && c !== conceptFilter)
      );
    } else {
      setConceptSuggestions([]);
    }
  };

  const selectConcept = (c: string) => {
    setConceptFilter(c);
    setConceptInput(c);
    setConceptSuggestions([]);
    scheduleSearch(value, pathFilter, typeFilter, c);
  };

  const clearConcept = () => {
    setConceptFilter("");
    setConceptInput("");
    scheduleSearch(value, pathFilter, typeFilter, "");
  };

  const clearAll = () => {
    setValue("");
    setPathFilter("");
    setTypeFilter("");
    setConceptFilter("");
    setConceptInput("");
    scheduleSearch("", "", "", "");
  };

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const activeFilterCount = [pathFilter, typeFilter, conceptFilter].filter(Boolean).length;

  return (
    <div className="search-bar" ref={filterRef}>
      <div className="search-input-row">
        <div className="search-input-wrap">
          <input
            type="text"
            placeholder="搜索笔记..."
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => {
              // 输入框已有内容时自动重新搜索（避免需要 Enter）
              if (searchTimerRef.current) {
                clearTimeout(searchTimerRef.current);
                searchTimerRef.current = null;
              }
              if (value) fireSearch(value, pathFilter, typeFilter, conceptFilter);
            }}
            onBlur={() => {
              // 延迟检查：如果焦点移到筛选面板内部则不折叠
              setTimeout(() => {
                if (!filterRef.current?.contains(document.activeElement)) {
                  onInputBlur?.();
                }
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // 重新触发搜索（用户可能想用保留的关键词再次搜索）
                if (searchTimerRef.current) {
                  clearTimeout(searchTimerRef.current);
                  searchTimerRef.current = null;
                }
                fireSearch(value, pathFilter, typeFilter, conceptFilter);
              }
              if (e.key === "Escape") {
                onEscape?.();
                e.currentTarget.blur();
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            className="search-input"
          />
          {value && (
            <button className="search-clear" onClick={clearAll} aria-label="清除搜索">×</button>
          )}
        </div>
        <button
          className={`search-filter-btn ${filterOpen || hasFilters ? "active" : ""}`}
          onClick={() => setFilterOpen(!filterOpen)}
          title="筛选"
        >
          🔍
          {activeFilterCount > 0 && <span className="search-filter-badge">{activeFilterCount}</span>}
        </button>
      </div>

      {filterOpen && (
        <div className="search-filters">
          {/* 目录筛选 */}
          <div className="search-filter-group">
            <select
              className="search-filter-select"
              value={pathFilter}
              onChange={(e) => handlePathChange(e.target.value)}
            >
              {PATH_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* 类型筛选 */}
          <div className="search-filter-group">
            <div className="search-filter-chips">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  className={`search-filter-chip ${typeFilter === f.value ? "active" : ""}`}
                  onClick={() => handleTypeChange(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* 概念筛选 */}
          <div className="search-filter-group">
            <div className="search-filter-input-wrap">
              <input
                type="text"
                className="search-filter-input"
                placeholder="概念..."
                value={conceptInput}
                onChange={(e) => handleConceptChange(e.target.value)}
              />
              {conceptFilter && (
                <button className="search-filter-clear" onClick={clearConcept}>✕</button>
              )}
              {conceptSuggestions.length > 0 && (
                <div className="search-filter-suggestions">
                  {conceptSuggestions.map((c) => (
                    <button type="button" key={c} className="search-filter-suggestion" onClick={() => selectConcept(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
