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
