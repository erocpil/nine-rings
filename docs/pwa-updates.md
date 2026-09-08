# 手机 PWA 更新检查与恢复

## 已定位的更新缺口

- 原实现只监听注册后的 `updatefound`，没有接管 `registration.installing`。手机重新打开页面时，新 Worker 可能已经在安装，因而漏掉“新版就绪”通知。
- `registration.update()` 返回时并不代表安装完成。旧的更新按钮立即读取 `waiting`，可能为空，导致没有发出激活消息，也没有错误反馈。
- 除注册外，旧版只在页面变为可见时检查；持续前台使用、断网恢复缺少主动重试，失败的 Promise 也没有界面反馈。
- 页面导航采用版本内缓存优先，因此普通刷新仍可打开旧版。这是离线和资源版本一致性策略，不应通过清空用户数据来解决。

2026-09-08 核对线上 `/sw.js` 已有 `no-cache, no-store, must-revalidate` 响应头。没有取得问题手机的现场日志，不能据此断言每台设备都触发了同一个分支；上述生命周期缺口已用自动化测试覆盖。

## 更新流程

1. 启动、重新联网、回到前台时检查；前台持续使用时每 5 分钟检查。焦点/可见性事件合并并节流，避免重复下载。
2. 同时观察已有安装任务与后续安装事件，等待完整预缓存。检查/安装/激活均有超时和可重试错误提示。
3. 新版就绪后提示“保存并刷新”。保存期间暂停当前窗口的交互；保存失败取消刷新并显示错误。本地 IndexedDB 和文档不作清除。
4. 等待新版实际接管页面后刷新。其他窗口触发激活时，只提示本窗口保存并刷新，不强制刷新尚未保存的编辑。
5. 设置首页版本号下可手动“检查更新”，看到下载中、无待安装版本、就绪或失败状态。

注册使用 `updateViaCache: "none"`；预缓存资源使用 `Request(..., { cache: "reload" })`，避免新版缓存装入 HTTP 缓存中的旧入口。入口 HTML 也配置重新验证。预缓存继续整体成功后才允许激活，失败保留旧 Worker 的离线能力。

参考：[MDN update()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)、[MDN Service Worker 生命周期](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)。

## 验证与发布注意

- 单元测试：`npx vitest run tests/unit/pwa-updates.test.ts`。
- 生产构建浏览器测试：`npm run test:pwa`；模拟同一地址连续部署两个不同 Worker，覆盖安装中重启、下载失败与手动重试、保存后升级及离线重开。
- WebKit 更新回归：构建后执行 `npx playwright test --config playwright.pwa.config.ts e2e/pwa-update.spec.ts --browser=webkit --workers=1`。
- 这些测试模拟移动视口和真实 Service Worker，但不能代替真机独立安装模式验收。
- 修复需部署后才会进入手机。旧客户端还没有手动检查入口时，可先保存，联网重新打开应用；若仍没有提示，关闭该站点全部浏览器标签及系统任务切换器中的 PWA 后重新打开，让已经下载的等待版本接管。
- 不要卸载 PWA 或清除站点数据作为常规更新手段；尚未备份的本地数据可能丢失。

### 2026-09-08 验证记录

- 类型检查、Lint、生产构建通过；更新状态机 9 项单元测试及原有 PWA 构建/存储状态测试通过。
- Chromium 生产 PWA 测试 4 项通过。
- WebKit 更新专项 2 项通过，包括已有安装任务接管、保存后切换、安装失败重试，以及直接切断测试服务器连接后的缓存重开。
- 额外运行 WebKit 完整 PWA 套件时，原有 `context.setOffline(true)` 离线刷新测试报内部错误；改用页面自身刷新也未收到 load 事件。因此不宣称 WebKit 完整离线回归通过，仍需 iPhone 独立安装模式真机验收。
- 此次只修改和验证本地代码，未提交、推送或部署。核对时线上应用版本为 `b7a97ae.20260908T042433`。
