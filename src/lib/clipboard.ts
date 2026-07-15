/**
 * copyToClipboard — 安全的复制到剪贴板。
 *
 * 优先使用 navigator.clipboard API（需要安全上下文：HTTPS 或 localhost），
 * 失败时降级为 textarea + execCommand('copy') 方案（兼容纯 HTTP 访问）。
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 非安全上下文（HTTP）或权限拒绝 — 降级
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    document.execCommand("copy");
  } catch {
    // 最终兜底：静默失败
  } finally {
    document.body.removeChild(textarea);
  }
}
