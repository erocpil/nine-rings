import { useNotesStore } from "../stores/useNotesStore";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function DailyOverview() {
  const currentDate = useNotesStore((s) => s.currentDate);
  const notes = useNotesStore((s) => s.notes);
  const dailyPage = useNotesStore((s) => s.dailyPage);

  const date = new Date(currentDate + "T00:00:00");
  const weekday = WEEKDAYS[date.getDay()];
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const pendingTodos = dailyPage?.todos.filter((t) => !t.done).length ?? 0;
  const totalTodos = dailyPage?.todos.length ?? 0;

  return (
    <div className="daily-overview">
      <span className="daily-weekday">{weekday}</span>
      <span className="daily-date">
        {month}月{day}日
      </span>
      <span className="daily-stat">{notes.length} 篇笔记</span>
      {totalTodos > 0 && (
        <span className="daily-stat">
          {pendingTodos}/{totalTodos} 待办
        </span>
      )}
    </div>
  );
}
