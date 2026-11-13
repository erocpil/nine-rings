import { ProtectedNoteEditor } from "./ProtectedNoteEditor";
import { RenderedLinkMenu } from "./RenderedLinkMenu";
import { MarkdownDocumentView } from "./MarkdownDocumentView";
import { RenderedDocumentWorkspace, type NoteEditorProps } from "./RenderedDocumentWorkspace";
import { DocumentReferenceSearchContext } from "./DocumentReferenceSearchContext";
import { api } from "../lib/api";
export type { NoteEditorProps, RenderedWorkspaceHost } from "./RenderedDocumentWorkspace";
export { RenderedDocumentWorkspace } from "./RenderedDocumentWorkspace";
const searchDocuments = () => api.docs.search({});

/** Database-only composition. File hosts import the rendered workspace directly. */
export function NoteEditor(props: NoteEditorProps) {
  return <DocumentReferenceSearchContext.Provider value={searchDocuments}><ProtectedNoteEditor props={props} render={next => <RenderedLinkMenu key={next.noteId} noteId={next.noteId} onOpenLinkedNote={next.onOpenLinkedNote}><MarkdownDocumentView props={next} render={current => <RenderedDocumentWorkspace {...current} />} /></RenderedLinkMenu>} /></DocumentReferenceSearchContext.Provider>;
}
