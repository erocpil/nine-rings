import type { AutoSaveQueue } from "./auto-save-queue";
import type {
  DocumentRevisionEvent,
  DocumentSaveRevision,
} from "./document-save-revisions";

export type DocumentView = "rendered" | "source";
export interface DocumentSelection {
  from: number;
  to: number;
}
export interface DocumentEditTarget {
  readonly documentId: string;
  readonly documentGeneration: string;
  readonly contentRevision: number;
  readonly viewSession: string;
  readonly selectionEpoch: number;
  readonly view: DocumentView;
}
export interface InsertDocumentContent {
  type: "text" | "markdown";
  value: string;
}
export interface DocumentEditAdapter {
  editable(): boolean;
  insert(
    selection: Readonly<DocumentSelection>,
    content: InsertDocumentContent,
  ): boolean;
}
export class StaleEditTargetError extends Error {
  readonly code = "STALE_TARGET";
  constructor() {
    super("编辑目标已变化，请重新获取选区");
  }
}
interface ViewSession {
  owner: object;
  view: DocumentView;
  session: string;
  epoch: number;
  selection?: DocumentSelection;
  active: boolean;
  adapter?: DocumentEditAdapter;
}

/** Live host targets, deliberately distinct from serializable SDK handles. */
export class DocumentEditSessions {
  private views = new Map<string, ViewSession>();
  // Handles may outlive a view; retain its identity, never its editor adapter.
  private issued = new WeakMap<DocumentEditTarget, string>();
  private residents = new Map<string, object>();
  private residency = new Map<string, object>();
  constructor(private saves: AutoSaveQueue) {}

  subscribeRevisions(
    listener: (event: DocumentRevisionEvent) => void,
  ): () => void {
    return this.saves.subscribeRevisions(listener);
  }

  retain(id: string): () => void {
    this.saves.captureRevision(id);
    const owner = {};
    this.residents.set(id, owner);
    this.residency.set(id, owner);
    return () => {
      if (this.residents.get(id) !== owner) return;
      this.residents.delete(id);
      this.views.delete(id);
      void this.saves
        .retireDocument(
          id,
          () => this.residency.get(id) === owner && !this.residents.has(id),
        )
        .then(() => {
          if (this.residency.get(id) === owner && !this.residents.has(id))
            this.residency.delete(id);
        })
        .catch(() => {
          /* Preserve failed data for retry/emergency export. */
        });
    };
  }

  activate(
    id: string,
    owner: object,
    view: DocumentView,
    active: boolean,
  ): void {
    const old = this.views.get(id);
    if (old?.owner === owner && old.view === view && old.active === active)
      return;
    this.views.set(id, {
      owner,
      view,
      active,
      session: crypto.randomUUID(),
      epoch: 0,
      adapter:
        old?.owner === owner && old.view === view ? old.adapter : undefined,
      selection:
        old?.owner === owner && old.view === view ? old.selection : undefined,
    });
  }
  select(
    id: string,
    owner: object,
    view: DocumentView,
    selection: DocumentSelection,
  ): void {
    const state = this.views.get(id);
    if (!state || state.owner !== owner || state.view !== view) return;
    if (
      state.selection?.from === selection.from &&
      state.selection.to === selection.to
    )
      return;
    state.selection = { ...selection };
    state.epoch += 1;
  }
  bind(
    id: string,
    owner: object,
    view: DocumentView,
    adapter: DocumentEditAdapter | null,
  ): void {
    const state = this.views.get(id);
    if (state?.owner === owner && state.view === view)
      state.adapter = adapter ?? undefined;
  }
  active(id: string): boolean {
    return this.views.get(id)?.active === true;
  }
  apply(
    target: DocumentEditTarget,
    content: InsertDocumentContent,
  ): DocumentSaveRevision {
    const selection = this.validate(target);
    const adapter = this.views.get(target.documentId)?.adapter;
    if (!adapter?.editable()) throw new Error("READ_ONLY");
    if (!adapter.insert(selection, content)) throw new StaleEditTargetError();
    return this.saves.captureRevision(target.documentId);
  }
  readRevision(id: string): DocumentSaveRevision {
    if (!this.active(id) || !this.saves.isStorageCurrent(id))
      throw new StaleEditTargetError();
    return this.saves.captureRevision(id);
  }
  pendingChanges(id: string) {
    return this.saves.pending(id);
  }
  whenSaved(
    id: string,
    revision: DocumentSaveRevision,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.saves.whenSaved(id, revision, signal);
  }
  capture(id: string): DocumentEditTarget {
    const state = this.views.get(id);
    if (!state?.active || !state.selection) throw new StaleEditTargetError();
    const revision = this.saves.captureRevision(id);
    const target = Object.freeze({
      ...revision,
      viewSession: state.session,
      selectionEpoch: state.epoch,
      view: state.view,
    });
    this.issued.set(target, state.session);
    return target;
  }
  validate(target: DocumentEditTarget): Readonly<DocumentSelection> {
    const issued = this.issued.get(target);
    const current = this.views.get(target.documentId);
    const revision = this.saves.revisionState(target.documentId);
    if (
      !issued ||
      !this.saves.isStorageCurrent(target.documentId) ||
      current?.session !== issued ||
      !current?.active ||
      !current.selection ||
      current.epoch !== target.selectionEpoch ||
      revision.documentGeneration !== target.documentGeneration ||
      revision.contentRevision !== target.contentRevision
    )
      throw new StaleEditTargetError();
    return Object.freeze({ ...current.selection });
  }
}
