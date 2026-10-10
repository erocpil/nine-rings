import type { AutoSaveChanges } from "./auto-save-queue";

type Field = keyof AutoSaveChanges;
type Fields = Partial<Record<Field, number>>;
export interface DocumentSaveRevision {
  readonly documentId: string;
  readonly documentGeneration: string;
  readonly contentRevision: number;
}
export class SaveBarrierError extends Error {
  constructor(
    readonly code: "STALE_REVISION" | "SAVE_FAILED" | "CANCELLED",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SaveBarrierError";
  }
}
type Session = {
  generation: string;
  revision: number;
  confirmed: number;
  batches: WeakMap<object, number>;
  accepted: Fields;
  saved: Fields;
  invalidations: Set<() => void>;
};
type Issued = { session: Session; fields: Fields };

/** Internal host tokens use object identity. The future SDK transport must issue
 * opaque wire handles; serializing/reconstructing this object is not authority. */
export class DocumentSaveRevisions {
  private sessions = new Map<string, Session>();
  private issued = new WeakMap<DocumentSaveRevision, Issued>();

  private session(id: string): Session {
    let state = this.sessions.get(id);
    if (!state) {
      state = {
        generation: crypto.randomUUID(),
        revision: 0,
        confirmed: 0,
        batches: new WeakMap(),
        accepted: {},
        saved: {},
        invalidations: new Set(),
      };
      this.sessions.set(id, state);
    }
    return state;
  }

  accept(id: string, field: Field, batch?: object): void {
    const state = this.session(id);
    if (!batch || state.batches.get(batch) !== state.revision)
      state.revision += 1;
    if (batch) state.batches.set(batch, state.revision);
    state.accepted[field] = state.revision;
  }

  capture(id: string): DocumentSaveRevision {
    const state = this.session(id);
    const token = Object.freeze({
      documentId: id,
      documentGeneration: state.generation,
      contentRevision: state.revision,
    });
    this.issued.set(token, { session: state, fields: { ...state.accepted } });
    return token;
  }

  private validate(id: string, token: DocumentSaveRevision): Issued {
    const issued = this.issued.get(token);
    if (
      !issued ||
      token.documentId !== id ||
      this.sessions.get(id) !== issued.session
    ) {
      throw new SaveBarrierError(
        "STALE_REVISION",
        "文档保存修订已失效，请重新获取目标",
      );
    }
    return issued;
  }

  covered(id: string, token: DocumentSaveRevision): boolean {
    const { session, fields } = this.validate(id, token);
    return (Object.keys(fields) as Field[]).every(
      (field) => (session.saved[field] ?? 0) >= fields[field]!,
    );
  }

  acknowledge(token: DocumentSaveRevision, writtenFields: Field[]): void {
    const { session, fields } = this.validate(token.documentId, token);
    for (const field of writtenFields) {
      const revision = fields[field];
      if (revision !== undefined)
        session.saved[field] = Math.max(session.saved[field] ?? 0, revision);
    }
    if (this.covered(token.documentId, token)) {
      session.confirmed = Math.max(session.confirmed, token.contentRevision);
    }
  }

  state(id: string) {
    const state = this.session(id);
    return {
      documentGeneration: state.generation,
      contentRevision: state.revision,
      confirmedRevision: state.confirmed,
    };
  }

  invalidate(id: string): void {
    const old = this.sessions.get(id);
    this.sessions.delete(id);
    // Notify after deleting so a late completion cannot acknowledge the old state.
    for (const listener of old?.invalidations ?? []) listener();
    old?.invalidations.clear();
  }

  invalidateAll(): void {
    for (const id of this.sessions.keys()) this.invalidate(id);
  }

  watch(
    id: string,
    token: DocumentSaveRevision,
    listener: () => void,
  ): () => void {
    const { session } = this.validate(id, token);
    session.invalidations.add(listener);
    return () => session.invalidations.delete(listener);
  }
}
