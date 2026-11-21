import { readWorkbenchLinkOrigin } from "./editor-window";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { WorkbenchSourceView } from "./SourceView";
import { bufferDocumentPort, createBufferDocumentHost, type BufferRecord } from "./buffer-documents";

type Props = ComponentProps<typeof WorkbenchSourceView> & { bufferId: string };
export function BufferSourceView(props: Props) {
  const [record, setRecord] = useState<BufferRecord | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let live = true; void bufferDocumentPort.read(props.bufferId).then(value => { if (live) setRecord(value); }, cause => { if (live) setError(String(cause)); }); return () => { live = false; }; }, [props.bufferId, attempt]);
  const { closeRequest, onClose } = props;
  useEffect(() => {
    if (!error) return;
    // No editable view was mounted. A window close can keep the native record as-is.
    closeRequest.current = afterLeave => (afterLeave ?? onClose)();
    return () => { closeRequest.current = null; };
  }, [error, closeRequest, onClose]);
  if (error) return <div className="workbench-source-view"><p role="alert">本机编辑文档读取失败：{error}</p><button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>重试</button></div>;
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
  const [origin, setOrigin] = useState<{ rootId: string; node: string } | null>(null);
  useEffect(() => {
    if (!metadata.path || !props.active) return;
    let live = true;
    void readWorkbenchLinkOrigin(`workbench-buffer:${initial.id}`).then(value => { if (live) setOrigin(value); }, () => { if (live) setOrigin(null); });
    return () => { live = false; };
  }, [initial.id, metadata.path, props.active]);
  const linkOrigin = useMemo(() => origin ? { ...origin, read: props.host.read } : undefined, [origin, props.host.read]);
  const file = { ...props.file, node: { ...props.file.node, name: metadata.name } };
  return <WorkbenchSourceView {...props} file={file} host={binding.host} provider={binding.provider} linkOrigin={linkOrigin} initialReadonly={false} persistDocument
    untitled={!metadata.path} documentPath={metadata.path ?? "尚未选择保存位置"} />;
}
