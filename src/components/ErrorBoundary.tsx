import React from "react";
import { isModuleLoadError, recoverModuleLoad } from "../lib/module-load-recovery";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  recovering: boolean;
  recoveryMessage: string | null;
}

/**
 * React 错误边界 — 捕获渲染期 JS 异常，避免全白屏。
 * 一旦捕获到错误，显示错误摘要和重试按钮。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, recovering: false, recoveryMessage: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, recovering: false, recoveryMessage: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = async () => {
    const { error } = this.state;
    if (!error || !isModuleLoadError(error)) {
      this.setState({ error: null, recoveryMessage: null });
      return;
    }
    this.setState({ recovering: true, recoveryMessage: null });
    try {
      await recoverModuleLoad();
    } catch (reason) {
      this.setState({
        recovering: false,
        recoveryMessage: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          background: "#0d1117",
          color: "#c9d1d9",
        }}>
          <h1 style={{ marginBottom: 8, fontSize: 20 }}>Nine Rings · 九环</h1>
          <p style={{ color: "#f85149", marginBottom: 16 }}>
            渲染出错：{this.state.error.message}
          </p>
          <pre style={{
            maxWidth: "100%",
            overflow: "auto",
            fontSize: 12,
            color: "#8b949e",
            background: "#161b22",
            padding: 12,
            borderRadius: 6,
            marginBottom: 16,
          }}>
            {this.state.error.stack}
          </pre>
          {this.state.recoveryMessage && <p style={{ color: "#d29922", margin: "0 0 16px" }}>{this.state.recoveryMessage}</p>}
          <button
            onClick={this.handleRetry}
            disabled={this.state.recovering}
            style={{
              padding: "8px 16px",
              background: "#238636",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {this.state.recovering ? "正在恢复…" : "重试"}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
