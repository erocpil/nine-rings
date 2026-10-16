# 完整备份隔离演练

此目录不在普通 Vitest / CI 用例范围内。演练只读取显式指定的本机备份，使用 Node 进程内的 fake IndexedDB、内存 Git 对象和模拟宿主；禁止 `fetch`，不连接 GitHub、不导入真实数据库、不改写输入。

```sh
NR_SYNC_DRY_RUN_INPUT=/absolute/path/to/backup.json \
  bash scripts/with-local-tools.sh npx vitest run --config vitest.sync-local.config.ts
bash scripts/with-local-tools.sh npx tsc --project tsconfig.sync-local.json
```

输入上限 64 MiB，需至少两份文档及一个模板；测试在内存副本中改变两个标题与一个模板名。先在已有协议空间发布一个本机选择，保留远端及忽略选择；模拟分支更新成功但响应丢失，核对冻结记录并恢复接受状态。然后模拟另一客户端 Pull，正文应用后丢失确认，再按目标摘要核实恢复，断言不重复应用。

能力声明仅在本测试模块内模拟，生产 `CURRENT_SYNC_CAPABILITIES` 不变。输出仅有阶段、运行时、字节数、数量和耗时，不输出标题、正文、实体 ID 或凭据。大文件可能耗时数分钟；耗时包含重复认证、内存 Git 和 fake IndexedDB，不能当作真实网络或 SQLite 性能。

此演练验证完整数据的组装、64 MiB 目标预算、128 MiB 日志预算、持久记录回读和恢复逻辑；不证明真实进程重启、原生数据库导入、GitHub 网络传输、首次迁移或多设备并发已验收。小样本可用 `schema/sync/fixtures/candidate-entities-v1.json`，不依赖私有备份。
