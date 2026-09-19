import { BackupExportStatus } from "./BackupExportStatus";
import { BackupRestoreStatus } from "./BackupRestoreStatus";
import { ImportPathPicker } from "./ImportPathPicker";
import { ToolbarIcon } from "./ToolbarIcon";
import { DAILY_NOTES_ENABLED } from "../lib/workspace-features";
import { TEXT_IMPORT_ACCEPT } from "../lib/markdown-import";
import type { DocType } from "../types/models";
import type { WebStorageStatus } from "../hooks/useWebPlatform";
import type { useSettingsData } from "../hooks/useSettingsData";
import "./settings-data.css";

interface Props {
  visible: boolean;
  webStorageStatus?: WebStorageStatus;
  data: ReturnType<typeof useSettingsData>;
}

export function SettingsDataPage({ visible, webStorageStatus, data }: Props) {
  const {
    mdInputRef,
    directoryInputRef,
    directoryImportSupported,
    mdImporting,
    mdImportResult,
    mdImportTotal,
    mdImportProgress,
    mdImportCurrentFile,
    mdImportMode,
    setMdImportMode,
    mdImportPath,
    setMdImportPath,
    importPathTriggerRef,
    importPathPickerOpen,
    setImportPathPickerOpen,
    mdImportDocType,
    setMdImportDocType,
    mdImportTags,
    setMdImportTags,
    mdImportConcepts,
    setMdImportConcepts,
    handleMdImport,
    fileInputRef,
    importing,
    exporting,
    handleExport,
    handleImport,
    handleImportFile,
  } = data;
  if (!visible) return null;
  const busy = importing || exporting || mdImporting;
  const missingPath = mdImportMode === "document" && !mdImportPath.trim();

  return (
    <div className="settings-data-page">
      <div className="settings-data-grid">
        <section
          className="settings-data-card"
          aria-labelledby="data-backup-heading"
        >
          <header className="settings-data-heading">
            <span className="settings-data-icon">
              <ToolbarIcon name="shield" />
            </span>
            <div>
              <h3 id="data-backup-heading">JSON 备份与恢复</h3>
              <p>保存本地副本，或从其他设备迁移数据。</p>
            </div>
          </header>
          <div className="data-backup-action">
            <h4>保存一份备份</h4>
            <p>
              包含文档、随笔、待办、文档书签、模板及应用设置，不包含
              Token、密码等凭据。
            </p>
            <button
              type="button"
              className="settings-btn-primary"
              disabled={busy}
              onClick={handleExport}
            >
              <ToolbarIcon name="export" />
              {exporting ? "正在导出…" : "导出数据"}
            </button>
            <BackupExportStatus />
          </div>
          <div className="data-backup-action">
            <h4>从备份恢复</h4>
            <p>
              合并 JSON 备份：保留本机独有数据，相同 ID
              的记录及备份中包含的设置会被覆盖。
            </p>
            <p className="data-import-notice">
              建议先导出当前数据，并关闭其他编辑窗口，再选择备份文件。
            </p>
            <button
              type="button"
              className="settings-btn-secondary"
              onClick={handleImport}
              disabled={busy}
            >
              <ToolbarIcon name="undo" />
              {importing ? "恢复中…" : "导入数据"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              hidden
              disabled={busy}
              onChange={handleImportFile}
            />
            <BackupRestoreStatus />
          </div>
          <aside className="data-backup-scope">
            <ToolbarIcon name="document" />
            <p>
              PDF / EPUB 原文件及阅读数据不包含在此 JSON
              中。请另行保留原文件，并在阅读器中导出阅读数据。
            </p>
          </aside>
        </section>

        <section
          className="settings-data-card"
          aria-labelledby="data-text-heading"
        >
          <header className="settings-data-heading">
            <span className="settings-data-icon">
              <ToolbarIcon name="folder" />
            </span>
            <div>
              <h3 id="data-text-heading">Markdown / 纯文本导入</h3>
              <p>
                将文件或整个目录添加为
                {mdImportMode === "document" ? "文档" : "随笔"}。
              </p>
            </div>
          </header>
          <div className="markdown-import-form">
            <fieldset className="data-import-fields" disabled={busy}>
              {DAILY_NOTES_ENABLED && (
                <div
                  className="data-import-modes"
                  role="group"
                  aria-label="Markdown 导入类型"
                >
                  <label>
                    <input
                      type="radio"
                      name="text-import-mode"
                      checked={mdImportMode === "document"}
                      onChange={() => setMdImportMode("document")}
                    />
                    导入为文档
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="text-import-mode"
                      checked={mdImportMode === "note"}
                      onChange={() => setMdImportMode("note")}
                    />
                    导入为随笔
                  </label>
                </div>
              )}
              {mdImportMode === "document" && (
                <>
                  <div
                    className={`markdown-import-field markdown-import-path-field${importPathPickerOpen ? " import-path-expanded" : ""}`}
                  >
                    <label htmlFor="data-import-path">
                      目标路径 <span className="data-field-meta">必填</span>
                    </label>
                    <div className="data-import-path-row">
                      <input
                        id="data-import-path"
                        className="settings-input"
                        aria-label="Markdown 导入目标路径"
                        aria-describedby="data-import-path-hint"
                        placeholder="例如 references/networking"
                        value={mdImportPath}
                        onChange={(event) =>
                          setMdImportPath(event.target.value)
                        }
                      />
                      <button
                        ref={importPathTriggerRef}
                        type="button"
                        className="settings-btn-secondary"
                        aria-expanded={importPathPickerOpen}
                        onClick={() =>
                          setImportPathPickerOpen((value) => !value)
                        }
                      >
                        从文档树选择路径
                      </button>
                    </div>
                    <small id="data-import-path-hint">
                      可选择现有目录，也可输入新路径。选择目录导入时会保留所选目录及子目录结构。
                    </small>
                    {importPathPickerOpen && (
                      <ImportPathPicker
                        anchor={importPathTriggerRef.current}
                        initialPath={mdImportPath}
                        onClose={() => setImportPathPickerOpen(false)}
                        onSelect={(path) => {
                          setMdImportPath(path);
                          setImportPathPickerOpen(false);
                        }}
                      />
                    )}
                  </div>
                  <div className="data-import-metadata">
                    <label className="markdown-import-field">
                      <span>文档类型</span>
                      <select
                        className="settings-input"
                        aria-label="Markdown 导入文档类型"
                        value={mdImportDocType}
                        onChange={(event) =>
                          setMdImportDocType(event.target.value as DocType)
                        }
                      >
                        <option value="explanation">解释</option>
                        <option value="how-to">指南</option>
                        <option value="reference">参考</option>
                        <option value="tutorial">教程</option>
                      </select>
                    </label>
                    <label className="markdown-import-field">
                      <span>
                        概念标签 <span className="data-field-meta">可选</span>
                      </span>
                      <input
                        className="settings-input"
                        aria-label="Markdown 导入概念标签"
                        placeholder="用逗号分隔"
                        value={mdImportConcepts}
                        onChange={(event) =>
                          setMdImportConcepts(event.target.value)
                        }
                      />
                    </label>
                  </div>
                </>
              )}
              <label className="markdown-import-field">
                <span>
                  普通标签 <span className="data-field-meta">可选</span>
                </span>
                <input
                  className="settings-input"
                  aria-label="Markdown 导入普通标签"
                  placeholder="用逗号分隔，例如：资料, 待整理"
                  value={mdImportTags}
                  onChange={(event) => setMdImportTags(event.target.value)}
                />
              </label>
              <div className="data-import-actions">
                <button
                  type="button"
                  className="settings-btn-primary"
                  onClick={() => mdInputRef.current?.click()}
                  disabled={missingPath}
                >
                  <ToolbarIcon name="document" />
                  {mdImporting ? "导入中..." : "选择 .md / .txt 等文件"}
                </button>
                {mdImportMode === "document" && (
                  <button
                    type="button"
                    className="settings-btn-secondary"
                    onClick={() => directoryInputRef.current?.click()}
                    disabled={!directoryImportSupported || missingPath}
                  >
                    <ToolbarIcon name="folder" />
                    选择目录导入
                  </button>
                )}
                <input
                  ref={mdInputRef}
                  type="file"
                  accept={TEXT_IMPORT_ACCEPT}
                  multiple
                  hidden
                  onChange={handleMdImport}
                />
                <input
                  ref={directoryInputRef}
                  type="file"
                  aria-label="导入文本目录"
                  {...{ webkitdirectory: "" }}
                  multiple
                  hidden
                  onChange={handleMdImport}
                />
              </div>
            </fieldset>
            {missingPath && (
              <p className="data-import-notice">
                请先填写目标路径，再选择文件或目录。
              </p>
            )}
            {mdImportMode === "document" && !directoryImportSupported && (
              <p className="data-import-notice">
                当前环境不支持选择目录，请使用多选文件导入。
              </p>
            )}
            {mdImporting && (
              <div className="data-import-feedback" role="status">
                <div>
                  <strong>正在导入</strong>
                  <span>
                    {mdImportProgress} / {mdImportTotal} 个文件已处理
                  </span>
                </div>
                <progress
                  aria-label="文本导入进度"
                  value={mdImportProgress}
                  max={mdImportTotal || 1}
                />
                <small>{mdImportCurrentFile || "正在准备文件…"}</small>
                <small>关闭设置后仍会继续导入。</small>
              </div>
            )}
            {!mdImporting && mdImportResult && (
              <div
                className={`data-import-feedback${mdImportResult.failed || mdImportResult.interrupted ? " has-errors" : ""}`}
                role="status"
              >
                <strong>
                  {mdImportResult.interrupted ? "导入已中断，" : ""}已导入{" "}
                  {mdImportResult.count} 篇
                  {mdImportResult.mode === "document" ? "文档" : "随笔"}
                </strong>
                {!!mdImportResult.skipped && (
                  <span>已跳过 {mdImportResult.skipped} 个不支持的文件。</span>
                )}
                {!!mdImportResult.failed && (
                  <span>{mdImportResult.failed} 个文件导入失败。</span>
                )}
                {mdImportResult.error && <small>{mdImportResult.error}</small>}
                {(mdImportResult.failed > 0 || mdImportResult.interrupted) && (
                  <small>
                    已导入的内容会保留；重新选择文件会再次创建内容，建议只重试失败的文件。
                  </small>
                )}
              </div>
            )}
            <details className="data-import-help">
              <summary>支持的格式与导入规则</summary>
              <ul>
                <li>
                  支持
                  .md、.markdown、.txt、.text、.log、.csv、.tsv、.rst、.adoc；编码为
                  UTF-8 或带 BOM 的 UTF-16。
                </li>
                <li>
                  Markdown 转换为排版正文；其他格式保留纯文本，CSV / TSV
                  不转换为表格。
                </li>
                <li>
                  每个文件新建一篇内容，重复导入不会自动去重。目录中的空文件夹和不支持的文件类型会跳过。
                </li>
                <li>
                  目录示例：资料/网络/a.txt →
                  目标路径/资料/网络。目录选择取决于系统文件选择器，不支持时可改用多选文件。
                </li>
              </ul>
            </details>
          </div>
        </section>
      </div>
      {webStorageStatus?.supported && (
        <section className="data-browser-storage" aria-label="浏览器存储">
          <div>
            <strong>浏览器存储</strong>
            <p>数据保存在当前浏览器中，自动保存不等于备份。</p>
          </div>
          <dl>
            <div>
              <dt>已使用</dt>
              <dd>
                {formatStorageBytes(webStorageStatus.usage)}
                {webStorageStatus.quota !== null && (
                  <small> / {formatStorageBytes(webStorageStatus.quota)}</small>
                )}
              </dd>
            </div>
            <div>
              <dt>持久存储</dt>
              <dd>
                {webStorageStatus.persisted === null
                  ? "暂不可用"
                  : webStorageStatus.persisted
                    ? "已启用"
                    : "未启用"}
              </dd>
            </div>
          </dl>
          {webStorageStatus.persisted === false && (
            <p className="data-storage-hint">
              浏览器可能在空间紧张时清理数据，建议定期导出备份。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return "暂不可用";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
