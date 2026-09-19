import { APP_CHANGELOG } from "../lib/app-changelog";

export function SettingsChangelog() {
  return (
    <section className="settings-changelog" aria-label="更新记录">
      <div className="settings-changelog-intro">
        <p>近期主要功能改进与问题修复，按日期从新到旧排列。</p>
        <p>
          当前版本 <code>{__APP_VERSION__}</code>
        </p>
      </div>
      {APP_CHANGELOG.map((entry) => (
        <article className="settings-changelog-entry" key={entry.date}>
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
