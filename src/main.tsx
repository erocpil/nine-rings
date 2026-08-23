import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
const QuickCapture = lazy(() => import("./components/QuickCapture"));
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getAdapter } from "./lib/storage";
import "./styles.css";

// 根据 URL 参数判断窗口类型：?win=qc → Quick Capture，否则主窗口
const params = new URLSearchParams(window.location.search);
const isQuickCapture = params.get("win") === "qc";

// 不等待 React effects 才请求 Web IndexedDB / Tauri 存储实现。动态导入在
// 应用外壳渲染时并行进行，可缩短随后读取上次文档的关键路径。
void getAdapter().catch((error) => {
  console.warn("[Storage] 启动预热失败，将在读取数据时重试:", error);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div style={{ padding: "1rem", fontSize: 13, color: "var(--text-muted)" }}>加载中...</div>}>
        {isQuickCapture ? <QuickCapture /> : <App />}
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
