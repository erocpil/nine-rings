import { APP_CHANGELOG } from "../lib/app-changelog";

export function SettingsChangelog() {
  return (
    <section className="settings-changelog" aria-label="更新记录">
      <div className="settings-changelog-intro">
        <p>最近三批功能改进与问题修复，按发布顺序从新到旧排列。</p>
        <p>
          当前版本 <code>{__APP_VERSION__}</code>
        </p>
      </div>
      {APP_CHANGELOG.slice(0, 3).map((entry) => (
        <article className="settings-changelog-entry" key={`${entry.date}:${entry.title}`}>
          <time dateTime={entry.date}>{entry.date}</time>
          <h3>{entry.title}</h3>
          <ul>
            {entry.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
