# Mermaid 在 Tauri 安装包中的样式策略

## 原因

Mermaid 在渲染时生成 SVG 内的 style 元素及节点 style 属性。Tauri 对打包资源默认追加 CSP nonce/hash；style-src 一旦包含 nonce/hash，原来的 unsafe-inline 就不再允许这些运行时样式。结果是 SVG 默认黑色填充、时序消息线没有 stroke，并且标签测量可能失真。开发服务器和普通 Web 的策略不同，因此仅跑普通浏览器用例无法覆盖。

依据：[Tauri CSP 文档](https://v2.tauri.app/security/csp/)、[Tauri 配置说明](https://v2.tauri.app/reference/config/#securityconfig)、[CSP2 样式规则](https://www.w3.org/TR/CSP2/#directive-style-src)。

## 修复范围

tauri.conf.json 的 dangerousDisableAssetCspModification 仅列出 style-src，保留既有 style-src 'self' 'unsafe-inline' 的实际语义。动态 SVG 样式和属性可以生效；脚本 CSP 及其自动 nonce/hash 注入仍保留，不增加 unsafe-inline/unsafe-eval 脚本许可。Mermaid 仍使用 strict 安全模式，颜色与源码不做二次替换。

这是对动态内联样式的明确许可。今后若收紧为 nonce 方案，必须同时处理 Mermaid 测量阶段的临时 DOM、最终 SVG style 元素与内联属性，不能只为最终图像添加 nonce。

## 验证与发布

e2e/mermaid-tauri-csp.spec.ts 从实际 Tauri 配置构造浏览器响应 CSP，并模拟未豁免时 Tauri 注入的样式 nonce。在修复前，WebKit 中粉色节点实际为 rgb(0, 0, 0)，复现截图症状；修复后检查自定义填充、默认填充、文字颜色、时序消息线及样式策略违规事件。

此测试模拟打包策略，不代替 macOS WKWebView 真机测试。修改需要重新构建、安装 Tauri 桌面包，单独更新 Web 资源无法修复已有安装包的策略。
