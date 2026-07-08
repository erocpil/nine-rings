import React, { useState, useCallback } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [value, setValue] = useState("");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setValue(v);
      // 简单防抖：300ms 后触发搜索
      const timer = setTimeout(() => onSearch(v), 300);
      return () => clearTimeout(timer);
    },
    [onSearch]
  );

  return (
    <div className="search-bar">
      <input
        type="text"
        placeholder="搜索笔记..."
        value={value}
        onChange={handleChange}
        className="search-input"
      />
      {value && (
        <button className="search-clear" onClick={() => { setValue(""); onSearch(""); }}>
          ×
        </button>
      )}
    </div>
  );
}
