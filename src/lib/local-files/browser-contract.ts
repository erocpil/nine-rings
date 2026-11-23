import type { FileNode, FilePage, LocalFileDigest, LocalFileFingerprint, LocalFileDetails, LocalFileSnapshot } from "./file-model";
import type { LocalFileListOptions } from "./tree";

export type BrowserPreview = { kind: "text"; value: string; truncated: boolean; markdownSource?: string } | { kind: "image"; value: string; truncated: false } | { kind: "pdf"; value: Blob; truncated: false } | { kind: "epub"; value: Blob; truncated: false };
export interface BrowserTextLocation { from: number; to: number; revision: string }
export interface BrowserFileOpen { rootId: string; rootName: string; node: FileNode; location?: BrowserTextLocation; headingFragment?: string; siblings?: readonly FileNode[] }

/** Trusted host ports, not a third-party permission grant. Implementations must
 * enforce their own root authorization and presentation/save boundaries. */
export interface BrowserDirectoryHost {
  assertActive(): void;
  files: {
    resolveLink?(rootId: string, node: string): Promise<FileNode>;
    list(rootId: string, node: string, offset: number, options: LocalFileListOptions): Promise<FilePage>;
    stat(rootId: string, node: string): Promise<LocalFileFingerprint>;
    readSnapshot(rootId: string, node: string): Promise<LocalFileSnapshot>;
    readEpubPreview?(rootId: string, node: string, signal?: AbortSignal): Promise<Blob>;
    readPdfPreview?(rootId: string, node: string, signal?: AbortSignal): Promise<Blob>;
    readImagePreview?(rootId: string, node: string, signal?: AbortSignal): Promise<string>;
    readImageAsset(rootId: string, node: string, signal?: AbortSignal): Promise<string>;
    fileProperties?(rootId: string, node: string): Promise<LocalFileDetails>;
    digest(rootId: string, node: string): Promise<LocalFileDigest>;
    digestByteLimit(): number;
  };
  /** Recheck save/auth/cancellation before accepting presentation. Once accepted,
   * a command may deactivate its caller and must not be reported as a failed read. */
  open(request: BrowserFileOpen, signal: AbortSignal): Promise<void>;
}

export interface BrowserDirectoryProvider {
  textSnapshot?(rootId: string, node: string, signal: AbortSignal): Promise<LocalFileSnapshot>;
  digestByteLimit(): number;
  contentDigest(rootId: string, node: string, signal: AbortSignal, binary?: boolean): Promise<LocalFileDigest>;
  preview(rootId: string, node: string, signal: AbortSignal): Promise<BrowserPreview>;
  page(rootId: string, node: string, offset: number, options: LocalFileListOptions, signal: AbortSignal): Promise<FilePage>;
  details?(rootId: string, node: string, signal: AbortSignal): Promise<LocalFileDetails>;
  properties(rootId: string, node: string, signal: AbortSignal): Promise<LocalFileFingerprint>;
  open(rootId: string, rootName: string, node: FileNode, signal: AbortSignal, location?: BrowserTextLocation, siblings?: readonly FileNode[]): Promise<void>;
  openMarkdownLink(rootId: string, from: string, href: string, signal: AbortSignal): Promise<void>;
}
