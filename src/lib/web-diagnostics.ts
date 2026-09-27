import type { WebStorageStatus } from "../hooks/useWebPlatform";
import { api } from "./api";
import { parseJsonAsync } from "./data-transform-client";
import { readReaderDiagnostics } from "./reader-diagnostics";

interface BackupShape {
  notes?: Array<{ storagePath?: unknown; content?: unknown }>;
}

export interface DiagnosticDataSummary {
  notes: number;
  documents: number;
  malformedNotes: number;
}

export function summarizeDiagnosticBackup(data: BackupShape): DiagnosticDataSummary {
  const notes = Array.isArray(data.notes) ? data.notes : [];
  return {
    notes: notes.length,
    documents: notes.filter((note) => typeof note.storagePath === "string" && note.storagePath.length > 0).length,
    malformedNotes: notes.filter((note) => !note.content || typeof note.content !== "object").length,
  };
}

export async function collectWebDiagnostics(storage: WebStorageStatus): Promise<Record<string, unknown>> {
  const backup = await api.export.data();
  const data = await parseJsonAsync<BackupShape>(backup);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return {
    reportVersion: 1,
    readerEvents: readReaderDiagnostics(),
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
