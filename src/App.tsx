import React from "react";
import { useNotes } from "./hooks/useNotes";
import { DatePicker } from "./components/DatePicker";
import { TodoList } from "./components/TodoList";
import { Sidebar } from "./components/Sidebar";
import { NoteEditor } from "./components/NoteEditor";
import { SearchBar } from "./components/SearchBar";
import { useSearch } from "./hooks/useSearch";
import { useNotesStore } from "./stores/useNotesStore";

function App() {
  const {
    currentDate,
    loading,
    notes,
    selectedNote,
    setDate,
    selectNote,
    createNote,
    updateNote,
    deleteNote,
  } = useNotes();

  const dailyPage = useNotesStore((s) => s.dailyPage);
  const updateTodos = useNotesStore((s) => s.updateTodos);
  const { search, results, query } = useSearch();

  const handleDateChange = (date: string) => {
    setDate(date);
  };

  const handleTitleChange = (title: string) => {
    if (selectedNote) {
      updateNote(selectedNote.id, { title });
    }
  };

  const handleContentChange = (content: any) => {
    if (selectedNote) {
      updateNote(selectedNote.id, { content });
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <DatePicker value={currentDate} onChange={handleDateChange} />
        <SearchBar onSearch={search} />
      </header>

      <div className="app-body">
        <aside className="app-sidebar">
          <Sidebar
            notes={query ? results : notes}
            selectedId={selectedNote?.id ?? null}
            onSelect={selectNote}
            onCreate={createNote}
          />
        </aside>

        <main className="app-main">
          {query ? (
            <div className="search-results">
              <h3>搜索结果 ({results.length})</h3>
              {results.map((r) => (
                <div key={r.id} className="search-hit" onClick={() => selectNote(r)}>
                  <div className="search-hit-title">{r.title || "无标题"}</div>
                  <div className="search-hit-date">{r.date}</div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <TodoList
                todos={dailyPage?.todos ?? []}
                onChange={updateTodos}
              />
              {selectedNote ? (
                <NoteEditor
                  title={selectedNote.title}
                  content={selectedNote.content}
                  onTitleChange={handleTitleChange}
                  onContentChange={handleContentChange}
                />
              ) : (
                <div className="empty-state">
                  {loading ? "加载中..." : "选择或新建一篇笔记"}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
