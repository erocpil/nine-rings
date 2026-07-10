import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface TagFilterProps {
  activeTag: string | null;
  onTagSelect: (tag: string | null) => void;
}

export function TagFilter({ activeTag, onTagSelect }: TagFilterProps) {
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    api.tags.listAll().then(setTags).catch(() => {});
  }, []);

  // Refresh when activeTag changes (e.g., after note update adds/removes tags)
  useEffect(() => {
    api.tags.listAll().then(setTags).catch(() => {});
  }, [activeTag]);

  if (tags.length === 0) return null;

  return (
    <div className="tag-filter">
      <div className="tag-filter-list">
        <span
          className={`tag-filter-chip ${!activeTag ? "active" : ""}`}
          onClick={() => onTagSelect(null)}
        >
          全部
        </span>
        {tags.map((t) => (
          <span
            key={t}
            className={`tag-filter-chip ${activeTag === t ? "active" : ""}`}
            onClick={() => onTagSelect(activeTag === t ? null : t)}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
