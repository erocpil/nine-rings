# E2E 的 macOS / Linux / Windows 支持

E2E 使用本机浏览器验证真实平台行为。普通测试不改写 `navigator.platform`；平台分支测试可以显式模拟平台，但不能据此声称已验证该系统的原生键盘、剪贴板或窗口行为。

## 运行

三种系统使用同一锁文件和 Node 22。项目依赖留在 `node_modules`，浏览器由 Playwright 安装到用户缓存；Linux 的 `--with-deps` 会安装系统浏览器运行库，仅在 CI 或专用测试机使用。

```sh
npm ci
npx playwright install chromium webkit
npm run test:e2e:platforms
npm run test:e2e:platforms -- --browser=webkit
```

如需隔离浏览器缓存，可在终端设置 `PLAYWRIGHT_BROWSERS_PATH` 为项目外专用目录；安装和执行时必须使用相同值。不要在 npm scripts 中使用仅适用于 POSIX shell 的环境变量赋值。

`playwright.platforms.config.ts` 是持续运行的有限回归集，覆盖真实主快捷键、光标移动、原生剪贴板、创建保存、最近文档内存、导航、加密、首页与阅读分栏。它不替代完整 E2E。

完整运行：

```sh
npm run test:e2e -- --browser=chromium --workers=2
npm run test:e2e -- --browser=webkit --workers=2
npm run build
npx playwright test --config=playwright.pwa.config.ts --browser=chromium --workers=1
npx playwright test --config=playwright.pwa.config.ts --browser=webkit --workers=1
```

GitHub Actions 的 **E2E Native Platforms** 工作流自动运行三系统 × 两浏览器的有限回归集。手动选择 `suite=full` 可运行默认全套和生产/PWA；默认套件失败也会继续生产专项。各平台独立上传 JSON、截图与失败 trace，不因某个平台失败取消其他平台。

## 编写约定

- 普通复制、全选、撤销、重做和应用快捷键使用 Playwright `ControlOrMeta`。不要把全部 `Control` 替换成 `Meta`。macOS Control 文本移动、快捷键录制、Vim Control-R 等显式行为应保留原按键。
- 原生行首/行尾和文档起止使用 `helpers/keyboard.ts`。macOS 使用 Command 加方向键；Linux/Windows 使用 Home/End 或 Control+Home/End。只替换修饰键不能正确模拟 macOS 文档边界。
- 输出文件使用 `test.info().outputPath(...)`，由 Playwright 隔离不同用例、浏览器和重试。不要写死 `/tmp`，也不要让不同 worker 覆盖同一截图。
- 原生系统剪贴板用例通过 `requireNativeClipboard` 声明 Chromium 权限依赖；三种系统均验证。WebKit 的 ClipboardEvent、DataTransfer 和 Markdown/HTML 解析测试继续执行。不要把所有粘贴测试都限制为 Chromium。
- CDP 注入只在 Chromium 执行。WebKit 用事件回归覆盖应用逻辑；真实鼠标侧键仍需手动验证。
- 字体和换行可以不同，优先断言对齐关系、是否溢出、内容完整性。确需精确像素时固定测试字体与视口，不通过宽泛容差掩盖错位。
- 显式模拟 Windows/macOS 的用例必须同时设置两个分支，不能把“没有改 navigator.platform”当成 Windows。

## 验证边界与已有失败

接入矩阵不等于三平台全套已经通过。2026-09-27 的 macOS 完整基线包含旧界面选择器、固定 Control 快捷键、几何与其他尚待定位的失败。兼容改动保留业务断言，不批量删除或跳过这些失败。

WebKit 自动化离线重载内部错误已在独立 Service Worker 页面复现；生产离线测试仍保留失败，不能当作离线能力通过。已有阅读器 Blob 和性能诊断跳过项须单独审查。

本机运行只证明 macOS 行为；Linux 和 Windows 的原生兼容性以对应 CI 结果为准。对比耗时和失败数量时必须固定提交、依赖、浏览器版本、范围与并发数。

### 本轮本机验证（2026-09-27）

- 平台回归集：Chromium 30 项通过；WebKit 28 项通过、2 项跳过（CDP 鼠标侧键、原生剪贴板权限）。
- 原有代码块快捷键代表用例：Chromium 6 项通过；WebKit 同组加粘贴解析共 10 项通过。
- WebKit 多标签页同步与冲突：2 项通过，确认光标边界辅助函数不会阻塞多页面操作。
- 项目类型检查、新增 E2E/配置类型检查、全套测试发现、工作流 YAML 解析及差异检查通过。

本轮未重跑全部 850 项默认用例；Linux/Windows CI 尚未执行，不标记为已通过。
