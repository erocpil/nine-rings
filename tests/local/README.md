# 完整备份隔离演练

此目录不在普通 Vitest / CI 用例范围内。演练只读取显式指定的本机备份，使用 Node 进程内的 fake IndexedDB、内存 Git 对象和模拟宿主；禁止 `fetch`，不连接 GitHub、不导入真实数据库、不改写输入。

```sh
NR_SYNC_DRY_RUN_INPUT=/absolute/path/to/backup.json \
  bash scripts/with-local-tools.sh node scripts/rehearse-sync-backup.mjs
bash scripts/with-local-tools.sh npx tsc --project tsconfig.sync-local.json
```

输入上限 64 MiB，需至少两份文档及一个模板；测试在内存副本中改变两个标题与一个模板名。先在已有协议空间发布一个本机选择，保留远端及忽略选择；模拟分支更新成功但响应丢失，核对冻结记录并恢复接受状态。然后模拟另一客户端 Pull，正文应用后丢失确认，再按目标摘要核实恢复，断言不重复应用。

能力声明仅在本测试模块内模拟，生产 `CURRENT_SYNC_CAPABILITIES` 不变。输出仅有阶段、运行时、字节数、数量和耗时，不输出标题、正文、实体 ID 或凭据。大文件可能耗时数分钟；耗时包含重复认证、内存 Git 和 fake IndexedDB，不能当作真实网络或 SQLite 性能。

此演练验证完整数据的组装、64 MiB 目标预算、128 MiB 日志预算、持久记录回读和恢复逻辑；不证明真实进程重启、原生数据库导入、GitHub 网络传输、首次迁移或多设备并发已验收。小样本可用 `schema/sync/fixtures/candidate-entities-v1.json`，不依赖私有备份。

主入口按 Web、Tauri 分别启动进程，任一失败即停止，不继续下一端。`NR_SYNC_DRY_RUN_RUNTIME=web` 或 `tauri` 可只测一端。大数据路径使用普通函数与显式调用计数，避免 spy 的历史记录保留完整备份。

`NR_SYNC_DRY_RUN_HEAP_MB=1024` 可限制每个测试 worker 的 V8 老生代堆（允许 256～4096 MiB，不设置则沿用 Node 默认值）。它只影响测试，不修改系统或应用工具链。结果中的 `peakRssKiB` 为该 worker 最大常驻内存（KiB），包括年轻代、外部缓冲区、测试框架、模拟 Git/IndexedDB 和开发依赖，不能解释为应用峰值或“总内存不超过老生代限额”。实际应用存储和生产界面需单独测量。

直接运行 Vitest 配置仍可做功能检查，但不要把同一 worker 连续两端的内存高水位作为独立客户端测量。fake IndexedDB 会保留已完成事务/请求等测试对象；资源测量使用上述独立进程入口。

`NR_SYNC_DRY_RUN_SCENARIO=all-documents` 会在内存副本中修改全部文档标题和模板名称，发布所有差异，再从原始本机副本 Pull 全部差异并核验丢失确认恢复。它补充默认的本机/远端/忽略混合选择；不是所有正文、设置或保护记录同时改变的绝对最坏情况，也不覆盖首次迁移。

## 真实浏览器测量

```sh
NR_SYNC_DRY_RUN_INPUT=/absolute/path/to/backup.json \
  bash scripts/with-local-tools.sh node scripts/profile-sync-browser.mjs
# 同一命令加 NR_SYNC_PROFILE_BROWSER=webkit 可测 WebKit。
```

该入口单独打包现有认证/投影代码（生产压缩，无 Vitest/fake IndexedDB），启动只监听 127.0.0.1 随机端口的临时服务器和全新浏览器上下文，阻止访问其它 origin。备份通过浏览器自动化传入，不作为 HTTP 文件提供；真实 IndexedDB 仅使用隔离测试库，写入后回读并核对 SHA-256，最后删除测试库并关闭上下文。不会开启同步、修改产品数据库或连接 GitHub；输入仍限制 64 MiB，输出不含正文/标识/凭据。浏览器需已安装。

测量范围仅为候选认证/投影及原始来源字符串的真实 IndexedDB 往返，不是完整发布/Pull，也不是产品存储适配器或原生 SQLite。Chromium 输出各阶段结束时 CDP 的 JS 已用堆（不强制 GC），并非进程 RSS 或峰值；卸载后即时采样也不能证明稳定释放。WebKit 缺少对应接口，内存为 null，不拿 Chromium 堆值推断 Tauri。不得将这段的良好结果替代后续全流程和真实宿主测量。

512 MiB/1 GiB 老生代实验仅为诊断条件，不是产品最低内存或发布硬门禁。依据真实宿主的额外内存、响应性、失败与释放表现确定预算，再决定是否进行较大重构。
