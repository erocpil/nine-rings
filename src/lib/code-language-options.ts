export interface CodeLanguageOption {
  value: string;
  label: string;
}

export const CODE_LANGUAGE_OPTIONS: readonly CodeLanguageOption[] = [
  { value: "c", label: "C" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "css", label: "CSS" },
  { value: "flow", label: "Flow / 流程" },
  { value: "go", label: "Go" },
  { value: "xml", label: "HTML / XML" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "makefile", label: "Makefile" },
  { value: "markdown", label: "Markdown" },
  { value: "mermaid", label: "Mermaid" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "bash", label: "Shell / Bash" },
  { value: "sql", label: "SQL" },
  { value: "", label: "Text" },
  { value: "typescript", label: "TypeScript" },
  { value: "yaml", label: "YAML" },
] as const;
