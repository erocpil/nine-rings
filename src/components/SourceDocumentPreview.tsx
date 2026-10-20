import { DeferredFlowBlock } from "./DeferredFlowBlock";
import { MermaidDiagram } from "./MermaidDiagram";

/** Rendering is derived from the raw source; it never writes document content. */
export function SourceDocumentPreview({ language, source, fontSize }: { language: string; source: string; fontSize: number }) {
  return <div className="note-editor-scroll standalone-document-preview editor-content" aria-label={`${language === "flow" ? "Flow" : "Mermaid"} 渲染`} style={{ fontSize }}>
    {!source.trim() ? <p>暂无内容，切换到源码开始编辑。</p> : language === "flow" ? <DeferredFlowBlock source={source} /> : <MermaidDiagram source={source} interactive />}
  </div>;
}
