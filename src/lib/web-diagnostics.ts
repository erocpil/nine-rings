import type { WebStorageStatus } from "../hooks/useWebPlatform";
import { api } from "./api";
import { parseJsonAsync } from "./data-transform-client";

interface BackupShape {
  notes?: Array<{ storagePath?: unknown; content?: unknown }>;
  daily_pages?: Array<{ todos?: unknown }>;
}

export interface DiagnosticDataSummary {
  notes: number;
  documents: number;
  dailyNotes: number;
  dailyPages: number;
  todos: number;
  malformedNotes: number;
}

export function summarizeDiagnosticBackup(data: BackupShape): DiagnosticDataSummary {
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const pages = Array.isArray(data.daily_pages) ? data.daily_pages : [];
  return {
    notes: notes.length,
    documents: notes.filter((note) => typeof note.storagePath === "string" && note.storagePath.length > 0).length,
    dailyNotes: notes.filter((note) => !note.storagePath).length,
    dailyPages: pages.length,
    todos: pages.reduce((count, page) => count + (Array.isArray(page.todos) ? page.todos.length : 0), 0),
    malformedNotes: notes.filter((note) => !note.content || typeof note.content !== "object").length,
  };
}

export async function collectWebDiagnostics(storage: WebStorageStatus): Promise<Record<string, unknown>> {
  const backup = await api.export.data();
  const data = await parseJsonAsync<BackupShape>(backup);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: "Counts and runtime metadata only. Note content, titles, tags, IDs and credentials are excluded.",
    app: {
      version: __APP_VERSION__,
      online: navigator.onLine,
      standalone,
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    },
    runtime: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    },
    storage: {
      supported: storage.supported,
      persisted: storage.persisted,
      usage: storage.usage,
      quota: storage.quota,
      localStorageEntryCount: window.localStorage.length,
      sessionStorageEntryCount: window.sessionStorage.length,
    },
    data: summarizeDiagnosticBackup(data),
  };
}
