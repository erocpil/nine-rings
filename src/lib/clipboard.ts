/**
 * copyToClipboard — 安全的复制到剪贴板。
 *
 * 优先使用 navigator.clipboard API（需要安全上下文：HTTPS 或 localhost），
 * 失败时降级为 textarea + execCommand('copy') 方案（兼容纯 HTTP 访问）。
 */
export async function copyToClipboard(text: string, options: { reportFailure?: boolean } = {}): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 非安全上下文（HTTP）或权限拒绝 — 降级
  }

  const previousFocus = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    if (!copied && options.reportFailure) throw new Error("复制失败");
  } catch (error) {
    if (options.reportFailure) throw error;
  } finally {
    document.body.removeChild(textarea);
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }
}
