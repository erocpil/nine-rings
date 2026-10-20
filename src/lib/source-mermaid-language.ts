import { StreamLanguage } from "@codemirror/language";

/** Lightweight highlighting for Mermaid source; actual validation belongs to Mermaid. */
export const mermaidSourceLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/%%.*/)) return "comment";
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(/\b(?:flowchart|graph|subgraph|end|direction|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|participant|actor|Note|loop|alt|else|opt|rect|par|and|style|classDef|class|linkStyle|click|TB|TD|BT|LR|RL)\b/)) return "keyword";
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return "number";
    stream.next();
    return null;
  },
});
