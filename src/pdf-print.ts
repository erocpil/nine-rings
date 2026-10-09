import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

declare global {
  interface Window {
    __NR_PRINT_HTML?: string;
    __NR_PRINT_TITLE?: string;
  }
}

async function start() {
  const html = window.__NR_PRINT_HTML;
  const title = window.__NR_PRINT_TITLE;
  delete window.__NR_PRINT_HTML;
  delete window.__NR_PRINT_TITLE;
  if (!html) throw new Error("打印文档未加载，请关闭窗口后重新导出。");
  const snapshot = new DOMParser().parseFromString(html, "text/html");
  // The snapshot is already sanitized by pdf-export; never execute its scripts.
  snapshot
    .querySelectorAll("script, iframe, object, embed")
    .forEach((node) => node.remove());
  document.head.replaceChildren(
    ...[...snapshot.head.childNodes].map((node) =>
      document.importNode(node, true),
    ),
  );
  document.body.replaceChildren(
    ...[...snapshot.body.childNodes].map((node) =>
      document.importNode(node, true),
    ),
  );
  const error = document.createElement("p");
  error.setAttribute("role", "alert");
  error.style.cssText = "color:#b42318;padding:0 16px;";
  const actions = document.querySelector(".print-actions")!;
  actions.append(error);
  const printButton = actions.querySelector<HTMLButtonElement>(".primary")!;
  const closeButton = actions.querySelector<HTMLButtonElement>(
    "button:not(.primary)",
  )!;
  closeButton.addEventListener("click", () => void getCurrentWindow().close());
  let printing = false;
  const print = async () => {
    if (printing) return;
    printing = true;
    printButton.disabled = true;
    error.textContent = "";
    try {
      await invoke("print_pdf_document", {
        title: title ?? document.title.replace(/\.pdf$/i, ""),
      });
    } catch (reason) {
      error.textContent = `无法启动打印：${String(reason)}`;
    } finally {
      printing = false;
      printButton.disabled = false;
    }
  };
  printButton.addEventListener("click", () => void print());
  // Native print operates on this WebView, after its own fonts/images have loaded.
  const images = Promise.all(
    [...document.images].map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
  await Promise.race([
    Promise.all([images, document.fonts.ready]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  await print();
}
void start().catch((reason) => {
  document.body.textContent = String(reason);
});
