# 手机 PWA 更新检查与恢复

## 已定位的更新缺口

- 原实现只监听注册后的 `updatefound`，没有接管 `registration.installing`。手机重新打开页面时，新 Worker 可能已经在安装，因而漏掉“新版就绪”通知。
- `registration.update()` 返回时并不代表安装完成。旧的更新按钮立即读取 `waiting`，可能为空，导致没有发出激活消息，也没有错误反馈。
- 除注册外，旧版只在页面变为可见时检查；持续前台使用、断网恢复缺少主动重试，失败的 Promise 也没有界面反馈。
- 页面导航采用版本内缓存优先，因此普通刷新仍可打开旧版。这是离线和资源版本一致性策略，不应通过清空用户数据来解决。

2026-09-08 核对线上 `/sw.js` 已有 `no-cache, no-store, must-revalidate` 响应头。没有取得问题手机的现场日志，不能据此断言每台设备都触发了同一个分支；上述生命周期缺口已用自动化测试覆盖。

## 更新流程

### 安装失败 `state=redundant` 的根因（2026-09-08）

线上 `/sw.js` 的预缓存清单包含 `/assets/RecycleBin-vUfx7BMo.js`，该地址实测返回 HTTP 404。Vite 的 CSS 插件会在 `generateBundle` 中删除纯样式的 JS 中间块，而原 PWA 插件在删除之前生成清单，导致安装请求一个最终不存在的文件。任何一次重试都无法修复这个构建错误。

PWA 清单生成改为 `generateBundle.order: "post"`，在 Vite 清理完成后读取最终产物；生产 PWA 测试会逐项检查清单文件存在。安装同时改为最多 4 个并发任务、下载失败最多尝试 3 次；只有完整缓存成功才允许激活，失败时等所有写入结束后移除该次构建的缓存。

Worker 会报告失败资源、下载/缓存写入阶段、HTTP 状态、尝试次数和构建标识，页面的“查看详情 / 一键复制详情”接收这些信息。兼容消息先于或晚于 `redundant` 状态到达，重试成功后清除错误。已有旧客户端仍可能只显示通用错误，但可以安装修正清单后的 Worker；无需清除站点数据。

这次线上验证定位到构建清单错误，不能将 `redundant` 一概归因于手机网络或存储空间。

本次验证：生产构建（含 TypeScript 检查）、Lint、PWA 构建测试通过；更新状态机 13 项单元测试通过；Chromium 4 项 PWA 测试通过；WebKit 3 项更新测试通过，涵盖失败资源详情、手动重试与短暂下载失败自动恢复。修改尚未提交或部署，仍需发布后真机验收。

## 更新行为

### HTTP 200 后图标下载中断（2026-09-09）

现场详情：`build=d2b6443.20260909T130341 cache=nine-rings-1s3om48`，`resource=/icon-192.png stage=cache-write status=200 attempt=1 AbortError: Fetch is aborted`。核对线上 Worker 与该版本相符，图标响应头返回 200、image/png、Content-Length 70407，未发现此前那类清单 404 问题；一次响应头检查不能证明手机当时的正文传输正常。

代码存在明确缺口：fetch 在响应头到达后即可返回，原实现立刻进入 cache.put，此时正文可能还在下载，15 秒 AbortController 定时器仍在运行。正文中断或超时会在 cache.put 中报错，而旧策略对所有 cache-write 错误都不重试，因此第一次失败就放弃整版安装。日志不能区分到底是计时器还是系统/网络触发中止，但可确认该错误被错误地当作不可重试的写入失败。

修复将过程拆为 download（响应头）、body-read（完整正文）、cache-write（已下载字节写入）。正文下载仍有 15 秒超时、最多 3 次尝试；完成正文后取消网络超时，再写缓存。重建 Response 时保留内容类型等响应头，删除已解码正文不再适用的 Content-Encoding/Content-Length。并发仍限制为 4，以限制暂存完整正文的内存占用；PDF 核心大资源仍按需缓存。

CacheStorage 的 AbortError/NetworkError 最多尝试 3 次，QuotaExceededError 等永久写入错误仍立即报告。最终错误新增 timeout 标志，便于区别主动超时与其它中止。失败仍等待所有写入结束、仅删除失败构建缓存，不清除旧版缓存或 IndexedDB。

新增生成 Worker 单测覆盖 200 后正文超时、慢缓存写入不触发下载中止、短暂写入中止、配额失败、连续正文失败与失败缓存清理；生产浏览器回归主动在图标返回 200 后截断正文，验证自动重试、完整升级及断网后图标仍可解码。需部署修复版本后手机才能获得此逻辑，不建议卸载 PWA 或清除站点数据来绕过问题。

验证：预缓存与更新状态机共 21 项单测通过，Chromium/WebKit 更新回归共 8 项通过；类型、Lint、格式、PWA 构建检查及生产构建通过。旧测试的手机设置入口已改用现有 Alt+, 快捷键，避免点击已移入抽屉的隐藏按钮。本次修复尚未提交或部署，仍待 iPhone 独立安装模式验收。

1. 启动时立即检查；前台定时检查周期为 30 分钟。重新联网、回到前台、窗口获得焦点和页面恢复显示共用 30 分钟冷却间隔（从最近一次实际检查开始计时，包含手动检查和失败尝试）。后台隐藏或离线时跳过自动检查；手动“检查更新”和明确应用更新不受冷却限制。此节流控制应用主动发起的检查，不限制浏览器自身的 Service Worker 更新行为。
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
