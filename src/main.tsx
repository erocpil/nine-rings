import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickCapture from "./components/QuickCapture";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

// 根据 URL 参数判断窗口类型：?win=qc → Quick Capture，否则主窗口
const params = new URLSearchParams(window.location.search);
const isQuickCapture = params.get("win") === "qc";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isQuickCapture ? <QuickCapture /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
