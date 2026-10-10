import type { AutoSaveQueue } from "./auto-save-queue";
import type { DocumentSaveRevision } from "./document-save-revisions";

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
}

/** Live host targets, deliberately distinct from serializable SDK handles. */
export class DocumentEditSessions {
  private views = new Map<string, ViewSession>();
  private issued = new WeakMap<
    DocumentEditTarget,
    { session: ViewSession; revision: DocumentSaveRevision }
  >();
  private residents = new Map<string, object>();
  private residency = new Map<string, object>();
  constructor(private saves: AutoSaveQueue) {}

  retain(id: string): () => void {
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
    this.issued.set(target, { session: state, revision });
    return target;
  }
  validate(target: DocumentEditTarget): Readonly<DocumentSelection> {
    const issued = this.issued.get(target);
    const current = this.views.get(target.documentId);
    const revision = this.saves.revisionState(target.documentId);
    if (
      !issued ||
      current !== issued.session ||
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
