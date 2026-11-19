import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { WorkbenchSourceView } from "./SourceView";
import { bufferDocumentPort, createBufferDocumentHost, type BufferRecord } from "./buffer-documents";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";

type Props = ComponentProps<typeof WorkbenchSourceView> & { bufferId: string };
export function BufferSourceView(props: Props) {
  const [record, setRecord] = useState<BufferRecord | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let live = true; void bufferDocumentPort.read(props.bufferId).then(value => { if (live) setRecord(value); }, cause => { if (live) setError(String(cause)); }); return () => { live = false; }; }, [props.bufferId, attempt]);
  if (error) return <WorkspaceDialog title="新建文档读取失败" onClose={props.onClose}><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>重试</button></WorkspaceDialog>;
  if (!record) return <p role="status">正在恢复本机编辑文档…</p>;
  return <LoadedBuffer {...props} initial={record} />;
}
function LoadedBuffer({ initial, ...props }: Props & { initial: BufferRecord }) {
  const [metadata, setMetadata] = useState(initial);
  const metadataRef = useRef(initial);
  const binding = useMemo(() => createBufferDocumentHost(initial, props.host, props.provider, value => {
    const previous = metadataRef.current; metadataRef.current = value;
    if (value.path !== previous.path || value.name !== previous.name) setMetadata(value);
  }), [initial, props.host, props.provider]);
  const file = { ...props.file, node: { ...props.file.node, name: metadata.name } };
  return <WorkbenchSourceView {...props} file={file} host={binding.host} provider={binding.provider} initialReadonly={false} persistDocument
    untitled={!metadata.path} documentPath={metadata.path ?? "尚未选择保存位置"} />;
}
