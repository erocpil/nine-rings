interface EditorInsertDialogsProps {
  linkDialog: boolean;
  linkDialogUrl: string;
  setLinkDialog: (open: boolean) => void;
  setLinkDialogUrl: (url: string) => void;
  insertLink: () => void;
  imageDialog: boolean;
  imageUrl: string;
  setImageDialog: (open: boolean) => void;
  setImageUrl: (url: string) => void;
  insertImageUrl: () => void;
}

/** Controlled dialogs retain their original DOM location, autofocus and selection behavior. */
export function EditorInsertDialogs({ linkDialog, linkDialogUrl, setLinkDialog, setLinkDialogUrl, insertLink, imageDialog, imageUrl, setImageDialog, setImageUrl, insertImageUrl }: EditorInsertDialogsProps) {
  return (<>
    {/* ── 插入链接对话框（复用图片对话框样式）── */}
    {linkDialog && (
      <div className="image-dialog-overlay" onClick={() => setLinkDialog(false)}>
        <div className="image-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="image-dialog-header">
            插入链接
            <button className="image-dialog-close" onClick={() => setLinkDialog(false)}>✕</button>
          </div>
          <input
            className="image-dialog-input"
            placeholder="https://..."
            value={linkDialogUrl}
            onChange={(e) => setLinkDialogUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && insertLink()}
            autoFocus
          />
          <p className="image-dialog-hint">选中文字将变为链接；未选中时插入 URL 本身</p>
          <div className="image-dialog-actions">
            <button className="menu-btn" onClick={() => setLinkDialog(false)}>取消</button>
            <button className="menu-btn active" onClick={insertLink}>插入</button>
          </div>
        </div>
      </div>
    )}

    {/* ── 图片 URL 对话框 ── */}
    {imageDialog && (
      <div className="image-dialog-overlay" onClick={() => setImageDialog(false)}>
        <div className="image-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="image-dialog-header">
            插入图片
            <button className="image-dialog-close" onClick={() => setImageDialog(false)}>✕</button>
          </div>
          <input
            className="image-dialog-input"
            placeholder="图片 URL 或 base64"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && insertImageUrl()}
            autoFocus
          />
          <p className="image-dialog-hint">支持：https:// 或 data:image/... base64</p>
          <div className="image-dialog-actions">
            <button className="menu-btn" onClick={() => setImageDialog(false)}>取消</button>
            <button className="menu-btn active" onClick={insertImageUrl}>插入</button>
          </div>
        </div>
      </div>
    )}
  </>);
}
