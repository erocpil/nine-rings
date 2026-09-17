import { SettingsSection } from "./SettingsFields";
import { BackupExportStatus } from "./BackupExportStatus";
import { BackupRestoreStatus } from "./BackupRestoreStatus";
import { ImportPathPicker } from "./ImportPathPicker";
import { DAILY_NOTES_ENABLED } from "../lib/workspace-features";
import { TEXT_IMPORT_ACCEPT } from "../lib/markdown-import";
import type { DocType } from "../types/models";
import type { WebStorageStatus } from "../hooks/useWebPlatform";
import type { useSettingsData } from "../hooks/useSettingsData";
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
    mdImportCount,
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
    handleExport,
    handleImport,
    handleImportFile,
  } = data;
  return (
    <>
      {webStorageStatus?.supported && (
        <SettingsSection
          title="浏览器存储"
          desc="Nine Rings 的本地数据保存在当前浏览器中"
          visible={visible}
        >
          <div className="web-storage-summary">
            <span>
              持久存储：
              <strong>
                {webStorageStatus.persisted ? "已授权" : "未授权"}
              </strong>
            </span>
            <span>
              已使用：
              <strong>{formatStorageBytes(webStorageStatus.usage)}</strong>
              {webStorageStatus.quota !== null &&
                ` / ${formatStorageBytes(webStorageStatus.quota)}`}
            </span>
          </div>
          {!webStorageStatus.persisted && (
            <p className="web-storage-hint">
              浏览器可能在空间紧张时清理本站数据，建议定期导出或配置 GitHub
              备份。
            </p>
          )}
        </SettingsSection>
      )}
      <SettingsSection
        title="数据导出 / 导入"
        desc="全量 JSON 包含笔记、待办、书签、应用配置及非敏感用户设置；Token、密码等凭据不导出"
        visible={visible}
      >
        <BackupExportStatus />
        <BackupRestoreStatus />
        <p className="settings-hint">
          恢复前请关闭其他编辑窗口；恢复锁只防止多个恢复同时执行，不隔离普通编辑。中断后请先导出本地数据并检查，再决定是否重新导入。
        </p>
        <div className="settings-button-row">
          <button className="settings-btn-primary" onClick={handleExport}>
            导出数据
          </button>
          <button
            className="settings-btn-secondary"
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? "导入中..." : "导入数据"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
      </SettingsSection>
      {/* ═══════════════════════ */}
      {/* Markdown 导入 */}
      {/* ═══════════════════════ */}
      <SettingsSection
        title="Markdown / 纯文本导入"
        desc="导入文件或整个目录；支持 .md、.markdown、.txt、.text、.log、.csv、.tsv、.rst、.adoc。非 Markdown 文件保留纯文本，支持 UTF-8 及带 BOM 的 UTF-16。"
        visible={visible}
      >
        <div className="markdown-import-form">
          <div
            className="settings-radio-group markdown-import-mode"
            role="radiogroup"
            aria-label="Markdown 导入类型"
          >
            <button
              className={`settings-radio ${mdImportMode === "document" ? "active" : ""}`}
              onClick={() => setMdImportMode("document")}
              type="button"
            >
              导入为文档
            </button>
            {DAILY_NOTES_ENABLED && (
              <button
                className={`settings-radio ${mdImportMode === "note" ? "active" : ""}`}
                onClick={() => setMdImportMode("note")}
                type="button"
              >
                导入为随笔
              </button>
            )}
          </div>

          {mdImportMode === "document" && (
            <div className="markdown-import-grid">
              <div className="markdown-import-field markdown-import-path-field">
                <span>目标路径</span>
                <input
                  className="settings-input"
                  aria-label="Markdown 导入目标路径"
                  placeholder="例如 references/networking"
                  value={mdImportPath}
                  disabled={mdImporting}
                  onChange={(event) => setMdImportPath(event.target.value)}
                />
                <button
                  ref={importPathTriggerRef}
                  type="button"
                  className="settings-btn-secondary"
                  disabled={mdImporting}
                  onClick={() => setImportPathPickerOpen(true)}
                >
                  从文档树选择路径
                </button>
                <small>可从现有目录树选择，也可手动输入新路径。</small>
                <small>
                  单独选文件时直接放入目标路径；选择目录时保留所选目录及全部子目录，例如
                  资料/网络/a.txt → 目标路径/资料/网络。空目录不导入。
                </small>
              </div>
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
                <span>概念标签</span>
                <input
                  className="settings-input"
                  aria-label="Markdown 导入概念标签"
                  placeholder="逗号分隔，可选"
                  value={mdImportConcepts}
                  onChange={(event) => setMdImportConcepts(event.target.value)}
                />
              </label>
            </div>
          )}

          <label className="markdown-import-field">
            <span>普通标签</span>
            <input
              className="settings-input"
              aria-label="Markdown 导入普通标签"
              placeholder="逗号分隔，可选"
              value={mdImportTags}
              onChange={(event) => setMdImportTags(event.target.value)}
            />
          </label>

          <div className="settings-button-row">
            <button
              className="settings-btn-secondary"
              onClick={() => mdInputRef.current?.click()}
              disabled={
                mdImporting ||
                (mdImportMode === "document" && !mdImportPath.trim())
              }
            >
              {mdImporting
                ? `导入中... ${mdImportProgress}/${mdImportTotal}`
                : "选择 .md / .txt 等文件"}
            </button>
            {mdImportMode === "document" && (
              <button
                className="settings-btn-secondary"
                onClick={() => directoryInputRef.current?.click()}
                disabled={
                  !directoryImportSupported ||
                  mdImporting ||
                  !mdImportPath.trim()
                }
              >
                选择目录导入
              </button>
            )}
            {(mdImporting || mdImportProgress > 0) && (
              <span className="settings-import-progress">
                {mdImportTotal > 0
                  ? `${mdImportProgress} / ${mdImportTotal} 已处理`
                  : ""}
                {mdImportCurrentFile ? ` · ${mdImportCurrentFile}` : ""}
              </span>
            )}
            {mdImportCount > 0 && !mdImporting && (
              <span className="settings-import-ok">
                已导入 {mdImportCount} 篇笔记
              </span>
            )}
            <input
              ref={mdInputRef}
              type="file"
              accept={TEXT_IMPORT_ACCEPT}
              multiple
              style={{ display: "none" }}
              onChange={handleMdImport}
            />
            <input
              ref={directoryInputRef}
              type="file"
              aria-label="导入文本目录"
              {...{ webkitdirectory: "" }}
              multiple
              style={{ display: "none" }}
              onChange={handleMdImport}
            />
          </div>
          <small>
            {directoryImportSupported
              ? "目录选择取决于系统文件选择器；若手机版无法选择目录，可改用多选文件，或在桌面端导入后同步。"
              : "当前环境不支持目录选择，请改用多选文件，或在桌面端导入后同步。"}
          </small>
        </div>
      </SettingsSection>
      {/* ═══════════════════════ */}
      {importPathPickerOpen && visible && (
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
    </>
  );
}
function formatStorageBytes(bytes: number | null): string {
  if (bytes === null) return "不可用";
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
