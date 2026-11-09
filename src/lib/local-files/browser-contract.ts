import type { FileNode, FilePage, LocalFileDigest, LocalFileFingerprint, LocalFileSnapshot } from "./file-model";
import type { LocalFileListOptions } from "./tree";

export interface BrowserTextLocation { from: number; to: number; revision: string }
export interface BrowserFileOpen { rootId: string; rootName: string; node: FileNode; location?: BrowserTextLocation }

/** Trusted host ports, not a third-party permission grant. Implementations must
 * enforce their own root authorization and presentation/save boundaries. */
export interface BrowserDirectoryHost {
  assertActive(): void;
  files: {
    list(rootId: string, node: string, offset: number, options: LocalFileListOptions): Promise<FilePage>;
    stat(rootId: string, node: string): Promise<LocalFileFingerprint>;
    readSnapshot(rootId: string, node: string): Promise<LocalFileSnapshot>;
    readImageAsset(rootId: string, node: string): Promise<string>;
    digest(rootId: string, node: string): Promise<LocalFileDigest>;
    digestByteLimit(): number;
  };
  /** Recheck save/auth/cancellation before accepting presentation. Once accepted,
   * a command may deactivate its caller and must not be reported as a failed read. */
  open(request: BrowserFileOpen, signal: AbortSignal): Promise<void>;
}

export interface BrowserDirectoryProvider {
  digestByteLimit(): number;
  contentDigest(rootId: string, node: string, signal: AbortSignal, binary?: boolean): Promise<LocalFileDigest>;
  preview(rootId: string, node: string, signal: AbortSignal): Promise<{ kind: "text" | "image"; value: string; truncated: boolean }>;
  page(rootId: string, node: string, offset: number, options: LocalFileListOptions, signal: AbortSignal): Promise<FilePage>;
  properties(rootId: string, node: string, signal: AbortSignal): Promise<LocalFileFingerprint>;
  open(rootId: string, rootName: string, node: FileNode, signal: AbortSignal, location?: BrowserTextLocation): Promise<void>;
}
