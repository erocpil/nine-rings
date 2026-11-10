import type { FileRoot } from "./file-model";
import type { BrowserDirectoryProvider } from "./browser-contract";
import type { BrowserMutation } from "./browser-operation-contract";
import type { BrowserOperationQueueCore } from "./browser-queue-core";
import type { searchLocalFiles } from "./search";

export interface BrowserSettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** Trusted application composition, never an installed plugin permission grant. */
export interface BrowserWorkspaceHost {
  readonly provider: BrowserDirectoryProvider;
  readonly queue: BrowserOperationQueueCore;
  readonly settings: BrowserSettingsStore;
  readonly showQueueHistory: boolean;
  assertActive(): void;
  roots(): Promise<FileRoot[]>;
  choose(): Promise<FileRoot | null>;
  addFiles(files: readonly File[]): FileRoot | null;
  displayPath(rootId: string, node: string): Promise<string>;
  readonly externalOpen?: { open(rootId: string, node: string, chooseApplication: boolean): Promise<boolean> };
  readonly absolutePaths: boolean;
  supportsDirectoryPicker(): boolean;
  supportsDirectoryChanges(rootId: string): boolean;
  canWrite(rootId: string): boolean;
  canTransfer(): boolean;
  canTrash(): boolean;
  subscribeMutations(listener: (change: BrowserMutation) => void): () => void;
  search: typeof searchLocalFiles;
}
